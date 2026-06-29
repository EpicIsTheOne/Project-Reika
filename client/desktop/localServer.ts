import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";

export interface DesktopServerOptions {
  distDir: string;
  host?: string;
  port?: number;
  agentTarget?: string;
  relayTarget?: string;
  apiTarget?: string;
}

export interface DesktopServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

export async function startDesktopServer(options: DesktopServerOptions): Promise<DesktopServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const distDir = resolve(options.distDir);
  const agentTarget = options.agentTarget ?? "http://127.0.0.1:47840";
  const relayTarget = options.relayTarget ?? "http://127.0.0.1:8790";
  const apiTarget = options.apiTarget ?? "http://127.0.0.1:8787";

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);
      if (url.pathname.startsWith("/agent")) {
        await proxyHttp(req, res, agentTarget, url.pathname.replace(/^\/agent/u, "") || "/", url.search);
        return;
      }
      if (url.pathname.startsWith("/v1")) {
        await proxyHttp(req, res, relayTarget, url.pathname, url.search);
        return;
      }
      if (url.pathname.startsWith("/api")) {
        await proxyHttp(req, res, apiTarget, url.pathname, url.search);
        return;
      }
      serveStatic(distDir, url.pathname, res);
    } catch (error) {
      sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  const relayWs = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    if (!url.pathname.startsWith("/v1")) {
      socket.destroy();
      return;
    }
    relayWs.handleUpgrade(req, socket, head, (client) => {
      const target = new URL(`${url.pathname}${url.search}`, relayTarget);
      target.protocol = target.protocol === "https:" ? "wss:" : "ws:";
      const upstream = new WebSocket(target);
      upstream.on("open", () => {
        client.on("message", (message) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(message);
        });
        upstream.on("message", (message) => {
          if (client.readyState === WebSocket.OPEN) client.send(message);
        });
      });
      upstream.on("close", () => client.close());
      upstream.on("error", () => client.close());
      client.on("close", () => upstream.close());
      client.on("error", () => upstream.close());
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveListen());
  });

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise((resolveClose) => {
        relayWs.close();
        server.close(() => resolveClose());
      })
  };
}

async function proxyHttp(req: IncomingMessage, res: ServerResponse, targetBase: string, pathname: string, search: string) {
  const target = new URL(`${pathname}${search}`, targetBase);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || key.toLowerCase() === "host") continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
  const response = await fetch(target, { method, headers, body, redirect: "manual" });
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) {
    res.end();
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

function serveStatic(distDir: string, rawPathname: string, res: ServerResponse) {
  const decoded = decodeURIComponent(rawPathname.split("?")[0] || "/");
  const candidate = decoded === "/" ? "/index.html" : decoded;
  const normalized = normalize(candidate).replace(/^(\.\.[/\\])+/u, "");
  const filePath = resolve(join(distDir, normalized));
  if (!filePath.startsWith(`${distDir}${sep}`) && filePath !== distDir) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }
  const finalPath = existsSync(filePath) && statSync(filePath).isFile() ? filePath : join(distDir, "index.html");
  if (!existsSync(finalPath)) {
    sendJson(res, 404, { ok: false, error: "Client build not found. Run npm run build first." });
    return;
  }
  const ext = extname(finalPath).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable"
  });
  createReadStream(finalPath).pipe(res);
}

function readBody(req: IncomingMessage) {
  return new Promise<Buffer>((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}
