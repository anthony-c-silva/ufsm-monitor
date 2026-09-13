#!/usr/bin/env bash
# ============================================================================
# Auto-deploy do SERVIDOR CENTRAL (Opção 1 — pull + rebuild).
#
# Puxa o código novo do GitHub e reconstrói a stack em Docker. Só reconstrói
# quando há commit novo no branch remoto (evita rebuild à toa). Funciona atrás
# do firewall/NAT da UFSM porque é o servidor que "puxa" (só conexão de saída).
#
# Uso:
#   - automático: chamado pelo systemd timer (ufsm-monitor-deploy.timer);
#   - manual:     bash deploy/deploy.sh
# ============================================================================
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/ufsm-monitor}"   # onde o repo foi clonado no servidor
BRANCH="${DEPLOY_BRANCH:-main}"             # branch a acompanhar

cd "$REPO_DIR"

git fetch --quiet origin "$BRANCH"

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "$(date '+%F %T') sem mudanças (HEAD=${LOCAL:0:7})"
  exit 0
fi

echo "$(date '+%F %T') commit novo: ${LOCAL:0:7} -> ${REMOTE:0:7}; atualizando..."
git pull --ff-only origin "$BRANCH"

# Sobe apenas o núcleo (os probes reais são os Raspberry Pi, fora do compose).
# 'up -d --build' reconstrói só o que mudou e recria só os contêineres afetados.
docker compose up -d --build

# Remove imagens antigas/órfãs para não lotar o disco.
docker image prune -f >/dev/null 2>&1 || true

echo "$(date '+%F %T') deploy concluído (agora em ${REMOTE:0:7})"
