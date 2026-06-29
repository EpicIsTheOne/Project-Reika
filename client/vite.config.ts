import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
