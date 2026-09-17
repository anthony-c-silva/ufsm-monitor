import React, { useEffect, useState } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Server, Globe, Boxes, SlidersHorizontal, Activity, Send } from "lucide-react";
import { api } from "../api.js";
import { fmtTime, fmtAgo, TYPE_LABEL } from "../format.js";
import { SkeletonKpis, SkeletonBlock, SkeletonTable } from "../components/Skeleton.jsx";

function Kpi({ label, value, sub, Icon }) {
  return (
    <div className="card kpi">
      <div className="label">{Icon && <Icon size={13} />} {label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Overview({ notify, refreshKey }) {
  const [ov, setOv] = useState(null);
  const [act, setAct] = useState([]);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([api.overview(), api.activity({ hours: 24, bucket_minutes: 30 }), api.recent(10)])
      .then(([o, a, r]) => {
        if (!alive) return;
        setOv(o);
        setAct(a.points || []);
        setRecent(r);
      })
      .catch((e) => notify("Falha ao carregar visão geral: " + e.message, "err"))
      .finally(() => alive && setLoading(false));
    return () => (alive = false);
  }, [refreshKey, notify]);

  if (loading && !ov) {
    return (
      <>
        <SkeletonKpis n={6} />
        <div className="section-title">Atividade (24h)</div>
        <SkeletonBlock h={240} />
        <div className="section-title">Atividade recente</div>
        <SkeletonTable rows={6} cols={5} />
      </>
    );
  }
  if (!ov) return <div className="empty-state">Sem dados. O controlador está no ar?</div>;

  const c = ov.counts;
  const runs = ov.runs;
  const rate = runs.total ? Math.round((runs.success / runs.total) * 100) : null;

  return (
    <>
      <div className="grid kpis">
        <Kpi label="Probes" value={c.probes} sub={`${c.probes_active} ativos`} Icon={Server} />
        <Kpi label="Destinos" value={c.targets} sub="allowlist" Icon={Globe} />
        <Kpi label="Grupos" value={c.groups} Icon={Boxes} />
        <Kpi label="Planos" value={c.plans} sub={`${c.plans_enabled} habilitados`} Icon={SlidersHorizontal} />
        <Kpi label="Medições (24h)" value={runs.total} sub={rate !== null ? `${rate}% sucesso` : "sem dados"} Icon={Activity} />
        <Kpi label="Tarefas publicadas" value={c.tasks_published} Icon={Send} />
      </div>

      <div className="section-title">Atividade (últimas 24h)</div>
      <div className="card">
        <div className="hd">
          <h3><Activity size={15} /> Medições por período de 30 min</h3>
          <span className={"badge " + (ov.scheduler.enabled ? "ok" : "muted")}>
            {ov.scheduler.enabled ? "● scheduler ativo" : "○ scheduler desativado"}
          </span>
        </div>
        <div className="bd">
          {act.length === 0 ? (
            <div className="empty-state">Sem medições nas últimas 24h. Habilite um plano em <b>Planos</b>.</div>
          ) : (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <AreaChart data={act} margin={{ top: 6, right: 16, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="gOk" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#34d399" stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="gErr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f87171" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#f87171" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#26313f" />
                  <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    minTickGap={40} tick={{ fontSize: 11, fill: "#93a2b6" }} stroke="#26313f" />
                  <YAxis tick={{ fontSize: 11, fill: "#93a2b6" }} stroke="#26313f" width={36} allowDecimals={false} />
                  <Tooltip
                    labelFormatter={(t) => new Date(t).toLocaleString("pt-BR")}
                    contentStyle={{ background: "#161d28", border: "1px solid #26313f", borderRadius: 8, color: "#e7edf5" }}
                    labelStyle={{ color: "#93a2b6" }} itemStyle={{ color: "#e7edf5" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="success" name="sucesso" stackId="1" stroke="#34d399" fill="url(#gOk)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="error" name="falha" stackId="1" stroke="#f87171" fill="url(#gErr)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="section-title">Atividade recente</div>
      <div className="card scroll-x">
        {recent.length === 0 ? (
          <div className="empty-state">Nenhuma medição em andamento. Habilite e rode um plano em <b>Planos</b>.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Quando</th><th>Probe</th><th>Tipo</th><th>Destino</th><th>Status</th></tr>
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
