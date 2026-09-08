# Deploy físico — servidor central + Raspberry Pi (probe)

Guia passo a passo para tirar a plataforma do Docker de demonstração e rodá-la de verdade:
o **servidor central** roda a stack em contêineres; cada **Raspberry Pi** roda apenas o
binário Go do agente via `systemd`.

```
   Raspberry Pi 4B (probe)                 Servidor central (Ubuntu/Docker)
   ┌───────────────────────┐   AMQP 5672   ┌───────────────────────────────────────────┐
   │ ufsm-monitor-agent     │──────────────▶│ RabbitMQ · Controlador · Ingestão         │
   │ (systemd, arm64)       │◀──────────────│ TimescaleDB · Dashboard (web :8080)       │
   │ + iperf3/DNS de destino│   comandos    └───────────────────────────────────────────┘
   └───────────────────────┘
```

> Pré-requisitos: servidor com **Docker + Docker Compose** e IP na LAN; Pi 4B com
> **Raspberry Pi OS 64-bit** (ou Ubuntu 64-bit) e acesso SSH. Servidor e Pi na **mesma rede**.

---

## Parte 1 — Servidor central

**1.1** Descubra o IP do servidor na rede (anote, ex.: `192.168.0.10`):

```bash
hostname -I
```

**1.2** Suba a stack **sem** os agentes de demonstração (o `profile demo` os deixa de fora):

```bash
cd ufsm-monitor
docker compose up -d --build
docker compose ps
```

- Dashboard: `http://<IP-SERVIDOR>:8080`
- API/Swagger: `http://<IP-SERVIDOR>:8000/docs`
- RabbitMQ (management): `http://<IP-SERVIDOR>:15672` (guest/guest)

**1.3** Crie um **usuário RabbitMQ para os probes**. O usuário `guest` **não** conecta de outra
máquina (só localhost), então o Pi precisa de credencial própria:

```bash
docker exec ufsm-rabbitmq rabbitmqctl add_user probe 'TROQUE_por_uma_senha_forte'
docker exec ufsm-rabbitmq rabbitmqctl set_permissions -p / probe ".*" ".*" ".*"
```

> Isso persiste no volume do RabbitMQ. Se um dia rodar `docker compose down -v` (apaga
> volumes), recrie o usuário. Para vários probes, dá para criar uma credencial por probe.

**1.4** Libere as portas no **firewall do servidor** (se usar `ufw`):

```bash
sudo ufw allow 5672/tcp    # AMQP  — os probes conectam aqui
sudo ufw allow 8080/tcp    # dashboard
sudo ufw allow 8000/tcp    # API (opcional)
```

> **Servidor em Windows (Docker Desktop):** as portas são publicadas no host Windows; para
> outras máquinas da LAN acessarem, permita o app no **Firewall do Windows**. Para papel de
> servidor, um **Linux (Ubuntu)** é mais simples e é o recomendado.

**1.5** No **dashboard → Inventário**, cadastre:

- **Probe:** `probe_id = probe-ct-01` (o mesmo que você porá no Pi) e **endereço = IP do Pi**
  na LAN (ex.: `192.168.0.50`). O endereço é o que permite a **malha** (outros probes medirem este).
- **Destinos:** os externos que quer medir (ex.: `1.1.1.1`, `https://www.ufsm.br`).

> O agente **não** se auto-cadastra no controlador — o inventário é administrativo. Cadastre
> cada probe aqui (ou via `POST /probes`) com o `probe_id` idêntico ao do agente.

---

## Parte 2 — Compilar o agente para o Pi (arm64)

O Pi 4B é **arm64**. O binário é **estático** (`CGO_ENABLED=0`), então não depende de bibliotecas.

**Opção A (recomendada) — cross-compile na máquina de dev (WSL/Linux com Go):**

```bash
cd ufsm-monitor/agent
make build-arm64                        # gera bin/arm64/ufsm-monitor-agent
scp bin/arm64/ufsm-monitor-agent  pi@<IP-PI>:/tmp/
scp deploy/ufsm-monitor-agent.service deploy/agent.env.example  pi@<IP-PI>:/tmp/
```

**Opção B — compilar no próprio Pi:** instale o Go 64-bit no Pi e rode `make build-arm64`
(ou `go build ./cmd/ufsm-monitor-agent`) dentro de `agent/`.

---

## Parte 3 — Instalar no Raspberry Pi

Entre por SSH no Pi (`ssh pi@<IP-PI>`) e:

**3.1** Utilitários de medição (o agente chama estes binários):

