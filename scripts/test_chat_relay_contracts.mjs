import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const providerRuntime = read("server/src/modules/provider/providerRuntime.ts");
const serverMain = read("server/src/main.ts");
const dispatcher = read("server/src/modules/commands/dispatcher.ts");
const chatView = read("client/src/features/chat/ChatView.tsx");
const relayClient = read("client/src/data/relay.ts");

for (const forbidden of [
  "You are talking in AgentHub",
  "You are replying inside AgentHub",
  "You are replying inside an AgentHub",
  "AgentHub chat session",
  "Project Reika Agent Server direct-provider chat",
  "Project Reika session id:",
  "Latest user message:"
]) {
  assert(!providerRuntime.includes(forbidden), `Provider runtime must not inject prompt wrapper text: ${forbidden}`);
  assert(!serverMain.includes(forbidden), `Server chat path must not inject prompt wrapper text: ${forbidden}`);
  assert(!dispatcher.includes(forbidden), `Relay dispatcher must not inject prompt wrapper text: ${forbidden}`);
  assert(!relayClient.includes(forbidden), `Relay client must not inject prompt wrapper text: ${forbidden}`);
}

assert(
  dispatcher.includes("message: payload.message"),
  "Relay dispatcher should pass the user message through unchanged."
);

assert(
  dispatcher.includes("providerSessionId: typeof payload.providerSessionId === 'string'") &&
    serverMain.includes("providerSessionId: payload.providerSessionId") &&
    serverMain.includes("providerSessionId: typeof input.providerSessionId === 'string' && input.providerSessionId.trim()"),
  "Relay/direct chat should pass provider session ids as metadata, not prompt text."
);

assert(
  chatView.includes("message,") && chatView.includes("text: message") && chatView.includes("providerSessionId: makeProviderSessionId(relaySessionId)"),
  "ChatView should send and persist the raw composer message."
);

assert(
  serverMain.includes("context ? `${input.message}\\n\\nAttached files/links:\\n${context}` : input.message"),
  "The only server-side prompt mutation should be explicit attachment context."
);

assert(
  providerRuntime.includes("'agent', '--agent', agentId") &&
    providerRuntime.includes("'--session-id', openClawSessionId") &&
    providerRuntime.includes("const openClawSessionId = request.providerSessionId || providerSessionId('project_reika', sessionId)") &&
    providerRuntime.includes("metadata: { providerSessionId: openClawSessionId"),
  "OpenClaw chat must target the selected agent and store a real OpenClaw session id."
);

assert(
  !providerRuntime.includes("parsed.hermesSessionId || request.providerSessionId || sessionId"),
  "Hermes must not fall back to the AgentHub/relay session id as a fake Hermes session id."
);

assert(
  providerRuntime.includes("...(hermesSessionId ? { providerSessionId: hermesSessionId, hermesSessionId } : {})"),
  "Hermes should only persist a real Hermes session id."
);

assert(
  !providerRuntime.includes("--pass-session-id"),
  "Hermes must not inject AgentHub or provider session ids into the model prompt."
);

assert(
  serverMain.includes("result.metadata?.providerSessionId") &&
    serverMain.includes("if (realProviderSessionId) providerSessionIds[result.providerId] = realProviderSessionId"),
  "Server session metadata must only persist explicit provider session ids."
);

console.log("chat relay contracts ok");
