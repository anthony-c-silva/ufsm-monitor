#!/usr/bin/env bash
# Semeia a demo: registra os 2 probes (com seus endereços na rede Docker),
# autoriza os destinos externos, cria e RODA o plano de malha.
# Uso (a partir da raiz do repo, com a stack no ar):  bash scripts/demo-seed.sh
set -euo pipefail

API="${API:-http://localhost:8000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> aguardando o controlador em $API ..."
until curl -sf "$API/health" >/dev/null 2>&1; do sleep 2; done

echo "==> registrando probes (endereço = nome do serviço na rede Docker)"
curl -s -X POST "$API/probes" -H 'content-type: application/json' \
  -d '{"probe_id":"probe-a","address":"agent-a","deployment":"container-a"}' >/dev/null
curl -s -X POST "$API/probes" -H 'content-type: application/json' \
  -d '{"probe_id":"probe-b","address":"agent-b","deployment":"container-b"}' >/dev/null

echo "==> autorizando destinos externos (allowlist)"
curl -s -X POST "$API/targets" -H 'content-type: application/json' \
  -d '{"name":"cloudflare","address":"1.1.1.1"}' >/dev/null
curl -s -X POST "$API/targets" -H 'content-type: application/json' \
  -d '{"name":"ufsm-web","address":"https://www.ufsm.br"}' >/dev/null

echo "==> criando o plano de malha"
curl -s -X POST "$API/plans" -H 'content-type: application/json' \
  -d @"$ROOT/controller/examples/plan-mesh.json"
echo

echo "==> rodando o plano (gera e publica as tarefas)"
curl -s -X POST "$API/plans/demo-mesh/run"
echo
echo "==> pronto. Veja o Grafana em http://localhost:3000 (admin/admin)."
