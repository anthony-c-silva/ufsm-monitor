# Teste de escalabilidade do servidor central

Simula sondas publicando resultados no RabbitMQ, no mesmo formato do agente, e
mede como o servidor central (RabbitMQ, ingestão e TimescaleDB) se comporta
com o aumento do número de sondas.

Perfil de cada sonda simulada (igual ao das sondas reais): ICMP para 4 destinos
a cada 1 min, DNS para 2 destinos a cada 5 min, HTTP para 3 destinos a cada
5 min e traceroute para 2 destinos a cada 15 min, cerca de 5,1 mensagens por
minuto por sonda. Os inícios são espalhados ao longo do período.

## Arquivos

| Arquivo | Onde roda | Função |
|---|---|---|
| `loadgen.py` | servidor ou outra máquina | gera a carga (sondas `sim-0001`, `sim-0002`, ...) |
| `monitor.py` | servidor | registra fila, CPU, memória, tamanho do banco e atraso de ingestão |
| `analisar.py` | qualquer máquina | resume cada degrau e gera os gráficos |
| `cleanup.sql` | servidor | apaga os dados das sondas simuladas |
| `probe_stats.sh` | Raspberry Pi | consumo de recursos do agente na sonda |

## Passo a passo (no servidor)

```bash
cd ~/ufsm-monitor/tools/loadtest

# terminal 1: coleta das métricas
python3 monitor.py --saida monitor_log.csv

# terminal 2: carga em degraus (10, 50, 100, 250, 500 e 1000 sondas, 10 min cada)
docker run --rm --network ufsm-monitor_default -v "$PWD":/lt -w /lt \
  ufsm-monitor-controller python loadgen.py \
  --amqp amqp://guest:guest@rabbitmq:5672/ degraus

# ao terminar o loadgen, Ctrl+C no terminal 1

# vazão máxima de ingestão (2 min publicando o mais rápido possível)
docker run --rm --network ufsm-monitor_default -v "$PWD":/lt -w /lt \
  ufsm-monitor-controller python loadgen.py --saida maximo_log.csv \
  --amqp amqp://guest:guest@rabbitmq:5672/ maximo --duracao 120

# análise (pip install pandas matplotlib)
python3 analisar.py loadgen_log.csv monitor_log.csv

# limpeza
docker exec -i ufsm-timescaledb psql -U ufsm -d monitor < cleanup.sql
```

Se o usuário do RabbitMQ não for o padrão, troque `guest:guest` na URL e
exporte `RABBIT_USER` e `RABBIT_PASS` antes do `monitor.py`.

O gerador consome pouco processador na carga em degraus. No modo máximo, o
ideal é rodá-lo em outra máquina da rede (com `pip install pika` e a URL
apontando para o IP do servidor), para que ele não dispute processador com a
ingestão.

## Consumo de recursos na sonda

```bash
chmod +x probe_stats.sh
./probe_stats.sh 5 > probe_stats_$(hostname).csv   # deixar rodando algumas horas
```
