# infra — Infraestrutura de apoio (Docker)

Sobe os serviços que a plataforma precisa. Na **Fase 3**, só o **RabbitMQ**.

## Pré-requisito: Docker Desktop com integração WSL

1. Instale o **Docker Desktop for Windows** (site oficial da Docker).
2. Abra o Docker Desktop → **Settings → Resources → WSL Integration** →
   ative para a distro **Ubuntu** → **Apply & Restart**.
3. No terminal do Ubuntu, confirme:
   ```bash
   docker version
   docker compose version
   ```

## Subir o RabbitMQ

```bash
cd infra
docker compose up -d
docker compose ps
```

- **Management UI:** http://localhost:15672 — usuário `guest`, senha `guest`.
- **Porta AMQP:** `localhost:5672` (é onde o agente vai conectar na Fase 3).

## Comandos úteis

```bash
docker compose logs -f rabbitmq   # ver logs
docker compose stop               # parar (mantém os dados)
docker compose start              # subir de novo
docker compose down               # remover contêineres (mantém o volume de dados)
```

## Teste de tolerância (Fase 3)

Para simular queda do broker sem perder resultados: com o agente rodando,
`docker compose stop rabbitmq`, gere medições (elas ficam na outbox SQLite),
depois `docker compose start rabbitmq` e observe a `result_outbox` esvaziar
conforme os resultados são publicados e confirmados.

## Credenciais

`guest/guest` só funciona a partir de `localhost` — suficiente para desenvolvimento
no WSL. Para os probes reais (Raspberry Pi) criaremos um usuário por probe com ACLs
(spec 12).
