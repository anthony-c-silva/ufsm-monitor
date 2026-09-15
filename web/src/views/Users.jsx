import React, { useEffect, useState } from "react";
import { UserPlus, Trash2, ShieldCheck } from "lucide-react";
import { api } from "../api.js";

export default function Users({ notify, refreshKey, currentUser }) {
  const [users, setUsers] = useState([]);
  const [f, setF] = useState({ username: "", password: "" });

  const load = () =>
    api.users().then(setUsers).catch((e) => notify("Falha ao carregar usuários: " + e.message, "err"));

  useEffect(() => {
    load();
    /* eslint-disable-next-line */
  }, [refreshKey]);

  const add = async () => {
    if (!f.username || !f.password) return notify("Informe usuário e senha", "err");
    if (f.password.length < 8) return notify("A senha deve ter ao menos 8 caracteres", "err");
    try {
      await api.createUser(f);
      setF({ username: "", password: "" });
      notify("Usuário criado (troca de senha obrigatória no 1º login)", "ok");
      load();
    } catch (e) {
      notify("Erro: " + e.message, "err");
    }
  };

  const del = async (u) => {
    if (!confirm(`Remover o usuário ${u.username}?`)) return;
    try {
      await api.delUser(u.id);
      notify("Usuário removido");
      load();
    } catch (e) {
      notify("Erro: " + e.message, "err");
    }
  };

  return (
    <>
      <div className="section-title">
        <ShieldCheck size={15} /> Usuários (papel único: ADMIN)
      </div>
      <div className="card">
        <div className="bd">
          <div className="form-grid">
            <label className="fld">
              Usuário
              <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="ex.: joao.ti" />
            </label>
            <label className="fld">
              Senha inicial
              <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="ao menos 8 caracteres" />
            </label>
            <button className="btn primary" onClick={add}>
              <UserPlus size={15} /> Criar usuário
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            O novo usuário deverá trocar a senha no primeiro login. Todos têm acesso total.
          </div>
        </div>
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>usuário</th>
                <th>papel</th>
                <th>estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="mono">
                    {u.username}
                    {currentUser && u.id === currentUser.id && <span className="badge blue" style={{ marginLeft: 8 }}>você</span>}
                  </td>
                  <td>
                    <span className="badge blue">{u.role}</span>
                    {u.must_change_password && <span className="badge warn" style={{ marginLeft: 6 }}>trocar senha</span>}
                  </td>
                  <td>{u.active ? <span className="badge ok">ativo</span> : <span className="badge muted">inativo</span>}</td>
                  <td>
                    <button className="btn danger small" onClick={() => del(u)} disabled={currentUser && u.id === currentUser.id}>
                      <Trash2 size={13} /> remover
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan="4" className="muted">Nenhum usuário.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
