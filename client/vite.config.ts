import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const configuredRelayUrl = process.env.VITE_REIKA_RELAY_URL ?? process.env.REIKA_RELAY_URL ?? "";

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_REIKA_RELAY_URL": JSON.stringify(configuredRelayUrl)
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/agent": {
        target: "http://127.0.0.1:47840",
        rewrite: (path) => path.replace(/^\/agent/u, "")
      },
      "/v1": {
        target: "http://127.0.0.1:8790",
        ws: true
      }
    }
  }
});
