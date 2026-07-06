// Comando sink-results: consome e imprime os resultados publicados pelos probes.
// Simula o servico de ingestao (que na Fase 5 gravara no PostgreSQL/TimescaleDB).
//
// Uso:
//
//	go run ./cmd/sink-results
//	./bin/sink-results        # Ctrl+C para sair
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/anthonycarlosp7/ufsm-monitor-agent/internal/broker"
)

func main() {
	url := envOr("AMQP_URL", "amqp://guest:guest@localhost:5672/")
	conn, err := broker.Dial(url)
	if err != nil {
		log.Fatalf("conectar no broker: %v", err)
	}
	defer conn.Close()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("aguardando resultados na fila %s (Ctrl+C para sair)...", broker.QueueResults)
	n := 0
	err = conn.ConsumeResults(ctx, func(body []byte) error {
		n++
		fmt.Printf("=== resultado %d ===\n%s\n", n, string(body))
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("encerrado (%d resultados recebidos)", n)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
