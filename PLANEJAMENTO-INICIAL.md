# Planejamento Inicial de Desenvolvimento
## Plataforma Distribuída de Monitoramento Ativo da Rede da UFSM

> Documento de planejamento para iniciar o desenvolvimento do MVP, antes da escrita formal do TCC.
> Foco: **decisão de stack + detalhamento das Fases 1 e 2** (protótipos de medição e agente mínimo).
> Baseado na especificação enviada pelo orientador (Prof. Carlos Raniery).

---

## 0. Como usar este documento

A especificação do orientador já é excelente e traz, na seção 14, uma sequência de 6 fases. Este documento **não substitui** aquela sequência — ele a torna acionável para as **duas primeiras fases**, adiciona decisões técnicas que precisam ser tomadas *antes* de escrever a primeira linha de código, e sugere uma filosofia de execução que reduz o risco de você construir muita coisa que não conversa entre si.

Ordem de leitura sugerida: seção 1 (filosofia) → 2 (stack) → 3 (contratos) → 4 (ambiente) → 6 e 7 (Fases 1 e 2 detalhadas) → 8 (o que fazer esta semana).

---

## 1. Filosofia de execução: "esqueleto que anda" antes de "sistema completo"

O maior risco de um projeto distribuído feito por uma pessoa só é construir **muitos módulos isolados que nunca se integram**. A especificação lista dezenas de componentes (agente, broker, controlador, banco temporal, dashboards, matriz, scheduler...). Se você tentar deixar cada um "perfeito" antes de integrar, corre o risco de descobrir tarde que as peças não encaixam.

Recomendação: siga as fases do orientador, **mas** assim que terminar a Fase 2, faça um **corte vertical fino** (*walking skeleton*) com **um único tipo de medição** (ICMP) atravessando toda a pilha:

```
agente executa ping  →  RabbitMQ  →  serviço de ingestão  →  PostgreSQL  →  Grafana mostra o gráfico
```

Só depois de esse "esqueleto que anda" estar funcionando você deve alargar horizontalmente (adicionar iperf3, DNS, HTTP, traceroute) e verticalmente (planos, malha, agregações). Isso valida a arquitetura de ponta a ponta cedo e dá ao seu orientador algo concreto para ver rápido — o que ajuda a "validar a ideia", que é exatamente o que vocês querem.

**Princípio central que atravessa tudo:** defina os **contratos de mensagem** (formato do resultado normalizado, formato da tarefa) *antes* de programar agente e controlador. Isso é o que impede a peça A e a peça B de divergirem. Ver seção 3.

---

## 2. Decisão de stack: Go vs Python/FastAPI para o controlador

O **agente é em Go** — isso não está em discussão (binário único ARM, controle de subprocesso, AMQP persistente, `httptrace`). A dúvida é o **controlador central** (API, validação de planos, scheduler, ingestão). O orientador autorizou "Go ou Python com FastAPI".

### Comparação objetiva

| Critério | Python + FastAPI | Go (end-to-end) |
|---|---|---|
| Velocidade de desenvolvimento da API/CRUD | **Muito alta** (FastAPI + SQLAlchemy + Alembic) | Média (mais boilerplate) |
| Validação de planos JSON | **Excelente** — Pydantic é quase feito para isso | Boa (`encoding/json` + validação manual ou libs) |
| Reuso de tipos com o agente | Não há reuso (linguagens diferentes) | **Alto** — pacote Go compartilhado de structs |
| Concorrência do scheduler (reservas iperf3) | Boa (`asyncio`) | **Excelente** (goroutines/channels nativos) |
| Curva de aprendizado (1 aluno) | Baixa se você já sabe Python | Menor nº de stacks para dominar |
| Ecossistema de dados/agregação | **Muito rico** (pandas se precisar) | Suficiente |
| Deploy do controlador | Contêiner Python | Binário único |

### Recomendação: **Python + FastAPI no controlador, Go no agente**

Justificativa para o seu contexto (TCC, um desenvolvedor, prazo definido):

1. **O controlador é essencialmente uma aplicação web/CRUD + validador de JSON.** É exatamente onde FastAPI + Pydantic brilham. O requisito de "validar o plano antes de publicar" (seção 7 da spec: probes existem, grupos válidos, destinos autorizados, orçamento de banda, expansão de malha `n(n-1)`) vira código curto e legível com Pydantic.
2. **Chegar aos experimentos mais rápido = mais tempo para escrever o TCC.** A avaliação experimental (seção 15) e a escrita são o que dá nota. Otimize para reduzir o tempo de construção do controlador.
3. **Grafana e TimescaleDB são agnósticos à linguagem** — a escolha do controlador não afeta a camada de visualização/dados.

