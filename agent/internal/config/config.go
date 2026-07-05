// Package config carrega a configuracao do agente a partir de variaveis de
// ambiente (fornecidas pelo systemd via EnvironmentFile) e resolve a identidade
// permanente do probe.
package config

import (
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/model"
)

// Config reune todos os parametros de execucao do agente.
type Config struct {
	ProbeID           string        // id permanente do probe
	IdentityPath      string        // arquivo onde o UUID do probe e persistido
	SQLitePath        string        // caminho do banco local (outbox)
	HealthAddr        string        // endereco do servidor HTTP (/health, /version, /metadata)
	TasksDir          string        // diretorio-spool de tarefas locais (Fase 2, antes do RabbitMQ)
	InventoryInterval time.Duration // frequencia da coleta de inventario
	Deployment        string        // rotulo da implantacao (predio/sala), opcional
	VLAN              string        // rede/VLAN logica, opcional
}

// Load le a configuracao do ambiente, aplicando defaults sensatos.
func Load() Config {
	return Config{
		IdentityPath:      env("PROBE_ID_FILE", "/etc/ufsm-monitor/probe-id"),
		SQLitePath:        env("SQLITE_PATH", "/var/lib/ufsm-monitor/agent.db"),
		HealthAddr:        env("HEALTH_ADDR", ":8080"),
		TasksDir:          env("TASKS_DIR", "/var/lib/ufsm-monitor/tasks"),
		InventoryInterval: time.Duration(envInt("INVENTORY_INTERVAL_SECONDS", 60)) * time.Second,
		Deployment:        os.Getenv("DEPLOYMENT"),
		VLAN:              os.Getenv("VLAN"),
	}
}

// EnsureProbeID resolve o id permanente do probe.
// Ordem: variavel PROBE_ID -> arquivo de identidade -> gera e persiste um novo.
// O id NUNCA deriva de IP/hostname (spec 4.1).
func (c *Config) EnsureProbeID() (string, error) {
	if v := os.Getenv("PROBE_ID"); v != "" {
		c.ProbeID = v
		return v, nil
	}
	if data, err := os.ReadFile(c.IdentityPath); err == nil {
		id := trim(string(data))
		if id != "" {
			c.ProbeID = id
			return id, nil
		}
	}
	// Gera um novo id e persiste.
	id := "probe-" + model.NewUUID()
	if err := os.MkdirAll(filepath.Dir(c.IdentityPath), 0o755); err != nil {
		return "", err
	}
	if err := model.WriteFileAtomic(c.IdentityPath, []byte(id+"\n"), 0o644); err != nil {
		return "", err
	}
	c.ProbeID = id
	return id, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func trim(s string) string {
	for len(s) > 0 && (s[len(s)-1] == '\n' || s[len(s)-1] == '\r' || s[len(s)-1] == ' ') {
		s = s[:len(s)-1]
	}
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\n' || s[0] == '\r') {
		s = s[1:]
	}
	return s
}
