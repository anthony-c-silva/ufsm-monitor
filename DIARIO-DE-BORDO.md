# Diário de Bordo — Plataforma Distribuída de Monitoramento da Rede da UFSM

Registro cronológico de decisões, progresso e pendências. Serve de matéria-prima
para a escrita do TCC (especialmente as seções de decisões de projeto e avaliação).

---

## Decisões de projeto (registro permanente)

- **DP-01 — Linguagens.** Controlador em **Python + FastAPI**; agente em **Go**.
  Motivo: o controlador é essencialmente API/CRUD + validação de planos JSON,
  onde FastAPI + Pydantic aceleram muito e ajudam a chegar antes aos experimentos.
  O agente exige binário único ARM, controle de subprocesso e AMQP persistente → Go.
  *Decidido em 2026-07-05.*
- **DP-02 — Contratos como fonte única.** Formatos de mensagem definidos em
  **JSON Schema** (`contracts/`), independentes de linguagem, para evitar
  divergência de schema entre agente (Go) e controlador (Python).
- **DP-03 — Envelope comum.** Todo resultado sai num envelope único
  (`schema_version, run_id, probe_id, kind, timestamps, status, result{}`),
  com bloco `result` tipado por medição. Espelha o modelo `measurement_runs` +
  tabelas específicas do banco.
- **DP-04 — Segurança na execução.** Toda medição roda via `exec.CommandContext`
  com **argumentos explícitos** e timeout; nunca `sh -c`. Conjunto **fechado** de
  tipos de medição.
- **DP-05 — iperf3 intrusivo.** Dois sentidos = duas execuções separadas
  (`-reverse`), nunca `--bidir`. Será serializado pelo scheduler na plataforma final.
- **DP-06 — Identidade do probe.** UUID **permanente**, não derivado de IP/hostname
  (o Pi troca de VLAN/IP). Nos protótipos vem de flag/env; no agente virá de arquivo.
- **DP-07 — Driver SQLite.** `modernc.org/sqlite` (Go puro, sem cgo). Motivo:
  cross-compila para ARM (Pi) sem toolchain C. `MaxOpenConns=1` no outbox local
  para consistência de PRAGMAs (WAL/synchronous/busy_timeout).
- **DP-08 — Entrega de tarefas na Fase 2.** Diretório-spool local (`TASKS_DIR`)
  como fonte de tarefas antes do RabbitMQ. Na Fase 3 o spool vira consumidor AMQP;
  o fluxo executar→persistir→publicar→confirmar→remover permanece.
- **DP-09 — Agente e protótipos em módulos separados.** `prototypes/` (Fase 1,
  stdlib, sem deps) e `agent/` (Fase 2, com SQLite) são módulos Go independentes,
  cada um buildável isoladamente. Alinhado com "probes homogêneos" e repositórios
  independentes por deployable.

---

## 2026-07-05 — Planejamento + início da Fase 1

**Feito**
- Documento `PLANEJAMENTO-INICIAL.md` (stack, roadmap, detalhamento Fases 1 e 2).
- Scaffold do repositório: `contracts/`, `prototypes/`, `scripts/`, `.gitignore`.
- Contratos JSON Schema: `contracts/result.schema.json` e `contracts/task.schema.json`.
- Pacote Go compartilhado `prototypes/internal/model` (envelope + UUID v4 + Emit).
- **Fase 1 — 6 protótipos em Go** (`prototypes/cmd/`):
  - `icmp` (fping): loss, min/avg/max, jitter, percentis p50/p95/p99.
  - `iperf3` (JSON): throughput, bytes, retransmits, direção.
  - `dns` (dig): RCODE, resolvedor, transporte, elapsed, answers.
  - `http` (httptrace nativo): fases DNS/TCP/TLS/TTFB/total.
  - `traceroute` (mtr --json): hops com RTT e perda.
  - `sysinfo` (stdlib + /proc): inventário do probe.
- `Makefile` (build + cross-compile arm64/armv7), `README.md`, exemplos em
  `contracts/examples/`, validador `scripts/validate_result.py`.

**Validação**
- 9 JSONs bem-formados; 6 exemplos de resultado validados contra o schema
  (jsonschema) — OK.
- **Pendente:** compilar e rodar o Go na máquina real (o ambiente de apoio não
  tinha Go/rede). Rodar: `cd prototypes && go vet ./... && make build`.

**Próximos passos**
- [ ] Instalar Go + `fping iperf3 dnsutils mtr-tiny` na máquina de dev.
- [ ] `go vet ./...` e `make build`; rodar cada protótipo e conferir o JSON.
- [ ] Validar saída real: `./bin/icmp -target 1.1.1.1 | python3 ../scripts/validate_result.py`.
- [ ] Fechar com o orientador: probes/prédios do piloto e a VPS externa de referência.
- [ ] Iniciar Fase 2 (agente mínimo: config, executor, outbox SQLite, /health, systemd).

**Notas para a escrita (métricas da spec §15)**
- Registrar, quando começar a medir de verdade: precisão temporal (agendado vs.
  real), sobrecarga do agente (CPU/mem/tráfego), confiabilidade (tarefas
  recebidas/executadas/armazenadas). Ainda não aplicável nesta fase.

---

## 2026-07-05 — Fase 2 (agente mínimo)

**Feito**
- Módulo `agent/` (`github.com/anthonycarlosp7/ufsm-monitor-agent`).
- `internal/model`: envelope + `Task` (com `Expired`/`TooEarly`) + UUID + escrita atômica.
- `internal/config`: carga por env + `EnsureProbeID` (env → arquivo → gera e persiste).
- `internal/measure`: executor com icmp, iperf3, dns, http (httptrace), traceroute,
  sysinfo; `Run(task)` despacha por tipo (conjunto FECHADO).
