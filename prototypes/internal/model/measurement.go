// Package model define o envelope de resultado comum a todas as medicoes.
// E a contraparte, em Go, de contracts/result.schema.json.
//
// Todo prototipo/agente produz um *Envelope e chama Emit para escreve-lo
// como JSON no stdout.
package model

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"time"
)

// SchemaVersion e a versao atual do contrato do envelope de resultado.
const SchemaVersion = "1.0"

// Status representa o desfecho de uma medicao.
type Status string

const (
	StatusSuccess Status = "success"
	StatusFailure Status = "failure"
	StatusTimeout Status = "timeout"
)

// Envelope e o wrapper comum de todo resultado de medicao.
// O campo Result carrega um payload especifico do tipo (ICMPResult, etc.).
type Envelope struct {
	SchemaVersion string      `json:"schema_version"`
	RunID         string      `json:"run_id"`
	TaskID        string      `json:"task_id,omitempty"`
	PlanID        string      `json:"plan_id,omitempty"`
	PlanRevision  int         `json:"plan_revision,omitempty"`
	JobID         string      `json:"job_id,omitempty"`
	ProbeID       string      `json:"probe_id"`
	Kind          string      `json:"kind"`
	Target        string      `json:"target,omitempty"`
	TargetProbe   string      `json:"target_probe,omitempty"`
	ObservedAt    time.Time   `json:"observed_at"`
	StartedAt     time.Time   `json:"started_at"`
	FinishedAt    time.Time   `json:"finished_at"`
	Status        Status      `json:"status"`
	ErrorMessage  string      `json:"error_message,omitempty"`
	Result        interface{} `json:"result,omitempty"`
	Raw           interface{} `json:"raw,omitempty"`
}

// New constroi um envelope com run_id gerado e timestamps preenchidos.
// started deve ser o instante imediatamente anterior a execucao da medicao.
func New(probeID, kind, target string, started time.Time) *Envelope {
	return &Envelope{
		SchemaVersion: SchemaVersion,
		RunID:         NewUUID(),
		ProbeID:       probeID,
		Kind:          kind,
		Target:        target,
		ObservedAt:    started.UTC(),
		StartedAt:     started.UTC(),
		FinishedAt:    time.Now().UTC(),
		Status:        StatusSuccess,
	}
}

// Finish marca o fim da medicao com o status e (opcional) mensagem de erro.
func (e *Envelope) Finish(status Status, errMsg string) {
	e.FinishedAt = time.Now().UTC()
	e.Status = status
	e.ErrorMessage = errMsg
}

// Emit serializa o envelope como JSON indentado no stdout.
func (e *Envelope) Emit() error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(e)
}

// NewUUID retorna um UUID aleatorio RFC 4122 versao 4 (sem dependencias externas).
func NewUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("00000000-0000-4000-8000-%012x", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40 // versao 4
	b[8] = (b[8] & 0x3f) | 0x80 // variante RFC 4122
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ProbeID resolve o identificador do probe a partir de (nesta ordem):
// a flag informada, a variavel de ambiente PROBE_ID, ou um valor padrao.
// No agente real (Fase 2) o id vem de um arquivo persistente.
func ProbeID(flagValue string) string {
	if flagValue != "" {
		return flagValue
	}
	if env := os.Getenv("PROBE_ID"); env != "" {
		return env
	}
	return "probe-dev-01"
}
