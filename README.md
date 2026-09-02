# Plataforma Distribuída de Monitoramento Ativo da Rede da UFSM

Plataforma de **monitoramento ativo** de rede formada por _probes_ homogêneos (executáveis em
Raspberry Pi) que realizam medições — ICMP, vazão (iperf3), DNS, HTTP/HTTPS e caminho — segundo
**planos declarativos**, orquestrada por um controlador central que valida os planos, distribui as
tarefas, consolida os resultados em séries temporais e os apresenta em dashboards.

Trabalho de Conclusão de Curso — Ciência da Computação, Universidade Federal de Santa Maria (UFSM).

> **Escopo.** A plataforma coleta medições de forma confiável, registra séries históricas e as
> apresenta para observação operacional. O sistema **observa e apresenta** os dados (disponibilidade,
> latência, perda, vazão, DNS, HTTP/HTTPS, caminho); **não** infere causa-raiz automaticamente.

## Estado do projeto

Implementação concluída e validada de ponta a ponta (Fases 1 a 6 da proposta), executando em
contêineres. Restam atividades não relacionadas ao código: implantação nos Raspberry Pi físicos,
avaliação experimental em escala e escrita do TCC.

## Recursos

- **Medições ativas:** ICMP, DNS, HTTP/HTTPS (com decomposição em fases via `httptrace`), traceroute
  e vazão (iperf3). Cada resultado é emitido em um envelope **JSON normalizado** (contratos em `contracts/`).
- **Probes homogêneos:** cada probe não apenas mede como também **oferece serviços de destino**
  (servidor iperf3, servidor DNS e endpoint HTTP), permitindo medição **mútua** entre probes e com o
  servidor — topologias em **estrela** e **malha**.
- **Planos declarativos (JSON):** o controlador **valida** o plano (existência de probes, allowlist de
  destinos, período mínimo, limites) e o **expande** em tarefas concretas, materializando a malha `n(n-1)`.
- **Orquestração assíncrona:** distribuição de comandos e resultados via **RabbitMQ**, com _publisher
  confirms_. No probe, uma **outbox SQLite** persiste o resultado antes da publicação, garantindo
  tolerância a falhas de rede ou do broker.
- **Scheduler automático:** os planos habilitados são executados periodicamente (`period_seconds`, com
  _jitter_), sem acionamento manual. Os testes de **iperf3 são serializados** (reserva de origem e
  destino), evitando que um probe participe de dois testes de vazão simultâneos.
- **Consolidação e visualização:** ingestão em **PostgreSQL/TimescaleDB** (hypertables), com painéis em
  **Grafana** (legado) e um **dashboard web próprio**.
- **Dashboard próprio (web):** front-end React/Vite que **substitui o Grafana** — cadastro de
  probes/destinos/grupos, **construtor visual de planos** (quais probes medem o quê, tipo, período,
  malha/estrela), **séries temporais** e **matriz probe × destino**, consumindo a API do controlador.
- **Empacotamento:** toda a plataforma sobe em contêineres; o agente é um binário Go **cross-compilável
  para ARM** (Raspberry Pi), instalável como serviço `systemd`.

## Arquitetura (visão geral)

```
Administração / visualização
        │
        ▼
Controlador (Python + FastAPI)   ── inventário, planos JSON, validação/expansão, scheduler, API
        │
        ▼
RabbitMQ (barramento AMQP)       ── comandos e resultados
        │
        ▼
Agentes / probes (Go)            ── executam e OFERECEM medições; outbox SQLite; publicam resultados
        │
        ▼
Serviço de Ingestão (Python)     ── consome resultados
        │
        ▼
PostgreSQL + TimescaleDB         ── inventário, planos e séries temporais
        │
        ▼
Grafana                          ── dashboards e matriz probe × destino
```

Além do fluxo de controle acima, os probes realizam **medições entre si e com o servidor** (planos de
medição). A visão completa está nos diagramas C4 em [`docs/arquitetura/`](docs/arquitetura/) (contexto,
contêineres e componentes) e no diagrama de sequência interativo do fluxo de execução.

## Estrutura do repositório

