import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { api } from "../api.js";
import { fmtValue, unitLabel, TYPE_LABEL, PALETTE } from "../format.js";

const MAX_LINES = 8;

// Faixas de tempo prontas (padrão de ferramentas de monitoramento).
const WINDOWS = [
  { h: 0.5, label: "Últimos 30 minutos", short: "últimos 30 min" },
  { h: 1, label: "Última 1 hora", short: "última 1 h" },
  { h: 2, label: "Últimas 2 horas", short: "últimas 2 h" },
  { h: 6, label: "Últimas 6 horas", short: "últimas 6 h" },
  { h: 12, label: "Últimas 12 horas", short: "últimas 12 h" },
  { h: 24, label: "Últimas 24 horas", short: "últimas 24 h" },
  { h: 48, label: "Últimos 2 dias", short: "últimos 2 dias" },
  { h: 168, label: "Últimos 7 dias", short: "últimos 7 dias" },
];

export default function Series({ notify, refreshKey }) {
  const [meta, setMeta] = useState(null);
  const [probes, setProbes] = useState([]);
  const [targets, setTargets] = useState([]);
  const [type, setType] = useState("icmp");
  const [field, setField] = useState("rtt_avg_ms");
  const [probeId, setProbeId] = useState("");
  const [target, setTarget] = useState("");
  const [hours, setHours] = useState(24);
  const [resp, setResp] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    Promise.all([api.fields(), api.probes(), api.targets()])
      .then(([m, p, t]) => { setMeta(m); setProbes(p); setTargets(t); })
      .catch((e) => notify("Falha ao carregar filtros: " + e.message, "err"));
  }, [notify]);

  const fieldOptions = meta ? meta.fields[type] || [] : [];
  useEffect(() => {
    if (meta && !fieldOptions.includes(field)) setField(meta.primary[type]);
    // eslint-disable-next-line
  }, [type, meta]);

  const fetchSeries = () => {
    setLoading(true);
    api.series({ type, field, probe_id: probeId, target, hours, limit: 3000 })
      .then(setResp)
      .catch((e) => notify("Erro nas séries: " + e.message, "err"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { if (meta) fetchSeries(); /* eslint-disable-next-line */ }, [refreshKey, meta]);

  // mapa endereço -> nome amigável (exibir o destino pelo nome, não pelo IP/host)
  const nameByAddr = useMemo(() => {
    const m = {};
    targets.forEach((t) => { if (t.address) m[t.address] = t.name; });
    probes.forEach((p) => { if (p.address) m[p.address] = p.probe_id; });
    return m;
  }, [targets, probes]);

  // agrupa pontos em linhas (probe → destino), rotulando o destino pelo nome
  const { data, keys } = useMemo(() => {
    const pts = resp?.points || [];
    const groups = {};
    for (const p of pts) {
      const dst = nameByAddr[p.target] || p.target;
      const key = `${p.probe_id} → ${dst}`;
      (groups[key] ||= []).push(p);
    }
    let keys = Object.keys(groups);
    keys.sort((a, b) => groups[b].length - groups[a].length);
    const shown = keys.slice(0, MAX_LINES);
    const times = [...new Set(pts.map((p) => p.observed_at))].sort();
    const rowByTime = new Map(times.map((t) => [t, { t }]));
    shown.forEach((k) => groups[k].forEach((p) => { rowByTime.get(p.observed_at)[k] = p.value; }));
    return { data: [...rowByTime.values()], keys: shown };
  }, [resp, nameByAddr]);

  // opções de destino: valor = endereço (o que o filtro usa), rótulo = nome amigável
  const targetOptions = useMemo(() => {
    const opts = [];
    const seen = new Set();
    targets.forEach((t) => { if (t.address && !seen.has(t.address)) { seen.add(t.address); opts.push({ value: t.address, label: t.name }); } });
    probes.forEach((p) => { if (p.address && !seen.has(p.address)) { seen.add(p.address); opts.push({ value: p.address, label: p.probe_id + " (probe)" }); } });
    return opts;
  }, [targets, probes]);

  return (
    <>
      <div className="card">
        <div className="bd">
          <div className="form-grid">
            <label className="fld">tipo de medição
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {(meta?.types || ["icmp"]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
              </select>
            </label>
            <label className="fld">métrica
              <select value={field} onChange={(e) => setField(e.target.value)}>
                {fieldOptions.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="fld">probe (origem)
              <select value={probeId} onChange={(e) => setProbeId(e.target.value)}>
                <option value="">todos</option>
                {probes.map((p) => <option key={p.probe_id} value={p.probe_id}>{p.probe_id}</option>)}
              </select>
            </label>
            <label className="fld">destino
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">todos</option>
                {targetOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="fld">janela de tempo
              <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {WINDOWS.map((w) => <option key={w.h} value={w.h}>{w.label}</option>)}
              </select>
              <span className="hint">período mostrado no gráfico</span>
            </label>
            <button className="btn primary" onClick={fetchSeries} disabled={loading}>Consultar</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="hd">
          <h3>{TYPE_LABEL[type] || type} — {field} <span className="muted">({unitLabel(field) || "valor"})</span></h3>
          {loading && <span className="spinner" />}
        </div>
        <div className="bd">
          {(!data.length) ? (
            <div className="empty-state">Sem pontos nesse período. Rode um plano e aguarde a coleta.</div>
          ) : (
            <div style={{ width: "100%", height: 380 }}>
              <ResponsiveContainer>
                <LineChart data={data} margin={{ top: 8, right: 20, bottom: 28, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#26313f" />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(t) => {
                      const d = new Date(t);
                      return hours > 48
                        ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
                        : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                    }}
                    minTickGap={40} tick={{ fontSize: 11, fill: "#93a2b6" }} stroke="#26313f"
                    label={{ value: `Horário (${(WINDOWS.find((w) => w.h === hours)?.short) || hours + " h"})`, position: "insideBottom", offset: -12, fill: "#93a2b6", fontSize: 11 }}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#93a2b6" }} stroke="#26313f" width={64}
                    label={{ value: unitLabel(field) || "valor", angle: -90, position: "insideLeft", offset: 8, fill: "#93a2b6", fontSize: 11, style: { textAnchor: "middle" } }} />
                  <Tooltip
                    labelFormatter={(t) => new Date(t).toLocaleString("pt-BR")}
                    formatter={(v) => fmtValue(type, field, v)}
                    contentStyle={{ background: "#161d28", border: "1px solid #26313f", borderRadius: 8, color: "#e7edf5" }}
                    labelStyle={{ color: "#93a2b6" }}
                    itemStyle={{ color: "#e7edf5" }}
                  />
                  <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: 11 }} />
                  {keys.map((k, i) => (
                    <Line key={k} type="monotone" dataKey={k} stroke={PALETTE[i % PALETTE.length]}
                      dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {keys.length >= MAX_LINES && <div className="muted" style={{ marginTop: 8 }}>Exibindo as {MAX_LINES} séries com mais pontos. Refine com os filtros de probe/destino.</div>}
        </div>
      </div>
    </>
  );
}
