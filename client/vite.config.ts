import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const configuredRelayUrl = process.env.VITE_REIKA_RELAY_URL ?? process.env.REIKA_RELAY_URL ?? "";
const configuredRelayProxyTarget =
  process.env.VITE_REIKA_RELAY_PROXY_TARGET ??
  process.env.AGENTHUB_RELAY_TARGET ??
  deriveRelayProxyTarget(configuredRelayUrl) ??
  "https://relay.techexplore.us";

export default defineConfig({
  plugins: [quietLocalAgentHealthProbe(), react()],
  define: {
    "import.meta.env.VITE_REIKA_RELAY_URL": JSON.stringify(configuredRelayUrl)
  },
  server: {
    port: 5173,
    strictPort: false,
    watch: {
      ignored: ["**/dist-desktop/**", "**/release/**"]
    },
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/agent": {
        target: "http://127.0.0.1:47840",
        rewrite: (path) => path.replace(/^\/agent/u, ""),
        configure(proxy) {
          proxy.on("error", (_error, _request, response) => {
            if (!response || response.headersSent) return;
            response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            response.end(JSON.stringify({ ok: false, error: "Local Reika agent is still starting." }));
          });
        }
      },
      "/v1": {
        target: configuredRelayProxyTarget,
        ws: true
      }
    }
  }
});

function quietLocalAgentHealthProbe(): Plugin {
  const target = "http://127.0.0.1:47840";
  return {
    name: "quiet-local-agent-health-probe",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
        if (request.method !== "GET" || !request.url?.startsWith("/agent/health")) {
          next();
          return;
        }

        try {
          const upstream = await fetch(`${target}/health`, { signal: AbortSignal.timeout(800) });
          response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
          response.end(Buffer.from(await upstream.arrayBuffer()));
        } catch {
          response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          response.end(JSON.stringify({ ok: false, error: "Local Reika agent is still starting." }));
        }
      });
    }
  };
}

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
