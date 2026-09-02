"""Configuração do controlador, lida de variáveis de ambiente (.env opcional)."""
import os

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # python-dotenv é opcional
    pass

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg2://ufsm:ufsm@localhost:5432/monitor"
)
AMQP_URL = os.getenv("AMQP_URL", "amqp://guest:guest@localhost:5672/")

# Origens permitidas para o front-end (CORS). "*" libera todas (padrão em dev).
FRONTEND_ORIGINS = os.getenv("FRONTEND_ORIGINS", "*")

# Limites de validação de planos (spec 7).
MIN_PERIOD_SECONDS = int(os.getenv("MIN_PERIOD_SECONDS", "10"))
MAX_IPERF_DURATION = int(os.getenv("MAX_IPERF_DURATION", "30"))
MAX_TASKS_PER_CYCLE = int(os.getenv("MAX_TASKS_PER_CYCLE", "500"))

# Janela de validade de uma tarefa publicada (segundos). Tarefa vencida não roda.
TASK_TTL_SECONDS = int(os.getenv("TASK_TTL_SECONDS", "90"))

# Scheduler automático (Fase 6). "off" desativa (aí só roda via POST /plans/{id}/run).
SCHEDULER_ENABLED = os.getenv("SCHEDULER", "on") != "off"
SCHEDULER_TICK_SECONDS = int(os.getenv("SCHEDULER_TICK_SECONDS", "5"))
# Jitter aplicado ao período de cada job (fração), para evitar sincronização rígida.
JOB_JITTER_PCT = float(os.getenv("JOB_JITTER_PCT", "0.15"))
# Folga entre ondas de iperf3 (segundos) somada à duração do teste.
IPERF3_SLACK_SECONDS = int(os.getenv("IPERF3_SLACK_SECONDS", "5"))