### O risco dessa escolha, e como neutralizá-lo

O único ponto fraco de misturar linguagens é **divergência de schema** entre agente (Go) e controlador (Python): se o formato do resultado ou da tarefa mudar de um lado e não do outro, quebra silenciosamente.

**Mitigação (faça isto no dia 1):** defina os contratos como **JSON Schema** numa pasta `contracts/`, tratada como fonte única de verdade. O agente Go valida a saída contra o schema; o controlador Python gera os modelos Pydantic a partir dele. Assim, a linguagem deixa de importar — o contrato é que manda. Ver seção 3.

### Quando eu escolheria Go end-to-end em vez disso

Se você **já é fluente em Go e desconfortável em Python**, ou se quiser maximizar segurança de tipos com um pacote de structs compartilhado entre agente e controlador (eliminando de vez a divergência de schema), então **Go dos dois lados** é uma escolha perfeitamente defensável — e reduz de dois para um o número de ecossistemas que você mantém. É uma decisão legítima; leve as duas opções para o orientador com esta tabela. A recomendação padrão deste documento (Python no controlador) é a que otimiza para velocidade de entrega.

> **Ação:** decida isto com o orientador na próxima reunião. O resto do planejamento das Fases 1 e 2 vale **independentemente** da escolha, porque a Fase 1 são scripts e a Fase 2 é 100% agente em Go.

---

## 3. Contratos de mensagem — defina ANTES de codar (o passo que mais economiza dor)

Todo resultado de medição deve sair do agente num **envelope comum**, com um bloco `result` específico por tipo. Isso espelha o modelo de dados da spec (tabela genérica `measurement_runs` + tabelas tipadas por medição).

### Envelope de resultado (comum a todos os tipos)

```json
{
  "schema_version": "1.0",
  "run_id": "6fd91840-b3d0-4fbc-a7fb-e1d79dcd214f",
  "task_id": "0c2c...",
  "plan_id": "campus-baseline-v1",
  "plan_revision": 4,
  "job_id": "mesh-icmp",
  "probe_id": "probe-ct-01",
  "kind": "icmp",
  "target": "10.10.20.30",
  "target_probe": "probe-cpd-01",
  "observed_at": "2026-07-05T18:00:00Z",
  "started_at": "2026-07-05T18:00:00Z",
  "finished_at": "2026-07-05T18:00:10Z",
  "status": "success",
  "error_message": null,
  "result": { "...": "campos específicos do tipo (ver Fase 1)" },
  "raw": { "...": "saída bruta da ferramenta, opcional, para auditoria" }
}
```

- `run_id` / `task_id` → UUIDs; batem com o modelo de dados.
- `status` ∈ {`success`, `failure`, `timeout`}.
- `result` → o objeto normalizado de cada medição (as seções 6.1–6.5 da spec definem exatamente esses campos; reaproveite-os).
- `raw` → guardado como `jsonb` no Postgres só para auditoria/reprocessamento (a spec recomenda isso).

### Envelope de tarefa (o que o controlador envia ao probe)

Use exatamente o formato da seção 8 da spec (`task_id`, `type`, `source_probe`, `target_probe`, `not_before`, `expires_at`, `parameters`). O importante é: **tarefa tem expiração** e o agente rejeita tarefa expirada.

Guarde os dois schemas em `contracts/result.schema.json` e `contracts/task.schema.json`. Versione com `schema_version`.

---

## 4. Ambiente de desenvolvimento inicial

### Estrutura de repositório (monorepo)

```
ufsm-monitor/
├── README.md
├── contracts/              # JSON Schema — fonte única dos formatos de mensagem
│   ├── result.schema.json
│   └── task.schema.json
├── prototypes/             # FASE 1 — scripts de medição (Go ou shell+wrapper)
│   ├── icmp/
│   ├── iperf3/
│   ├── dns/
│   ├── http/
│   ├── traceroute/
│   └── sysinfo/
├── agent/                  # FASE 2 — ufsm-monitor-agent (Go)
│   ├── cmd/agent/main.go
│   ├── internal/
│   │   ├── config/
│   │   ├── executor/       # icmp, dns, http, traceroute, iperf3
│   │   ├── outbox/         # SQLite (WAL)
│   │   ├── health/         # /health /version /metadata
│   │   ├── inventory/
│   │   └── telemetry/
│   └── go.mod
├── controller/             # FASE 4 — API/scheduler/ingestão (Python FastAPI ou Go)
├── db/
│   └── migrations/         # SQL/Alembic — schema PostgreSQL + TimescaleDB
├── deploy/
│   ├── docker-compose.yml  # Postgres+Timescale, RabbitMQ, Grafana p/ dev local
│   ├── systemd/ufsm-monitor-agent.service
│   └── grafana/
└── docs/
    ├── arquitetura.md
    └── diario-de-bordo.md  # anotações p/ a escrita do TCC (ver seção 9)
```

