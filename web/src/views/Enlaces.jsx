import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Waypoints, ArrowUp, ArrowDown, X, Gauge, Route, Activity } from "lucide-react";
import { api } from "../api.js";
import { fmtAgo, fmtTime } from "../format.js";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import { SkeletonTable } from "../components/Skeleton.jsx";

const MODE_LABEL = {
  sonda: "Por sonda",
  trecho: "Por trecho compartilhado",
  global: "Um teste por vez",
};

const emptyLink = { name: "", description: "", capacity_mbps: "" };

export default function Enlaces({ notify, refreshKey }) {
  const [coord, setCoord] = useState(null);
  const [links, setLinks] = useState([]);
  const [uplinks, setUplinks] = useState({});
  const [probes, setProbes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);

  const [linkForm, setLinkForm] = useState(null);
  const [linkMode, setLinkMode] = useState("create");
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [chainOf, setChainOf] = useState(null); // { probe_id, links: [] }
  const [addSel, setAddSel] = useState("");

  const loadStatic = () =>
    Promise.all([api.links(), api.uplinks(), api.probes()])
      .then(([l, u, p]) => { setLinks(l); setUplinks(u); setProbes(p); });

  const loadCoord = (silent) =>
    api.coordination()
      .then(setCoord)
      .catch((e) => { if (!silent) notify("Falha ao carregar a coordenação: " + e.message, "err"); });

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStatic(), loadCoord(false)])
      .catch((e) => notify("Falha ao carregar enlaces: " + e.message, "err"))
      .finally(() => setLoading(false));
    const t = setInterval(() => loadCoord(true), 5000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [refreshKey]);

  const changeMode = async (mode) => {
    setSavingMode(true);
    try {
      await api.setCoordinationMode(mode);
      notify(`Coordenação: ${MODE_LABEL[mode]}`, "ok");
      loadCoord(true);
    } catch (e) {
      notify("Erro ao mudar o modo: " + e.message, "err");
    } finally { setSavingMode(false); }
  };

  // ----- enlaces
  const openCreate = () => { setLinkMode("create"); setLinkForm({ ...emptyLink }); };
  const openEdit = (l) => { setLinkMode("edit"); setLinkForm({ name: l.name, description: l.description || "", capacity_mbps: l.capacity_mbps ?? "" }); };
  const saveLink = async () => {
    if (!linkForm.name.trim()) return notify("Informe o nome do enlace", "err");
    setSaving(true);
    try {
      const cap = String(linkForm.capacity_mbps).trim();
      await api.saveLink({ name: linkForm.name.trim(), description: linkForm.description, capacity_mbps: cap ? Number(cap) : null });
      notify(`Enlace '${linkForm.name}' salvo`, "ok");
      setLinkForm(null);
      loadStatic();
    } catch (e) {
      notify("Erro ao salvar o enlace: " + e.message, "err");
    } finally { setSaving(false); }
  };
  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.delLink(toDelete.name);
      notify(`Enlace '${toDelete.name}' removido`, "ok");
      setToDelete(null);
      loadStatic();
    } catch (e) {
      notify("Erro ao remover: " + e.message, "err");
    } finally { setDeleting(false); }
  };

  // ----- cadeia por sonda
  const openChain = (pid) => { setChainOf({ probe_id: pid, links: [...(uplinks[pid] || [])] }); setAddSel(""); };
  const move = (i, d) => setChainOf((c) => {
    const l = [...c.links];
    const j = i + d;
    if (j < 0 || j >= l.length) return c;
    [l[i], l[j]] = [l[j], l[i]];
    return { ...c, links: l };
  });
  const removeAt = (i) => setChainOf((c) => ({ ...c, links: c.links.filter((_, k) => k !== i) }));
  const addLink = () => {
    if (!addSel) return;
    setChainOf((c) => (c.links.includes(addSel) ? c : { ...c, links: [...c.links, addSel] }));
    setAddSel("");
  };
  const saveChain = async () => {
    setSaving(true);
    try {
      await api.setUplinks(chainOf.probe_id, chainOf.links);
      notify(`Caminho de '${chainOf.probe_id}' salvo`, "ok");
      setChainOf(null);
      loadStatic();
    } catch (e) {
      notify("Erro ao salvar o caminho: " + e.message, "err");
    } finally { setSaving(false); }
  };

  if (loading && !coord) {
    return (<><div className="section-title"><Waypoints size={14} /> Enlaces</div><SkeletonTable rows={5} cols={4} /></>);
  }

  const mode = coord?.mode || "trecho";

  return (
    <>
      {/* modo de coordenação */}
      <div className="section-title"><Gauge size={14} /> Coordenação dos testes de vazão</div>
      <div className="card">
        <div className="bd">
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <select value={mode} disabled={savingMode} onChange={(e) => changeMode(e.target.value)} style={{ width: "auto" }}>
              {Object.keys(MODE_LABEL).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
            <span className="muted" style={{ fontSize: 12.5 }}>{coord?.modes?.[mode]}</span>
          </div>
          <div className="hint" style={{ marginTop: 10, fontSize: 12 }}>
            No modo por trecho, dois testes cujos caminhos passam por um mesmo enlace cadastrado abaixo aguardam um ao outro.
            Sondas sem caminho cadastrado seguem apenas a regra por sonda.
          </div>
        </div>
      </div>

      {/* estado ao vivo */}
      <div className="section-title"><Activity size={14} /> Estado agora</div>
      <div className="card scroll-x">
        <div className="bd">
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13 }}>
            <div><b>Em execução:</b> {coord?.running?.length || 0}</div>
            <div><b>Na fila:</b> {coord?.queue?.length || 0}</div>
            <div><b>Recursos ocupados:</b> {coord?.busy?.length ? coord.busy.map((b) => b.resource).join(", ") : "nenhum"}</div>
          </div>
          {coord?.queue?.length > 0 && (
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Aguardando</th><th>Teste</th><th>Esperando por</th></tr></thead>
              <tbody>
                {coord.queue.map((q, i) => (
                  <tr key={i}>
                    <td>{q.waiting_s}s</td>
                    <td className="mono">{q.source_probe} → {q.target_probe || q.target}</td>
                    <td className="mono">{(q.blocked_by || []).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="section-title">Últimos testes de vazão despachados</div>
      <div className="card scroll-x">
        {!coord?.recent?.length ? (
          <div className="empty-state">Nenhum teste de vazão despachado desde que o controlador iniciou.</div>
        ) : (
          <table>
            <thead><tr><th>Quando</th><th>Teste</th><th>Modo</th><th>Esperou</th><th>Motivo da espera</th><th>Enlaces do caminho</th></tr></thead>
            <tbody>
              {coord.recent.slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td title={fmtTime(r.dispatched_at)}>{fmtAgo(r.dispatched_at)}</td>
                  <td className="mono">{r.source_probe} → {r.target_probe || r.target}</td>
                  <td>{MODE_LABEL[r.mode] || r.mode}</td>
                  <td>{r.waited_s}s</td>
                  <td className="mono">{(r.blocked_by || []).join(", ") || "—"}</td>
                  <td className="mono">{r.resources.filter((x) => x.startsWith("enlace:")).map((x) => x.slice(7)).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* enlaces */}
      <div className="section-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Waypoints size={14} /> Enlaces</span>
        <button className="btn small primary" onClick={openCreate}><Plus size={14} /> Adicionar enlace</button>
      </div>
      <div className="card scroll-x">
        <table>
          <thead><tr><th>Nome</th><th>Descrição</th><th>Capacidade</th><th>Usado por</th><th></th></tr></thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.name}>
                <td className="mono">{l.name}</td>
                <td>{l.description || "—"}</td>
                <td>{l.capacity_mbps ? `${l.capacity_mbps} Mb/s` : "—"}</td>
                <td className="mono">{l.used_by.length ? l.used_by.join(", ") : "—"}</td>
                <td>
                  <div className="btn-row">
                    <button className="btn small" onClick={() => openEdit(l)}><Pencil size={13} /> Editar</button>
                    <button className="btn small danger" onClick={() => setToDelete(l)}><Trash2 size={13} /> Remover</button>
                  </div>
                </td>
              </tr>
            ))}
            {links.length === 0 && <tr><td colSpan="5" className="muted">Nenhum enlace cadastrado. Cadastre os trechos que as sondas compartilham, como o uplink de um switch.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* caminho de cada sonda */}
      <div className="section-title"><Route size={14} /> Caminho de cada sonda até o núcleo</div>
      <div className="card scroll-x">
        <table>
          <thead><tr><th>Sonda</th><th>Enlaces (da sonda em direção ao núcleo)</th><th></th></tr></thead>
          <tbody>
            {probes.map((p) => (
              <tr key={p.probe_id}>
                <td className="mono">{p.probe_id}</td>
                <td className="mono">{(uplinks[p.probe_id] || []).length ? uplinks[p.probe_id].join(" → ") : <span className="muted">não cadastrado</span>}</td>
                <td><button className="btn small" onClick={() => openChain(p.probe_id)}><Pencil size={13} /> Editar</button></td>
              </tr>
            ))}
            {probes.length === 0 && <tr><td colSpan="3" className="muted">Nenhuma sonda cadastrada.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* modal enlace */}
      <Modal
        open={!!linkForm}
        onClose={() => !saving && setLinkForm(null)}
        title={linkMode === "edit" ? "Editar enlace" : "Novo enlace"}
        icon={Waypoints}
        busy={saving}
        footer={
          <>
            <button className="btn" onClick={() => setLinkForm(null)} disabled={saving}>Cancelar</button>
            <button className="btn primary" onClick={saveLink} disabled={saving}>{saving ? <span className="spinner" /> : <Plus size={14} />} Salvar</button>
          </>
        }
      >
        {linkForm && (
          <div className="form-grid">
            <label className="fld">nome
              <input value={linkForm.name} disabled={linkMode === "edit"} onChange={(e) => setLinkForm({ ...linkForm, name: e.target.value })} placeholder="uplink-anexo-c" />
              <span className="hint">identificador curto do trecho</span>
            </label>
            <label className="fld">capacidade (Mb/s)
              <input type="number" min="1" value={linkForm.capacity_mbps} onChange={(e) => setLinkForm({ ...linkForm, capacity_mbps: e.target.value })} placeholder="1000" />
              <span className="hint">opcional, apenas informativo</span>
            </label>
            <label className="fld" style={{ gridColumn: "1 / -1" }}>descrição
              <input value={linkForm.description} onChange={(e) => setLinkForm({ ...linkForm, description: e.target.value })} placeholder="switch do anexo C até o núcleo do CT" />
            </label>
          </div>
        )}
      </Modal>

      {/* modal caminho */}
      <Modal
        open={!!chainOf}
        onClose={() => !saving && setChainOf(null)}
        title={chainOf ? <>Caminho de <span className="mono">{chainOf.probe_id}</span></> : ""}
        icon={Route}
        busy={saving}
        footer={
          <>
            <button className="btn" onClick={() => setChainOf(null)} disabled={saving}>Cancelar</button>
            <button className="btn primary" onClick={saveChain} disabled={saving}>{saving ? <span className="spinner" /> : null} Salvar caminho</button>
          </>
        }
      >
        {chainOf && (
          <>
            <div className="hint" style={{ marginBottom: 10 }}>
              Liste os enlaces na ordem em que o tráfego da sonda sobe até o núcleo da rede. Enlaces que duas sondas têm em
              comum acima do ponto de encontro dos caminhos não são contados no teste entre elas.
            </div>
            {chainOf.links.length === 0 && <div className="muted" style={{ marginBottom: 10 }}>Nenhum enlace no caminho.</div>}
            {chainOf.links.map((l, i) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="badge blue">{i + 1}</span>
                <span className="mono" style={{ flex: 1 }}>{l}</span>
                <button className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="subir"><ArrowUp size={13} /></button>
                <button className="btn small" onClick={() => move(i, 1)} disabled={i === chainOf.links.length - 1} aria-label="descer"><ArrowDown size={13} /></button>
                <button className="btn small danger" onClick={() => removeAt(i)} aria-label="remover"><X size={13} /></button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <select value={addSel} onChange={(e) => setAddSel(e.target.value)}>
                <option value="">adicionar enlace…</option>
                {links.filter((l) => !chainOf.links.includes(l.name)).map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
              </select>
              <button className="btn small primary" onClick={addLink} disabled={!addSel}><Plus size={13} /> Adicionar</button>
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        busy={deleting}
        onConfirm={confirmDelete}
        confirmLabel="Remover enlace"
        message={toDelete && <>Remover o enlace <b className="mono">{toDelete.name}</b>? Ele também sai do caminho das sondas que o usam.</>}
      />
    </>
  );
}
