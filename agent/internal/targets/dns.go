package targets

import (
	"context"
	"fmt"
	"log"
	"net"

	"github.com/miekg/dns"
)

// RunDNSServer sobe um servidor DNS minimo que responde consultas do tipo A com
// um IP configurado (por padrao, o IP do proprio probe). Permite que outros
// probes midam o desempenho de resolucao DNS contra este probe. Escuta em UDP e
// TCP. Bloqueia ate o contexto ser cancelado; retorna erro se nao conseguir
// escutar na porta (o chamador trata como nao-fatal).
func RunDNSServer(ctx context.Context, port int, answerIP string) error {
	if answerIP == "" {
		answerIP = primaryIP()
	}
	ip := net.ParseIP(answerIP)
	if ip == nil {
		ip = net.ParseIP("127.0.0.1")
	}

	handler := dns.HandlerFunc(func(w dns.ResponseWriter, r *dns.Msg) {
		m := new(dns.Msg)
		m.SetReply(r)
		m.Authoritative = true
		for _, q := range r.Question {
			if q.Qtype == dns.TypeA {
				if v4 := ip.To4(); v4 != nil {
					m.Answer = append(m.Answer, &dns.A{
						Hdr: dns.RR_Header{Name: q.Name, Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: 60},
						A:   v4,
					})
				}
			}
		}
		_ = w.WriteMsg(m)
	})

	addr := fmt.Sprintf(":%d", port)
	udp := &dns.Server{Addr: addr, Net: "udp", Handler: handler}
	tcp := &dns.Server{Addr: addr, Net: "tcp", Handler: handler}

	go func() {
		<-ctx.Done()
		_ = udp.Shutdown()
		_ = tcp.Shutdown()
	}()
	go func() {
		if err := tcp.ListenAndServe(); err != nil && ctx.Err() == nil {
			log.Printf("servidor DNS (TCP): %v", err)
		}
	}()
	return udp.ListenAndServe()
}

// primaryIP descobre o IP de saida do probe (nao envia pacotes).
func primaryIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}
