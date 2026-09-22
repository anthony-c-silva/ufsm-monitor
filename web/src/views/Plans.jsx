import React, { useEffect, useMemo, useState } from "react";
import {
  Plus, Upload, Pencil, Trash2, Play, Code, Info, AlertTriangle, SlidersHorizontal,
} from "lucide-react";
import { api } from "../api.js";
import { TYPE_LABEL } from "../format.js";
import MultiSelect from "../components/MultiSelect.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { SkeletonTable } from "../components/Skeleton.jsx";

const TYPES = ["icmp", "iperf3", "dns", "http", "traceroute"];
const num = (v) => (v === "" || v === null || v === undefined ? undefined : Number(v));

let jobSeq = 0;
const blankJob = () => ({
  id: "job-" + ++jobSeq, type: "icmp", sources: [], targets: [],
  exclude_self: true, period_seconds: 60, params: { samples: 10 },
});

// spec (plano salvo) -> job do construtor (params por tipo)
function jobToBuilder(j) {
  const p = {};
  if (j.type === "icmp") { p.samples = j.samples; p.timeout_ms = j.timeout_ms; }
  else if (j.type === "iperf3") { p.duration_seconds = j.duration_seconds; p.reverse = j.reverse; }
  else if (j.type === "dns") { p.qtype = j.qtype ?? "A"; p.tcp = j.tcp; p.resolver = j.resolver; }
  else if (j.type === "http") { p.method = j.method ?? "GET"; p.timeout_ms = j.timeout_ms; }
  else if (j.type === "traceroute") { p.cycles = j.cycles; p.max_hops = j.max_hops; }
  return {
    id: j.id || "job-" + ++jobSeq, type: j.type, sources: j.sources || [], targets: j.targets || [],
    exclude_self: j.exclude_self ?? true, period_seconds: j.period_seconds ?? 60, params: p,
  };
}

