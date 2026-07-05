# controller — Controlador central (Fase 4)

> **Ainda não implementado.** Esta pasta é o lar do controlador central e será
> preenchida na Fase 4. Criada agora só para deixar a estrutura do repositório clara.

O controlador é o "cérebro" da plataforma (o que você chamou de *conector*):
recebe os planos JSON do administrador, valida, expande grupos/topologias em
tarefas concretas, agenda, e ingere os resultados publicados pelos probes.

- **Linguagem:** Python + FastAPI (decisão DP-01 no diário).
- **Responsabilidades:** inventário de probes, cadastro de destinos, grupos,
  planos JSON + validador, expansão de malha (`n(n-1)`), scheduler, API e
  serviço de ingestão (RabbitMQ → PostgreSQL/TimescaleDB).
- **Contratos:** usa os mesmos JSON Schema de `../contracts/` que o agente usa,
  garantindo que os formatos de tarefa e resultado batam entre os dois lados.

Estrutura prevista (a criar na Fase 4):

```
controller/
├── pyproject.toml
├── app/
│   ├── main.py            # FastAPI
│   ├── models/            # Pydantic (gerados a partir de ../contracts/)
│   ├── plans/             # validação e expansão de planos
│   ├── scheduler/         # reserva de recursos, serialização de iperf3
│   └── ingestion/         # consumidor RabbitMQ -> PostgreSQL/TimescaleDB
└── migrations/            # schema PostgreSQL + hypertables TimescaleDB
```