### Infra local com Docker Compose (para desenvolver sem hardware)

Você não precisa de Raspberry Pis para começar. Suba tudo local em contêineres e simule "vários probes" rodando o binário do agente em portas/configs diferentes.

`deploy/docker-compose.yml` deve conter, no mínimo:

- **PostgreSQL + TimescaleDB** — imagem `timescale/timescaledb` (Postgres com a extensão já embutida).
- **RabbitMQ** — imagem `rabbitmq:3-management` (o `-management` dá a UI web na porta 15672, ótima para inspecionar filas).
- **Grafana** — imagem `grafana/grafana`, conectada ao Postgres.

Assim você desenvolve e testa o fluxo inteiro na sua máquina; o Raspberry Pi entra só quando o agente estiver estável (Fase 2 concluída).

### Ferramentas de medição a instalar (no probe / na máquina de dev)

`fping`, `iperf3`, `dig` (dnsutils), `curl`, `mtr` / `traceroute`. Na Fase 1 você encapsula essas ferramentas; na versão final, DNS e HTTP migram para implementação nativa em Go (`net` e `net/http` + `httptrace`).

---

## 5. Roadmap macro (as 6 fases da spec, resumidas)

| Fase | Entrega | Critério de saída |
|---|---|---|
| **1. Protótipos locais** | Scripts p/ ICMP, iperf3, DNS, HTTP, traceroute, sysinfo | Cada script gera **JSON normalizado** conforme os contratos |
| **2. Agente mínimo** | `ufsm-monitor-agent` em Go: config, executor c/ timeout, SQLite, `/health`, systemd | Um probe executa tarefas locais e **armazena resultados** |
| *(corte vertical)* | ICMP de ponta a ponta: agente→RabbitMQ→ingestão→Postgres→Grafana | Um gráfico de RTT aparece no Grafana vindo do agente real |
| **3. RabbitMQ** | Fila de comandos por probe, publicação de resultados, *publisher confirms*, ack, reconexão, outbox | Resultados **não se perdem** durante queda do broker |
| **4. Controlador** | Inventário, destinos, grupos, planos JSON, validador, expansão, scheduler básico | Admin cria um plano e os probes executam as tarefas |
| **5. Banco temporal + dashboard** | Ingestão, hypertables, agregações contínuas, dashboards, matriz probe×destino | Filtrar resultados por período/origem/destino/tipo |
| **6. Malha completa controlada** | Expansão de malha, cálculo de pares, reserva de recursos, serialização de iperf3 | Malha de 4–8 probes roda sem colisão de iperf3 |

As duas próximas seções detalham **apenas as Fases 1 e 2**, como você pediu.

---

## 6. FASE 1 — Protótipos de medição (detalhada)

**Objetivo:** provar que você consegue extrair, de cada ferramenta, exatamente as métricas que a spec pede, e emitir o JSON normalizado. Nada de rede, broker ou banco ainda. É a fase mais rápida e a que mais reduz incerteza.

**Formato de saída:** cada protótipo imprime no `stdout` um objeto `result` (o miolo do envelope da seção 3). Escreva-os já **em Go**, dentro de `prototypes/`, para reaproveitar o código no agente na Fase 2 (em vez de jogar fora scripts shell). Encapsule as ferramentas externas com `exec.CommandContext` (com timeout) e faça o *parsing* da saída.

### Tarefas por medição

**6.1 ICMP** — encapsular `fping`
- Comando: `fping -C 10 -q <alvo>` (10 amostras; `-C` dá RTT por amostra, permitindo calcular jitter e percentis).
- Parsear e emitir: `samples_sent`, `samples_received`, `loss_pct`, `rtt_min_ms`, `rtt_avg_ms`, `rtt_max_ms`, `jitter_ms` (e p50/p95/p99 quando houver amostras suficientes).
- **Regra da spec:** nunca guardar só a média — a média esconde picos. Registre min/avg/max/jitter/percentis.

