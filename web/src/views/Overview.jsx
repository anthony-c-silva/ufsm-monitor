import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { fmtTime, fmtAgo, TYPE_LABEL } from "../format.js";

function Kpi({ label, value, sub }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Overview({ notify, refreshKey }) {
  const [ov, setOv] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.overview(), api.recent(20)])
      .then(([o, r]) => {
        if (!alive) return;
        setOv(o);
        setRecent(r);
      })
      .catch((e) => notify("Falha ao carregar visão geral: " + e.message, "err"))
      .finally(() => alive && setLoading(false));
    return () => (alive = false);
  }, [refreshKey, notify]);

  if (loading && !ov) return <div className="empty-state"><span className="spinner" /> Carregando…</div>;
  if (!ov) return <div className="empty-state">Sem dados. O controlador está no ar?</div>;

  const c = ov.counts;
  const runs = ov.runs;
  const rate = runs.total ? Math.round((runs.success / runs.total) * 100) : null;

  return (
    <>
      <div className="grid kpis">
        <Kpi label="Probes" value={c.probes} sub={`${c.probes_active} ativos`} />
        <Kpi label="Destinos" value={c.targets} sub="allowlist" />
        <Kpi label="Grupos" value={c.groups} />
        <Kpi label="Planos" value={c.plans} sub={`${c.plans_enabled} habilitados`} />
        <Kpi label="Medições (24h)" value={runs.total} sub={rate !== null ? `${rate}% sucesso` : "sem dados"} />
        <Kpi label="Tarefas publicadas" value={c.tasks_published} />
      </div>

      <div className="section-title">Scheduler</div>
      <div className="card">
        <div className="bd inline">
          <span className={"badge " + (ov.scheduler.enabled ? "ok" : "muted")}>
            {ov.scheduler.enabled ? "● Ativo" : "○ Desativado"}
          </span>
          <span className="muted">
            {ov.scheduler.last_runs?.length || 0} job(s) executados recentemente ·
            última medição {runs.last_observed_at ? fmtAgo(runs.last_observed_at) : "—"}
          </span>
        </div>
      </div>

      <div className="section-title">Atividade recente</div>
      <div className="card scroll-x">
        {recent.length === 0 ? (
          <div className="empty-state">Nenhuma medição registrada ainda. Crie e rode um plano em <b>Planos</b>.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Quando</th><th>Probe</th><th>Tipo</th><th>Destino</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td title={fmtTime(r.observed_at)}>{fmtAgo(r.observed_at)}</td>
                  <td className="mono">{r.probe_id}</td>
                  <td>{TYPE_LABEL[r.type] || r.type}</td>
                  <td className="mono">{r.target_probe || r.target || "—"}</td>
                  <td>
                    {r.status === "success"
                      ? <span className="badge ok">sucesso</span>
                      : <span className="badge err" title={r.error_message || ""}>{r.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
