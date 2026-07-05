package measure

import (
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"net/http/httptrace"
	"time"
)

// HTTPResult e o bloco "result" da medicao HTTP/HTTPS (decomposta em fases).
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

// HTTP mede o acesso web com o cliente nativo do Go + httptrace (spec 5.2/6.4).
func HTTP(ctx context.Context, url, method string, timeoutMs int) Result {
	if method == "" {
		method = "GET"
	}
	if timeoutMs <= 0 {
		timeoutMs = 5000
	}
	res := &HTTPResult{URL: url, Status: "failure"}

	cctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
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

	req, err := http.NewRequestWithContext(cctx, method, url, nil)
	if err != nil {
		return resFail("URL invalida: "+err.Error(), res, nil)
	}
	req = req.WithContext(httptrace.WithClientTrace(cctx, trace))

	reqStart = time.Now()
	resp, err := http.DefaultTransport.RoundTrip(req)
	if err != nil {
		res.DNSMs = ms(dnsDur)
		res.TCPConnectMs = ms(connDur)
		res.TLSHandshakeMs = ms(tlsDur)
		res.TotalMs = ms(time.Since(reqStart))
		if cctx.Err() == context.DeadlineExceeded {
			return resTimeout(err.Error(), res, nil)
		}
		return resFail(err.Error(), res, nil)
	}
	defer resp.Body.Close()

	n, _ := io.Copy(io.Discard, resp.Body)
	res.HTTPStatus = resp.StatusCode
	res.DNSMs = ms(dnsDur)
	res.TCPConnectMs = ms(connDur)
	res.TLSHandshakeMs = ms(tlsDur)
	res.TTFBMs = ms(ttfb)
	res.TotalMs = ms(time.Since(reqStart))
	res.ResponseBytes = n
	res.Status = "success"
	return resOK(res, nil)
}

func ms(d time.Duration) float64 { return float64(d.Microseconds()) / 1000.0 }
