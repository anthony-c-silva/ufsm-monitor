import React, { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from "recharts";
import { Thermometer, Cpu, MemoryStick, HardDrive, Network, Clock, HeartPulse, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { fmtTime } from "../format.js";
import Modal from "./Modal.jsx";
import { SkeletonBlock } from "./Skeleton.jsx";

// Limites usados nas cores (o Raspberry Pi reduz a frequência a partir de ~80 °C).
export const TEMP_WARN = 65;
export const TEMP_CRIT = 75;

const THROTTLE_LABEL = {
  subtensao: "subtensão (fonte fraca)",
  frequencia_limitada: "frequência limitada",
  desempenho_reduzido: "desempenho reduzido",
  limite_termico: "limite térmico",
};

export function fmtUptime(s) {
  if (!s && s !== 0) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

export function tempClass(t) {
  if (t === null || t === undefined) return "muted";
  if (t >= TEMP_CRIT) return "err";
  if (t >= TEMP_WARN) return "warn";
  return "ok";
}

export function pctClass(v, warn = 70, crit = 90) {
  if (v === null || v === undefined) return "muted";
  if (v >= crit) return "err";
  if (v >= warn) return "warn";
  return "ok";
}

export function throttleText(list) {
  return (list || []).map((f) => THROTTLE_LABEL[f] || f).join(", ");
}

const fmt = (v, unit, n = 1) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(n)} ${unit}`);

function Kpi({ label, value, sub, Icon, cls }) {
  return (
    <div className="card kpi">
      <div className="label">{Icon && <Icon size={13} />} {label}</div>
      <div className="value" style={{ fontSize: 22 }}>
        {cls ? <span className={"badge " + cls} style={{ fontSize: 18 }}>{value}</span> : value}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

const axis = { tick: { fontSize: 11, fill: "#93a2b6" }, stroke: "#26313f" };
const tooltip = {
  contentStyle: { background: "#161d28", border: "1px solid #26313f", borderRadius: 8, color: "#e7edf5" },
  labelStyle: { color: "#93a2b6" },
  itemStyle: { color: "#e7edf5" },
  labelFormatter: (t) => new Date(t).toLocaleString("pt-BR"),
};
const tickTime = (hours) => (t) => {
  const d = new Date(t);
  return hours > 24
    ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit" }) + "h"
    : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};

function Chart({ title, data, hours, lines, unit, domain, refLine }) {
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="hd"><h3>{title}</h3></div>
      <div className="bd">
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 6, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#26313f" />
              <XAxis dataKey="t" tickFormatter={tickTime(hours)} minTickGap={40} {...axis} />
              <YAxis domain={domain || ["auto", "auto"]} width={48} unit={unit} {...axis} />
              <Tooltip {...tooltip} formatter={(v, name) => [v === null ? "—" : `${v} ${unit}`, name]} />
              <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} />
              {refLine && <ReferenceLine y={refLine.y} stroke="#f87171" strokeDasharray="4 4" label={{ value: refLine.label, fill: "#f87171", fontSize: 10, position: "insideTopRight" }} />}
              {lines.map((l) => (
                <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function ProbeHealth({ probe, onClose, notify }) {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!probe) return undefined;
    let alive = true;
    const bucket = hours <= 6 ? 1 : hours <= 24 ? 5 : 30;
    const run = (silent) => {
      if (!silent) setLoading(true);
      api.probeHealth(probe.probe_id, { hours, bucket_minutes: bucket })
        .then((d) => { if (alive) setData(d); })
        .catch((e) => { if (alive && !silent) notify?.("Falha ao carregar a saúde da sonda: " + e.message, "err"); })
        .finally(() => { if (alive && !silent) setLoading(false); });
    };
    run(false);
    const t = setInterval(() => run(true), 60000);
    return () => { alive = false; clearInterval(t); };
  }, [probe, hours, notify]);

  const h = data?.latest;
  const pts = data?.points || [];
  const agora = h?.throttled_now || [];
  const desdeBoot = h?.throttled_since_boot || [];

  return (
    <Modal
      open={!!probe}
      onClose={onClose}
      title={probe ? <>Saúde da sonda <span className="mono">{probe.probe_id}</span></> : ""}
      icon={HeartPulse}
      size="lg"
      footer={<button className="btn" onClick={onClose}>Fechar</button>}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {h ? <>Último relato: {fmtTime(h.observed_at)} · agente {h.agent_version || "—"} · relógio {h.time_sync === "synchronized" ? "sincronizado" : (h.time_sync || "—")}</> : "Sem relato de inventário ainda."}
        </span>
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ width: "auto" }}>
          <option value={6}>últimas 6 h</option>
          <option value={24}>últimas 24 h</option>
          <option value={168}>últimos 7 dias</option>
        </select>
      </div>

      {agora.length > 0 && (
        <div className="badge err" style={{ marginBottom: 10 }}><AlertTriangle size={13} /> Limitação ativa agora: {throttleText(agora)}</div>
      )}
      {agora.length === 0 && desdeBoot.length > 0 && (
        <div className="badge warn" style={{ marginBottom: 10 }}><AlertTriangle size={13} /> Desde que ligou já houve: {throttleText(desdeBoot)}</div>
      )}

      {loading && !data ? <SkeletonBlock h={320} /> : (
        <>
          <div className="grid kpis">
            <Kpi label="Temperatura" Icon={Thermometer} value={fmt(h?.cpu_temp_c, "°C")} cls={tempClass(h?.cpu_temp_c)}
              sub={h?.cpu_freq_mhz ? `${Math.round(h.cpu_freq_mhz)} MHz` : null} />
            <Kpi label="CPU" Icon={Cpu} value={fmt(h?.cpu_usage_pct, "%")} cls={pctClass(h?.cpu_usage_pct)}
              sub={h?.load_avg ? `carga ${h.load_avg.map((v) => v.toFixed(2)).join(" / ")}` : null} />
            <Kpi label="Memória" Icon={MemoryStick} value={fmt(h?.mem_used_pct, "%")} cls={pctClass(h?.mem_used_pct, 80, 92)}
              sub={h?.mem_total_kb ? `de ${(h.mem_total_kb / 1048576).toFixed(1)} GB` : null} />
            <Kpi label="Disco" Icon={HardDrive} value={fmt(h?.disk_used_pct, "%")} cls={pctClass(h?.disk_used_pct, 80, 92)}
              sub={h?.disk_total_bytes ? `de ${(h.disk_total_bytes / 1e9).toFixed(0)} GB` : null} />
            <Kpi label="Link" Icon={Network} value={h?.link_speed_mbps ? `${h.link_speed_mbps} Mb/s` : "—"}
              cls={h?.link_speed_mbps ? (h.link_speed_mbps < 1000 ? "warn" : "ok") : "muted"} sub={h?.ip_address || null} />
            <Kpi label="Ligada há" Icon={Clock} value={fmtUptime(h?.uptime_seconds)}
              sub={h?.agent_rss_kb ? `agente ${fmt(h.agent_cpu_pct, "%")} CPU · ${(h.agent_rss_kb / 1024).toFixed(0)} MB` : null} />
          </div>

          {pts.length === 0 ? (
            <div className="empty-state" style={{ marginTop: 12 }}>Sem dados no período. A sonda envia o inventário a cada minuto quando está conectada.</div>
          ) : (
            <>
              <Chart title="Temperatura do processador" data={pts} hours={hours} unit="°C" refLine={{ y: 80, label: "redução de frequência" }}
                lines={[{ key: "temp_avg", name: "média", color: "#f59e0b" }, { key: "temp_max", name: "máxima", color: "#f87171" }]} />
              <Chart title="Uso do processador" data={pts} hours={hours} unit="%" domain={[0, 100]}
                lines={[{ key: "cpu_pct", name: "sonda (total)", color: "#60a5fa" }, { key: "agent_cpu_pct", name: "agente e medições (% de um núcleo)", color: "#34d399" }]} />
              <Chart title="Memória em uso" data={pts} hours={hours} unit="%" domain={[0, 100]}
                lines={[{ key: "mem_pct", name: "memória", color: "#a78bfa" }]} />
            </>
          )}
        </>
      )}
    </Modal>
  );
}
