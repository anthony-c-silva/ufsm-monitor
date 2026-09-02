import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em desenvolvimento, o front chama "/api/..." e o Vite faz proxy para o
// controlador (FastAPI) em localhost:8000, removendo o prefixo /api.
// Em produção (contêiner), o Nginx faz o mesmo proxy (ver web/nginx.conf).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.CONTROLLER_URL || "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