export default function Plans({ notify, refreshKey }) {
  const [plans, setPlans] = useState([]);
  const [probes, setProbes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [targets, setTargets] = useState([]);
  const [expanded, setExpanded] = useState(null); // {plan_id, spec}
  const [loading, setLoading] = useState(true);

  const loadAll = () => {
    setLoading(true);
    return Promise.all([api.plans(), api.probes(), api.groups(), api.targets()])
      .then(([pl, pr, gr, tg]) => { setPlans(pl); setProbes(pr); setGroups(gr); setTargets(tg); })
      .catch((e) => notify("Falha ao carregar: " + e.message, "err"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [refreshKey]);

  // ---------------- construtor (modal) ----------------
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderMode, setBuilderMode] = useState("create"); // "create" | "edit"
  const [planId, setPlanId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [inlineGroups, setInlineGroups] = useState([]);
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
    ...targets.map((t) => ({ value: t.address, label: t.name + " (" + t.address + (t.kind === "probe" ? ", probe" : "") + ")" })),
  ], [groupNames, probes, targets]);

  const patchJob = (i, patch) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...patch } : j)));
  const patchParam = (i, patch) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, params: { ...j.params, ...patch } } : j)));
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

  const openCreate = () => {
    setBuilderMode("create"); setPlanId(""); setEnabled(true);
    setInlineGroups([]); setJobs([blankJob()]); setResult(null); setBuilderOpen(true);
  };
  const openEdit = async (id) => {
    try {
      const p = await api.getPlan(id);
      const spec = p.spec || {};
      setBuilderMode("edit");
      setPlanId(spec.plan_id || id);
      setEnabled(false);
      setInlineGroups(Object.entries(spec.groups || {}).map(([name, members]) => ({ name, members: members || [] })));
      setJobs((spec.jobs || []).map(jobToBuilder));
      setResult(null);
      setBuilderOpen(true);
    } catch (e) { notify("Erro ao abrir o plano: " + e.message, "err"); }
  };
  const closeBuilder = () => { if (!busy) setBuilderOpen(false); };

  const doValidate = async () => {
    if (!planId) return notify("Informe o plan_id", "err");
    setBusy(true); setResult(null);
    try { setResult({ kind: "validate", data: await api.validatePlan(buildPlan()) }); }
    catch (e) { notify("Erro na validação: " + e.message, "err"); }
    finally { setBusy(false); }
  };
  const doSave = async () => {
    if (!planId) return notify("Informe o plan_id", "err");
    setBusy(true);
    try {
      if (builderMode === "edit") {
        const r = await api.updatePlan(planId, buildPlan());
        notify(`Plano '${planId}' atualizado e desabilitado — reative quando quiser`, "ok");
        setResult({ kind: "saved", data: r });
      } else {
        const r = await api.createPlan(buildPlan());
        notify(`Plano '${planId}' criado`, "ok");
        setResult({ kind: "saved", data: r });
      }
      setBuilderOpen(false);
      loadAll();
    } catch (e) { notify((builderMode === "edit" ? "Erro ao salvar: " : "Erro ao criar: ") + e.message, "err"); }
    finally { setBusy(false); }
  };

  // ---------------- importar (modal) ----------------
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [importBusy, setImportBusy] = useState(false);

  const openImport = () => { setImportText(""); setImportResult(null); setImportOpen(true); };
  const parseImport = () => {
    try { return JSON.parse(importText); }
    catch (e) { notify("JSON inválido: " + e.message, "err"); return null; }
  };
  const importValidate = async () => {
    const p = parseImport(); if (!p) return;
    setImportBusy(true);
    try { setImportResult({ kind: "validate", data: await api.validatePlan(p) }); }
    catch (e) { notify("Erro: " + e.message, "err"); }
    finally { setImportBusy(false); }
  };
  const importCreate = async () => {
    const p = parseImport(); if (!p) return;
    setImportBusy(true);
    try {
      await api.createPlan(p);
      notify(`Plano '${p.plan_id || "?"}' criado`, "ok");
      setImportOpen(false);
      loadAll();
    } catch (e) { notify("Erro ao criar: " + e.message, "err"); }
    finally { setImportBusy(false); }
  };

  // ---------------- ações da lista ----------------
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const togglePlan = async (p) => {
    const target = !p.enabled;
    setPlans((ps) => ps.map((x) => (x.plan_id === p.plan_id ? { ...x, enabled: target } : x)));
    try {
      await (target ? api.enablePlan : api.disablePlan)(p.plan_id);
      notify(target ? `Plano '${p.plan_id}' habilitado` : `Plano '${p.plan_id}' desabilitado`, "ok");
    } catch (e) {
      setPlans((ps) => ps.map((x) => (x.plan_id === p.plan_id ? { ...x, enabled: p.enabled } : x)));
      notify("Erro ao alterar o plano: " + e.message, "err");
    }
  };
  const runPlan = async (id) => {
    try { const r = await api.runPlan(id); notify(`Rodou '${id}': ${r.published} tarefa(s) publicada(s)`, "ok"); }
    catch (e) { notify("Erro ao rodar: " + e.message, "err"); }
  };
  const viewSpec = async (id) => {
    if (expanded?.plan_id === id) return setExpanded(null);
    try { const p = await api.getPlan(id); setExpanded(p); } catch (e) { notify("Erro: " + e.message, "err"); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.delPlan(toDelete.plan_id);
      notify(`Plano '${toDelete.plan_id}' removido`, "ok");
      setToDelete(null);
      loadAll();
    } catch (e) { notify("Erro ao remover: " + e.message, "err"); }
    finally { setDeleting(false); }
  };

  if (loading && plans.length === 0 && probes.length === 0) {
    return (<><div className="section-title"><SlidersHorizontal size={14} /> Planos</div><SkeletonTable rows={4} cols={4} /></>);
  }

  return (
    <>
      <div className="section-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><SlidersHorizontal size={14} /> Planos cadastrados</span>
        <div className="btn-row">
          <button className="btn small" onClick={openImport}><Upload size={14} /> Importar JSON</button>
          <button className="btn small primary" onClick={openCreate}><Plus size={14} /> Criar plano</button>
        </div>
      </div>

      <div className="card scroll-x">
        <table>
          <thead><tr><th>plano</th><th>rev.</th><th>habilitado</th><th>ações</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <React.Fragment key={p.plan_id}>
                <tr>
                  <td className="mono">{p.plan_id}</td>
                  <td>{p.revision}</td>
                  <td>
                    <label className="switch" title={p.enabled ? "habilitado" : "desabilitado"}>
                      <input type="checkbox" checked={p.enabled} onChange={() => togglePlan(p)} />
                      <span className="track"><span className="thumb" /></span>
                    </label>
                  </td>
                  <td>
                    <div className="btn-row">
                      <button className="btn small primary" onClick={() => runPlan(p.plan_id)}><Play size={13} /> Rodar</button>
                      <button className="btn small" onClick={() => openEdit(p.plan_id)}><Pencil size={13} /> Editar</button>
                      <button className="btn small" onClick={() => viewSpec(p.plan_id)}><Code size={13} /> {expanded?.plan_id === p.plan_id ? "Ocultar" : "Ver JSON"}</button>
                      <button className="btn small danger" onClick={() => setToDelete(p)}><Trash2 size={13} /> Remover</button>
                    </div>
                  </td>
                </tr>
                {expanded?.plan_id === p.plan_id && (
                  <tr><td colSpan="4"><pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(expanded.spec, null, 2)}</pre></td></tr>
                )}
              </React.Fragment>
            ))}
            {plans.length === 0 && <tr><td colSpan="4" className="muted">Nenhum plano ainda. Clique em <b>Criar plano</b> ou <b>Importar JSON</b>.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ---------- modal: importar JSON ---------- */}
      <Modal
        open={importOpen}
        onClose={() => !importBusy && setImportOpen(false)}
        title="Importar plano (JSON)"
        icon={Upload}
        size="md"
        busy={importBusy}
        footer={
          <>
            <button className="btn" onClick={() => setImportOpen(false)} disabled={importBusy}>Cancelar</button>
            <button className="btn" onClick={importValidate} disabled={importBusy}>Validar</button>
            <button className="btn primary" onClick={importCreate} disabled={importBusy}>
              {importBusy ? <span className="spinner" /> : <Plus size={14} />} Criar do JSON
            </button>
          </>
        }
      >
        <div className="note" style={{ marginBottom: 12 }}>
          <Info size={16} />
          <span>Cole o JSON de um plano (ex.: <span className="mono">controller/examples/plan-malha-ufsm.json</span>). Use
            <b> Validar</b> para conferir antes de criar.</span>
        </div>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='{ "plan_id": "...", "jobs": [ ... ] }'
          style={{ width: "100%", minHeight: 200, fontFamily: "monospace", fontSize: 12.5 }}
        />
        {importResult?.kind === "validate" && (
          <div style={{ marginTop: 12 }}>
            {importResult.data.valid
              ? <><span className="badge ok">válido</span> <span className="muted"> — {importResult.data.expansion.total_tasks_per_cycle} tarefas/ciclo</span></>
              : <><span className="badge err">inválido</span><ul>{importResult.data.errors.map((e, k) => <li key={k} className="mono">{e}</li>)}</ul></>}
          </div>
        )}
      </Modal>

      {/* ---------- modal: construtor (criar/editar) ---------- */}
      <Modal
        open={builderOpen}
        onClose={closeBuilder}
        title={builderMode === "edit" ? `Editar plano: ${planId}` : "Criar plano"}
        icon={SlidersHorizontal}
        size="lg"
        busy={busy}
        footer={
          <>
            <button className="btn" onClick={closeBuilder} disabled={busy}>Cancelar</button>
            <button className="btn" onClick={doValidate} disabled={busy}>Validar</button>
            <button className="btn primary" onClick={doSave} disabled={busy}>
              {busy ? <span className="spinner" /> : <Plus size={14} />} {builderMode === "edit" ? "Salvar (desabilita)" : "Criar plano"}
            </button>
          </>
        }
      >
        <div className="note" style={{ marginBottom: 14 }}>
          <Info size={16} />
          <span>Um plano diz <b>o que medir</b>: um ou mais <i>jobs</i>, cada um com um tipo de medição, de quais
            probes (origens) para quais alvos (destinos) e de quanto em quanto tempo. Para medir de/para vários probes
            de uma vez, use <b>grupos</b>.</span>
        </div>

        <div className="form-grid">
          <label className="fld">plan_id
            <input value={planId} disabled={builderMode === "edit"} onChange={(e) => setPlanId(e.target.value)} placeholder="meu-plano" />
            <span className="hint">{builderMode === "edit" ? "identificador fixo do plano" : "nome único do plano"}</span>
          </label>
          {builderMode === "create" && (
            <label className="fld">habilitar agora?
              <select value={enabled ? "1" : "0"} onChange={(e) => setEnabled(e.target.value === "1")}>
                <option value="1">sim</option><option value="0">não</option>
              </select>
              <span className="hint">se sim, o scheduler começa a rodar assim que criado</span>
            </label>
          )}
        </div>

        {builderMode === "edit" && (
          <div className="note warn" style={{ marginTop: 12 }}>
            <AlertTriangle size={16} />
            <span>Ao salvar, este plano será <b>desabilitado</b> e a revisão será incrementada. Reative-o na lista quando quiser voltar a rodar.</span>
          </div>
        )}

        {/* grupos inline */}
        <div className="section-title" style={{ marginTop: 18 }}>Grupos deste plano (opcional)</div>
        <div className="hint" style={{ marginBottom: 8 }}>Crie grupos só para este plano, ou use os grupos já cadastrados na aba Grupos.</div>
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
        <button className="btn small" onClick={addInlineGroup}><Plus size={13} /> grupo</button>

        {/* jobs */}
        <div className="section-title" style={{ marginTop: 18 }}>Jobs (o que medir)</div>
        {jobs.map((j, i) => (
          <div key={i} className="card" style={{ marginBottom: 12 }}>
            <div className="hd">
              <h3>Job #{i + 1}</h3>
              <button className="btn small danger" onClick={() => setJobs((js) => js.filter((_, k) => k !== i))}><Trash2 size={13} /> remover job</button>
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
                  <span className="hint">de quanto em quanto tempo repetir (ex.: 60 = a cada minuto)</span>
                </label>
                <label className="fld">não medir a si mesmo
                  <select value={j.exclude_self ? "1" : "0"} onChange={(e) => patchJob(i, { exclude_self: e.target.value === "1" })}>
                    <option value="1">sim</option><option value="0">não</option>
                  </select>
                  <span className="hint">em malha (grupo→mesmo grupo), evita um probe medir contra ele próprio</span>
                </label>
              </div>

              <div style={{ marginTop: 10 }} className="muted">origens (quais probes fazem a medição):</div>
              <MultiSelect options={sourceOptions} selected={j.sources} onChange={(vals) => patchJob(i, { sources: vals })} placeholder="selecionar origens..." />

              <div style={{ marginTop: 10 }} className="muted">destinos (o que será medido):</div>
              <MultiSelect options={targetOptions} selected={j.targets} onChange={(vals) => patchJob(i, { targets: vals })} placeholder="selecionar destinos..." />

              {/* parâmetros por tipo */}
              <div className="form-grid" style={{ marginTop: 12 }}>
                {j.type === "icmp" && (<>
                  <label className="fld">amostras
                    <input type="number" value={j.params.samples ?? ""} onChange={(e) => patchParam(i, { samples: e.target.value })} placeholder="10" />
                    <span className="hint">nº de pacotes (pings) por medição</span>
                  </label>
                  <label className="fld">tempo limite (ms)
                    <input type="number" value={j.params.timeout_ms ?? ""} onChange={(e) => patchParam(i, { timeout_ms: e.target.value })} placeholder="1000" />
                    <span className="hint">espera máxima por resposta (1000 = 1s)</span>
                  </label>
                </>)}
                {j.type === "iperf3" && (<>
                  <label className="fld">duração (s)
                    <input type="number" value={j.params.duration_seconds ?? ""} onChange={(e) => patchParam(i, { duration_seconds: e.target.value })} placeholder="5" />
                    <span className="hint">quanto tempo o teste de vazão roda</span>
                  </label>
                  <label className="fld">sentido reverso
                    <select value={j.params.reverse ? "1" : "0"} onChange={(e) => patchParam(i, { reverse: e.target.value === "1" })}><option value="0">não</option><option value="1">sim</option></select>
                    <span className="hint">medir no sentido destino → origem</span>
                  </label>
                </>)}
                {j.type === "dns" && (<>
                  <label className="fld">tipo de registro
                    <input value={j.params.qtype ?? "A"} onChange={(e) => patchParam(i, { qtype: e.target.value })} placeholder="A" />
                    <span className="hint">ex.: A, AAAA, MX, TXT</span>
                  </label>
                  <label className="fld">usar TCP
                    <select value={j.params.tcp ? "1" : "0"} onChange={(e) => patchParam(i, { tcp: e.target.value === "1" })}><option value="0">não</option><option value="1">sim</option></select>
                    <span className="hint">por padrão a consulta DNS usa UDP</span>
                  </label>
                  <label className="fld">resolver (opcional)
                    <input value={j.params.resolver ?? ""} onChange={(e) => patchParam(i, { resolver: e.target.value })} placeholder="1.1.1.1" />
                    <span className="hint">servidor DNS específico a consultar</span>
                  </label>
                </>)}
                {j.type === "http" && (<>
                  <label className="fld">método
                    <select value={j.params.method ?? "GET"} onChange={(e) => patchParam(i, { method: e.target.value })}><option>GET</option><option>HEAD</option></select>
                  </label>
                  <label className="fld">tempo limite (ms)
                    <input type="number" value={j.params.timeout_ms ?? ""} onChange={(e) => patchParam(i, { timeout_ms: e.target.value })} placeholder="5000" />
                    <span className="hint">espera máxima pela resposta (5000 = 5s)</span>
                  </label>
                </>)}
                {j.type === "traceroute" && (<>
                  <label className="fld">rodadas (cycles)
                    <input type="number" value={j.params.cycles ?? ""} onChange={(e) => patchParam(i, { cycles: e.target.value })} placeholder="3" />
                    <span className="hint">quantas vezes traçar o caminho</span>
                  </label>
                  <label className="fld">máx. de saltos
                    <input type="number" value={j.params.max_hops ?? ""} onChange={(e) => patchParam(i, { max_hops: e.target.value })} placeholder="30" />
                    <span className="hint">limite de saltos (hops) até o destino</span>
                  </label>
                </>)}
              </div>
            </div>
          </div>
        ))}
        <button className="btn small" onClick={() => setJobs((js) => [...js, blankJob()])}><Plus size={13} /> job</button>

        {result?.kind === "validate" && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="bd">
              {result.data.valid
                ? <><span className="badge ok">válido</span> <span className="muted"> — {result.data.expansion.total_tasks_per_cycle} tarefas/ciclo</span>
                    <pre className="mono" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(result.data.expansion, null, 2)}</pre></>
                : <><span className="badge err">inválido</span><ul>{result.data.errors.map((e, k) => <li key={k} className="mono">{e}</li>)}</ul></>}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        busy={deleting}
        onConfirm={confirmDelete}
        confirmLabel="Remover plano"
        message={toDelete && <>Remover o plano <b className="mono">{toDelete.plan_id}</b>? Essa ação não pode ser desfeita.</>}
      />
    </>
  );
}
