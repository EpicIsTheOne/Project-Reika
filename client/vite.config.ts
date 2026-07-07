import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const configuredRelayUrl = process.env.VITE_REIKA_RELAY_URL ?? process.env.REIKA_RELAY_URL ?? "";
const configuredRelayProxyTarget =
  process.env.VITE_REIKA_RELAY_PROXY_TARGET ??
  process.env.AGENTHUB_RELAY_TARGET ??
  deriveRelayProxyTarget(configuredRelayUrl) ??
  "https://relay.techexplore.us";

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
        target: configuredRelayProxyTarget,
        ws: true
      }
    }
  }
});

function deriveRelayProxyTarget(relayDeviceUrl: string) {
  if (!relayDeviceUrl.trim()) return undefined;
  try {
    const url = new URL(relayDeviceUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:" && url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}
