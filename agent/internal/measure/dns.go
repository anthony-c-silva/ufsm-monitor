package measure

import (
	"bytes"
	"context"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
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

// DNSParams parametriza uma consulta DNS.
type DNSParams struct {
	QName     string
	QType     string
	Resolver  string
	TCP       bool
	TimeoutMs int
}

var (
	dnsReStatus  = regexp.MustCompile(`status:\s*([A-Z]+)`)
	dnsReAnswers = regexp.MustCompile(`ANSWER:\s*(\d+)`)
	dnsReQtime   = regexp.MustCompile(`Query time:\s*(\d+)\s*msec`)
	dnsReMsgSize = regexp.MustCompile(`MSG SIZE\s+rcvd:\s*(\d+)`)
	dnsReServer  = regexp.MustCompile(`SERVER:\s*([^#(\s]+)`)
)

// DNS mede a resolucao de nomes encapsulando o `dig`.
func DNS(ctx context.Context, p DNSParams) Result {
	if p.QType == "" {
		p.QType = "A"
	}
	if p.TimeoutMs <= 0 {
		p.TimeoutMs = 2000
	}
	transport := "udp"
	if p.TCP {
		transport = "tcp"
	}

	timeoutSec := (p.TimeoutMs + 999) / 1000
	if timeoutSec < 1 {
		timeoutSec = 1
	}
	args := []string{"+tries=1", "+time=" + strconv.Itoa(timeoutSec)}
	if p.TCP {
		args = append(args, "+tcp")
	}
	if p.Resolver != "" {
		args = append(args, "@"+p.Resolver)
	}
	args = append(args, p.QName, p.QType)

	cctx, cancel := context.WithTimeout(ctx, time.Duration(p.TimeoutMs)*time.Millisecond+2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(cctx, "dig", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	_ = cmd.Run()
	out := stdout.String()
	raw := map[string]string{"dig_output": strings.TrimSpace(out)}

	res := &DNSResult{QName: p.QName, QType: p.QType, Transport: transport, Resolver: p.Resolver}

	if cctx.Err() == context.DeadlineExceeded {
		res.Status = "timeout"
		return resTimeout("dig excedeu o tempo limite", res, raw)
	}

	if m := dnsReStatus.FindStringSubmatch(out); m != nil {
		res.RCode = m[1]
	}
	if m := dnsReAnswers.FindStringSubmatch(out); m != nil {
		res.AnswerCount, _ = strconv.Atoi(m[1])
	}
	if m := dnsReQtime.FindStringSubmatch(out); m != nil {
		v, _ := strconv.Atoi(m[1])
		res.ElapsedMs = float64(v)
	}
	if m := dnsReMsgSize.FindStringSubmatch(out); m != nil {
		res.ResponseBytes, _ = strconv.Atoi(m[1])
	}
	if res.Resolver == "" {
		if m := dnsReServer.FindStringSubmatch(out); m != nil {
			res.Resolver = m[1]
		}
	}
	res.Answers = parseDNSAnswers(out)

	switch {
	case res.RCode == "NOERROR":
		res.Status = "success"
		return resOK(res, raw)
	case res.RCode == "":
		res.Status = "failure"
		return resFail("sem resposta do resolvedor", res, raw)
	default:
		res.Status = "failure"
		return resFail("RCODE "+res.RCode, res, raw)
	}
}

func parseDNSAnswers(out string) []string {
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
