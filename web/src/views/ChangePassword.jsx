import React, { useState } from "react";
import { Lock, ShieldCheck, KeyRound } from "lucide-react";
import { api } from "../api.js";
import { setSession } from "../auth.js";

export default function ChangePassword({ forced, onDone, onCancel, notify }) {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (nw.length < 8) return setErr("a nova senha deve ter ao menos 8 caracteres");
    if (nw !== confirm) return setErr("as senhas não coincidem");
    setBusy(true);
    try {
      const data = await api.changePassword({ current_password: cur, new_password: nw });
      if (data && data.access_token) {
        setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          username: data.username,
          must_change_password: false,
        });
      }
      notify && notify("Senha alterada com sucesso", "ok");
      onDone && onDone();
    } catch (ex) {
      setErr(ex.message || "falha ao trocar a senha");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo">
          <ShieldCheck size={22} color="#3d8bfd" />
          <strong>UFSM Monitor</strong>
        </div>
        <h1>{forced ? "Defina uma nova senha" : "Trocar senha"}</h1>
        <p className="sub">
          {forced
            ? "Por segurança, defina uma senha forte antes de continuar."
            : "Ao trocar a senha, as outras sessões serão encerradas."}
        </p>
        <form onSubmit={submit}>
          {err && <div className="auth-err">{err}</div>}
          <label className="fld">
            Senha atual
            <div className="input-icon">
              <Lock size={16} className="lead" />
              <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" />
            </div>
          </label>
          <label className="fld">
            Nova senha
            <div className="input-icon">
              <KeyRound size={16} className="lead" />
              <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" placeholder="ao menos 8 caracteres" />
            </div>
          </label>
          <label className="fld">
            Confirmar nova senha
            <div className="input-icon">
              <KeyRound size={16} className="lead" />
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </div>
          </label>
          <button className="btn primary" disabled={busy}>
            {busy ? <span className="spinner" /> : "Salvar nova senha"}
          </button>
          {!forced && onCancel && (
            <button type="button" className="btn" onClick={onCancel} style={{ justifyContent: "center" }}>
              Cancelar
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
