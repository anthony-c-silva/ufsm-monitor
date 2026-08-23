# Plataforma Distribuída de Monitoramento Ativo da Rede da UFSM

Plataforma de **monitoramento ativo** formada por _probes_ homogêneos (Raspberry Pi)
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

| Pasta                                                    | Conteúdo                                                                          | Estado                         |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------ |
| `contracts/`                                             | Formatos de mensagem em **JSON Schema** (fonte única) + exemplos                  | ✔                              |
| `prototypes/`                                            | **Fase 1** — protótipos de medição em Go (stdlib), 1 por tipo                     | ✔ (compilar/testar na máquina) |
| `agent/`                                                 | **Fase 2** — `ufsm-monitor-agent` (Go): executor, outbox SQLite, /health, systemd | ✔ (compilar/testar na máquina) |
| `controller/`                                            | Controlador central (Python/FastAPI)                                              | ⏳ Fase 4                      |
| `scripts/`                                               | Utilitários (ex.: validador de resultados)                                        | ✔                              |
| `docs/`, `PLANEJAMENTO-INICIAL.md`, `DIARIO-DE-BORDO.md` | Planejamento e registro                                                           | ✔                              |

## Decisões de stack

- **Agente:** Go (binário único ARM, subprocessos, AMQP, `httptrace`).
- **Controlador:** Python + FastAPI (API/CRUD + validação de planos com Pydantic).
- **Contratos:** JSON Schema, independentes de linguagem, para não haver divergência
  entre agente (Go) e controlador (Python).
- **Broker:** RabbitMQ. **Banco:** PostgreSQL + TimescaleDB. **Dashboards:** Grafana.

## Executar tudo via Docker (recomendado)

Um único comando sobe a stack inteira (infra + controlador + ingestão + 2 agentes de
demonstração). Pré‑requisito: **Docker Desktop** (com integração WSL, se estiver no Windows).

```bash
# na raiz do repositório
docker compose up -d --build     # 1ª vez demora (build do Go e pip install)
docker compose ps                # confere que tudo subiu
```

Depois, **semeie a demo** (registra os probes, autoriza destinos, cria e roda o plano):

```bash
bash scripts/demo-seed.sh
```

Endpoints:

- **Controlador / API:** http://localhost:8000/docs
- **RabbitMQ:** http://localhost:15672 (guest/guest)
- **Grafana:** http://localhost:3000 (admin/admin) → dashboard "UFSM Monitor — Visão Geral"
- **Serviços de cada probe:** http://localhost:8081/services (agent‑a) e http://localhost:8082/services (agent‑b)

O plano de demo (`controller/examples/plan-mesh.json`) exercita a **malha**: `agent-a` e
`agent-b` medem **um ao outro** (ICMP, DNS, iperf3) além dos destinos externos — provando
a medição mútua entre probes.

Comandos úteis:

```bash
docker compose logs -f agent-a          # ver um agente
docker compose up -d rabbitmq timescaledb grafana   # só a infra (dev com apps na venv)
docker compose down                     # para tudo (mantém os volumes/dados)
docker compose down -v                  # para e APAGA os dados
```

## Monorepo e implantação em produção

O repositório é um **monorepo** e assim deve permanecer — mas monorepo **não** significa
um único deployable. Cada parte é construída e implantada no seu alvo:

- **Servidor central** (sala de servidores do CT): roda a stack de orquestração **em
  contêineres** (controlador, ingestão, RabbitMQ, TimescaleDB, Grafana) — o mesmo
  `docker compose`, sem os `agent-a`/`agent-b` de demonstração.
- **Cada Raspberry Pi** (probe físico): roda **só o binário Go do agente**, cross‑compilado
  para ARM (`cd agent && make build-arm64`) e instalado como **serviço systemd**
  (`agent/deploy/`). O Pi **não precisa de Docker nem do repositório inteiro** — basta
  copiar o binário + o `.service` + o `agent.env`, apontando `AMQP_URL` para o RabbitMQ do
  servidor.

Por que monorepo aqui: os **contratos JSON Schema** (`contracts/`) são compartilhados entre
agente (Go) e controlador (Python) — fonte única, sem sincronizar dois repositórios; mudanças
de formato são atômicas num só commit; e é mais simples para um projeto de uma pessoa. Só
valeria separar em vários repositórios com times grandes e ciclos de release independentes.
