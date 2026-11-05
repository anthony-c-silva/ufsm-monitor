#!/usr/bin/env bash
# Consumo de recursos do agente na sonda (Raspberry Pi).
# Uso: ./probe_stats.sh [intervalo_s] > probe_stats_$(hostname).csv
# Registra CPU e memória (RSS) do agente e dos processos de medição que ele
# dispara (fping, iperf3, dig, mtr), além da memória livre e do uso do disco.
INT=${1:-5}
echo "ts,agente_cpu_pct,agente_rss_kib,filhos_cpu_pct,filhos_rss_kib,mem_disp_kib,disco_usado_pct,temp_c"
while true; do
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  read -r acpu arss < <(ps -C ufsm-monitor-agent -o %cpu=,rss= | awk '{c+=$1; r+=$2} END {print c+0, r+0}')
  read -r fcpu frss < <(ps -C fping,iperf3,dig,mtr,mtr-packet -o %cpu=,rss= | awk '{c+=$1; r+=$2} END {print c+0, r+0}')
  mem=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
  disco=$(df --output=pcent / | tail -1 | tr -dc '0-9')
  temp=$(awk '{printf "%.1f", $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
  echo "$ts,$acpu,$arss,$fcpu,$frss,$mem,$disco,$temp"
  sleep "$INT"
done
