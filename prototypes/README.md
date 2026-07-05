# Fase 1 — Protótipos de medição

Cada protótipo encapsula (ou implementa) **uma** medição e imprime no `stdout` um
**envelope JSON** conforme [`../contracts/result.schema.json`](../contracts/result.schema.json).
São a base reutilizável do `measurement-executor` do agente (Fase 2).

| Protótipo | Ferramenta | O que mede |
|---|---|---|
| `icmp`       | `fping`               | conectividade, perda, RTT (min/avg/max), jitter, percentis |
| `iperf3`     | `iperf3`              | vazão TCP, bytes, retransmissões (dois sentidos via `-reverse`) |
| `dns`        | `dig`                 | tempo de resolução, RCODE, resolvedor, transporte |
| `http`       | Go `net/http/httptrace` | fases: DNS, TCP, TLS, TTFB, total, status |
| `traceroute` | `mtr --json`          | rota até o destino, RTT e perda por hop |
| `sysinfo`    | Go stdlib + `/proc`   | inventário do probe (spec 4.1) |

## Pré-requisitos

- **Go 1.21+**
- Ferramentas externas: `fping`, `iperf3`, `dig` (dnsutils/bind-utils), `mtr`.
  No Debian/Raspberry Pi OS: `sudo apt-get install fping iperf3 dnsutils mtr-tiny`
- `mtr` usa sockets raw → precisa de privilégio (o pacote costuma vir setuid;
  no serviço, rode como root ou com `CAP_NET_RAW`).
- Para testar `iperf3`, o destino precisa de um servidor: `iperf3 -s`.

## Build

```bash
make build          # compila todos em ./bin/
make icmp           # compila só um
go build ./cmd/icmp # equivalente, binário no diretório atual
go vet ./...        # análise estática (rode sempre antes de commitar)
gofmt -l .          # lista arquivos fora do padrão (vazio = ok)
```

### Cross-compile para o Raspberry Pi

```bash
make build-arm64    # Pi 3/4/5 64-bit  -> bin/arm64/
make build-armv7    # Pi Zero/1/2 32-bit -> bin/armv7/
```

## Como rodar (exemplos)

```bash
# ICMP: 10 amostras
./bin/icmp -target 1.1.1.1 -count 10 -probe probe-ct-01

# Vazão TCP, sentido normal e inverso (execuções separadas, nunca --bidir)
./bin/iperf3 -target 10.10.20.30 -duration 10 -probe probe-ct-01 -target-probe probe-cpd-01
./bin/iperf3 -target 10.10.20.30 -duration 10 -reverse

# DNS por um resolvedor específico, via TCP
./bin/dns -qname www.ufsm.br -qtype A -resolver 10.0.0.53 -tcp

# HTTP/HTTPS com decomposição de fases
./bin/http -url https://www.ufsm.br -timeout-ms 5000

# Caminho de rede
sudo ./bin/traceroute -target 200.19.0.1 -cycles 3

# Inventário local
./bin/sysinfo -probe probe-ct-01
```

O `-probe` é opcional; se omitido, usa a variável de ambiente `PROBE_ID` ou `probe-dev-01`.

## Critério de saída da Fase 1

Cada protótipo gera um envelope JSON **válido** contra o schema, para os 6 tipos.
Valide assim:

```bash
# well-formed + campos obrigatórios (script incluído na raiz do repo)
./bin/icmp -target 1.1.1.1 | python3 ../scripts/validate_result.py
```

## Observações de projeto (para o TCC)

- **ICMP nunca guarda só a média** — a média esconde picos; registramos
  min/avg/max, jitter e percentis (spec 6.1).
- **iperf3 é intrusivo** — na plataforma final o scheduler serializa e reserva
  origem+destino. Aqui os dois sentidos são execuções separadas (spec 6.2).
- **HTTP tem fases** — não existe "RTT HTTP" único (spec 6.4). Usamos
  `httptrace`, que é a escolha da versão final.
- **Segurança** — toda execução usa `exec.CommandContext` com **argumentos
  explícitos** e timeout; nunca `sh -c` (evita injeção de comando, spec 5.1/12).
- **DNS** — use nomes estáveis e configuráveis; evite nomes aleatórios (spec 6.3).
