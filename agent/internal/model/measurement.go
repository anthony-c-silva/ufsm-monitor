// Package model define o envelope de resultado e a tarefa de medicao,
// contrapartes em Go de contracts/result.schema.json e task.schema.json.
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

// Finish marca o fim da medicao com status e (opcional) mensagem de erro.
func (e *Envelope) Finish(status Status, errMsg string) {
	e.FinishedAt = time.Now().UTC()
	e.Status = status
	e.ErrorMessage = errMsg
}

// JSON serializa o envelope de forma indentada.
func (e *Envelope) JSON() ([]byte, error) {
	return json.MarshalIndent(e, "", "  ")
}

// Task e uma tarefa concreta de medicao enviada a um probe.
// Contraparte de contracts/task.schema.json.
type Task struct {
	TaskID       string          `json:"task_id"`
	PlanID       string          `json:"plan_id,omitempty"`
	PlanRevision int             `json:"plan_revision,omitempty"`
	JobID        string          `json:"job_id,omitempty"`
	Type         string          `json:"type"`
	SourceProbe  string          `json:"source_probe"`
	TargetProbe  string          `json:"target_probe,omitempty"`
	Target       string          `json:"target,omitempty"`
	NotBefore    time.Time       `json:"not_before"`
	ExpiresAt    time.Time       `json:"expires_at"`
	Parameters   json.RawMessage `json:"parameters"`
}

// Expired informa se a tarefa ja venceu (regra da spec: tarefa vencida nao roda).
func (t *Task) Expired(now time.Time) bool {
	return !t.ExpiresAt.IsZero() && now.After(t.ExpiresAt)
}

// TooEarly informa se ainda nao chegou a janela de execucao (not_before).
func (t *Task) TooEarly(now time.Time) bool {
	return !t.NotBefore.IsZero() && now.Before(t.NotBefore)
}

// NewUUID retorna um UUID aleatorio RFC 4122 versao 4.
func NewUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("00000000-0000-4000-8000-%012x", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// WriteFileAtomic grava data em path de forma atomica (tmp + rename).
func WriteFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
