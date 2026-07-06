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

# Limites de validação de planos (spec 7).
MIN_PERIOD_SECONDS = int(os.getenv("MIN_PERIOD_SECONDS", "10"))
MAX_IPERF_DURATION = int(os.getenv("MAX_IPERF_DURATION", "30"))
MAX_TASKS_PER_CYCLE = int(os.getenv("MAX_TASKS_PER_CYCLE", "500"))

# Janela de validade de uma tarefa publicada (segundos). Tarefa vencida não roda.
TASK_TTL_SECONDS = int(os.getenv("TASK_TTL_SECONDS", "90"))