**6.2 Vazão** — encapsular `iperf3`
- Sentido normal: `iperf3 -c <alvo> -J -t 10` | Sentido inverso: `iperf3 -c <alvo> -J -t 10 -R`.
- `-J` → saída JSON (parse fácil). Emitir: `direction` (`source_to_target` / `target_to_source`), `protocol`, `duration_seconds`, `throughput_bps`, `bytes_transferred`, `retransmits`.
- **Regra da spec:** **não** use `--bidir` na 1ª versão — modele os dois sentidos como execuções separadas. Trate iperf3 como medição **intrusiva** (será serializada mais tarde).

**6.3 DNS** — `dig` (ou nativo em Go)
- Emitir: `resolver`, `qname`, `qtype`, `transport` (udp/tcp), `elapsed_ms`, `rcode`, `answer_count`, `status`, tamanho da resposta.
- **Regra da spec:** nomes consultados **configuráveis e estáveis** (nomes institucionais + poucos nomes públicos conhecidos). Nada de consultas aleatórias — atrapalha comparabilidade histórica.

**6.4 HTTP/HTTPS** — `curl` agora, **cliente Go nativo com `httptrace`** na versão final
- Não medir "RTT HTTP" genérico. Decompor em fases: `dns_ms`, `tcp_connect_ms`, `tls_handshake_ms`, `ttfb_ms`, `total_ms`, `http_status`, `response_bytes`.
- Com `curl`: use `-w` com variáveis (`%{time_namelookup}`, `%{time_connect}`, `%{time_appconnect}`, `%{time_starttransfer}`, `%{time_total}`, `%{http_code}`). Já vá planejando a versão `httptrace`, que dá esses eventos nativamente.

**6.5 Caminho** — `mtr` / `traceroute`
- Frequência **menor** que ping/DNS (volume maior, rotas mudam devagar).
- Emitir lista de `hops` com `ttl`, `address`, `rtt_avg_ms`, `loss_pct`. `mtr --json` dá saída estruturada.

**6.6 Sysinfo (inventário local)** — coletar do sistema
- `hostname`, versão do agente, versões das ferramentas, IP atual, interface, gateway, resolvedores DNS, MAC, uso de CPU/memória/disco, estado de sincronização de tempo.
- **Regra da spec:** o **identificador do probe é permanente** e **não** deriva de IP nem hostname (o Pi pode mudar de VLAN/IP). Gere um UUID persistido em arquivo no primeiro boot.

### Critério de aceite da Fase 1
Rodar cada protótipo na sua máquina e obter um JSON válido, conforme `contracts/result.schema.json`, para cada um dos 6 tipos. Valide os JSONs contra o schema automaticamente (um pequeno teste).

---

## 7. FASE 2 — Agente mínimo `ufsm-monitor-agent` (detalhada)

**Objetivo:** transformar os protótipos num único binário Go que lê configuração, executa tarefas (por enquanto vindas de um arquivo/CLI local, ainda sem RabbitMQ), aplica timeout, persiste resultados em SQLite e expõe `/health`. Rodar como serviço systemd.

### Módulos (subconjunto mínimo da árvore da spec)

```
ufsm-monitor-agent
├── config          # lê /etc/ufsm-monitor/agent.env + arquivo de identidade (UUID)
├── executor        # dispara icmp/dns/http/traceroute/iperf3 (reusa a Fase 1)
├── outbox (SQLite) # persiste resultados antes de qualquer publicação
├── health-server   # GET /health /version /metadata
├── inventory       # coleta sysinfo (Fase 1 §6.6)
└── telemetry/logs  # logs estruturados
```

### Tarefas concretas (em ordem)

1. **Identidade do probe.** No 1º boot, gerar UUID e gravar em `/etc/ufsm-monitor/probe-id`. Nunca derivar de IP/hostname. Ler no start.
2. **Config.** Carregar de `EnvironmentFile=/etc/ufsm-monitor/agent.env` (endpoints, credenciais futuras, limites de concorrência, caminho do SQLite).
3. **Executor com segurança.** Rodar ferramentas **só por argumentos explícitos** com `exec.CommandContext` — **nunca** `sh -c "... $VAR"` (evita injeção de comando, requisito de segurança da spec). Todo teste tem **timeout**, limite de execução e registro de erro. O agente aceita apenas um **conjunto fechado de tipos** (`icmp`, `iperf3`, `dns`, `http`, `traceroute`) e valida os parâmetros de cada tipo.
4. **Outbox SQLite.** Criar o banco local com as tabelas mínimas da spec: `pending_tasks`, `running_tasks`, `result_outbox`, `failed_tasks`, `agent_state`. PRAGMAs recomendados pela spec:
   ```sql
   PRAGMA journal_mode=WAL;
   PRAGMA synchronous=NORMAL;   -- FULL se o local tiver risco alto de queda de energia
   PRAGMA busy_timeout=5000;
   ```
   Fluxo obrigatório: **executar → persistir no SQLite → (depois) publicar → confirmar → remover da outbox.** Persistir *antes* de publicar é o que garante que nenhum resultado se perca se a conexão cair. (A publicação em si só entra na Fase 3.)
