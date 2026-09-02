// Formatação de valores de métricas e helpers de UI.

export function fmtValue(type, field, v) {
  if (v === null || v === undefined) return "—";
  if (field === "throughput_bps") {
    if (v >= 1e9) return (v / 1e9).toFixed(2) + " Gbit/s";
    if (v >= 1e6) return (v / 1e6).toFixed(1) + " Mbit/s";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + " kbit/s";
    return v.toFixed(0) + " bit/s";
  }
  if (field === "loss_pct") return Number(v).toFixed(1) + " %";
  if (field === "response_bytes" || field === "bytes_transferred") {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + " MB";
    if (v >= 1e3) return (v / 1e3).toFixed(1) + " kB";
    return v + " B";
  }
  if (field === "http_status" || field === "answer_count" || field === "retransmits")
    return String(v);
  if (typeof v === "number") return v.toFixed(v < 10 ? 2 : 1) + " ms";
  return String(v);
}

export function unitLabel(field) {
  if (field === "throughput_bps") return "bit/s";
  if (field === "loss_pct") return "%";
  if (field === "http_status" || field === "answer_count" || field === "retransmits") return "";
  if (field === "response_bytes" || field === "bytes_transferred") return "bytes";
  return "ms";
}

export function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

export function fmtAgo(iso) {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return Math.round(s) + "s atrás";
  if (s < 3600) return Math.round(s / 60) + "min atrás";
  if (s < 86400) return Math.round(s / 3600) + "h atrás";
  return Math.round(s / 86400) + "d atrás";
}

export const TYPE_LABEL = {
  icmp: "ICMP (latência)",
  iperf3: "iperf3 (vazão)",
  dns: "DNS",
  http: "HTTP/HTTPS",
  traceroute: "traceroute",
};

// paleta para linhas de séries
export const PALETTE = [
  "#0b5cad", "#17915b", "#c23b3b", "#b6892a", "#7b3fbf",
  "#0e8f9e", "#d2691e", "#2e7d32", "#8e2de2", "#475569",
];
