import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { tagTtsText } from "fish-audio-tts-toolkit/src/tagging.js";

const socketUrl = process.argv[2] || process.env.REIKA_RELAY_APP_URL;
if (!socketUrl) {
  throw new Error("Pass a relay app WebSocket URL or set REIKA_RELAY_APP_URL.");
}
const deviceId = process.argv[3] || "linux-srv955268-local";
const providerId = process.argv[4] || "commandcenter-local";
const agent = process.argv[5] || "orchestrator";

function envelope(type, payload) {
  return {
    v: 1,
    id: `voice_smoke_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    type,
    timestamp: new Date().toISOString(),
    source: { kind: "app", id: "reika-voice-smoke" },
    target: { kind: "device", id: deviceId },
    deviceId,
    payload
  };
}

function request(socket, type, payload, expectedType, timeoutMs = 180000) {
  const outgoing = envelope(type, payload);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timed out`)), timeoutMs);
    const onMessage = (data) => {
      let incoming;
      try { incoming = JSON.parse(data.toString()); } catch { return; }
      if (incoming.replyTo !== outgoing.id && incoming.correlationId !== outgoing.id) return;
      if (incoming.type === "command.accepted") return;
      if (incoming.type === "command.failed" || incoming.type === "command.rejected") {
        clearTimeout(timer);
        socket.off("message", onMessage);
        reject(new Error(incoming.payload?.message || incoming.payload?.reason || incoming.type));
        return;
      }
      if (incoming.type !== expectedType) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(incoming.payload);
    };
    socket.on("message", onMessage);
    socket.send(JSON.stringify(outgoing));
  });
}

const socket = new WebSocket(socketUrl);
await new Promise((resolve, reject) => {
  socket.once("open", resolve);
  socket.once("error", reject);
});

try {
  const chat = await request(socket, "agent.chat.request", {
    providerId,
    agent,
    message: "Reply with one short sentence confirming this real Reika voice smoke test.",
    fileIds: []
  }, "agent.chat.response");
  if (!chat?.text) throw new Error("Real agent returned no text");

  const tagged = await tagTtsText({ text: `*she answers warmly* ${chat.text}` });
  const voice = await request(socket, "agent.voice.request", {
    providerId,
    agent,
    text: tagged.taggedText,
    requestId: `audio_${Date.now().toString(36)}`
  }, "agent.voice.response", 60000);
  const audioBytes = Buffer.from(voice?.audioBase64 || "", "base64").length;
  if (!audioBytes) throw new Error("Real agent voice returned no audio");
  console.log(JSON.stringify({
    ok: true,
    agent,
    providerId,
    chatRuntime: chat.runtime,
    responseText: chat.text,
    toolkitTags: tagged.tags,
    spokenText: tagged.spokenText,
    voiceId: voice.voiceId,
    contentType: voice.contentType,
    audioBytes
  }, null, 2));
} finally {
  socket.close();
}
