// Package outbox implementa a fila local persistente do probe, em SQLite.
//
// Estrategia (spec 9): executar -> persistir no SQLite -> publicar -> confirmar
// -> remover da outbox. Persistir ANTES de publicar garante que nenhum
// resultado se perca se a conexao com o broker cair apos a medicao.
//
// Usa modernc.org/sqlite (Go puro, sem cgo) para facilitar o cross-compile
// para ARM. PRAGMAs recomendados pela spec: WAL + synchronous=NORMAL + busy_timeout.
package outbox

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/model"

	_ "modernc.org/sqlite"
)

// DB encapsula a fila local persistente.
type DB struct {
	sql *sql.DB
}

const schema = `
CREATE TABLE IF NOT EXISTS pending_tasks (
    task_id     TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS running_tasks (
    task_id    TEXT PRIMARY KEY,
    started_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS result_outbox (
    run_id     TEXT PRIMARY KEY,
    task_id    TEXT,
    kind       TEXT NOT NULL,
    payload    TEXT NOT NULL,
    created_at TEXT NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS failed_tasks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    TEXT,
    error      TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
`

// Open abre (ou cria) o banco local e garante o schema e os PRAGMAs.
func Open(path string) (*DB, error) {
	dsn := fmt.Sprintf(
		"file:%s?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)",
		path,
	)
	sqlDB, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// Outbox local tem baixa concorrencia; uma unica conexao evita surpresas
	// de locking e mantem os PRAGMAs consistentes.
	sqlDB.SetMaxOpenConns(1)
	if err := sqlDB.Ping(); err != nil {
		return nil, err
	}
	if _, err := sqlDB.Exec(schema); err != nil {
		return nil, err
	}
	return &DB{sql: sqlDB}, nil
}

// Close fecha o banco.
func (d *DB) Close() error { return d.sql.Close() }

func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// EnqueueTask registra uma tarefa recebida (ainda nao executada).
func (d *DB) EnqueueTask(t *model.Task) error {
	payload, err := json.Marshal(t)
	if err != nil {
		return err
	}
	_, err = d.sql.Exec(
		`INSERT OR REPLACE INTO pending_tasks(task_id, payload, received_at) VALUES(?,?,?)`,
		t.TaskID, string(payload), now(),
	)
	return err
}

// MarkRunning move a tarefa de pending para running.
func (d *DB) MarkRunning(taskID string) error {
	tx, err := d.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM pending_tasks WHERE task_id = ?`, taskID); err != nil {
		return err
	}
	if _, err := tx.Exec(
		`INSERT OR REPLACE INTO running_tasks(task_id, started_at) VALUES(?,?)`,
		taskID, now(),
	); err != nil {
		return err
	}
	return tx.Commit()
}

// SaveResult persiste um resultado na outbox e encerra a tarefa (remove de running).
// Este e o ponto critico: acontece ANTES de qualquer publicacao no broker.
func (d *DB) SaveResult(env *model.Envelope) error {
	payload, err := env.JSON()
	if err != nil {
		return err
	}
	tx, err := d.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT OR REPLACE INTO result_outbox(run_id, task_id, kind, payload, created_at, attempts)
		 VALUES(?,?,?,?,?,0)`,
		env.RunID, env.TaskID, env.Kind, string(payload), now(),
	); err != nil {
		return err
	}
	if env.TaskID != "" {
		if _, err := tx.Exec(`DELETE FROM running_tasks WHERE task_id = ?`, env.TaskID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// RecordFailure registra uma falha de execucao e encerra a tarefa.
func (d *DB) RecordFailure(taskID, errMsg string) error {
	tx, err := d.sql.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(
		`INSERT INTO failed_tasks(task_id, error, created_at) VALUES(?,?,?)`,
		taskID, errMsg, now(),
	); err != nil {
		return err
	}
	if taskID != "" {
		if _, err := tx.Exec(`DELETE FROM running_tasks WHERE task_id = ?`, taskID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM pending_tasks WHERE task_id = ?`, taskID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// PendingResult representa um resultado ainda nao publicado no broker.
type PendingResult struct {
	RunID    string
	TaskID   string
	Kind     string
	Payload  string
	Attempts int
}

// PendingResults retorna resultados aguardando publicacao (usado na Fase 3).
func (d *DB) PendingResults(limit int) ([]PendingResult, error) {
	rows, err := d.sql.Query(
		`SELECT run_id, task_id, kind, payload, attempts
		   FROM result_outbox ORDER BY created_at ASC LIMIT ?`, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PendingResult
	for rows.Next() {
		var p PendingResult
		if err := rows.Scan(&p.RunID, &p.TaskID, &p.Kind, &p.Payload, &p.Attempts); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// AckResult remove um resultado da outbox apos o publisher confirm (Fase 3).
func (d *DB) AckResult(runID string) error {
	_, err := d.sql.Exec(`DELETE FROM result_outbox WHERE run_id = ?`, runID)
	return err
}

// CountResults retorna quantos resultados aguardam publicacao (util para /health).
func (d *DB) CountResults() (int, error) {
	var n int
	err := d.sql.QueryRow(`SELECT COUNT(*) FROM result_outbox`).Scan(&n)
	return n, err
}

// SetState grava um par chave/valor de estado do agente.
func (d *DB) SetState(key, value string) error {
	_, err := d.sql.Exec(
		`INSERT OR REPLACE INTO agent_state(key, value, updated_at) VALUES(?,?,?)`,
		key, value, now(),
	)
	return err
}

// GetState le um valor de estado; ok=false se ausente.
func (d *DB) GetState(key string) (value string, ok bool, err error) {
	err = d.sql.QueryRow(`SELECT value FROM agent_state WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}
