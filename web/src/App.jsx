import React, { useCallback, useState } from "react";
import Overview from "./views/Overview.jsx";
import Inventory from "./views/Inventory.jsx";
import Plans from "./views/Plans.jsx";
import Series from "./views/Series.jsx";
import Matrix from "./views/Matrix.jsx";

const NAV = [
  { id: "overview", label: "Visão geral", ico: "▤", title: "Visão geral" },
  { id: "inventory", label: "Inventário", ico: "🖧", title: "Inventário — probes, destinos e grupos" },
  { id: "plans", label: "Planos", ico: "⚙", title: "Planos de medição" },
  { id: "series", label: "Séries", ico: "📈", title: "Séries temporais" },
  { id: "matrix", label: "Matriz & status", ico: "▦", title: "Matriz probe×destino e status" },
];

let toastId = 0;

export default function App() {
  const [view, setView] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [toasts, setToasts] = useState([]);

  const notify = useCallback((msg, kind = "ok") => {
    const id = ++toastId;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const refresh = () => setRefreshKey((k) => k + 1);
  const current = NAV.find((n) => n.id === view);
  const shared = { notify, refreshKey };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span>UFSM Monitor</span>
          <h1>Monitoramento Ativo da Rede</h1>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={n.id === view ? "active" : ""}
              onClick={() => setView(n.id)}
            >
              <span className="ico">{n.ico}</span>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="foot">Plataforma distribuída · TCC</div>
      </aside>

      <div className="main">
        <header className="topbar">
          <h2>{current?.title}</h2>
          <div className="right">
            <span className="badge blue">API /api</span>
            <button className="btn small" onClick={refresh}>↻ Atualizar</button>
          </div>
        </header>
        <div className="content">
          {view === "overview" && <Overview {...shared} />}
          {view === "inventory" && <Inventory {...shared} />}
          {view === "plans" && <Plans {...shared} />}
          {view === "series" && <Series {...shared} />}
          {view === "matrix" && <Matrix {...shared} />}
        </div>
      </div>

      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + (t.kind === "err" ? "err" : t.kind === "ok" ? "ok" : "")}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
