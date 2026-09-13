# Auto-deploy do servidor central (Opção 1 — pull + timer)

Faz o **servidor puxar o código novo do GitHub** e reconstruir a stack sozinho, a cada
~2 minutos. Você trabalha normalmente no seu PC e dá `git push`; em pouco tempo o servidor
se atualiza. Como quem inicia a conexão é o servidor (só saída HTTPS para o GitHub),
**funciona atrás do firewall/NAT da UFSM sem abrir nenhuma porta**.

## Pré-requisitos no servidor

- Ubuntu Server com **Docker + Docker Compose** e **git** instalados.
- Um usuário (ex.: `ufsm`) no grupo `docker`:
  ```bash
  sudo usermod -aG docker ufsm      # depois, refaça login para valer
  ```

## 1. Clonar o repositório

```bash
sudo mkdir -p /opt/ufsm-monitor
sudo chown ufsm:ufsm /opt/ufsm-monitor
git clone https://github.com/anthonycarlosp7/ufsm-monitor /opt/ufsm-monitor   # ajuste a URL
cd /opt/ufsm-monitor
```

> **Repositório privado?** Gere uma chave só-leitura no servidor e cadastre no GitHub como
> *Deploy key*:
> ```bash
> ssh-keygen -t ed25519 -C "servidor-ufsm" -f ~/.ssh/id_ed25519 -N ""
> cat ~/.ssh/id_ed25519.pub   # cole em GitHub → repo → Settings → Deploy keys (Read only)
> ```
> e clone via SSH: `git clone git@github.com:anthonycarlosp7/ufsm-monitor /opt/ufsm-monitor`.
> Repositório **público** não precisa de chave.

## 2. Testar o deploy manualmente

```bash
bash deploy/deploy.sh          # 1ª vez: sobe a stack; depois só atualiza se houver commit novo
docker compose ps              # confere os serviços do núcleo no ar
```

## 3. Ativar o timer (automático a cada 2 min)

```bash
# ajuste o User/caminhos no .service se o seu usuário/pasta forem diferentes
sudo cp deploy/ufsm-monitor-deploy.service /etc/systemd/system/
sudo cp deploy/ufsm-monitor-deploy.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ufsm-monitor-deploy.timer
```

Pronto. A partir daí, todo `git push` no branch `main` chega ao servidor em até ~2 min.

## Verificar / acompanhar

```bash
systemctl list-timers | grep ufsm-monitor      # quando roda a próxima vez
systemctl status ufsm-monitor-deploy.service   # resultado da última execução
journalctl -u ufsm-monitor-deploy.service -f   # log ao vivo (útil para ver o rebuild)
```

## Ajustes rápidos

- **Frequência:** mude `OnUnitActiveSec` no `.timer` (ex.: `5min`) e rode
  `sudo systemctl daemon-reload && sudo systemctl restart ufsm-monitor-deploy.timer`.
- **Branch:** altere `DEPLOY_BRANCH` no `.service` (padrão `main`).
- **Forçar agora:** `sudo systemctl start ufsm-monitor-deploy.service`.
- **Pausar o automático:** `sudo systemctl disable --now ufsm-monitor-deploy.timer`.

## Observações

- O `deploy.sh` sobe **só o núcleo** (controlador, ingestão, RabbitMQ, TimescaleDB, painel);
  os probes reais são os Raspberry Pi, instalados à parte (ver `docs/DEPLOY-FISICO.md`).
- O rebuild só acontece quando há commit novo, então rodar a cada 2 min é barato.
- Quando quiser deploy **no instante do push** (sem esperar os 2 min), o próximo passo é um
  *self-hosted runner* do GitHub Actions (Opção 2) — dá pra adicionar depois sem desfazer isto.