- `internal/outbox`: SQLite WAL com `pending_tasks`, `running_tasks`, `result_outbox`,
  `failed_tasks`, `agent_state`; fluxo executar→persistir→(publicar).
- `internal/health`: `/health`, `/version`, `/metadata` e `/` (alvo HTTP p/ outros probes).
- `cmd/ufsm-monitor-agent`: subcomandos `serve` (health + inventário + spool),
  `run-task`, `inventory`, `version`; shutdown gracioso (SIGINT/SIGTERM).
- `deploy/`: unit systemd (hardening + `CAP_NET_RAW`) e `agent.env.example`.
- `Makefile` (build + cross-compile arm64/armv7), README do agente, tarefas de exemplo.
- Root `README.md`, `.gitignore` atualizado, instruções de git/push.

**Pendências (precisam da sua máquina — sem Go/rede no ambiente de apoio)**
- [ ] `cd agent && go mod tidy` (baixa `modernc.org/sqlite`, gera `go.sum`).
- [ ] `go vet ./...` e `make build` (agent e prototypes).
- [ ] Testar: `run-task` de cada tipo; `serve` + `curl /health` + spool + inspeção do SQLite.
- [ ] Teste de tolerância: matar o agente no meio e confirmar resultados persistidos.

**Próximo (Fase 3)** — trocar o spool por consumidor RabbitMQ com publisher confirms
e ack; publicar os resultados da `result_outbox` e removê-los após confirmação.

---

## 2026-07-05 — Validação em hardware (WSL2 / Ubuntu, Go 1.26)

Ambiente de desenvolvimento: Windows + **WSL2 (Ubuntu)**, aberto no VSCode. Escolha
justificada: o agente é Linux-only (usa `syscall.Statfs`, `/proc` e ferramentas
`fping`/`mtr`), então o WSL replica o ambiente do Raspberry Pi. Go 1.26.

**Ajuste necessário:** repositório em `/mnt/c` (OneDrive) → Git acusava *dubious
ownership* (`exit status 128`) e o `go build` (VCS stamping) falhava. Resolvido com
`git config --global --add safe.directory '*'`.

**Fase 1 — validada ✔** `go vet` limpo; `make build` OK; os 6 protótipos rodaram e
emitiram JSON válido (icmp com percentis, sysinfo completo, http com fases
DNS/TCP/TLS/TTFB, dns NOERROR, traceroute com 9 hops). Validador jsonschema: OK.

**Fase 2 — validada ✔** `go mod tidy` baixou `modernc.org/sqlite v1.53.0`; `go vet`
limpo; `make build` OK. `run-task` executou a tarefa e persistiu na outbox (envelope
com `task_id`/`job_id`). `serve`: `/health`, `/version`, `/metadata` responderam;
tarefa deixada no spool foi executada automaticamente (http, success); shutdown
gracioso OK. Resultados (icmp, sysinfo, http) persistidos em `result_outbox`.

Nota: `result_outbox` guarda o envelope inteiro em `payload` (jsonb-like); o status
é lido via `json_extract(payload,'$.status')` — não há coluna `status` dedicada.

---

## 2026-07-06 — Fase 3 (RabbitMQ) implementada e validada

**Infra:** `infra/docker-compose.yml` com RabbitMQ 3.13-management via Docker Desktop
(integração WSL). UI em :15672, AMQP em :5672. Postgres/TimescaleDB e Grafana ficam
comentados para a Fase 5.

**Código:**
- `internal/broker` (amqp091-go): conexão + canal em modo *confirm*; declaração da
  topologia (exchanges `monitor.commands|results|events` topic; filas
  `probe.<id>.commands` e `monitor.ingestion.results`); `publish()` aguarda o
  publisher confirm antes de retornar; consumer com QoS=1 e ack/nack manual.
- `serve` ganhou consumidor de comandos e publisher que **drena a outbox**
  (publica → confirma → `AckResult` remove do SQLite), ambos com reconexão (5s).
  Heartbeat a cada 30s em `monitor.events`. Config: `AMQP_URL` (default local,
  `off` desabilita).
- Ferramentas de teste: `cmd/publish-task` (simula controlador enviando tarefa) e
  `cmd/sink-results` (simula ingestão consumindo `result.#`).

**Decisões:**
- **DP-10 — Fila de resultados durável.** O agente também declara
  `monitor.ingestion.results` (durável, bind `result.#`) para que resultados fiquem
  retidos no broker se a ingestão estiver fora — nada se perde.
- **DP-11 — Publicação sequencial com confirm 1:1.** Cada `Conn` é usada por uma
  única goroutine; publicações sequenciais garantem confirms casados 1:1 (sem
  concorrência no canal AMQP).

**Validação ✔** `go vet` limpo; `make build` OK (agente + ferramentas). Fluxo
completo observado: `publish-task` → RabbitMQ → agente consome/executa → outbox →
publisher (confirm) → `sink-results`. Resultados que estavam presos na outbox desde
a Fase 2 (sem broker) foram drenados assim que o broker subiu — store-and-forward
comprovado.

**Tolerância a falha — validada ✔** Com o RabbitMQ parado (`docker compose stop`),
uma medição gerada via spool ficou retida na `result_outbox` (contagem = 3); ao
religar o broker, o publisher reconectou e drenou tudo (contagem = 0). Nenhum
resultado perdido — critério central da Fase 3 comprovado.

**Próximo (Fase 4)** — controlador em Python/FastAPI: inventário, destinos, grupos,
planos JSON + validador + expansão de malha, scheduler, e o serviço de ingestão que
substitui o `sink-results` gravando no PostgreSQL/TimescaleDB.
