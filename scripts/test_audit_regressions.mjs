import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const uplink = read("server/src/modules/uplink/relayClient.ts");
const server = read("server/src/main.ts");
const provider = read("server/src/modules/provider/providerRuntime.ts");
const relay = read("Relay/src/relay/server.ts");
const relayClient = read("client/src/data/relay.ts");
const chat = read("client/src/features/chat/ChatView.tsx");
const desktop = read("client/desktop/main.ts");
const home = read("client/src/features/home/HomePage.tsx");
const protocol = read("shared/protocol/index.ts");
const dispatcher = read("server/src/modules/commands/dispatcher.ts");
const assets = read("client/src/data/assets.ts");

assert(uplink.includes("if (disableReconnect) this.enabled = false") && uplink.includes("if (!this.enabled) return;"), "RELAY-001 manual stop must suppress reconnect.");
assert(server.includes("enqueueChatTurn(session.id") && server.indexOf("findProvider(providers") < server.indexOf("const userMessage = appendMessage"), "AGENT-001/PROTOCOL-001 must validate then serialize before persistence.");
assert(provider.includes("homedir()") && provider.includes("join(homedir(), '.openclaw'") && provider.includes("path.delimiter") === false && provider.includes("delimiter"), "AGENT-002 must use platform path APIs.");
assert(provider.includes("AbortSignal.timeout(providerHttpTimeoutMs)"), "AGENT-003 provider HTTP requires a deadline.");
assert(relayClient.includes("if ((lastError as Error & { requestSent?: boolean }).requestSent) break"), "PROTOCOL-002 must not resend ambiguous accepted work.");
assert(chat.includes("Attachments are unavailable for remote chat") && chat.includes("fileIds: []"), "CLIENT-001 remote attachments must be disabled and omitted.");
assert(relay.includes("maxPayload: relayConfig.maxWsPayloadBytes") && relay.includes("RequestBodyTooLargeError") && relay.includes("renameSync(temporaryPath"), "RELAY-002/003 limits and atomic replacement must remain enabled.");
assert(relay.includes("Heartbeat expired") && relay.includes("heartbeatStaleMs"), "RELAY-004 must expire stale devices.");
assert(desktop.includes("sandbox: true") && desktop.includes('parsed.protocol === "https:"') && desktop.includes('webContents.on("will-navigate"'), "SECURITY-002 desktop navigation hardening must remain enabled.");
assert(!home.includes("All systems operational") && home.includes("unavailableProviders") && home.includes("App connected"), "UI-001 health copy must remain scoped and honest.");
assert(!chat.includes('aria-label="Heart reaction"') && chat.includes("MessageBody") && chat.includes("slice(-500)"), "UI-003/004/005 chat regressions must remain fixed.");
assert(relay.includes('deploymentMode: "private-single-operator-testing"') && relay.includes("REIKA_RELAY_ALLOW_NONLOCAL"), "SECURITY-001 relay must remain private/testing-only by default.");
assert(protocol.includes('"command.status.request"') && protocol.includes('"executing"') && dispatcher.includes("IdempotencyLedger"), "PROTOCOL-002 durable delivery status and agent authority must remain wired.");
assert(chat.includes("chat-drawer-toggle") && chat.includes("sessionDrawerOpen"), "UI-002 laptop session drawer must remain available.");
assert(!assets.includes("reika_phase1_generated") && assets.includes("reika_phase1_webp"), "PERF-001 production asset catalog must use generated WebP files.");

console.log("audit regression contracts ok");
