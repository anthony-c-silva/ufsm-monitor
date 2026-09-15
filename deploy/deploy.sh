#!/usr/bin/env bash
# ============================================================================
# Auto-deploy do SERVIDOR CENTRAL (Opção 1 — pull + rebuild), com trava de CI.
#
# Puxa o código novo do GitHub e reconstrói a stack em Docker, mas SÓ se o
# workflow de CI (.github/workflows/ci.yml) daquele commit tiver concluído com
# sucesso. Assim o servidor nunca sobe um commit que quebrou o build.
#
# Funciona atrás do firewall/NAT da UFSM (só conexões de saída).
#
# Variáveis (opcionais):
#   REPO_DIR       pasta do repositório (padrão /opt/ufsm-monitor)
#   DEPLOY_BRANCH  branch acompanhado (padrão main)
#   REQUIRE_CI     1 = só faz deploy com CI verde (padrão) · 0 = ignora o CI
#   CI_WORKFLOW    arquivo do workflow (padrão ci.yml)
#   REPO_SLUG      owner/repo (padrão: detectado do remote)
#   GITHUB_TOKEN   opcional (repo privado / mais requisições na API)
#
# Uso: chamado pelo systemd timer, ou manualmente:  bash deploy/deploy.sh
# ============================================================================
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/ufsm-monitor}"
BRANCH="${DEPLOY_BRANCH:-main}"
REQUIRE_CI="${REQUIRE_CI:-1}"
CI_WORKFLOW="${CI_WORKFLOW:-ci.yml}"

cd "$REPO_DIR"

git fetch --quiet origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "$(date '+%F %T') sem mudanças (HEAD=${LOCAL:0:7})"
  exit 0
fi

echo "$(date '+%F %T') commit novo: ${LOCAL:0:7} -> ${REMOTE:0:7}"

# ---------------------------------------------------------------------------
# Trava de CI: só prossegue se o workflow do commit remoto passou.
# ---------------------------------------------------------------------------
if [ "$REQUIRE_CI" = "1" ]; then
  SLUG="${REPO_SLUG:-$(git config --get remote.origin.url \
        | sed -E 's#(git@github.com:|https?://github.com/)##; s#\.git$##')}"
  API="https://api.github.com/repos/${SLUG}/actions/workflows/${CI_WORKFLOW}/runs?head_sha=${REMOTE}&per_page=1"

  auth=()
  [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer ${GITHUB_TOKEN}")

  JSON="$(curl -fsSL "${auth[@]}" -H "Accept: application/vnd.github+json" "$API" 2>/dev/null || echo '')"
  OUT="$(printf '%s' "$JSON" | python3 -c '
import sys, json
try:
    runs = (json.load(sys.stdin).get("workflow_runs") or [])
    print(runs[0].get("status", ""), runs[0].get("conclusion", "")) if runs else print("none", "none")
except Exception:
    print("error", "error")
' 2>/dev/null || echo "error error")"
  STATUS="${OUT%% *}"
  CONCLUSION="${OUT##* }"

  if [ "$STATUS" != "completed" ]; then
    echo "$(date '+%F %T') CI ainda não concluiu (status=${STATUS}); aguardando o próximo ciclo"
    exit 0
  fi
  if [ "$CONCLUSION" != "success" ]; then
    echo "$(date '+%F %T') CI NÃO passou (conclusion=${CONCLUSION}); deploy adiado até um commit verde"
    exit 0
  fi
  echo "$(date '+%F %T') CI verde — prosseguindo com o deploy"
fi

# ---------------------------------------------------------------------------
git pull --ff-only origin "$BRANCH"
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
echo "$(date '+%F %T') deploy concluído (agora em ${REMOTE:0:7})"
