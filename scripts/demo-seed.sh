#!/usr/bin/env bash
# Semeia a demo: faz login, registra os 2 probes (endereços na rede Docker),
# autoriza os destinos, cria e RODA o plano de malha.
# Requer a API com autenticação (login admin no 1º boot).
# Uso (a partir da raiz do repo, com a stack no ar):  bash scripts/demo-seed.sh
set -euo pipefail

API="${API:-http://localhost:8000}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
NEW_ADMIN_PASS="${NEW_ADMIN_PASS:-admin12345}"   # usada se a troca for obrigatória (1º boot)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Extrai um campo string de um JSON simples (sem depender de jq).
json_str() { grep -o "\"$1\":\"[^\"]*\"" | sed "s/.*:\"//; s/\"$//" | head -1; }

echo "==> aguardando o controlador em $API ..."
until curl -sf "$API/health" >/dev/null 2>&1; do sleep 2; done

echo "==> login ($ADMIN_USER)"
LOGIN="$(curl -fsS -X POST "$API/auth/login" -H 'content-type: application/json' \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")"
TOKEN="$(printf '%s' "$LOGIN" | json_str access_token)"

# No 1º boot o admin precisa trocar a senha antes de usar as demais rotas.
if printf '%s' "$LOGIN" | grep -q '"must_change_password":true'; then
  echo "==> troca de senha obrigatória -> definindo NEW_ADMIN_PASS"
  CH="$(curl -fsS -X POST "$API/auth/change-password" \
    -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
    -d "{\"current_password\":\"$ADMIN_PASS\",\"new_password\":\"$NEW_ADMIN_PASS\"}")"
  TOKEN="$(printf '%s' "$CH" | json_str access_token)"
fi

AUTH=(-H "authorization: Bearer $TOKEN" -H 'content-type: application/json')

echo "==> registrando probes (endereço = nome do serviço na rede Docker)"
curl -fsS -X POST "$API/probes" "${AUTH[@]}" \
  -d '{"probe_id":"probe-a","address":"agent-a","deployment":"container-a"}' >/dev/null
curl -fsS -X POST "$API/probes" "${AUTH[@]}" \
  -d '{"probe_id":"probe-b","address":"agent-b","deployment":"container-b"}' >/dev/null

echo "==> autorizando destinos externos (allowlist)"
curl -fsS -X POST "$API/targets" "${AUTH[@]}" -d '{"name":"cloudflare","address":"1.1.1.1"}' >/dev/null
curl -fsS -X POST "$API/targets" "${AUTH[@]}" -d '{"name":"ufsm-web","address":"https://www.ufsm.br"}' >/dev/null

echo "==> criando o plano de malha"
curl -fsS -X POST "$API/plans" "${AUTH[@]}" -d @"$ROOT/controller/examples/plan-mesh.json"; echo

echo "==> rodando o plano (gera e publica as tarefas)"
curl -fsS -X POST "$API/plans/demo-mesh/run" "${AUTH[@]}"; echo

echo "==> pronto. Dashboard em http://localhost:8080 (login admin — senha trocada se foi o 1º boot)."
