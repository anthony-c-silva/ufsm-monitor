# Imagem do controlador (FastAPI). O serviço de ingestão usa a MESMA imagem,
# sobrescrevendo o comando para `python -m app.ingestion` no docker-compose.
FROM python:3.12-slim

WORKDIR /app

# Dependências primeiro (melhora o cache do build)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY examples ./examples

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
