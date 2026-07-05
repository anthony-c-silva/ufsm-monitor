// Comando icmp: mede conectividade e atraso encapsulando o fping.
//
// Uso:
//
//	go run ./cmd/icmp -target 1.1.1.1 -count 10
//	./bin/icmp -target 10.10.20.30 -count 20 -probe probe-ct-01
//
// Requer o binario `fping` instalado (apt-get install fping).
// A saida e um envelope JSON conforme contracts/result.schema.json.
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"math"
	"os"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"

	"ufsmmonitor/prototypes/internal/model"
)

// ICMPResult e o payload especifico (bloco "result") da medicao ICMP.
type ICMPResult struct {
	SamplesSent     int      `json:"samples_sent"`
	SamplesReceived int      `json:"samples_received"`
	LossPct         float64  `json:"loss_pct"`
	RTTMinMs        *float64 `json:"rtt_min_ms"`
	RTTAvgMs        *float64 `json:"rtt_avg_ms"`
	RTTMaxMs        *float64 `json:"rtt_max_ms"`
	JitterMs        *float64 `json:"jitter_ms"`
	RTTP50Ms        *float64 `json:"rtt_p50_ms,omitempty"`
	RTTP95Ms        *float64 `json:"rtt_p95_ms,omitempty"`
	RTTP99Ms        *float64 `json:"rtt_p99_ms,omitempty"`
}

func main() {
	target := flag.String("target", "", "endereco/host de destino (obrigatorio)")
	count := flag.Int("count", 10, "numero de amostras (fping -C)")
	probe := flag.String("probe", "", "id do probe (default: env PROBE_ID ou probe-dev-01)")
	flag.Parse()

	if *target == "" {
		fmt.Fprintln(os.Stderr, "erro: -target e obrigatorio")
		os.Exit(2)
	}

	started := time.Now()
	env := model.New(model.ProbeID(*probe), "icmp", *target, started)

	// Timeout amplo: fping envia 1 amostra por segundo por padrao.
	overall := time.Duration(*count)*1500*time.Millisecond + 5*time.Second
	ctx, cancel := context.WithTimeout(context.Background(), overall)
	defer cancel()

	// fping -C N -q escreve a linha de resultados por amostra no STDERR.
	cmd := exec.CommandContext(ctx, "fping", "-C", strconv.Itoa(*count), "-q", *target)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	// fping retorna exit != 0 quando ha perda; parseamos a saida de qualquer forma.
	combined := stderr.String() + stdout.String()
	env.Raw = map[string]string{"fping_output": strings.TrimSpace(combined)}

	if ctx.Err() == context.DeadlineExceeded {
		env.Finish(model.StatusTimeout, "fping excedeu o tempo limite")
		res := &ICMPResult{SamplesSent: *count, LossPct: 100}
		env.Result = res
		emit(env)
		return
	}

	rtts, sent, ok := parseFping(combined, *count)
	if !ok {
		msg := "nao foi possivel parsear a saida do fping"
		if runErr != nil {
			msg = msg + ": " + runErr.Error()
		}
		env.Finish(model.StatusFailure, msg)
		env.Result = &ICMPResult{SamplesSent: *count, LossPct: 100}
		emit(env)
		return
	}

	res := buildResult(rtts, sent)
	if res.SamplesReceived == 0 {
		env.Finish(model.StatusFailure, "100% de perda")
	} else {
		env.Finish(model.StatusSuccess, "")
	}
	env.Result = res
	emit(env)
}

// parseFping extrai os RTTs (em ms) da saida do fping -C.
// Linha esperada:  "10.10.20.30 : 0.12 0.15 - 0.14 ..."  ('-' = amostra perdida).
func parseFping(out string, count int) (rtts []float64, sent int, ok bool) {
	for _, line := range strings.Split(out, "\n") {
		idx := strings.Index(line, " : ")
		if idx < 0 {
			continue
		}
		fields := strings.Fields(line[idx+3:])
		if len(fields) == 0 {
			continue
		}
		for _, f := range fields {
			if f == "-" {
				continue
			}
			if v, err := strconv.ParseFloat(f, 64); err == nil {
				rtts = append(rtts, v)
			}
		}
		return rtts, len(fields), true
	}
	return nil, count, false
}

func buildResult(rtts []float64, sent int) *ICMPResult {
	res := &ICMPResult{
		SamplesSent:     sent,
		SamplesReceived: len(rtts),
	}
	if sent > 0 {
		res.LossPct = round(float64(sent-len(rtts)) / float64(sent) * 100)
	}
	if len(rtts) == 0 {
		res.LossPct = 100
		return res
	}

	sorted := append([]float64(nil), rtts...)
	sort.Float64s(sorted)

	min, max, sum := sorted[0], sorted[len(sorted)-1], 0.0
	for _, v := range sorted {
		sum += v
	}
	avg := sum / float64(len(sorted))

	res.RTTMinMs = ptr(round(min))
	res.RTTMaxMs = ptr(round(max))
	res.RTTAvgMs = ptr(round(avg))
	res.JitterMs = ptr(round(jitter(rtts)))

	// Percentis so fazem sentido com amostras suficientes.
	if len(sorted) >= 10 {
		res.RTTP50Ms = ptr(round(percentile(sorted, 50)))
		res.RTTP95Ms = ptr(round(percentile(sorted, 95)))
		res.RTTP99Ms = ptr(round(percentile(sorted, 99)))
	}
	return res
}

// jitter: media do valor absoluto das diferencas entre amostras consecutivas
// (variacao de atraso, na linha do RFC 3550). Usa a ordem original de chegada.
func jitter(rtts []float64) float64 {
	if len(rtts) < 2 {
		return 0
	}
	sum := 0.0
	for i := 1; i < len(rtts); i++ {
		sum += math.Abs(rtts[i] - rtts[i-1])
	}
	return sum / float64(len(rtts)-1)
}

// percentile pelo metodo nearest-rank. `sorted` deve estar ordenado.
func percentile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	rank := int(math.Ceil(p/100*float64(len(sorted)))) - 1
	if rank < 0 {
		rank = 0
	}
	if rank >= len(sorted) {
		rank = len(sorted) - 1
	}
	return sorted[rank]
}

func round(v float64) float64 { return math.Round(v*1000) / 1000 }
func ptr(v float64) *float64  { return &v }

func emit(env *model.Envelope) {
	if err := env.Emit(); err != nil {
		fmt.Fprintln(os.Stderr, "erro ao emitir JSON:", err)
		os.Exit(1)
	}
}
