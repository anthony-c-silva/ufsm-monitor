package measure

import (
	"context"
	"encoding/json"

	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/model"
)

// Run despacha uma tarefa para a medicao correspondente, extraindo os
// parametros tipados de task.Parameters. Conjunto FECHADO de tipos: um tipo
// desconhecido nunca vira execucao de comando arbitrario (spec 12).
func Run(ctx context.Context, t *model.Task) Result {
	switch t.Type {
	case KindICMP:
		var p struct {
			Samples   int `json:"samples"`
			TimeoutMs int `json:"timeout_ms"`
		}
		_ = json.Unmarshal(t.Parameters, &p)
		return ICMP(ctx, t.Target, p.Samples)

	case KindIperf3:
		var p struct {
			DurationSeconds int  `json:"duration_seconds"`
			Reverse         bool `json:"reverse"`
		}
		_ = json.Unmarshal(t.Parameters, &p)
		return Iperf3(ctx, t.Target, p.DurationSeconds, p.Reverse)

	case KindDNS:
		var p struct {
			QName     string `json:"qname"`
			QType     string `json:"qtype"`
			Resolver  string `json:"resolver"`
			TCP       bool   `json:"tcp"`
			TimeoutMs int    `json:"timeout_ms"`
		}
		_ = json.Unmarshal(t.Parameters, &p)
		if p.QName == "" {
			p.QName = t.Target
		}
		return DNS(ctx, DNSParams{
			QName:     p.QName,
			QType:     p.QType,
			Resolver:  p.Resolver,
			TCP:       p.TCP,
			TimeoutMs: p.TimeoutMs,
		})

	case KindHTTP:
		var p struct {
			Method    string `json:"method"`
			TimeoutMs int    `json:"timeout_ms"`
		}
		_ = json.Unmarshal(t.Parameters, &p)
		return HTTP(ctx, t.Target, p.Method, p.TimeoutMs)

	case KindTraceroute:
		var p struct {
			Cycles  int `json:"cycles"`
			MaxHops int `json:"max_hops"`
		}
		_ = json.Unmarshal(t.Parameters, &p)
		return Traceroute(ctx, t.Target, p.Cycles, p.MaxHops)

	default:
		return Result{Status: model.StatusFailure, ErrMsg: "tipo de medicao desconhecido: " + t.Type}
	}
}
