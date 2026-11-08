# Experimento de interferência entre testes de vazão

Compara a vazão medida por dois pares de sondas cujos caminhos atravessam um
mesmo enlace, em quatro condições, repetidas em várias rodadas com ordem
sorteada:

| Condição | O que roda | Modo de coordenação |
|---|---|---|
| `solo-a` | só o par A | sonda |
| `solo-b` | só o par B | sonda |
| `par-sem` | A e B disparados juntos | sonda (regra usual: só impede a mesma sonda em dois testes) |
| `par-com` | A e B disparados juntos | trecho (testes que dividem um enlace esperam um ao outro) |

## Montagem

```
[probe-ct-01]──┐
               ├──[switch 100 Mb/s]══ enlace "sw100-ti" ══[rede da TI, 1 Gb/s]──┬──[servidor: probe-srv-01]
[probe-ct-02]──┘                                                             └──[probe-ct-03 (Pi 3B)]
```

- Par A: `probe-ct-01 → probe-srv-01`. Par B: `probe-ct-02 → probe-ct-03`.
- A ct-03 e o servidor ficam **fora** do switch de 100 Mb/s. Se a ct-03 estiver
  no mesmo switch, o tráfego do par B não passa pelo uplink e não há disputa.
- Os dois testes enviam no mesmo sentido (da sonda de origem para o destino,
  sem `reverse`). Em sentidos opostos o enlace full-duplex não seria disputado.

## Preparação

1. **probe-ct-03 (Pi 3B):** troque `PROBE_ID=probe-ct-03` e a senha no
   `/etc/ufsm-monitor/agent.env`, instale o binário atual,
   `sudo systemctl disable --now iperf3` e reinicie o agente. Cadastre a sonda
   no painel com o IP dela.
2. **Endereços no painel:** confira o IP de cada sonda em Probes (os destinos
   ct-03 e srv-01 precisam estar certos).
3. **Conectividade:** na ct-01, `nc -zv <IP do servidor> 5201`; na ct-02,
   `nc -zv <IP da ct-03> 5201`. Ambos devem responder `succeeded`.
4. **Enlaces (painel → Enlaces):** cadastre o enlace `sw100-ti` (capacidade 100)
   e, em "Caminho de cada sonda", coloque `sw100-ti` na ct-01 e na ct-02.
5. **Outros testes de vazão:** desabilite os planos com iperf3 durante o
   experimento, para não interferirem.

## Execução (no servidor)

```bash
cd /opt/ufsm-monitor/tools/interferencia
python3 experimento.py --par-a probe-ct-01:probe-srv-01 --par-b probe-ct-02:probe-ct-03 \
  --rodadas 10 --duracao 10 --saida resultados
python3 analisar.py resultados/resultados_interferencia.csv
```

O script pede a senha do usuário `admin` do painel. Cada rodada leva cerca de
1 minuto e meio; 10 rodadas, uns 15 minutos. O modo de coordenação volta ao
original no final.

## O que sai

- `log_condicoes.csv`: início e fim de cada condição.
- `resultados_interferencia.csv`: um teste por linha, com condição, par, vazão
  (Mb/s), retransmissões e horários.
- `resumo_interferencia.csv`: média, desvio, mínimo, mediana e máximo por
  condição e par.
- `rodadas_pares.csv`: sobreposição entre os dois testes e tempo total para
  concluir ambos, em cada rodada das condições `par-sem` e `par-com`.
- `interferencia_vazao.png`: boxplot da vazão (se o matplotlib estiver instalado).

Resultado esperado: em `par-sem`, os dois testes se sobrepõem e cada par mede
perto da metade da vazão de `solo`; em `par-com`, a sobreposição é zero, cada
par mede perto da vazão de `solo` e o tempo total para concluir os dois dobra.
