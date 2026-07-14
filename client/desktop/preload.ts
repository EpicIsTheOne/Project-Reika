import { contextBridge, ipcRenderer } from "electron";

async function invokeVoice(channel: string, input?: unknown) {
  try {
    return await ipcRenderer.invoke(channel, input);
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error || "Voice operation failed."))
      .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, "");
    throw new Error(message);
  }
}

contextBridge.exposeInMainWorld("reikaDesktop", {
  platform: process.platform,
  version: process.env.npm_package_version ?? "0.1.0",
  voice: {
    secretStatus: () => invokeVoice("reika-voice:secret-status"),
    saveSecret: (apiKey: string) => invokeVoice("reika-voice:save-secret", { apiKey }),
    testSecret: () => invokeVoice("reika-voice:test-secret"),
    removeSecret: () => invokeVoice("reika-voice:remove-secret"),
    search: (query: string) => invokeVoice("reika-voice:search", { query }),
    tag: (text: string) => invokeVoice("reika-voice:tag", { text }),
    synthesize: (input: { requestId: string; text: string; voiceId: string }) => invokeVoice("reika-voice:synthesize", input),
    cancel: (requestId: string) => invokeVoice("reika-voice:cancel", { requestId }),
    stopAll: () => invokeVoice("reika-voice:stop-all")
  },
  stt: {
    secretStatus: () => invokeVoice("reika-stt:secret-status"),
    saveSecret: (apiKey: string) => invokeVoice("reika-stt:save-secret", { apiKey }),
    testSecret: () => invokeVoice("reika-stt:test-secret"),
    removeSecret: () => invokeVoice("reika-stt:remove-secret"),
    transcribe: (input: { requestId: string; audioBase64: string; format: string }) => invokeVoice("reika-stt:transcribe", input),
    cancel: (requestId: string) => invokeVoice("reika-stt:cancel", { requestId })
  }
});
