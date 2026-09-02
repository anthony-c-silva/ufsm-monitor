import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { api } from "../api.js";
import { fmtValue, unitLabel, TYPE_LABEL, PALETTE } from "../format.js";

const MAX_LINES = 8;

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

  // agrupa pontos em linhas (probe → destino)
  const { data, keys } = useMemo(() => {
    const pts = resp?.points || [];
    const groups = {};
    for (const p of pts) {
      const key = `${p.probe_id} → ${p.target}`;
      (groups[key] ||= []).push(p);
    }
    let keys = Object.keys(groups);
    keys.sort((a, b) => groups[b].length - groups[a].length);
    const shown = keys.slice(0, MAX_LINES);
    const times = [...new Set(pts.map((p) => p.observed_at))].sort();
    const rowByTime = new Map(times.map((t) => [t, { t }]));
    shown.forEach((k) => groups[k].forEach((p) => { rowByTime.get(p.observed_at)[k] = p.value; }));
    return { data: [...rowByTime.values()], keys: shown };
  }, [resp]);

  const targetList = useMemo(() => {
    const s = new Set();
    targets.forEach((t) => s.add(t.address));
    probes.forEach((p) => p.address && s.add(p.address));
    return [...s];
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
              <input list="targetlist" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="todos" />
              <datalist id="targetlist">{targetList.map((t) => <option key={t} value={t} />)}</datalist>
            </label>
            <label className="fld">janela (horas)
              <input type="number" min="1" value={hours} onChange={(e) => setHours(Number(e.target.value) || 24)} />
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
                <LineChart data={data} margin={{ top: 8, right: 20, bottom: 8, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef1f6" />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    minTickGap={40} tick={{ fontSize: 11 }}
                  />
                  <YAxis tick={{ fontSize: 11 }} width={64} />
                  <Tooltip
                    labelFormatter={(t) => new Date(t).toLocaleString("pt-BR")}
                    formatter={(v) => fmtValue(type, field, v)}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
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
