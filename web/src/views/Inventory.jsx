import React, { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Inventory({ notify, refreshKey }) {
  const [probes, setProbes] = useState([]);
  const [targets, setTargets] = useState([]);
  const [groups, setGroups] = useState([]);

  const load = () =>
    Promise.all([api.probes(), api.targets(), api.groups()])
      .then(([p, t, g]) => { setProbes(p); setTargets(t); setGroups(g); })
      .catch((e) => notify("Falha ao carregar inventário: " + e.message, "err"));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refreshKey]);

  // -------- forms state --------
  const [pf, setPf] = useState({ probe_id: "", hostname: "", address: "", deployment: "", vlan: "", active: true });
  const [tf, setTf] = useState({ name: "", kind: "external", address: "" });
  const [gf, setGf] = useState({ name: "", members: [] });

  const addProbe = async () => {
    if (!pf.probe_id) return notify("Informe o probe_id", "err");
    try { await api.addProbe(pf); setPf({ probe_id: "", hostname: "", address: "", deployment: "", vlan: "", active: true }); notify("Probe salvo"); load(); }
    catch (e) { notify("Erro: " + e.message, "err"); }
  };
  const addTarget = async () => {
    if (!tf.name || !tf.address) return notify("Nome e endereço são obrigatórios", "err");
    try { await api.addTarget(tf); setTf({ name: "", kind: "external", address: "" }); notify("Destino salvo"); load(); }
    catch (e) { notify("Erro: " + e.message, "err"); }
  };
  const addGroup = async () => {
    if (!gf.name) return notify("Informe o nome do grupo", "err");
    try { await api.addGroup(gf); setGf({ name: "", members: [] }); notify("Grupo salvo"); load(); }
    catch (e) { notify("Erro: " + e.message, "err"); }
  };
  const toggleMember = (id) =>
    setGf((g) => ({ ...g, members: g.members.includes(id) ? g.members.filter((x) => x !== id) : [...g.members, id] }));

  const del = async (fn, arg, label) => {
    if (!confirm(`Remover ${label}?`)) return;
    try { await fn(arg); notify("Removido"); load(); } catch (e) { notify("Erro: " + e.message, "err"); }
  };

  return (
    <>
      {/* PROBES */}
      <div className="section-title">Probes</div>
      <div className="card">
        <div className="bd">
          <div className="form-grid">
            <label className="fld">probe_id
              <input value={pf.probe_id} onChange={(e) => setPf({ ...pf, probe_id: e.target.value })} placeholder="probe-a" />
            </label>
            <label className="fld">hostname
              <input value={pf.hostname} onChange={(e) => setPf({ ...pf, hostname: e.target.value })} placeholder="jarvis" />
            </label>
            <label className="fld">endereço (IP/host)
              <input value={pf.address} onChange={(e) => setPf({ ...pf, address: e.target.value })} placeholder="agent-a" />
            </label>
            <label className="fld">deployment
              <input value={pf.deployment} onChange={(e) => setPf({ ...pf, deployment: e.target.value })} placeholder="dev / campus" />
            </label>
            <label className="fld">vlan
              <input value={pf.vlan} onChange={(e) => setPf({ ...pf, vlan: e.target.value })} />
            </label>
            <label className="fld">ativo
              <select value={pf.active ? "1" : "0"} onChange={(e) => setPf({ ...pf, active: e.target.value === "1" })}>
                <option value="1">sim</option><option value="0">não</option>
              </select>
            </label>
            <button className="btn primary" onClick={addProbe}>+ Adicionar probe</button>
          </div>
        </div>
        <div className="scroll-x">
          <table>
            <thead><tr><th>probe_id</th><th>hostname</th><th>endereço</th><th>deployment</th><th>vlan</th><th>ativo</th><th></th></tr></thead>
            <tbody>
              {probes.map((p) => (
                <tr key={p.probe_id}>
                  <td className="mono">{p.probe_id}</td><td>{p.hostname || "—"}</td>
                  <td className="mono">{p.address || "—"}</td><td>{p.deployment || "—"}</td><td>{p.vlan || "—"}</td>
                  <td>{p.active ? <span className="badge ok">ativo</span> : <span className="badge muted">inativo</span>}</td>
                  <td><button className="btn danger small" onClick={() => del(api.delProbe, p.probe_id, `probe ${p.probe_id}`)}>remover</button></td>
                </tr>
              ))}
              {probes.length === 0 && <tr><td colSpan="7" className="muted">Nenhum probe cadastrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* TARGETS */}
      <div className="section-title">Destinos (allowlist)</div>
      <div className="card">
        <div className="bd">
          <div className="form-grid">
            <label className="fld">nome
              <input value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} placeholder="cloudflare" />
            </label>
            <label className="fld">tipo
              <select value={tf.kind} onChange={(e) => setTf({ ...tf, kind: e.target.value })}>
                <option value="external">externo</option><option value="probe">probe</option>
              </select>
            </label>
            <label className="fld">endereço (URL/host/IP)
              <input value={tf.address} onChange={(e) => setTf({ ...tf, address: e.target.value })} placeholder="1.1.1.1 ou https://www.ufsm.br" />
            </label>
            <button className="btn primary" onClick={addTarget}>+ Adicionar destino</button>
          </div>
        </div>
        <div className="scroll-x">
          <table>
            <thead><tr><th>nome</th><th>tipo</th><th>endereço</th><th></th></tr></thead>
            <tbody>
              {targets.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td><span className="badge blue">{t.kind}</span></td>
                  <td className="mono">{t.address}</td>
                  <td><button className="btn danger small" onClick={() => del(api.delTarget, t.id, `destino ${t.name}`)}>remover</button></td>
                </tr>
              ))}
              {targets.length === 0 && <tr><td colSpan="4" className="muted">Nenhum destino autorizado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* GROUPS */}
      <div className="section-title">Grupos de probes</div>
      <div className="card">
        <div className="bd">
          <label className="fld" style={{ maxWidth: 260 }}>nome do grupo
            <input value={gf.name} onChange={(e) => setGf({ ...gf, name: e.target.value })} placeholder="campus" />
          </label>
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ marginBottom: 6, fontSize: 12 }}>membros:</div>
            <div className="checks">
              {probes.map((p) => (
                <label key={p.probe_id} className={"chk" + (gf.members.includes(p.probe_id) ? " on" : "")}>
                  <input type="checkbox" checked={gf.members.includes(p.probe_id)} onChange={() => toggleMember(p.probe_id)} />
                  {p.probe_id}
                </label>
              ))}
              {probes.length === 0 && <span className="muted">cadastre probes primeiro</span>}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={addGroup}>+ Salvar grupo</button>
          </div>
        </div>
        <div className="scroll-x">
          <table>
            <thead><tr><th>grupo</th><th>membros</th><th></th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name}>
                  <td className="mono">{g.name}</td>
                  <td>{(g.members || []).join(", ") || "—"}</td>
                  <td><button className="btn danger small" onClick={() => del(api.delGroup, g.name, `grupo ${g.name}`)}>remover</button></td>
                </tr>
              ))}
              {groups.length === 0 && <tr><td colSpan="3" className="muted">Nenhum grupo.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
