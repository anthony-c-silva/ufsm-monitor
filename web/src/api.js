// Cliente da API do controlador (FastAPI).
// Base: "/api" (proxy do Vite em dev; proxy do Nginx em produção).
// Pode ser sobrescrito com VITE_API_BASE.
const BASE = import.meta.env.VITE_API_BASE || "/api";

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail;
    try {
      detail = await res.json();
    } catch {
      detail = await res.text();
    }
    const msg =
      detail && detail.detail
        ? typeof detail.detail === "string"
          ? detail.detail
          : JSON.stringify(detail.detail)
        : typeof detail === "string"
        ? detail
        : JSON.stringify(detail);
    const err = new Error(msg || `HTTP ${res.status}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const qs = (o) => "?" + new URLSearchParams(o).toString();

export const api = {
  // visão geral / status
  overview: () => req("/stats/overview"),
  recent: (limit = 50) => req("/measurements/recent" + qs({ limit })),
  probesStatus: (minutes = 30) => req("/probes/status" + qs({ minutes })),

  // inventário
  probes: () => req("/probes"),
  addProbe: (b) => req("/probes", { method: "POST", body: JSON.stringify(b) }),
  delProbe: (id) => req("/probes/" + encodeURIComponent(id), { method: "DELETE" }),
  targets: () => req("/targets"),
  addTarget: (b) => req("/targets", { method: "POST", body: JSON.stringify(b) }),
  delTarget: (id) => req("/targets/" + id, { method: "DELETE" }),
  groups: () => req("/groups"),
  addGroup: (b) => req("/groups", { method: "POST", body: JSON.stringify(b) }),
  delGroup: (n) => req("/groups/" + encodeURIComponent(n), { method: "DELETE" }),

  // planos
  plans: () => req("/plans"),
  getPlan: (id) => req("/plans/" + encodeURIComponent(id)),
  validatePlan: (p) => req("/plans/validate", { method: "POST", body: JSON.stringify(p) }),
  createPlan: (p) => req("/plans", { method: "POST", body: JSON.stringify(p) }),
  runPlan: (id) => req("/plans/" + encodeURIComponent(id) + "/run", { method: "POST" }),
  enablePlan: (id) => req("/plans/" + encodeURIComponent(id) + "/enable", { method: "POST" }),
  disablePlan: (id) => req("/plans/" + encodeURIComponent(id) + "/disable", { method: "POST" }),
  delPlan: (id) => req("/plans/" + encodeURIComponent(id), { method: "DELETE" }),

  // medições
  fields: () => req("/measurements/fields"),
  series: (q) => req("/measurements/series" + qs(q)),
  matrix: (type, hours = 24) => req("/measurements/matrix" + qs({ type, hours })),
};
