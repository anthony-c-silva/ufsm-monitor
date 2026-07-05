// Comando traceroute: registra a rota ate um destino encapsulando o `mtr`
// com saida estruturada (--json).
//
// Uso:
//
//	go run ./cmd/traceroute -target 1.1.1.1
//	./bin/traceroute -target 200.19.0.1 -cycles 3 -max-hops 30 -probe probe-ct-01
//
// Requer `mtr`. Como usa sockets raw, normalmente exige privilegio (setuid do
// mtr-packet, ou execucao como root no servico). Rodar com frequencia MENOR que
// ping/DNS: volume de dados maior e rotas mudam devagar (spec 6.5).
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

// Hop e um salto individual na rota.
type Hop struct {
	TTL      int     `json:"ttl"`
	Address  string  `json:"address"`
	RTTAvgMs float64 `json:"rtt_avg_ms"`
	LossPct  float64 `json:"loss_pct"`
}

// TracerouteResult e o bloco "result" da medicao de caminho.
type TracerouteResult struct {
	Target string `json:"target"`
	Hops   []Hop  `json:"hops"`
}

// mtrOutput mapeia os campos usados da saida `mtr --json`.
type mtrOutput struct {
	Report struct {
		Hubs []struct {
			Count int     `json:"count"`
			Host  string  `json:"host"`
			Loss  float64 `json:"Loss%"`
			Avg   float64 `json:"Avg"`
		} `json:"hubs"`
	} `json:"report"`
}

func main() {
	target := flag.String("target", "", "endereco/host de destino (obrigatorio)")
	cycles := flag.Int("cycles", 3, "numero de ciclos (mtr -c)")
	maxHops := flag.Int("max-hops", 30, "TTL maximo (mtr -m)")
	probe := flag.String("probe", "", "id do probe")
	flag.Parse()

	if *target == "" {
		fmt.Fprintln(os.Stderr, "erro: -target e obrigatorio")
		os.Exit(2)
	}

	started := time.Now()
	env := model.New(model.ProbeID(*probe), "traceroute", *target, started)

	overall := time.Duration(*cycles)*time.Duration(*maxHops)*time.Second + 15*time.Second
	ctx, cancel := context.WithTimeout(context.Background(), overall)
	defer cancel()

	cmd := exec.CommandContext(ctx, "mtr", "--json",
		"-c", strconv.Itoa(*cycles),
		"-m", strconv.Itoa(*maxHops),
		*target)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	if ctx.Err() == context.DeadlineExceeded {
		env.Finish(model.StatusTimeout, "mtr excedeu o tempo limite")
		env.Result = &TracerouteResult{Target: *target}
		emit(env)
		return
	}

	var out mtrOutput
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		msg := "saida do mtr nao e JSON valido"
		if runErr != nil {
			msg += ": " + runErr.Error()
		}
		if s := stderr.String(); s != "" {
			msg += " (" + s + ")"
		}
		env.Finish(model.StatusFailure, msg)
		env.Result = &TracerouteResult{Target: *target}
		emit(env)
		return
	}
	env.Raw = json.RawMessage(stdout.Bytes())

	res := &TracerouteResult{Target: *target}
	for _, h := range out.Report.Hubs {
		res.Hops = append(res.Hops, Hop{
			TTL:      h.Count,
			Address:  h.Host,
			RTTAvgMs: h.Avg,
			LossPct:  h.Loss,
		})
	}

	if len(res.Hops) == 0 {
		env.Finish(model.StatusFailure, "nenhum hop retornado")
	} else {
		env.Finish(model.StatusSuccess, "")
	}
	env.Result = res
	emit(env)
}

func emit(env *model.Envelope) {
	if err := env.Emit(); err != nil {
		fmt.Fprintln(os.Stderr, "erro ao emitir JSON:", err)
		os.Exit(1)
	}
}
