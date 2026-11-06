package measure

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Indicadores de saude da sonda, enviados junto com o inventario (sysinfo).
// Todos sao opcionais: o que nao existir no sistema fica de fora do JSON.

// clkTck e a unidade dos tempos de CPU em /proc (USER_HZ, 100 no Linux).
const clkTck = 100.0

// amostra anterior usada para calcular percentuais de CPU entre coletas.
var (
	cpuMu        sync.Mutex
	prevSysBusy  float64
	prevSysTotal float64
	prevProcCPU  float64
	prevProcWall time.Time
)

func readTrim(path string) (string, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(b)), true
}

func round1(v float64) float64 { return float64(int64(v*10+0.5)) / 10 }

// cpuTempC le a temperatura do SoC em graus Celsius.
func cpuTempC() *float64 {
	s, ok := readTrim("/sys/class/thermal/thermal_zone0/temp")
	if !ok {
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	t := round1(v / 1000)
	return &t
}

// cpuFreqMHz le a frequencia atual do nucleo 0.
func cpuFreqMHz() *float64 {
	s, ok := readTrim("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq")
	if !ok {
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	f := round1(v / 1000)
	return &f
}

// throttled devolve a mascara de limitacao do Raspberry Pi (formato do
// vcgencmd get_throttled). Bits 0-3 indicam a condicao atual e 16-19 se ela
// ocorreu desde o boot.
func throttled() (mask uint64, ok bool) {
	if s, found := readTrim("/sys/devices/platform/soc/soc:firmware/get_throttled"); found {
		if v, err := strconv.ParseUint(strings.TrimPrefix(s, "0x"), 16, 64); err == nil {
			return v, true
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "vcgencmd", "get_throttled").Output()
	if err != nil {
		return 0, false
	}
	s := strings.TrimSpace(string(out))
	s = strings.TrimPrefix(s, "throttled=")
	v, err := strconv.ParseUint(strings.TrimPrefix(s, "0x"), 16, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

var throttleNames = []string{"subtensao", "frequencia_limitada", "desempenho_reduzido", "limite_termico"}

func throttleFlags(mask uint64) (agora, desdeBoot []string) {
	for i, n := range throttleNames {
		if mask&(1<<uint(i)) != 0 {
			agora = append(agora, n)
		}
		if mask&(1<<uint(16+i)) != 0 {
			desdeBoot = append(desdeBoot, n)
		}
	}
	return agora, desdeBoot
}

func uptimeSeconds() int64 {
	s, ok := readTrim("/proc/uptime")
	if !ok {
		return 0
	}
	f := strings.Fields(s)
	if len(f) == 0 {
		return 0
	}
	v, _ := strconv.ParseFloat(f[0], 64)
	return int64(v)
}

// linkSpeedMbps le a velocidade negociada da interface (-1 ou erro = desconhecida).
func linkSpeedMbps(iface string) int {
	if iface == "" {
		return 0
	}
	s, ok := readTrim("/sys/class/net/" + iface + "/speed")
	if !ok {
		return 0
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return 0
	}
	return v
}

// sysCPU devolve os tempos ocupado e total do processador (/proc/stat).
func sysCPU() (busy, total float64, ok bool) {
	s, found := readTrim("/proc/stat")
	if !found {
		return 0, 0, false
	}
	line := strings.SplitN(s, "\n", 2)[0]
	f := strings.Fields(line)
	if len(f) < 8 || f[0] != "cpu" {
		return 0, 0, false
	}
	var vals []float64
	for _, x := range f[1:] {
		v, _ := strconv.ParseFloat(x, 64)
		vals = append(vals, v)
	}
	for _, v := range vals {
		total += v
	}
	idle := vals[3]
	if len(vals) > 4 {
		idle += vals[4] // iowait
	}
	return total - idle, total, true
}

// procCPUSeconds soma o tempo de CPU do agente e dos processos de medicao que
// ele executou e aguardou (fping, iperf3, dig, mtr), a partir de /proc/self/stat.
func procCPUSeconds() (float64, bool) {
	s, ok := readTrim("/proc/self/stat")
	if !ok {
		return 0, false
	}
	i := strings.LastIndex(s, ")")
	if i < 0 {
		return 0, false
	}
	f := strings.Fields(s[i+1:])
	// apos o ")": estado(0) ... utime(11) stime(12) cutime(13) cstime(14)
	if len(f) < 15 {
		return 0, false
	}
	var sum float64
	for _, idx := range []int{11, 12, 13, 14} {
		v, _ := strconv.ParseFloat(f[idx], 64)
		sum += v
	}
	return sum / clkTck, true
}

// agentRSSKB le a memoria residente do agente.
func agentRSSKB() int64 {
	s, ok := readTrim("/proc/self/status")
	if !ok {
		return 0
	}
	for _, line := range strings.Split(s, "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				v, _ := strconv.ParseInt(f[1], 10, 64)
				return v
			}
		}
	}
	return 0
}

// cpuPercents calcula o uso do processador da sonda (% do total) e do agente
// (% de um nucleo) desde a coleta anterior. Na primeira coleta devolve nil.
func cpuPercents() (sistema, agente *float64) {
	cpuMu.Lock()
	defer cpuMu.Unlock()
	now := time.Now()

	if busy, total, ok := sysCPU(); ok {
		if prevSysTotal > 0 && total > prevSysTotal {
			v := round1(100 * (busy - prevSysBusy) / (total - prevSysTotal))
			sistema = &v
		}
		prevSysBusy, prevSysTotal = busy, total
	}
	if secs, ok := procCPUSeconds(); ok {
		if !prevProcWall.IsZero() {
			if dt := now.Sub(prevProcWall).Seconds(); dt > 0 {
				v := round1(100 * (secs - prevProcCPU) / dt)
				agente = &v
			}
		}
		prevProcCPU, prevProcWall = secs, now
	}
	return sistema, agente
}