```bash
sudo apt update
sudo apt install -y fping iperf3 dnsutils mtr-tiny traceroute
```

**3.2** Usuário de serviço + binário:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin ufsm-monitor
sudo install -m 0755 /tmp/ufsm-monitor-agent /usr/local/bin/
```

**3.3** Configuração:

```bash
sudo mkdir -p /etc/ufsm-monitor
sudo cp /tmp/agent.env.example /etc/ufsm-monitor/agent.env
sudo nano /etc/ufsm-monitor/agent.env
```

Ajuste no `agent.env`:

```ini
PROBE_ID=probe-ct-01                                   # igual ao cadastrado no dashboard
AMQP_URL=amqp://probe:SUA_SENHA@<IP-SERVIDOR>:5672/     # usuário criado no passo 1.3
DEPLOYMENT=CT-sala-101
IPERF3_SERVER=on                                       # o Pi recebe testes de vazão (malha)
DNS_SERVER=off                                         # ver nota sobre a porta 53 abaixo
```

> **Porta 53 no Pi:** o `systemd-resolved` já ocupa a porta 53. Para o **primeiro deploy**,
> deixe `DNS_SERVER=off` — ICMP, iperf3, HTTP e DNS a resolvedores externos (1.1.1.1) seguem
> funcionando. Para ligar o servidor DNS do probe depois, veja a seção **Opcional** no fim.

**3.4** Serviço systemd:

```bash
sudo cp /tmp/ufsm-monitor-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ufsm-monitor-agent
systemctl status ufsm-monitor-agent
journalctl -u ufsm-monitor-agent -f          # acompanhar os logs
```

**3.5** Firewall do Pi (se ativo): libere o iperf3 e o health:

```bash
sudo ufw allow 5201/tcp    # servidor iperf3 (alvo de vazão)
sudo ufw allow 8080/tcp    # /health e /services
```

---

## Parte 4 — Verificar de ponta a ponta

1. **No Pi:** `curl localhost:8080/health` e `curl localhost:8080/services` devem responder.
2. **No servidor (dashboard):** aba **Matriz & status** → o probe aparece; **Visão geral** começa
   a registrar atividade quando um plano rodar.
3. **Crie um plano** (dashboard → **Planos**): origem = o probe (ou um grupo), destinos = `1.1.1.1`
   e o servidor/outro probe; tipos ICMP/HTTP/iperf3; período 60 s → **Validar** → **Criar** →
   **rodar agora**. Em ~1 min os dados surgem em **Séries** e **Matriz**.

---

## Malha com apenas 1 Pi

A malha precisa de ≥ 2 nós. Com um único Pi, faça o **servidor também ser um probe**:
rode o agente no próprio servidor (ou registre-o no inventário com o IP do servidor) para ter
malha de 2 nós (Pi ↔ servidor). Cada Pi extra: repita as Partes 2–3 com outro `PROBE_ID` e IP.

---

## Opcional — servidor DNS do probe na porta 53

Só é necessário para medições **DNS probe→probe**. Para liberar a porta 53 do Pi:

```bash
sudo sed -i 's/#\?DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
```

Depois, no `agent.env`: `DNS_SERVER=on` e `DNS_PORT=53`, e reinicie o serviço
(`sudo systemctl restart ufsm-monitor-agent`). A capacidade `CAP_NET_BIND_SERVICE` para a porta
privilegiada já está no arquivo `.service`.

---

## Troubleshooting

| Sintoma | Causa provável / solução |
| --- | --- |
| Agente não conecta no RabbitMQ (`ACCESS_REFUSED`) | Usando `guest` remoto. Use o usuário `probe` (passo 1.3) no `AMQP_URL`. |
| Agente não conecta (timeout) | Firewall do servidor bloqueando 5672, ou IP errado no `AMQP_URL`. |
| Probe não aparece no inventário | Ele não se auto-cadastra: cadastre em **Inventário** com o mesmo `probe_id`. |
| Sem dados em Séries/Matriz | Rode um plano e aguarde o período; veja `docker compose logs ingestion` no servidor. |
| Erro ao subir servidor DNS | Porta 53 ocupada pelo `systemd-resolved` — use `DNS_SERVER=off` ou a seção Opcional. |
| iperf3 probe→probe falha | Instale `iperf3` no Pi e libere a porta 5201 no firewall. |

Comandos úteis no Pi: `systemctl status ufsm-monitor-agent` · `journalctl -u ufsm-monitor-agent -e`.
No servidor: `docker compose ps` · `docker compose logs -f controller ingestion`.
