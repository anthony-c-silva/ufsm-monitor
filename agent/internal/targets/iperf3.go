// Package targets implementa os servicos que cada probe OFERECE como alvo de
// medicao, permitindo medicoes mutuas entre probes e com o controlador
// (topologias estrela e malha). Alem destes, o probe responde a ICMP (via SO)
// e expoe um endpoint HTTP em /health (pacote health).
package targets

import (
	"context"
	"log"
	"os/exec"
	"strconv"
	"time"
)

// RunIperf3Server mantem um servidor iperf3 (`iperf3 -s`) ativo numa porta fixa,
// reiniciando caso ele caia. Recebe testes de vazao de outros probes.
// Na primeira versao o servidor fica sempre ativo; o acesso deve ser restrito a
// enderecos institucionais por firewall (spec 4.2 / 12).
func RunIperf3Server(ctx context.Context, port int) {
	for ctx.Err() == nil {
		cmd := exec.CommandContext(ctx, "iperf3", "-s", "-p", strconv.Itoa(port))
		if err := cmd.Start(); err != nil {
			log.Printf("servidor iperf3: falha ao iniciar (%v); nova tentativa em 5s", err)
			if sleep(ctx, 5*time.Second) {
				return
			}
			continue
		}
		err := cmd.Wait()
		if ctx.Err() != nil {
			return
		}
		log.Printf("servidor iperf3 encerrou (%v); reiniciando em 3s", err)
		if sleep(ctx, 3*time.Second) {
			return
		}
	}
}

func sleep(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return true
	case <-time.After(d):
		return false
	}
}
