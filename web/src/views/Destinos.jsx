import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Globe, Info } from "lucide-react";
import { api } from "../api.js";
import { SkeletonTable } from "../components/Skeleton.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";

const emptyTarget = { name: "", kind: "external", address: "" };

export default function Destinos({ notify, refreshKey }) {
  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState(null);       // {id?, name, kind, address}
  const [mode, setMode] = useState("create");
  const [saving, setSaving] = useState(false);

  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setLoading(true);
    return api.targets()
      .then(setTargets)
      .catch((e) => notify("Falha ao carregar destinos: " + e.message, "err"))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refreshKey]);

  const openCreate = () => { setMode("create"); setForm({ ...emptyTarget }); };
  const openEdit = (t) => { setMode("edit"); setForm({ id: t.id, name: t.name, kind: t.kind, address: t.address }); };
  const closeForm = () => { if (!saving) setForm(null); };
  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim() || !form.address.trim()) return notify("Nome e endereço são obrigatórios", "err");
    setSaving(true);
    try {
      if (mode === "edit") {
        await api.updateTarget(form.id, { name: form.name, kind: form.kind, address: form.address });
        notify(`Destino '${form.name}' atualizado`, "ok");
      } else {
        await api.addTarget({ name: form.name, kind: form.kind, address: form.address });
        notify(`Destino '${form.name}' criado`, "ok");
      }
      setForm(null);
      load();
    } catch (e) {
      notify((mode === "edit" ? "Erro ao editar: " : "Erro ao criar: ") + e.message, "err");
    } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.delTarget(toDelete.id);
      notify(`Destino '${toDelete.name}' removido`, "ok");
      setToDelete(null);
      load();
    } catch (e) {
      notify("Erro ao remover: " + e.message, "err");
    } finally { setDeleting(false); }
  };

  if (loading && targets.length === 0) {
    return (<><div className="section-title"><Globe size={14} /> Destinos</div><SkeletonTable rows={5} cols={4} /></>);
  }

  return (
    <>
      <div className="section-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Globe size={14} /> Destinos</span>
        <button className="btn small primary" onClick={openCreate}><Plus size={14} /> Adicionar destino</button>
      </div>

      <div className="note" style={{ marginBottom: 12 }}>
        <Info size={16} />
        <span>Destinos são os alvos autorizados das medições (a <i>allowlist</i>). Um plano só pode medir endereços
          externos que estejam cadastrados aqui. Probes da malha não precisam entrar aqui, eles já são destinos entre si.</span>
      </div>

      <div className="card scroll-x">
        <table>
          <thead><tr><th>nome</th><th>tipo</th><th>endereço</th><th></th></tr></thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td><span className="badge blue">{t.kind === "probe" ? "probe" : "externo"}</span></td>
                <td className="mono">{t.address}</td>
                <td>
                  <div className="btn-row">
                    <button className="btn small" onClick={() => openEdit(t)}><Pencil size={13} /> Editar</button>
                    <button className="btn small danger" onClick={() => setToDelete(t)}><Trash2 size={13} /> Remover</button>
                  </div>
                </td>
              </tr>
            ))}
            {targets.length === 0 && <tr><td colSpan="4" className="muted">Nenhum destino autorizado. Clique em <b>Adicionar destino</b>.</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!form}
        onClose={closeForm}
        title={mode === "edit" ? "Editar destino" : "Novo destino"}
        icon={Globe}
        busy={saving}
        footer={
          <>
            <button className="btn" onClick={closeForm} disabled={saving}>Cancelar</button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <Plus size={14} />} {mode === "edit" ? "Salvar" : "Criar destino"}
            </button>
          </>
        }
      >
        {form && (
          <div className="form-grid">
            <label className="fld">nome
              <input value={form.name} onChange={(e) => patch("name", e.target.value)} placeholder="cloudflare-dns" />
              <span className="hint">apelido para reconhecer o destino</span>
            </label>
            <label className="fld">tipo
              <select value={form.kind} onChange={(e) => patch("kind", e.target.value)}>
                <option value="external">externo</option>
                <option value="probe">probe</option>
              </select>
              <span className="hint">externo = fora da sua rede; probe = outro ponto de medição</span>
            </label>
            <label className="fld">endereço (URL/host/IP)
              <input value={form.address} onChange={(e) => patch("address", e.target.value)} placeholder="1.1.1.1 ou https://www.exemplo.com" />
              <span className="hint">IP, nome de host ou URL do alvo</span>
            </label>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        busy={deleting}
        onConfirm={confirmDelete}
        confirmLabel="Remover destino"
        message={toDelete && <>Remover o destino <b>{toDelete.name}</b> (<span className="mono">{toDelete.address}</span>)? Planos que o utilizam podem ficar inválidos.</>}
      />
    </>
  );
}
