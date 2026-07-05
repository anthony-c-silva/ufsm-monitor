package measure

import (
	"bytes"
	"context"
	"math"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ICMPResult e o bloco "result" da medicao ICMP.
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

// ICMP mede conectividade/atraso com fping -C (multiplas amostras por execucao).
func ICMP(ctx context.Context, target string, count int) Result {
	if count <= 0 {
		count = 10
	}
	overall := time.Duration(count)*1500*time.Millisecond + 5*time.Second
	cctx, cancel := context.WithTimeout(ctx, overall)
	defer cancel()

	cmd := exec.CommandContext(cctx, "fping", "-C", strconv.Itoa(count), "-q", target)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	combined := stderr.String() + stdout.String()
	raw := map[string]string{"fping_output": strings.TrimSpace(combined)}

	if cctx.Err() == context.DeadlineExceeded {
		return resTimeout("fping excedeu o tempo limite", &ICMPResult{SamplesSent: count, LossPct: 100}, raw)
	}

	rtts, sent, parsed := parseFping(combined, count)
	if !parsed {
		msg := "nao foi possivel parsear a saida do fping"
		if runErr != nil {
			msg += ": " + runErr.Error()
		}
		return resFail(msg, &ICMPResult{SamplesSent: count, LossPct: 100}, raw)
	}

	res := buildICMP(rtts, sent)
	if res.SamplesReceived == 0 {
		return resFail("100% de perda", res, raw)
	}
	return resOK(res, raw)
}

// parseFping extrai os RTTs (ms) da saida do fping -C.
// Linha: "10.10.20.30 : 0.12 0.15 - 0.14 ..."  ('-' = amostra perdida).
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

func buildICMP(rtts []float64, sent int) *ICMPResult {
	res := &ICMPResult{SamplesSent: sent, SamplesReceived: len(rtts)}
	if sent > 0 {
		res.LossPct = round3(float64(sent-len(rtts)) / float64(sent) * 100)
	}
	if len(rtts) == 0 {
		res.LossPct = 100
		return res
	}

	sorted := append([]float64(nil), rtts...)
	sort.Float64s(sorted)

	sum := 0.0
	for _, v := range sorted {
		sum += v
	}
	res.RTTMinMs = f64ptr(round3(sorted[0]))
	res.RTTMaxMs = f64ptr(round3(sorted[len(sorted)-1]))
	res.RTTAvgMs = f64ptr(round3(sum / float64(len(sorted))))
	res.JitterMs = f64ptr(round3(jitter(rtts)))

	if len(sorted) >= 10 {
		res.RTTP50Ms = f64ptr(round3(percentile(sorted, 50)))
		res.RTTP95Ms = f64ptr(round3(percentile(sorted, 95)))
		res.RTTP99Ms = f64ptr(round3(percentile(sorted, 99)))
	}
	return res
}

// jitter: media do |diferenca| entre amostras consecutivas (ordem de chegada).
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

// percentile pelo metodo nearest-rank; `sorted` deve estar ordenado.
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
