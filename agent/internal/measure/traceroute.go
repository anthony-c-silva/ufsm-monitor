package measure

import (
	"bytes"
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"time"
)

// Hop e um salto individual na rota.
type Hop struct {
	TTL      int     `json:"ttl"`
	Address  string  `json:"address"`
	RTTAvgMs float64 `json:"rtt_avg_ms"`
	LossPct  float64 `json:"loss_pct"`
}

// TracerouteResult e o bloco "result" da medicao de caminho.
type TracerouteResult struct {
	Target string `json:"target"`
	Hops   []Hop  `json:"hops"`
}

type mtrOutput struct {
	Report struct {
		Hubs []struct {
			Count int     `json:"count"`
			Host  string  `json:"host"`
			Loss  float64 `json:"Loss%"`
			Avg   float64 `json:"Avg"`
		} `json:"hubs"`
	} `json:"report"`
}

// Traceroute registra a rota ate o destino com `mtr --json` (saida estruturada).
// Rodar com frequencia MENOR que ping/DNS (spec 6.5). Requer privilegio (raw sockets).
func Traceroute(ctx context.Context, target string, cycles, maxHops int) Result {
	if cycles <= 0 {
		cycles = 3
	}
	if maxHops <= 0 {
		maxHops = 30
	}
	overall := time.Duration(cycles)*time.Duration(maxHops)*time.Second + 15*time.Second
	cctx, cancel := context.WithTimeout(ctx, overall)
	defer cancel()

	cmd := exec.CommandContext(cctx, "mtr", "--json",
		"-c", strconv.Itoa(cycles),
		"-m", strconv.Itoa(maxHops),
		target)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	base := &TracerouteResult{Target: target}

	if cctx.Err() == context.DeadlineExceeded {
		return resTimeout("mtr excedeu o tempo limite", base, nil)
	}

	var out mtrOutput
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		msg := "saida do mtr nao e JSON valido"
		if runErr != nil {
			msg += ": " + runErr.Error()
		}
		if s := stderr.String(); s != "" {
			msg += " (" + s + ")"
		}
		return resFail(msg, base, nil)
	}

	res := &TracerouteResult{Target: target}
	for _, h := range out.Report.Hubs {
		res.Hops = append(res.Hops, Hop{
			TTL:      h.Count,
			Address:  h.Host,
			RTTAvgMs: h.Avg,
			LossPct:  h.Loss,
		})
	}
	if len(res.Hops) == 0 {
		return resFail("nenhum hop retornado", res, json.RawMessage(stdout.Bytes()))
	}
	return resOK(res, json.RawMessage(stdout.Bytes()))
}
