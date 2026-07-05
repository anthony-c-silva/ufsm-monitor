// Comando iperf3: mede vazao entre pares encapsulando o iperf3 com saida JSON.
//
// Uso:
//
//	go run ./cmd/iperf3 -target 10.10.20.30 -duration 10
//	./bin/iperf3 -target probe-cpd -reverse -probe probe-ct-01 -target-probe probe-cpd-01
//
// Requer `iperf3` no cliente e um servidor iperf3 escutando no destino
// (iperf3 -s). Medicao INTRUSIVA: na plataforma final sera serializada pelo
// scheduler. Os dois sentidos sao modelados como execucoes separadas (use -reverse),
// nunca --bidir.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"time"

	"ufsmmonitor/prototypes/internal/model"
)

// IperfResult e o bloco "result" da medicao de vazao.
type IperfResult struct {
	Protocol         string  `json:"protocol"`
	Direction        string  `json:"direction"`
	DurationSeconds  float64 `json:"duration_seconds"`
	BytesTransferred int64   `json:"bytes_transferred"`
	ThroughputBps    float64 `json:"throughput_bps"`
	Retransmits      int     `json:"retransmits"`
}

// iperfOutput mapeia apenas os campos usados da saida JSON do iperf3.
type iperfOutput struct {
	Error string `json:"error"`
	End   struct {
		SumSent     iperfSum `json:"sum_sent"`
		SumReceived iperfSum `json:"sum_received"`
	} `json:"end"`
}

type iperfSum struct {
	Bytes         int64   `json:"bytes"`
	BitsPerSecond float64 `json:"bits_per_second"`
	Retransmits   int     `json:"retransmits"`
	Seconds       float64 `json:"seconds"`
}

func main() {
	target := flag.String("target", "", "endereco do servidor iperf3 (obrigatorio)")
	duration := flag.Int("duration", 10, "duracao do teste em segundos (iperf3 -t)")
	reverse := flag.Bool("reverse", false, "sentido inverso (iperf3 -R): destino envia para a origem")
	probe := flag.String("probe", "", "id do probe de origem")
	targetProbe := flag.String("target-probe", "", "id do probe de destino, se o alvo for um probe")
	flag.Parse()

	if *target == "" {
		fmt.Fprintln(os.Stderr, "erro: -target e obrigatorio")
		os.Exit(2)
	}

	started := time.Now()
	env := model.New(model.ProbeID(*probe), "iperf3", *target, started)
	env.TargetProbe = *targetProbe

	overall := time.Duration(*duration)*time.Second + 15*time.Second
	ctx, cancel := context.WithTimeout(context.Background(), overall)
	defer cancel()

	args := []string{"-c", *target, "-J", "-t", strconv.Itoa(*duration)}
	if *reverse {
		args = append(args, "-R")
	}
	cmd := exec.CommandContext(ctx, "iperf3", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	direction := "source_to_target"
	if *reverse {
		direction = "target_to_source"
	}

	if ctx.Err() == context.DeadlineExceeded {
		env.Finish(model.StatusTimeout, "iperf3 excedeu o tempo limite")
		env.Result = &IperfResult{Protocol: "tcp", Direction: direction}
		emit(env)
		return
	}

	var out iperfOutput
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		msg := "saida do iperf3 nao e JSON valido"
		if runErr != nil {
			msg += ": " + runErr.Error()
		}
		if s := stderr.String(); s != "" {
			msg += " (" + s + ")"
		}
		env.Finish(model.StatusFailure, msg)
		env.Result = &IperfResult{Protocol: "tcp", Direction: direction}
		emit(env)
		return
	}
	env.Raw = out

	if out.Error != "" {
		env.Finish(model.StatusFailure, out.Error)
		env.Result = &IperfResult{Protocol: "tcp", Direction: direction}
		emit(env)
		return
	}

	// Throughput/bytes: usar o lado recebido (mais fiel ao que chegou).
	// Retransmissoes TCP sao reportadas no lado enviado.
	res := &IperfResult{
		Protocol:         "tcp",
		Direction:        direction,
		DurationSeconds:  out.End.SumReceived.Seconds,
		BytesTransferred: out.End.SumReceived.Bytes,
		ThroughputBps:    out.End.SumReceived.BitsPerSecond,
		Retransmits:      out.End.SumSent.Retransmits,
	}
	if res.DurationSeconds == 0 {
		res.DurationSeconds = float64(*duration)
	}
	env.Finish(model.StatusSuccess, "")
	env.Result = res
	emit(env)
}

func emit(env *model.Envelope) {
	if err := env.Emit(); err != nil {
		fmt.Fprintln(os.Stderr, "erro ao emitir JSON:", err)
		os.Exit(1)
	}
}
