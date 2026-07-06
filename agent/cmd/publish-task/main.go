// Comando publish-task: publica uma tarefa (arquivo JSON) na fila de comandos de
// um probe. Simula o controlador enviando um comando (ate a Fase 4 existir).
//
// Uso:
//
//	go run ./cmd/publish-task <probe_id> <arquivo.json>
//	AMQP_URL=amqp://guest:guest@localhost:5672/ ./bin/publish-task probe-dev-01 examples/task-icmp.json
package main

import (
	"log"
	"os"

	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/broker"
)

func main() {
	if len(os.Args) < 3 {
		log.Fatal("uso: publish-task <probe_id> <arquivo.json>")
	}
	probeID := os.Args[1]
	body, err := os.ReadFile(os.Args[2])
	if err != nil {
		log.Fatal(err)
	}

	url := envOr("AMQP_URL", "amqp://guest:guest@localhost:5672/")
	conn, err := broker.Dial(url)
	if err != nil {
		log.Fatalf("conectar no broker: %v", err)
	}
	defer conn.Close()

	if _, err := conn.DeclareCommandQueue(probeID); err != nil {
		log.Fatalf("declarar fila de comandos: %v", err)
	}
	if err := conn.PublishCommand(probeID, body); err != nil {
		log.Fatalf("publicar tarefa: %v", err)
	}
	log.Printf("tarefa publicada em probe.%s.command (%d bytes)", probeID, len(body))
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
