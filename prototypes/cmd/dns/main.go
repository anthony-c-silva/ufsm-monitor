// Comando dns: mede desempenho de resolucao de nomes encapsulando o `dig`.
//
// Uso:
//
//	go run ./cmd/dns -qname www.ufsm.br -qtype A
//	./bin/dns -qname www.ufsm.br -resolver 10.0.0.53 -tcp -probe probe-husm-01
//
// Requer `dig` (pacote dnsutils/bind-utils).
// Na versao final do agente, migrar para resolver nativo em Go (net.Resolver
// ou github.com/miekg/dns) para maior controle de RCODE/transporte.
//
// Regra da spec: use nomes estaveis e configuraveis (institucionais + poucos
// nomes publicos conhecidos). Evite nomes aleatorios: quebram a comparabilidade.
package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"ufsmmonitor/prototypes/internal/model"
)

// DNSResult e o bloco "result" da medicao DNS.
type DNSResult struct {
	Resolver      string   `json:"resolver"`
	QName         string   `json:"qname"`
	QType         string   `json:"qtype"`
	Transport     string   `json:"transport"`
	RCode         string   `json:"rcode"`
	AnswerCount   int      `json:"answer_count"`
	ElapsedMs     float64  `json:"elapsed_ms"`
	ResponseBytes int      `json:"response_bytes"`
	Answers       []string `json:"answers,omitempty"`
	Status        string   `json:"status"`
}

var (
	reStatus   = regexp.MustCompile(`status:\s*([A-Z]+)`)
	reAnswers  = regexp.MustCompile(`ANSWER:\s*(\d+)`)
	reQtime    = regexp.MustCompile(`Query time:\s*(\d+)\s*msec`)
	reMsgSize  = regexp.MustCompile(`MSG SIZE\s+rcvd:\s*(\d+)`)
	reServer   = regexp.MustCompile(`SERVER:\s*([^#(\s]+)`)
)

func main() {
	qname := flag.String("qname", "", "nome a consultar (obrigatorio)")
	qtype := flag.String("qtype", "A", "tipo de consulta (A, AAAA, MX, ...)")
	resolver := flag.String("resolver", "", "resolvedor a usar (default: o do sistema)")
	tcp := flag.Bool("tcp", false, "usar transporte TCP em vez de UDP")
	timeoutMs := flag.Int("timeout-ms", 2000, "timeout da consulta em ms")
	probe := flag.String("probe", "", "id do probe")
	flag.Parse()

	if *qname == "" {
		fmt.Fprintln(os.Stderr, "erro: -qname e obrigatorio")
		os.Exit(2)
	}

	started := time.Now()
	env := model.New(model.ProbeID(*probe), "dns", *qname, started)

	transport := "udp"
	if *tcp {
		transport = "tcp"
	}

	timeoutSec := (*timeoutMs + 999) / 1000
	if timeoutSec < 1 {
		timeoutSec = 1
	}
	args := []string{"+tries=1", "+time=" + strconv.Itoa(timeoutSec)}
	if *tcp {
		args = append(args, "+tcp")
	}
	if *resolver != "" {
		args = append(args, "@"+*resolver)
	}
	args = append(args, *qname, *qtype)

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*timeoutMs)*time.Millisecond+2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "dig", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	_ = cmd.Run()
	out := stdout.String()
	env.Raw = map[string]string{"dig_output": strings.TrimSpace(out)}

	res := &DNSResult{QName: *qname, QType: *qtype, Transport: transport, Resolver: *resolver}

	if ctx.Err() == context.DeadlineExceeded {
		res.Status = "timeout"
		env.Finish(model.StatusTimeout, "dig excedeu o tempo limite")
		env.Result = res
		emit(env)
		return
	}

	if m := reStatus.FindStringSubmatch(out); m != nil {
		res.RCode = m[1]
	}
	if m := reAnswers.FindStringSubmatch(out); m != nil {
		res.AnswerCount, _ = strconv.Atoi(m[1])
	}
	if m := reQtime.FindStringSubmatch(out); m != nil {
		v, _ := strconv.Atoi(m[1])
		res.ElapsedMs = float64(v)
	}
	if m := reMsgSize.FindStringSubmatch(out); m != nil {
		res.ResponseBytes, _ = strconv.Atoi(m[1])
	}
	if res.Resolver == "" {
		if m := reServer.FindStringSubmatch(out); m != nil {
			res.Resolver = m[1]
		}
	}
	res.Answers = parseAnswers(out, *qname)

	if res.RCode == "NOERROR" {
		res.Status = "success"
		env.Finish(model.StatusSuccess, "")
	} else if res.RCode == "" {
		res.Status = "failure"
		env.Finish(model.StatusFailure, "sem resposta do resolvedor")
	} else {
		res.Status = "failure"
		env.Finish(model.StatusFailure, "RCODE "+res.RCode)
	}
	env.Result = res
	emit(env)
}

// parseAnswers extrai os enderecos/valores da secao ANSWER da saida do dig.
func parseAnswers(out, qname string) []string {
	var answers []string
	inSection := false
	for _, line := range strings.Split(out, "\n") {
		if strings.HasPrefix(line, ";; ANSWER SECTION:") {
			inSection = true
			continue
		}
		if inSection {
			if strings.TrimSpace(line) == "" || strings.HasPrefix(line, ";;") {
				break
			}
			fields := strings.Fields(line)
			if len(fields) >= 5 {
				answers = append(answers, fields[len(fields)-1])
			}
		}
	}
	return answers
}

func emit(env *model.Envelope) {
	if err := env.Emit(); err != nil {
		fmt.Fprintln(os.Stderr, "erro ao emitir JSON:", err)
		os.Exit(1)
	}
}
