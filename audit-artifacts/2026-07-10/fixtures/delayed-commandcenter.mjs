import http from "node:http";

const port = Number(process.env.AUDIT_COMMANDCENTER_PORT || 18800);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `127.0.0.1:${port}`}`);
  if (request.method === "GET" && url.pathname === "/commandcenter/api/v1/agents") {
    return json(response, 200, {
      ok: true,
      primaryAgentId: "audit-agent",
      agents: [{ id: "audit-agent", name: "Audit Agent", model: "fixture" }]
    });
  }
  if (request.method === "POST" && url.pathname === "/commandcenter/api/v1/chat") {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    const delay = String(body.message || "").includes("slow") ? 700 : 50;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return json(response, 200, {
      ok: true,
      sessionId: body.sessionId,
      text: `fixture reply: ${body.message}`
    });
  }
  json(response, 404, { ok: false, error: "fixture route not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`audit CommandCenter fixture listening on ${port}`);
});

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