| Caminho             | Conteúdo                                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `contracts/`        | Formatos de mensagem em **JSON Schema** (fonte única de verdade) e exemplos                                 |
| `prototypes/`       | Protótipos de medição em Go (stdlib), um por tipo — validação isolada das medições (Fase 1)                |
| `agent/`            | Agente `ufsm-monitor-agent` (Go): executor, outbox SQLite, servidores iperf3/DNS, `/health`, `systemd`      |
| `controller/`       | Controlador (Python/FastAPI): inventário, planos, validação/expansão, publicação, **scheduler** e ingestão |
| `infra/`            | Provisionamento do Grafana (datasource TimescaleDB + dashboards) — legado                                  |
| `web/`              | **Dashboard web** (React/Vite + Nginx): inventário, construtor de planos, séries e matriz — substitui o Grafana |
| `scripts/`          | Utilitários (validador de resultados, `demo-seed.sh`)                                                       |
| `docs/`             | Arquitetura (C4 + sequência), cronograma, relatório de progresso e revisão bibliográfica                   |
| `docker-compose.yml`| Stack completa para execução/demonstração em contêineres                                                    |

## Stack tecnológica

- **Agente:** Go — binário único, cross-compila para ARM, controle de subprocessos, AMQP e `httptrace`.
- **Controlador e ingestão:** Python + FastAPI — API/CRUD e validação de planos com Pydantic.
- **Contratos:** JSON Schema, independentes de linguagem, para evitar divergência entre agente (Go) e
  controlador (Python).
- **Broker:** RabbitMQ. **Banco:** PostgreSQL + TimescaleDB. **Dashboards:** Grafana.

## Execução via Docker

Um único comando sobe a stack inteira (infraestrutura + controlador + ingestão + dois agentes de
demonstração). Pré-requisito: **Docker Desktop** (com integração WSL, no Windows).

```bash
# na raiz do repositório
docker compose up -d --build     # a primeira execução compila o Go e instala as dependências Python
docker compose ps                # confirma que os serviços subiram
```

Em seguida, o script de _seed_ registra os probes, autoriza os destinos, cria e roda o plano de malha:

```bash
bash scripts/demo-seed.sh
```

Endpoints:

- **Dashboard (web):** http://localhost:8080 — inventário, planos, séries e matriz (**substitui o Grafana**)
- **Controlador / API (Swagger):** http://localhost:8000/docs
- **RabbitMQ (Management):** http://localhost:15672 (guest/guest)
- **Grafana (legado):** http://localhost:3000 (admin/admin) → dashboard "UFSM Monitor — Visão Geral"
- **Serviços oferecidos por cada probe:** http://localhost:8081/services e http://localhost:8082/services

O plano `controller/examples/plan-mesh.json` exercita a **malha**: `agent-a` e `agent-b` medem um ao
outro (ICMP, DNS, iperf3) além dos destinos externos, demonstrando a medição mútua entre probes.

Comandos úteis:

```bash
docker compose logs -f controller                   # acompanhar o scheduler em ação
docker compose up -d rabbitmq timescaledb grafana   # somente a infraestrutura (dev com apps na venv)
docker compose down                                 # parar (preserva os volumes/dados)
docker compose down -v                              # parar e APAGAR os dados
```

## Implantação em produção (monorepo, deploy por alvo)

O repositório é um **monorepo**, mas isso não implica um único artefato de implantação. Cada parte é
construída e implantada em seu alvo:

- **Servidor central:** executa a stack de orquestração **em contêineres** (controlador, ingestão,
  RabbitMQ, TimescaleDB e Grafana) — o mesmo `docker compose`, sem os agentes de demonstração.
- **Cada Raspberry Pi (probe físico):** executa **apenas o binário Go do agente**, cross-compilado para
  ARM (`cd agent && make build-arm64`) e instalado como serviço `systemd` (ver `agent/deploy/`). O
  dispositivo não requer Docker nem o repositório completo — basta o binário, o arquivo `.service` e o
  `agent.env`, com `AMQP_URL` apontando para o RabbitMQ do servidor.

O monorepo se justifica porque os **contratos JSON Schema** (`contracts/`) são compartilhados entre
agente e controlador: fonte única, alterações de formato atômicas em um só commit e menor esforço de
manutenção. A separação em múltiplos repositórios só se justificaria com equipes grandes e ciclos de
release independentes.

## Documentação

- **Planejamento e registro:** [`PLANEJAMENTO-INICIAL.md`](PLANEJAMENTO-INICIAL.md) · [`DIARIO-DE-BORDO.md`](DIARIO-DE-BORDO.md)
- **Arquitetura:** diagramas C4 (contexto, contêineres, componentes) e o diagrama de sequência
  interativo do fluxo de execução em [`docs/arquitetura/`](docs/arquitetura/)
- **Acompanhamento:** relatório de progresso e cronograma em [`docs/`](docs/)
- **Revisão bibliográfica:** [`docs/revisao-bibliografica/`](docs/revisao-bibliografica/)
- **Documentação por módulo:** [`agent/README.md`](agent/README.md) · [`controller/README.md`](controller/README.md) · [`infra/README.md`](infra/README.md)
