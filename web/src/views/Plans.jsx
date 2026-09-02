import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { TYPE_LABEL } from "../format.js";

const TYPES = ["icmp", "iperf3", "dns", "http", "traceroute"];
const num = (v) => (v === "" || v === null || v === undefined ? undefined : Number(v));

function MultiChips({ options, selected, onToggle }) {
  if (options.length === 0) return <span className="muted">—</span>;
  return (
    <div className="checks">
      {options.map((o) => (
        <label key={o.value} className={"chk" + (selected.includes(o.value) ? " on" : "")}>
          <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onToggle(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

let jobSeq = 0;
const blankJob = () => ({
  id: "job-" + ++jobSeq, type: "icmp", sources: [], targets: [],
  exclude_self: true, period_seconds: 60, params: { samples: 10 },
});

export default function Plans({ notify, refreshKey }) {
  const [plans, setPlans] = useState([]);
  const [probes, setProbes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [targets, setTargets] = useState([]);
  const [expanded, setExpanded] = useState(null); // {plan_id, spec}

  const loadAll = () =>
    Promise.all([api.plans(), api.probes(), api.groups(), api.targets()])
      .then(([pl, pr, gr, tg]) => { setPlans(pl); setProbes(pr); setGroups(gr); setTargets(tg); })
      .catch((e) => notify("Falha ao carregar: " + e.message, "err"));

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [refreshKey]);

  // ---------------- builder ----------------
  const [planId, setPlanId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [inlineGroups, setInlineGroups] = useState([]); // [{name, members[]}]
  const [jobs, setJobs] = useState([blankJob()]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const groupNames = useMemo(() => {
    const names = new Set(groups.map((g) => g.name));
    inlineGroups.forEach((g) => g.name && names.add(g.name));
    return [...names];
  }, [groups, inlineGroups]);

  const sourceOptions = useMemo(() => [
    ...groupNames.map((n) => ({ value: "group:" + n, label: "grupo:" + n })),
    ...probes.map((p) => ({ value: "probe:" + p.probe_id, label: p.probe_id })),
  ], [groupNames, probes]);

  const targetOptions = useMemo(() => [
    ...groupNames.map((n) => ({ value: "group:" + n, label: "grupo:" + n })),
    ...probes.map((p) => ({ value: "probe:" + p.probe_id, label: p.probe_id })),
    ...targets.filter((t) => t.kind === "external").map((t) => ({ value: t.address, label: t.name + " (" + t.address + ")" })),
  ], [groupNames, probes, targets]);

  const patchJob = (i, patch) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...patch } : j)));
  const patchParam = (i, patch) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, params: { ...j.params, ...patch } } : j)));
  const toggleIn = (i, field, val) => setJobs((js) => js.map((j, k) => {
    if (k !== i) return j;
    const arr = j[field].includes(val) ? j[field].filter((x) => x !== val) : [...j[field], val];
    return { ...j, [field]: arr };
  }));
  const setType = (i, type) => {
    const defaults = { icmp: { samples: 10 }, iperf3: { duration_seconds: 5 }, dns: { qtype: "A" }, http: { method: "GET" }, traceroute: { cycles: 3, max_hops: 30 } };
    patchJob(i, { type, params: defaults[type] || {} });
  };

  const addInlineGroup = () => setInlineGroups((g) => [...g, { name: "", members: [] }]);
  const patchInlineGroup = (i, patch) => setInlineGroups((g) => g.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const toggleInlineMember = (i, id) => setInlineGroups((g) => g.map((x, k) => {
    if (k !== i) return x;
    const m = x.members.includes(id) ? x.members.filter((y) => y !== id) : [...x.members, id];
    return { ...x, members: m };
  }));

  function buildPlan() {
    const g = {};
    inlineGroups.forEach((x) => { if (x.name) g[x.name] = x.members; });
    return {
      plan_id: planId, revision: 1, enabled, groups: g,
      jobs: jobs.map((j) => {
        const b = { id: j.id, type: j.type, sources: j.sources, targets: j.targets, exclude_self: j.exclude_self, period_seconds: Number(j.period_seconds) };
        const p = j.params || {};
        if (j.type === "icmp") { b.samples = num(p.samples); b.timeout_ms = num(p.timeout_ms); }
        else if (j.type === "iperf3") { b.duration_seconds = num(p.duration_seconds); b.reverse = !!p.reverse; }
        else if (j.type === "dns") { b.qtype = p.qtype || "A"; b.tcp = !!p.tcp; if (p.resolver) b.resolver = p.resolver; }
        else if (j.type === "http") { b.method = p.method || "GET"; b.timeout_ms = num(p.timeout_ms); }
        else if (j.type === "traceroute") { b.cycles = num(p.cycles); b.max_hops = num(p.max_hops); }
        Object.keys(b).forEach((k) => b[k] === undefined && delete b[k]);
        return b;
      }),
    };
  }

  const doValidate = async () => {
    if (!planId) return notify("Informe o plan_id", "err");
    setBusy(true); setResult(null);
    try { setResult({ kind: "validate", data: await api.validatePlan(buildPlan()) }); }
    catch (e) { notify("Erro na validação: " + e.message, "err"); }
    finally { setBusy(false); }
  };
  const doCreate = async () => {
    if (!planId) return notify("Informe o plan_id", "err");
    setBusy(true);
    try {
      const r = await api.createPlan(buildPlan());
      notify("Plano '" + planId + "' criado", "ok");
      setResult({ kind: "created", data: r });
      loadAll();
    } catch (e) { notify("Erro ao criar: " + e.message, "err"); }
    finally { setBusy(false); }
  };

  // ---------------- list actions ----------------
  const act = async (fn, id, ok) => {
    try { await fn(id); notify(ok); loadAll(); } catch (e) { notify("Erro: " + e.message, "err"); }
  };
  const runPlan = async (id) => {
    try { const r = await api.runPlan(id); notify(`Rodou '${id}': ${r.published} tarefa(s) publicada(s)`, "ok"); }
    catch (e) { notify("Erro ao rodar: " + e.message, "err"); }
  };
  const viewSpec = async (id) => {
    if (expanded?.plan_id === id) return setExpanded(null);
    try { const p = await api.getPlan(id); setExpanded(p); } catch (e) { notify("Erro: " + e.message, "err"); }
  };

  return (
    <>
      <div className="section-title">Planos cadastrados</div>
      <div className="card scroll-x">
        <table>
          <thead><tr><th>plano</th><th>rev.</th><th>habilitado</th><th>ações</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <React.Fragment key={p.plan_id}>
                <tr>
                  <td className="mono">{p.plan_id}</td>
                  <td>{p.revision}</td>
                  <td>{p.enabled ? <span className="badge ok">sim</span> : <span className="badge muted">não</span>}</td>
                  <td>
                    <div className="btn-row">
                      {p.enabled
                        ? <button className="btn small" onClick={() => act(api.disablePlan, p.plan_id, "Plano desabilitado")}>desabilitar</button>
                        : <button className="btn small" onClick={() => act(api.enablePlan, p.plan_id, "Plano habilitado")}>habilitar</button>}
                      <button className="btn small primary" onClick={() => runPlan(p.plan_id)}>rodar agora</button>
                      <button className="btn small" onClick={() => viewSpec(p.plan_id)}>{expanded?.plan_id === p.plan_id ? "ocultar" : "ver JSON"}</button>
                      <button className="btn small danger" onClick={() => confirm(`Remover plano ${p.plan_id}?`) && act(api.delPlan, p.plan_id, "Plano removido")}>remover</button>
                    </div>
                  </td>
                </tr>
                {expanded?.plan_id === p.plan_id && (
                  <tr><td colSpan="4"><pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(expanded.spec, null, 2)}</pre></td></tr>
                )}
              </React.Fragment>
            ))}
            {plans.length === 0 && <tr><td colSpan="4" className="muted">Nenhum plano ainda. Monte um abaixo.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="section-title">Construtor de plano</div>
      <div className="card">
        <div className="bd">
          <div className="form-grid">
            <label className="fld">plan_id
              <input value={planId} onChange={(e) => setPlanId(e.target.value)} placeholder="meu-plano" />
            </label>
            <label className="fld">habilitado (scheduler)
              <select value={enabled ? "1" : "0"} onChange={(e) => setEnabled(e.target.value === "1")}>
                <option value="1">sim</option><option value="0">não</option>
              </select>
            </label>
          </div>

          {/* grupos inline */}
          <div className="section-title" style={{ marginTop: 18 }}>Grupos deste plano (opcional)</div>
          {inlineGroups.map((g, i) => (
            <div key={i} className="card" style={{ marginBottom: 10 }}>
              <div className="bd">
                <label className="fld" style={{ maxWidth: 240 }}>nome do grupo
                  <input value={g.name} onChange={(e) => patchInlineGroup(i, { name: e.target.value })} placeholder="probes" />
                </label>
                <div style={{ marginTop: 8 }} className="muted">membros:</div>
                <div className="checks">
                  {probes.map((p) => (
                    <label key={p.probe_id} className={"chk" + (g.members.includes(p.probe_id) ? " on" : "")}>
                      <input type="checkbox" checked={g.members.includes(p.probe_id)} onChange={() => toggleInlineMember(i, p.probe_id)} />
                      {p.probe_id}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
          <button className="btn small" onClick={addInlineGroup}>+ grupo</button>

          {/* jobs */}
          <div className="section-title" style={{ marginTop: 18 }}>Jobs (o que medir)</div>
          {jobs.map((j, i) => (
            <div key={i} className="card" style={{ marginBottom: 12 }}>
              <div className="hd">
                <h3>Job #{i + 1}</h3>
                <button className="btn small danger" onClick={() => setJobs((js) => js.filter((_, k) => k !== i))}>remover job</button>
              </div>
              <div className="bd">
                <div className="form-grid">
                  <label className="fld">id
                    <input value={j.id} onChange={(e) => patchJob(i, { id: e.target.value })} />
                  </label>
                  <label className="fld">tipo
                    <select value={j.type} onChange={(e) => setType(i, e.target.value)}>
                      {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
                    </select>
                  </label>
                  <label className="fld">período (s)
                    <input type="number" min="1" value={j.period_seconds} onChange={(e) => patchJob(i, { period_seconds: e.target.value })} />
                  </label>
                  <label className="fld">excluir self (malha)
                    <select value={j.exclude_self ? "1" : "0"} onChange={(e) => patchJob(i, { exclude_self: e.target.value === "1" })}>
                      <option value="1">sim</option><option value="0">não</option>
                    </select>
                  </label>
                </div>

                <div style={{ marginTop: 10 }} className="muted">origens (probes/grupos):</div>
                <MultiChips options={sourceOptions} selected={j.sources} onToggle={(v) => toggleIn(i, "sources", v)} />

                <div style={{ marginTop: 10 }} className="muted">destinos (probes/grupos/externos):</div>
                <MultiChips options={targetOptions} selected={j.targets} onToggle={(v) => toggleIn(i, "targets", v)} />

                {/* parâmetros por tipo */}
                <div className="form-grid" style={{ marginTop: 12 }}>
                  {j.type === "icmp" && (<>
                    <label className="fld">samples<input type="number" value={j.params.samples ?? ""} onChange={(e) => patchParam(i, { samples: e.target.value })} /></label>
                    <label className="fld">timeout_ms<input type="number" value={j.params.timeout_ms ?? ""} onChange={(e) => patchParam(i, { timeout_ms: e.target.value })} placeholder="1000" /></label>
                  </>)}
                  {j.type === "iperf3" && (<>
                    <label className="fld">duração (s)<input type="number" value={j.params.duration_seconds ?? ""} onChange={(e) => patchParam(i, { duration_seconds: e.target.value })} /></label>
                    <label className="fld">reverse<select value={j.params.reverse ? "1" : "0"} onChange={(e) => patchParam(i, { reverse: e.target.value === "1" })}><option value="0">não</option><option value="1">sim</option></select></label>
                  </>)}
                  {j.type === "dns" && (<>
                    <label className="fld">qtype<input value={j.params.qtype ?? "A"} onChange={(e) => patchParam(i, { qtype: e.target.value })} /></label>
                    <label className="fld">tcp<select value={j.params.tcp ? "1" : "0"} onChange={(e) => patchParam(i, { tcp: e.target.value === "1" })}><option value="0">não</option><option value="1">sim</option></select></label>
                    <label className="fld">resolver (opcional)<input value={j.params.resolver ?? ""} onChange={(e) => patchParam(i, { resolver: e.target.value })} /></label>
                  </>)}
                  {j.type === "http" && (<>
                    <label className="fld">método<select value={j.params.method ?? "GET"} onChange={(e) => patchParam(i, { method: e.target.value })}><option>GET</option><option>HEAD</option></select></label>
                    <label className="fld">timeout_ms<input type="number" value={j.params.timeout_ms ?? ""} onChange={(e) => patchParam(i, { timeout_ms: e.target.value })} placeholder="5000" /></label>
                  </>)}
                  {j.type === "traceroute" && (<>
                    <label className="fld">cycles<input type="number" value={j.params.cycles ?? ""} onChange={(e) => patchParam(i, { cycles: e.target.value })} /></label>
                    <label className="fld">max_hops<input type="number" value={j.params.max_hops ?? ""} onChange={(e) => patchParam(i, { max_hops: e.target.value })} /></label>
                  </>)}
                </div>
              </div>
            </div>
          ))}
          <button className="btn small" onClick={() => setJobs((js) => [...js, blankJob()])}>+ job</button>

          <div className="btn-row" style={{ marginTop: 18 }}>
            <button className="btn" onClick={doValidate} disabled={busy}>Validar</button>
            <button className="btn primary" onClick={doCreate} disabled={busy}>Criar plano</button>
            {busy && <span className="spinner" />}
          </div>

          {result && (
            <div className="card" style={{ marginTop: 14 }}>
              <div className="bd">
                {result.kind === "validate" && (
                  result.data.valid
                    ? <><span className="badge ok">válido</span> <span className="muted"> — {result.data.expansion.total_tasks_per_cycle} tarefas/ciclo</span>
                        <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result.data.expansion, null, 2)}</pre></>
                    : <><span className="badge err">inválido</span>
                        <ul>{result.data.errors.map((e, k) => <li key={k} className="mono">{e}</li>)}</ul></>
                )}
                {result.kind === "created" && (
                  <><span className="badge ok">plano armazenado</span>
                    <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result.data.expansion, null, 2)}</pre></>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
