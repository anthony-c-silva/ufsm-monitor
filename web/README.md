# web — Dashboard da plataforma (React + Vite)

Front-end que **substitui o Grafana**, com **login/autenticação**, tema **escuro**, layout
**responsivo**, fonte **Inter** e ícones **lucide-react**. Dá ao usuário final controle sobre
a plataforma (inventário e planos) e a visualização dos dados coletados.

## Telas

- **Login:** usuário/senha; primeiro acesso **admin / admin** com **troca de senha obrigatória**.
- **Visão geral:** contadores, status do scheduler e atividade recente.
- **Inventário:** cadastrar/remover probes, destinos (allowlist) e grupos.
- **Planos:** construtor visual — quais probes medem o quê (ICMP, iperf3, DNS, HTTP, traceroute),
  período, malha/estrela; validar, criar, habilitar e rodar.
- **Séries:** gráficos temporais por métrica (latência, perda, vazão, DNS, HTTP).
- **Matriz & status:** matriz probe×destino, saúde dos probes e **caminho (traceroute)**.
- **Usuários:** criar/remover usuários (papel único ADMIN).

Recursos de UX: **auto-refresh** (botão no topo, 30 s), menu de usuário (trocar senha / sair),
sidebar retrátil no celular.

## Autenticação

O front guarda um **access token** (curto) e um **refresh token** (rotativo). O access vai no
header `Authorization`; ao expirar, o front renova automaticamente pelo refresh. Ao trocar a
senha, as outras sessões são encerradas. Tokens ficam em `localStorage`.

## Como a API é acessada

O front chama `/api/...`. Em **desenvolvimento**, o Vite faz proxy de `/api` para o
controlador (`http://localhost:8000`); em **produção** (contêiner), o Nginx faz o mesmo proxy
para `http://controller:8000`. Sem CORS, origem única.

## Desenvolvimento

```bash
cd web
npm install
npm run dev            # http://localhost:5173  (controlador em :8000)
```

## Produção (Docker)

```bash
docker compose up -d --build web
```

Dashboard em **http://localhost:8080** (login inicial admin/admin).
