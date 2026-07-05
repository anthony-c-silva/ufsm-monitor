// Comando http: mede a experiencia de acesso web decompondo a requisicao em
// fases, usando o cliente HTTP nativo do Go com net/http/httptrace.
//
// Uso:
//
//	go run ./cmd/http -url https://www.ufsm.br
//	./bin/http -url https://servico.ufsm.br/health -timeout-ms 5000 -probe probe-ct-01
//
// Nao depende de ferramenta externa. httptrace fornece nativamente os eventos
// de DNS, conexao TCP, handshake TLS e primeiro byte da resposta -- por isso e
// preferido ao curl na versao final (spec 5.2).
package main

import (
	"context"
	"crypto/tls"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"os"
	"time"

	"ufsmmonitor/prototypes/internal/model"
)

// HTTPResult e o bloco "result" da medicao HTTP/HTTPS.
// NUNCA reduzir a um "RTT HTTP": a requisicao tem multiplas fases (spec 6.4).
type HTTPResult struct {
	URL            string  `json:"url"`
	HTTPStatus     int     `json:"http_status"`
	DNSMs          float64 `json:"dns_ms"`
	TCPConnectMs   float64 `json:"tcp_connect_ms"`
	TLSHandshakeMs float64 `json:"tls_handshake_ms"`
	TTFBMs         float64 `json:"ttfb_ms"`
	TotalMs        float64 `json:"total_ms"`
	ResponseBytes  int64   `json:"response_bytes"`
	Status         string  `json:"status"`
}

func main() {
	url := flag.String("url", "", "URL alvo (obrigatorio)")
	method := flag.String("method", "GET", "metodo HTTP")
	timeoutMs := flag.Int("timeout-ms", 5000, "timeout total em ms")
	probe := flag.String("probe", "", "id do probe")
	flag.Parse()

	if *url == "" {
		fmt.Fprintln(os.Stderr, "erro: -url e obrigatorio")
		os.Exit(2)
	}

	started := time.Now()
	env := model.New(model.ProbeID(*probe), "http", *url, started)
	res := &HTTPResult{URL: *url}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(*timeoutMs)*time.Millisecond)
	defer cancel()

	var dnsStart, connStart, tlsStart, reqStart time.Time
	var dnsDur, connDur, tlsDur, ttfb time.Duration

	trace := &httptrace.ClientTrace{
		DNSStart: func(httptrace.DNSStartInfo) { dnsStart = time.Now() },
		DNSDone:  func(httptrace.DNSDoneInfo) { dnsDur = time.Since(dnsStart) },
		ConnectStart: func(_, _ string) {
			if connStart.IsZero() {
				connStart = time.Now()
			}
		},
		ConnectDone:          func(_, _ string, _ error) { connDur = time.Since(connStart) },
		TLSHandshakeStart:    func() { tlsStart = time.Now() },
		TLSHandshakeDone:     func(tls.ConnectionState, error) { tlsDur = time.Since(tlsStart) },
		GotFirstResponseByte: func() { ttfb = time.Since(reqStart) },
	}

	req, err := http.NewRequestWithContext(ctx, *method, *url, nil)
	if err != nil {
		env.Finish(model.StatusFailure, "URL invalida: "+err.Error())
		res.Status = "failure"
		env.Result = res
		emit(env)
		return
	}
	req = req.WithContext(httptrace.WithClientTrace(ctx, trace))

	reqStart = time.Now()
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		status := model.StatusFailure
		if ctx.Err() == context.DeadlineExceeded {
			status = model.StatusTimeout
		}
		res.DNSMs = ms(dnsDur)
		res.TCPConnectMs = ms(connDur)
		res.TLSHandshakeMs = ms(tlsDur)
		res.TotalMs = ms(time.Since(reqStart))
		res.Status = "failure"
		env.Finish(status, err.Error())
		env.Result = res
		emit(env)
		return
	}
	defer resp.Body.Close()

	n, _ := io.Copy(io.Discard, resp.Body)
	total := time.Since(reqStart)

	res.HTTPStatus = resp.StatusCode
	res.DNSMs = ms(dnsDur)
	res.TCPConnectMs = ms(connDur)
	res.TLSHandshakeMs = ms(tlsDur)
	res.TTFBMs = ms(ttfb)
	res.TotalMs = ms(total)
	res.ResponseBytes = n
	res.Status = "success"

	env.Finish(model.StatusSuccess, "")
	env.Result = res
	emit(env)
}

// ms converte uma duracao para milissegundos com 3 casas decimais.
func ms(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000.0
}

func emit(env *model.Envelope) {
	if err := env.Emit(); err != nil {
		fmt.Fprintln(os.Stderr, "erro ao emitir JSON:", err)
		os.Exit(1)
	}
}
