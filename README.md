# Plataforma Distribuída de Monitoramento Ativo da Rede da UFSM

Plataforma de **monitoramento ativo** formada por *probes* homogêneos (Raspberry Pi)
que executam medições de rede (ICMP, vazão, DNS, HTTP/HTTPS, caminho) segundo
**planos declarativos**, com um controlador central que orquestra, consolida e
apresenta séries históricas. TCC — Ciência da Computação, UFSM.

> Objetivo: coletar medições de forma confiável, registrar séries históricas e
> apresentá-las para observação operacional. O sistema **observa e apresenta** os
> dados; **não** infere causa-raiz automaticamente.

## Arquitetura (visão geral)

```
Administração / visualização
        │
        ▼
Controlador central (Python + FastAPI)     ── inventário, planos JSON, scheduler, API
        │
        ▼
RabbitMQ (barramento assíncrono)           ── comandos, eventos, resultados
        │
        ▼
Probes homogêneos (Go: ufsm-monitor-agent) ── execução, outbox local, publicação
        │
        ▼
PostgreSQL + TimescaleDB                    ── inventário, planos, séries temporais
        │
        ▼
Grafana + interface própria                ── dashboards e matriz probe × destino
```

## Organização do repositório

| Pasta | Conteúdo | Estado |
|---|---|---|
| `contracts/`  | Formatos de mensagem em **JSON Schema** (fonte única) + exemplos | ✔ |
| `prototypes/` | **Fase 1** — protótipos de medição em Go (stdlib), 1 por tipo | ✔ (compilar/testar na máquina) |
| `agent/`      | **Fase 2** — `ufsm-monitor-agent` (Go): executor, outbox SQLite, /health, systemd | ✔ (compilar/testar na máquina) |
| `controller/` | Controlador central (Python/FastAPI) | ⏳ Fase 4 |
| `scripts/`    | Utilitários (ex.: validador de resultados) | ✔ |
| `docs/`, `PLANEJAMENTO-INICIAL.md`, `DIARIO-DE-BORDO.md` | Planejamento e registro | ✔ |

## Decisões de stack

- **Agente:** Go (binário único ARM, subprocessos, AMQP, `httptrace`).
- **Controlador:** Python + FastAPI (API/CRUD + validação de planos com Pydantic).
- **Contratos:** JSON Schema, independentes de linguagem, para não haver divergência
  entre agente (Go) e controlador (Python).
- **Broker:** RabbitMQ. **Banco:** PostgreSQL + TimescaleDB. **Dashboards:** Grafana.

## Começando

Fase 1 (protótipos): veja [`prototypes/README.md`](prototypes/README.md).
Fase 2 (agente): veja [`agent/README.md`](agent/README.md).

```bash
# Fase 1
cd prototypes && go vet ./... && make build
./bin/icmp -target 1.1.1.1 | python3 ../scripts/validate_result.py

# Fase 2
cd ../agent && go mod tidy && go vet ./... && make build
PROBE_ID=probe-dev-01 SQLITE_PATH=./agent.db ./bin/ufsm-monitor-agent run-task examples/task-icmp.json
```

## Publicar no GitHub

Este repositório está pronto para subir. Um único repositório (monorepo) é
suficiente para o TCC; se preferir separar `agent` e `controller` em repositórios
distintos depois, é simples.

```bash
cd "Área de Trabalho/TCC"
git init
git add .
git commit -m "Fase 1 (protótipos) + Fase 2 (agente): contratos, medições, outbox, systemd"
git branch -M main
git remote add origin git@github.com:anthonycarlosp7/ufsm-monitor.git   # ajuste o usuário/nome
git push -u origin main
```

> Criar o repositório no GitHub e autenticar (`git push`) são passos que **você**
> executa — não tenho acesso à sua conta.
