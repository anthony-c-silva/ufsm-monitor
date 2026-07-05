// Package measure implementa a execucao das medicoes ativas do agente.
// Cada funcao encapsula uma ferramenta/rotina e devolve um Result neutro, que o
// chamador (executor -> outbox) transforma em model.Envelope.
package measure

import (
	"math"

	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/model"
)

// AgentVersion identifica a versao do agente (usada em /version e no inventario).
const AgentVersion = "0.1.0"

// Tipos de medicao suportados (conjunto FECHADO, spec 12).
const (
	KindICMP       = "icmp"
	KindIperf3     = "iperf3"
	KindDNS        = "dns"
	KindHTTP       = "http"
	KindTraceroute = "traceroute"
	KindSysinfo    = "sysinfo"
)

// Result e o desfecho de uma medicao, pronto para compor um model.Envelope.
type Result struct {
	Status  model.Status
	ErrMsg  string
	Payload interface{}
	Raw     interface{}
}

func resOK(payload, raw interface{}) Result {
	return Result{Status: model.StatusSuccess, Payload: payload, Raw: raw}
}
func resFail(msg string, payload, raw interface{}) Result {
	return Result{Status: model.StatusFailure, ErrMsg: msg, Payload: payload, Raw: raw}
}
func resTimeout(msg string, payload, raw interface{}) Result {
	return Result{Status: model.StatusTimeout, ErrMsg: msg, Payload: payload, Raw: raw}
}

func round3(v float64) float64  { return math.Round(v*1000) / 1000 }
func f64ptr(v float64) *float64 { return &v }
