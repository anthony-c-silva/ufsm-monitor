import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Boxes, Info } from "lucide-react";
import { api } from "../api.js";
import { SkeletonTable } from "../components/Skeleton.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

export default function Groups({ notify, refreshKey }) {
  const [groups, setGroups] = useState([]);
  const [probes, setProbes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(null);       // {name, members[]}
  const [mode, setMode] = useState("create");
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    return Promise.all([api.groups(), api.probes()])
      .then(([g, p]) => { setGroups(g); setProbes(p); })
      .catch((e) => notify("Falha ao carregar grupos: " + e.message, "err"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refreshKey]);

  const openCreate = () => { setMode("create"); setForm({ name: "", members: [] }); };
  const openEdit = (g) => { setMode("edit"); setForm({ name: g.name, members: [...(g.members || [])] }); };
  const closeForm = () => { if (!saving) setForm(null); };
  const toggleMember = (id) =>
    setForm((f) => ({ ...f, members: f.members.includes(id) ? f.members.filter((x) => x !== id) : [...f.members, id] }));

  const save = async () => {
    if (!form.name.trim()) return notify("Informe o nome do grupo", "err");
    setSaving(true);
    try {
      await api.addGroup({ name: form.name, members: form.members }); // upsert por nome
      notify(mode === "edit" ? `Grupo '${form.name}' atualizado` : `Grupo '${form.name}' criado`, "ok");
      setForm(null);
      load();
    } catch (e) {
      notify((mode === "edit" ? "Erro ao editar: " : "Erro ao criar: ") + e.message, "err");
    } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.delGroup(toDelete.name);
      notify(`Grupo '${toDelete.name}' removido`, "ok");
      setToDelete(null);
      load();
    } catch (e) {
      notify("Erro ao remover: " + e.message, "err");
    } finally { setDeleting(false); }
  };

  if (loading && groups.length === 0) {
    return (<><div className="section-title"><Boxes size={14} /> Grupos</div><SkeletonTable rows={4} cols={3} /></>);
  }

  return (
    <>
      <div className="section-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Boxes size={14} /> Grupos de probes</span>
        <button className="btn small primary" onClick={openCreate} disabled={probes.length === 0}><Plus size={14} /> Adicionar grupo</button>
      </div>

      <div className="note" style={{ marginBottom: 12 }}>
        <Info size={16} />
        <span>Um grupo é um conjunto de probes com um nome (ex.: <b className="mono">campus</b>). Serve para você
          apontar um plano para vários probes de uma vez, sem listar cada um. Se você usar o mesmo grupo como origem
          e como destino de um job, a plataforma monta uma <b>malha</b> (todos medem todos); apontando muitos probes
          para um único destino, você monta uma topologia em <b>estrela</b>.</span>
      </div>

      {probes.length === 0 && (
        <div className="empty-state">Cadastre probes primeiro (aba <b>Probes</b>) para poder montar grupos.</div>
      )}

      <div className="card scroll-x">
        <table>
          <thead><tr><th>grupo</th><th>membros</th><th></th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.name}>
                <td className="mono">{g.name}</td>
                <td>{(g.members || []).length ? (g.members || []).join(", ") : <span className="muted">— vazio —</span>}</td>
                <td>
                  <div className="btn-row">
                    <button className="btn small" onClick={() => openEdit(g)}><Pencil size={13} /> Editar</button>
                    <button className="btn small danger" onClick={() => setToDelete(g)}><Trash2 size={13} /> Remover</button>
                  </div>
                </td>
              </tr>
            ))}
            {groups.length === 0 && probes.length > 0 && <tr><td colSpan="3" className="muted">Nenhum grupo. Clique em <b>Adicionar grupo</b>.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!form}
        onClose={closeForm}
        title={mode === "edit" ? "Editar grupo" : "Novo grupo"}
        icon={Boxes}
        busy={saving}
        footer={
          <>
            <button className="btn" onClick={closeForm} disabled={saving}>Cancelar</button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <Plus size={14} />} {mode === "edit" ? "Salvar" : "Criar grupo"}
            </button>
          </>
        }
      >
        {form && (
          <>
            <label className="fld" style={{ maxWidth: 280 }}>nome do grupo
              <input value={form.name} disabled={mode === "edit"} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="campus" />
              <span className="hint">{mode === "edit" ? "o nome do grupo não muda; edite os membros abaixo" : "usado nos planos como grupo:<nome>"}</span>
            </label>

            <div style={{ marginTop: 14 }} className="muted" >Membros ({form.members.length} de {probes.length}):</div>
            <div className="checks" style={{ marginTop: 6 }}>
              {probes.map((p) => (
                <label key={p.probe_id} className={"chk" + (form.members.includes(p.probe_id) ? " on" : "")}>
                  <input type="checkbox" checked={form.members.includes(p.probe_id)} onChange={() => toggleMember(p.probe_id)} />
                  {p.probe_id}
                </label>
              ))}
            </div>
          </>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        busy={deleting}
        onConfirm={confirmDelete}
        confirmLabel="Remover grupo"
        message={toDelete && <>Remover o grupo <b className="mono">{toDelete.name}</b>? Planos que usam <span className="mono">grupo:{toDelete.name}</span> podem ficar inválidos.</>}
      />
    </>
  );
}
