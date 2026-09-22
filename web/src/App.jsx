import React, { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard, Server, Globe, Boxes, SlidersHorizontal, Activity, Grid3x3, Users as UsersIcon,
  LogOut, RefreshCw, Menu, KeyRound, ChevronDown, Network,
} from "lucide-react";
import { api } from "./api.js";
import { isAuthenticated, clearSession, logout as doLogout, getUsername } from "./auth.js";
import Overview from "./views/Overview.jsx";
import Probes from "./views/Probes.jsx";
import Destinos from "./views/Destinos.jsx";
import Groups from "./views/Groups.jsx";
import Plans from "./views/Plans.jsx";
import Series from "./views/Series.jsx";
import Matrix from "./views/Matrix.jsx";
import Users from "./views/Users.jsx";
import Login from "./views/Login.jsx";
import ChangePassword from "./views/ChangePassword.jsx";

const NAV = [
  { id: "overview", label: "Visão geral", Icon: LayoutDashboard, title: "Visão geral" },
  { id: "probes", label: "Probes", Icon: Server, title: "Probes" },
  { id: "destinos", label: "Destinos", Icon: Globe, title: "Destinos (allowlist)" },
  { id: "groups", label: "Grupos", Icon: Boxes, title: "Grupos de probes" },
  { id: "plans", label: "Planos", Icon: SlidersHorizontal, title: "Planos de medição" },
  { id: "series", label: "Séries", Icon: Activity, title: "Séries temporais" },
  { id: "matrix", label: "Matriz & status", Icon: Grid3x3, title: "Matriz probe×destino e status" },
  { id: "users", label: "Usuários", Icon: UsersIcon, title: "Usuários" },
];

const AUTO_REFRESH_MS = 30000;
let toastId = 0;

export default function App() {
  const [phase, setPhase] = useState("loading"); // loading | login | changepw | app
  const [currentUser, setCurrentUser] = useState(null);
  const [view, setView] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [toasts, setToasts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);

  const notify = useCallback((msg, kind = "ok") => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // Carrega o usuário atual (após login / no boot).
  const enter = useCallback(async () => {
    try {
      const u = await api.me();
      setCurrentUser(u);
      setPhase(u.must_change_password ? "changepw" : "app");
    } catch {
      clearSession();
      setPhase("login");
    }
  }, []);

  // Boot: se há sessão, valida; senão, login.
  useEffect(() => {
    if (isAuthenticated()) enter();
    else setPhase("login");
  }, [enter]);

  // Reage a sessão expirada / troca obrigatória detectada pela API.
  useEffect(() => {
    const onUnauth = () => { clearSession(); setCurrentUser(null); setPhase("login"); };
    const onForbidden = () => setPhase((p) => (p === "app" ? "changepw" : p));
    window.addEventListener("ufsm:unauthorized", onUnauth);
    window.addEventListener("ufsm:forbidden", onForbidden);
    return () => {
      window.removeEventListener("ufsm:unauthorized", onUnauth);
      window.removeEventListener("ufsm:forbidden", onForbidden);
    };
  }, []);

  // Auto-refresh dos painéis.
  useEffect(() => {
    if (!autoRefresh || phase !== "app") return;
    const t = setInterval(() => setRefreshKey((k) => k + 1), AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [autoRefresh, phase]);

  const refresh = () => setRefreshKey((k) => k + 1);
  const logout = async () => {
    await doLogout();
    setCurrentUser(null);
    setMenuOpen(false);
    setPhase("login");
  };

  if (phase === "loading") {
    return <div className="auth-wrap"><span className="spinner" /></div>;
  }
  if (phase === "login") {
    return <Login onLoggedIn={enter} />;
  }
  if (phase === "changepw") {
    return <ChangePassword forced onDone={enter} notify={notify} />;
  }

  const current = NAV.find((n) => n.id === view) || NAV[0];
  const shared = { notify, refreshKey };
  const uname = currentUser?.username || getUsername() || "?";

  return (
    <div className="app">
      <div className={"overlay" + (sidebarOpen ? " show" : "")} onClick={() => setSidebarOpen(false)} />
      <aside className={"sidebar" + (sidebarOpen ? " open" : "")}>
        <div className="brand">
          <div className="logo"><Network size={20} color="#3d8bfd" /><span className="kicker">UFSM Monitor</span></div>
          <h1>Monitoramento Ativo da Rede</h1>
        </div>
        <nav className="nav">
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} className={id === view ? "active" : ""} onClick={() => { setView(id); setSidebarOpen(false); }}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>
        <div className="foot">Plataforma distribuída · TCC</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="left">
            <button className="iconbtn hamburger" onClick={() => setSidebarOpen(true)} aria-label="menu"><Menu size={18} /></button>
            <h2>{current.title}</h2>
          </div>
          <div className="right">
            <select
              className={"auto-refresh" + (autoRefresh ? " on" : "")}
              value={autoRefresh ? "on" : "off"}
              onChange={(e) => setAutoRefresh(e.target.value === "on")}
              title="Atualiza os painéis automaticamente a cada 30 segundos"
            >
              <option value="off">Auto-atualizar: desligada</option>
              <option value="on">Auto-atualizar: ligada (30s)</option>
            </select>
            <button className="btn small" onClick={refresh}><RefreshCw size={14} /> Atualizar</button>
            <div className="usermenu">
              <button className="trigger" onClick={() => setMenuOpen((v) => !v)}>
                <span className="avatar">{uname.slice(0, 1).toUpperCase()}</span>
                {uname} <ChevronDown size={14} />
              </button>
              {menuOpen && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 39 }} onClick={() => setMenuOpen(false)} />
                  <div className="menu">
                    <button onClick={() => { setShowChangePw(true); setMenuOpen(false); }}><KeyRound size={15} /> Trocar senha</button>
                    <div className="sep" />
                    <button onClick={logout}><LogOut size={15} /> Sair</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="content">
          {view === "overview" && <Overview {...shared} />}
          {view === "probes" && <Probes {...shared} />}
          {view === "destinos" && <Destinos {...shared} />}
          {view === "groups" && <Groups {...shared} />}
          {view === "plans" && <Plans {...shared} />}
          {view === "series" && <Series {...shared} />}
          {view === "matrix" && <Matrix {...shared} />}
          {view === "users" && <Users {...shared} currentUser={currentUser} />}
        </div>
      </div>

      {showChangePw && (
        <ChangePassword notify={notify} onDone={() => { setShowChangePw(false); notify("Senha alterada — faça login novamente se necessário", "ok"); }} onCancel={() => setShowChangePw(false)} />
      )}

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + (t.kind === "err" ? "err" : t.kind === "ok" ? "ok" : "")}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}
