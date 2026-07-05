# ufsm-monitor-agent (Fase 2)

Agente homogêneo executado em cada probe (Raspberry Pi). Um único binário Go que:

- executa medições (ICMP, iperf3, DNS, HTTP/HTTPS, traceroute) com timeout e
  **argumentos explícitos** (sem `sh -c` — spec 5.1/12);
- persiste resultados numa **outbox SQLite (WAL)** *antes* de qualquer publicação,
  garantindo que nada se perca em queda de rede/broker (spec 9);
- coleta **inventário** periódico (identidade permanente, IP, rota, DNS, CPU/mem/disco);
- expõe **`/health`, `/version`, `/metadata`** (o `/` serve conteúdo mínimo, para ser
  alvo de testes HTTP de outros probes — spec 4.2);
- roda como serviço **systemd** com reinício automático.

> **Fase 2:** as tarefas chegam por um diretório-spool local (`TASKS_DIR`). Na Fase 3,
> esse spool será trocado por um consumidor **RabbitMQ** — o resto do fluxo
> (executar → persistir no SQLite → publicar → confirmar → remover) não muda.

## Estrutura

```
agent/
├── go.mod
├── cmd/ufsm-monitor-agent/main.go   # entrypoint + subcomandos
├── internal/
│   ├── config/       # env + identidade permanente (UUID persistido)
│   ├── model/        # envelope + Task (contraparte dos JSON Schemas)
│   ├── measure/      # icmp, iperf3, dns, http, traceroute, sysinfo, executor
│   ├── outbox/       # SQLite WAL (pending/running/result_outbox/failed/agent_state)
│   └── health/       # servidor /health /version /metadata
├── deploy/           # unit systemd + agent.env.example
└── examples/         # tarefas de exemplo para o spool / run-task
```

## Pré-requisitos

- **Go 1.21+**
- Ferramentas: `fping`, `iperf3`, `dig`, `mtr` (mesmas da Fase 1).
- SQLite via **`modernc.org/sqlite`** (Go puro, sem cgo → cross-compila para ARM).

## ⚠️ Passo obrigatório: resolver dependências (precisa de rede)

O `go.mod` ainda não fixou a dependência do SQLite. **Rode uma vez**, na sua máquina:

```bash
cd agent
go mod tidy      # baixa modernc.org/sqlite e gera go.sum
```

Sem isso, `go build` falha com "cannot find module for modernc.org/sqlite".

## Build

```bash
make build            # -> bin/ufsm-monitor-agent
go vet ./...          # rode antes de confiar (não pude compilar no ambiente de apoio)
make build-arm64      # cross-compile p/ Pi 64-bit -> bin/arm64/
make build-armv7      # cross-compile p/ Pi 32-bit -> bin/armv7/
```

## Rodar em modo de desenvolvimento (sem systemd)

```bash
# Executa UMA tarefa e imprime o envelope resultante:
PROBE_ID=probe-dev-01 SQLITE_PATH=./agent.db \
  ./bin/ufsm-monitor-agent run-task examples/task-icmp.json

# Sobe o serviço (health server + inventário + spool):
PROBE_ID=probe-dev-01 SQLITE_PATH=./agent.db TASKS_DIR=./tasks HEALTH_ADDR=:8080 \
  ./bin/ufsm-monitor-agent serve
# noutro terminal:
curl localhost:8080/health
curl localhost:8080/metadata
cp examples/task-http.json ./tasks/     # o agente detecta, executa e move p/ tasks/done
```

Inspecionar a outbox:

```bash
sqlite3 ./agent.db "SELECT kind, status, created_at FROM result_outbox;"
```

## Instalar como serviço (no probe)

```bash
sudo useradd --system --no-create-home ufsm-monitor
sudo install -m 0755 bin/arm64/ufsm-monitor-agent /usr/local/bin/
sudo mkdir -p /etc/ufsm-monitor
sudo cp deploy/agent.env.example /etc/ufsm-monitor/agent.env   # edite conforme o local
sudo cp deploy/ufsm-monitor-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ufsm-monitor-agent
systemctl status ufsm-monitor-agent
journalctl -u ufsm-monitor-agent -f
```

## Critério de saída da Fase 2

Um probe roda como serviço systemd, executa cada tipo de tarefa vindo de um
arquivo local, aplica timeout, e os resultados ficam persistidos na outbox SQLite
mesmo sem rede/broker; `/health` responde. ✔ quando isso rodar na sua máquina/Pi.

## Nota sobre o módulo

O caminho do módulo é `github.com/anthonycarlosp7/ufsm-monitor-agent`. Se o seu
usuário/repo no GitHub for diferente, ajuste a primeira linha do `go.mod` e os
imports (`sed -i` no diretório) — ou mantenha, pois o build local não depende
de o repositório existir no GitHub.
