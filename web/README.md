# web — Dashboard da plataforma (React + Vite)

Front-end que **substitui o Grafana**, dando ao usuário final controle sobre a
plataforma (inventário e planos de medição) e a visualização dos dados coletados.

## Telas

- **Visão geral:** contadores (probes, destinos, planos, medições nas últimas 24 h),
  status do scheduler e atividade recente.
- **Inventário:** cadastrar/remover **probes**, **destinos** (allowlist) e **grupos**.
- **Planos:** construtor visual — escolher quais probes medem o quê (ICMP, iperf3, DNS,
  HTTP, traceroute), período, malha/estrela — além de validar, criar, habilitar e rodar.
- **Séries:** gráficos temporais por métrica (latência, perda, vazão, DNS, HTTP).
- **Matriz & status:** matriz probe×destino e saúde de cada probe.

## Como a API é acessada

O front chama `/api/...`. Em **desenvolvimento**, o Vite faz proxy de `/api` para o
controlador (`http://localhost:8000`). Em **produção** (contêiner), o Nginx faz o mesmo
proxy para `http://controller:8000`. Assim não há problema de CORS e a origem é única.

## Desenvolvimento

```bash
cd web
npm install
npm run dev            # http://localhost:5173  (controlador em :8000)
# controlador em outra porta? CONTROLLER_URL=http://localhost:9000 npm run dev
```

## Produção (Docker)

Sobe junto com a stack:

```bash
docker compose up -d --build web
```

Dashboard em **http://localhost:8080**.
