import React, { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Server, HeartPulse, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { SkeletonTable } from "../components/Skeleton.jsx";
import Modal from "../components/Modal.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import ProbeHealth, { fmtUptime, tempClass, pctClass, throttleText } from "../components/ProbeHealth.jsx";
import { fmtAgo, fmtTime } from "../format.js";

const emptyProbe = { probe_id: "", hostname: "", address: "", deployment: "", vlan: "", active: true };

export default function Probes({ notify, refreshKey }) {
  const [probes, setProbes] = useState([]);
  const [loading, setLoading] = useState(true);

  // modal de criar/editar
  const [form, setForm] = useState(null);      // objeto do probe em edição (ou null)
  const [mode, setMode] = useState("create");  // "create" | "edit"
  const [saving, setSaving] = useState(false);

  // confirmação de exclusão
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // modal de saúde da sonda
  const [healthOf, setHealthOf] = useState(null);

  // silent = atualização periódica (sem skeleton nem aviso de erro)
  const load = (silent = false) => {
    if (!silent) setLoading(true);
    return api.probesStatus(10)
      .then(setProbes)
      .catch((e) => { if (!silent) notify("Falha ao carregar probes: " + e.message, "err"); })
      .finally(() => { if (!silent) setLoading(false); });
  };
  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 30000);
    return () => clearInterval(t);
    /* eslint-disable-next-line */
  }, [refreshKey]);

  const openCreate = () => { setMode("create"); setForm({ ...emptyProbe }); };
  const openEdit = (p) => {
    setMode("edit");
    setForm({ probe_id: p.probe_id, hostname: p.hostname || "", address: p.address || "", deployment: p.deployment || "", vlan: p.vlan || "", active: !!p.active });
  };
  const closeForm = () => { if (!saving) setForm(null); };
  const patch = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.probe_id.trim()) return notify("Informe o probe_id", "err");
    setSaving(true);
    try {
      await api.addProbe(form); // POST faz upsert por probe_id (cria ou edita)
      notify(mode === "edit" ? `Probe '${form.probe_id}' atualizado` : `Probe '${form.probe_id}' criado`, "ok");
      setForm(null);
      load();
    } catch (e) {
      notify((mode === "edit" ? "Erro ao editar: " : "Erro ao criar: ") + e.message, "err");
    } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.delProbe(toDelete.probe_id);
      notify(`Probe '${toDelete.probe_id}' removido`, "ok");
      setToDelete(null);
      load();
    } catch (e) {
      notify("Erro ao remover: " + e.message, "err");
    } finally { setDeleting(false); }
  };

  if (loading && probes.length === 0) {
    return (<><div className="section-title"><Server size={14} /> Probes</div><SkeletonTable rows={6} cols={6} /></>);
  }

  return (
    <>
      <div className="section-title" style={{ justifyContent: "space-between" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Server size={14} /> Probes</span>
        <button className="btn small primary" onClick={openCreate}><Plus size={14} /> Adicionar probe</button>
      </div>

      <div className="card scroll-x">
        <table>
          <thead><tr><th>probe_id</th><th>estado</th><th>endereço</th><th>deployment</th><th>temperatura</th><th>CPU</th><th>memória</th><th>link</th><th>ligada há</th><th></th></tr></thead>
          <tbody>
            {probes.map((p) => {
              const h = p.health || {};
              const lim = h.throttled_now || [];
              return (
              <tr key={p.probe_id}>
                <td className="mono">{p.probe_id}</td>
                <td>
                  {!p.active ? <span className="badge muted">inativo</span>
                    : p.online ? <span className="badge ok" title={fmtTime(p.last_seen)}>online</span>
                    : <span className="badge err" title={p.last_seen ? fmtTime(p.last_seen) : "sem relato recente"}>offline</span>}
                  {p.active && p.last_seen && <div className="muted" style={{ fontSize: 11 }}>{fmtAgo(p.last_seen)}</div>}
                </td>
                <td className="mono">{p.address || "—"}</td>
                <td>{p.deployment || "—"}</td>
                <td>
                  {h.cpu_temp_c != null ? <span className={"badge " + tempClass(h.cpu_temp_c)}>{h.cpu_temp_c.toFixed(1)} °C</span> : "—"}
                  {lim.length > 0 && <span className="badge err" title={throttleText(lim)} style={{ marginLeft: 4 }}><AlertTriangle size={12} /></span>}
                </td>
                <td>{h.cpu_usage_pct != null ? <span className={"badge " + pctClass(h.cpu_usage_pct)}>{h.cpu_usage_pct.toFixed(0)}%</span> : "—"}</td>
                <td>{h.mem_used_pct != null ? <span className={"badge " + pctClass(h.mem_used_pct, 80, 92)}>{h.mem_used_pct.toFixed(0)}%</span> : "—"}</td>
                <td>{h.link_speed_mbps ? <span className={"badge " + (h.link_speed_mbps < 1000 ? "warn" : "ok")}>{h.link_speed_mbps} Mb/s</span> : "—"}</td>
                <td>{fmtUptime(h.uptime_seconds)}</td>
                <td>
                  <div className="btn-row">
                    <button className="btn small" onClick={() => setHealthOf(p)}><HeartPulse size={13} /> Saúde</button>
                    <button className="btn small" onClick={() => openEdit(p)}><Pencil size={13} /> Editar</button>
                    <button className="btn small danger" onClick={() => setToDelete(p)}><Trash2 size={13} /> Remover</button>
                  </div>
                </td>
              </tr>
              );
            })}
            {probes.length === 0 && <tr><td colSpan="10" className="muted">Nenhum probe cadastrado. Clique em <b>Adicionar probe</b>.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* modal criar/editar */}
      <Modal
        open={!!form}
        onClose={closeForm}
        title={mode === "edit" ? "Editar probe" : "Novo probe"}
        icon={Server}
        busy={saving}
        footer={
          <>
            <button className="btn" onClick={closeForm} disabled={saving}>Cancelar</button>
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? <span className="spinner" /> : <Plus size={14} />} {mode === "edit" ? "Salvar" : "Criar probe"}
            </button>
          </>
        }
      >
        {form && (
          <div className="form-grid">
            <label className="fld">probe_id
              <input value={form.probe_id} disabled={mode === "edit"} onChange={(e) => patch("probe_id", e.target.value)} placeholder="probe-a" />
              <span className="hint">{mode === "edit" ? "identificador fixo do probe" : "identificador único (ex.: probe-a)"}</span>
            </label>
            <label className="fld">hostname
              <input value={form.hostname} onChange={(e) => patch("hostname", e.target.value)} placeholder="jarvis" />
            </label>
            <label className="fld">endereço (IP/host)
              <input value={form.address} onChange={(e) => patch("address", e.target.value)} placeholder="10.0.0.5 ou agent-a" />
              <span className="hint">endereço em que este probe é alcançado na rede</span>
            </label>
            <label className="fld">deployment
              <input value={form.deployment} onChange={(e) => patch("deployment", e.target.value)} placeholder="dev / prédio A" />
              <span className="hint">onde o probe está (rótulo livre)</span>
            </label>
            <label className="fld">vlan
              <input value={form.vlan} onChange={(e) => patch("vlan", e.target.value)} placeholder="opcional" />
            </label>
            <label className="fld">ativo
              <select value={form.active ? "1" : "0"} onChange={(e) => patch("active", e.target.value === "1")}>
                <option value="1">sim</option><option value="0">não</option>
              </select>
              <span className="hint">probes inativos não recebem tarefas</span>
            </label>
          </div>
        )}
      </Modal>

      <ProbeHealth probe={healthOf} onClose={() => setHealthOf(null)} notify={notify} />

      <ConfirmDialog
        open={!!toDelete}
        onClose={() => !deleting && setToDelete(null)}
        busy={deleting}
        onConfirm={confirmDelete}
        confirmLabel="Remover probe"
        message={toDelete && <>Remover o probe <b className="mono">{toDelete.probe_id}</b>? Essa ação não pode ser desfeita.</>}
      />
    </>
  );
}
