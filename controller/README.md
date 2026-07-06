# controller — Controlador central (Fase 4)

FastAPI + PostgreSQL. Mantém o inventário (probes, destinos, grupos), recebe
**planos JSON**, os **valida e expande** em tarefas concretas e as **publica no
RabbitMQ** para os probes executarem.

```
POST /probes | /targets | /groups        cadastro (inventário + allowlist)
POST /plans/validate                      valida e mostra a expansão (n(n-1)) sem publicar
POST /plans                               valida e armazena o plano
POST /plans/{id}/run                      expande, gera as tarefas e publica no RabbitMQ
GET  /docs                                documentação interativa (Swagger)
```

## Pré-requisitos

- **Python 3.11+**
- Infra no ar: `cd ../infra && docker compose up -d` (agora sobe **RabbitMQ + PostgreSQL/TimescaleDB**).
- O **agente** rodando com `PROBE_ID=probe-dev-01` (Fase 3) para executar as tarefas,
  e o **`sink-results`** para ver os resultados chegando.

## Instalação

```bash
cd controller
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # ajuste se necessário
```

> Se faltar o módulo `venv`: `sudo apt install -y python3-venv`.

## Rodar

```bash
uvicorn app.main:app --reload --port 8000
```

- API em http://localhost:8000
- Documentação interativa (Swagger) em http://localhost:8000/docs
- As tabelas são criadas automaticamente no startup.

## Teste end-to-end (com agente + sink rodando)

Em outro terminal:

```bash
# 1. Registrar o probe (mesmo id que o agente usa)
curl -X POST localhost:8000/probes -H 'content-type: application/json' \
  -d '{"probe_id":"probe-dev-01","hostname":"JARVIS","deployment":"dev"}'

# 2. Autorizar os destinos externos (allowlist — a validação exige isto)
curl -X POST localhost:8000/targets -H 'content-type: application/json' -d '{"name":"cloudflare","address":"1.1.1.1"}'
curl -X POST localhost:8000/targets -H 'content-type: application/json' -d '{"name":"ufsm-web","address":"https://www.ufsm.br"}'
curl -X POST localhost:8000/targets -H 'content-type: application/json' -d '{"name":"ufsm-dns","address":"www.ufsm.br"}'

# 3. Validar o plano (mostra a expansão, sem publicar)
curl -X POST localhost:8000/plans/validate -H 'content-type: application/json' -d @examples/plan-dev.json

# 4. Criar o plano (valida e armazena)
curl -X POST localhost:8000/plans -H 'content-type: application/json' -d @examples/plan-dev.json

# 5. RODAR: gera as tarefas e publica no RabbitMQ
curl -X POST localhost:8000/plans/dev-baseline/run
```

Depois do passo 5, o **agente** consome os comandos, executa (icmp/http/dns) e o
**`sink-results`** imprime os resultados. É o ciclo completo:
**admin cria plano → controlador valida/expande/publica → probe executa → ingestão.** ✔

> O grupo `campus` está definido dentro do próprio plano (`groups`). Também dá para
> cadastrar grupos reutilizáveis via `POST /groups`.

## Observações

- **Allowlist:** destinos externos precisam estar em `/targets` (spec 12) — senão a
  validação recusa o plano.
- **Expansão:** para malha completa direcionada com n probes, `n(n-1)` tarefas/ciclo.
  Use `/plans/validate` para ver o custo antes de ativar.
- **Fase 5 (próxima):** substituir o `sink-results` por um serviço de ingestão que
  grava os resultados no PostgreSQL/TimescaleDB (hypertables) e ligar o Grafana.
