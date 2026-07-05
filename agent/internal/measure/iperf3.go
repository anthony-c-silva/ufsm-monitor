package measure

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"time"
)

// IperfResult e o bloco "result" da medicao de vazao.
type IperfResult struct {
	Protocol         string  `json:"protocol"`
	Direction        string  `json:"direction"`
	DurationSeconds  float64 `json:"duration_seconds"`
	BytesTransferred int64   `json:"bytes_transferred"`
	ThroughputBps    float64 `json:"throughput_bps"`
	Retransmits      int     `json:"retransmits"`
}

type iperfOutput struct {
	Error string `json:"error"`
	End   struct {
		SumSent     iperfSum `json:"sum_sent"`
		SumReceived iperfSum `json:"sum_received"`
	} `json:"end"`
}

type iperfSum struct {
	Bytes         int64   `json:"bytes"`
	BitsPerSecond float64 `json:"bits_per_second"`
	Retransmits   int     `json:"retransmits"`
	Seconds       float64 `json:"seconds"`
}

// Iperf3 mede vazao TCP. Os dois sentidos sao execucoes separadas (reverse),
// nunca --bidir (spec 6.2). Medicao INTRUSIVA: sera serializada pelo scheduler.
func Iperf3(ctx context.Context, target string, duration int, reverse bool) Result {
	if duration <= 0 {
		duration = 10
	}
	direction := "source_to_target"
	if reverse {
		direction = "target_to_source"
	}

	overall := time.Duration(duration)*time.Second + 15*time.Second
	cctx, cancel := context.WithTimeout(ctx, overall)
	defer cancel()

	args := []string{"-c", target, "-J", "-t", strconv.Itoa(duration)}
	if reverse {
		args = append(args, "-R")
	}
	cmd := exec.CommandContext(cctx, "iperf3", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	base := &IperfResult{Protocol: "tcp", Direction: direction}

	if cctx.Err() == context.DeadlineExceeded {
		return resTimeout("iperf3 excedeu o tempo limite", base, nil)
	}

	var out iperfOutput
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		msg := "saida do iperf3 nao e JSON valido"
		if runErr != nil {
			msg += ": " + runErr.Error()
		}
		if s := stderr.String(); s != "" {
			msg += " (" + s + ")"
		}
		return resFail(msg, base, nil)
	}
	if out.Error != "" {
		return resFail(out.Error, base, out)
	}

	res := &IperfResult{
		Protocol:         "tcp",
		Direction:        direction,
		DurationSeconds:  out.End.SumReceived.Seconds,
		BytesTransferred: out.End.SumReceived.Bytes,
		ThroughputBps:    out.End.SumReceived.BitsPerSecond,
		Retransmits:      out.End.SumSent.Retransmits,
	}
	if res.DurationSeconds == 0 {
		res.DurationSeconds = float64(duration)
	}
	return resOK(res, out)
}
