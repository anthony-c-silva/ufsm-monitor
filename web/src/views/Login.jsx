import React, { useState } from "react";
import { Activity, Lock, User, Eye, EyeOff } from "lucide-react";
import { login } from "../auth.js";

export default function Login({ onLoggedIn }) {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(username.trim(), password);
      onLoggedIn();
    } catch (ex) {
      setErr(ex.message || "falha no login");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo">
          <Activity size={22} color="#3d8bfd" />
          <strong>UFSM Monitor</strong>
        </div>
        <h1>Entrar</h1>
        <p className="sub">Monitoramento Ativo da Rede</p>
        <form onSubmit={submit}>
          {err && <div className="auth-err">{err}</div>}
          <label className="fld">
            Usuário
            <div className="input-icon">
              <User size={16} className="lead" />
              <input
                value={username}
                onChange={(e) => setU(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="admin"
              />
            </div>
          </label>
          <label className="fld">
            Senha
            <div className="input-icon">
              <Lock size={16} className="lead" />
              <input
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setP(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
              />
              <button type="button" className="toggle" onClick={() => setShow((s) => !s)} tabIndex={-1}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? <span className="spinner" /> : "Entrar"}
          </button>
        </form>
        <div className="auth-note">Primeiro acesso: admin / admin (troca de senha obrigatória)</div>
      </div>
    </div>
  );
}
