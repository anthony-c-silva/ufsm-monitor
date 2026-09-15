// Armazenamento e fluxo de sessão (access + refresh token).
// O access token vai no header Authorization; o refresh é usado para renovar.
const BASE = import.meta.env.VITE_API_BASE || "/api";
const KEY = "ufsm.auth";

let mem = load();

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

function persist(data) {
  mem = data;
  try {
    if (data) localStorage.setItem(KEY, JSON.stringify(data));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function getAccessToken() {
  return mem?.access_token || null;
}
export function getRefreshToken() {
  return mem?.refresh_token || null;
}
export function getUsername() {
  return mem?.username || null;
}
export function isAuthenticated() {
  return !!mem?.access_token;
}
export function setSession(data) {
  persist(data);
}
export function updateTokens(access, refresh) {
  if (mem) persist({ ...mem, access_token: access, refresh_token: refresh });
}
export function clearSession() {
  persist(null);
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data && data.detail ? data.detail : `HTTP ${res.status}`;
    const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function login(username, password) {
  const data = await post("/auth/login", { username, password });
  persist(data);
  return data;
}

export async function logout() {
  const rt = getRefreshToken();
  if (rt) {
    try {
      await post("/auth/logout", { refresh_token: rt });
    } catch {
      /* ignore */
    }
  }
  clearSession();
}

// Renova o access token usando o refresh (rotaciona). Retorna true se ok.
let refreshing = null;
export function refreshSession() {
  if (refreshing) return refreshing;
  const rt = getRefreshToken();
  if (!rt) return Promise.resolve(false);
  refreshing = post("/auth/refresh", { refresh_token: rt })
    .then((data) => {
      updateTokens(data.access_token, data.refresh_token);
      return true;
    })
    .catch(() => {
      clearSession();
      return false;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