5. **Servidor de saúde.** `GET /health` (ok), `GET /version` (versão do agente + ferramentas), `GET /metadata` (inventário). Conteúdo mínimo/estático — serve também de alvo para futuros testes HTTP entre probes.
6. **Inventário periódico.** Coletar sysinfo (§6.6) e gravar em `agent_state` a cada N segundos.
7. **Runner local de tarefas.** Um comando tipo `agent run-task task.json` que lê um envelope de tarefa de um arquivo, executa e grava o resultado na outbox. Isso simula o que a Fase 3 fará via RabbitMQ, sem depender do broker ainda.
8. **Serviço systemd.** Instalar `deploy/systemd/ufsm-monitor-agent.service` (use o exemplo da spec: `After/Wants=network-online.target`, `Restart=always`, `RestartSec=5`, usuário dedicado `ufsm-monitor`). Testar `systemctl start/enable` e reinício automático.

### Critério de aceite da Fase 2
Em uma máquina (ou num Raspberry Pi), o agente roda como serviço systemd, executa cada tipo de tarefa a partir de um arquivo local, aplica timeout, e os resultados ficam persistidos na outbox SQLite mesmo sem rede/broker. `curl localhost/health` responde.

---

## 8. O que fazer JÁ (primeiros passos práticos)

Uma sequência concreta para as próximas ~2 semanas, sem depender de decisão pendente nem de hardware:

1. **Criar o repositório** `ufsm-monitor` com a estrutura da seção 4 e inicializar git.
2. **Escrever os dois JSON Schemas** em `contracts/` (result e task). Isto congela os contratos antes de qualquer código.
3. **Subir o `docker-compose`** com Postgres+Timescale, RabbitMQ e Grafana e confirmar que sobem e você acessa as UIs (RabbitMQ :15672, Grafana :3000).
4. **Protótipo ICMP em Go** (§6.1) emitindo JSON válido contra o schema. É o "hello world" da medição.
5. **Repetir** para iperf3, DNS, HTTP, traceroute e sysinfo (Fase 1 completa).
6. **Montar o agente mínimo** (Fase 2): identidade, config, executor, outbox SQLite, `/health`, systemd.
7. **Levar ao orientador** a decisão de stack do controlador (seção 2) e o corte vertical ICMP como próximo marco visível.

Antes de mais nada, na **próxima reunião** feche com o orientador: (a) linguagem do controlador — Python/FastAPI (recomendado) ou Go end-to-end; (b) quantos e quais probes/prédios no piloto (CPD, CT, CCNE, HUSM aparecem como exemplo); (c) qual VPS externa de referência será usada.

---

## 9. O que registrar desde já para a escrita do TCC

Você vai escrever o TCC no fim, mas várias evidências só existem "no momento". Mantenha um `docs/diario-de-bordo.md` e registre desde a Fase 1:

- **Decisões de arquitetura e o porquê** (ex.: por que Python no controlador, por que não `--bidir`, por que UUID de identidade). Isso vira a seção de "decisões de projeto".
- **Métricas de avaliação da spec (seção 15):** confiabilidade (% de tarefas recebidas/executadas/armazenadas), perda de resultados durante queda do broker, tempo de recuperação, escalabilidade (nº de tarefas por nº de probes: lembre `n(n-1)`), sobrecarga (CPU/mem/disco/tráfego do agente), precisão temporal (agendado vs. real). Vá coletando conforme cada fase permite.
- **Limites explícitos (seção 16):** a plataforma **observa e apresenta** dados; **não** afirma causa-raiz automaticamente. Escreva isso desde já para não "vender" além do escopo.

---

## 10. Resumo em uma frase

Feche a linguagem do controlador com o orientador (recomendo **Python/FastAPI no controlador + Go no agente**, com contratos em JSON Schema para não haver divergência), depois **execute as Fases 1 e 2** — protótipos em Go que emitem JSON normalizado e um agente mínimo com outbox SQLite e systemd — e só então una tudo num **corte vertical de ICMP** de ponta a ponta antes de alargar para malha completa.
