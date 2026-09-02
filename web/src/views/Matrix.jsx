import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { fmtValue, fmtAgo, fmtTime, TYPE_LABEL } from "../format.js";

const TYPES = ["icmp", "iperf3", "dns", "http"];

function statusColor(cell, type, primary) {
  if (!cell) return null;
  if (cell.status !== "success") return { background: "var(--err-soft)", color: "var(--err)" };
  // leve gradiente por valor para icmp (latência)
  return { background: "var(--ok-soft)", color: "var(--ok)" };
}

export default function Matrix({ notify, refreshKey }) {
  const [type, setType] = useState("icmp");
  const [hours, setHours] = useState(24);
  const [mx, setMx] = useState(null);
  const [status, setStatus] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    Promise.all([api.matrix(type, hours), api.probesStatus(30)])
      .then(([m, s]) => { setMx(m); setStatus(s); })
      .catch((e) => notify("Erro ao carregar matriz: " + e.message, "err"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refreshKey, type, hours]);

  const { sources, cols, byKey, primary } = useMemo(() => {
    const cells = mx?.cells || [];
    const primary = mx?.primary;
    const srcSet = [], colMap = new Map(), byKey = {};
    for (const c of cells) {
      if (!srcSet.includes(c.source)) srcSet.push(c.source);
      const label = c.target_probe || c.target;
      if (!colMap.has(c.target)) colMap.set(c.target, label);
      byKey[c.source + "|" + c.target] = c;
    }
    return { sources: srcSet.sort(), cols: [...colMap.entries()], byKey, primary };
  }, [mx]);

  return (
    <>
      <div className="card">
        <div className="bd">
          <div className="form-grid">
            <label className="fld">tipo
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="fld">janela (horas)
              <input type="number" min="1" value={hours} onChange={(e) => setHours(Number(e.target.value) || 24)} />
            </label>
            <button className="btn primary" onClick={load} disabled={loading}>Atualizar</button>
          </div>
          <div className="pill-legend" style={{ marginTop: 10 }}>
            <span><span className="dot on" /> sucesso</span>
            <span><span className="dot off" /> sem dado</span>
            <span>célula = <code className="k">{primary || "métrica"}</code> mais recente (linha = origem, coluna = destino)</span>
          </div>
        </div>
      </div>

      <div className="section-title">Matriz probe × destino</div>
      <div className="card scroll-x">
        {sources.length === 0 ? (
          <div className="empty-state">Sem medições de {TYPE_LABEL[type]} nesse período.</div>
        ) : (
          <table className="matrix">
            <thead>
              <tr>
                <th className="rowh">origem \ destino</th>
                {cols.map(([addr, label]) => <th key={addr} title={addr}>{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <tr key={src}>
                  <td className="rowh mono">{src}</td>
                  {cols.map(([addr]) => {
                    const c = byKey[src + "|" + addr];
                    const style = statusColor(c, type, primary);
                    return (
                      <td key={addr}>
                        {c ? (
                          <div className="cell" style={style} title={`${c.status} · ${fmtTime(c.observed_at)}`}>
                            {fmtValue(type, primary, c.value)}
                          </div>
                        ) : <span className="cell empty">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="section-title">Status dos probes</div>
      <div className="card scroll-x">
        <table>
          <thead><tr><th>probe</th><th>hostname</th><th>endereço</th><th>estado</th><th>última medição</th><th>runs (30min)</th><th>sucesso</th></tr></thead>
          <tbody>
            {status.map((p) => (
              <tr key={p.probe_id}>
                <td className="mono">{p.probe_id}</td>
                <td>{p.hostname || "—"}</td>
                <td className="mono">{p.address || "—"}</td>
                <td>
                  {p.online
                    ? <span className="badge ok"><span className="dot on" /> online</span>
                    : <span className="badge muted"><span className="dot off" /> sem dados</span>}
                </td>
                <td title={fmtTime(p.last_seen)}>{p.last_seen ? fmtAgo(p.last_seen) : "—"}</td>
                <td>{p.runs_recent}</td>
                <td>{p.success_rate === null || p.success_rate === undefined ? "—" : Math.round(p.success_rate * 100) + "%"}</td>
              </tr>
            ))}
            {status.length === 0 && <tr><td colSpan="7" className="muted">Nenhum probe cadastrado.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
