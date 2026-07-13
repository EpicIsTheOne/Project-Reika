import assert from "node:assert/strict";
import { mapDevice } from "../src/data/api";
import { resolveAgentVoice, shouldSpeakAgentReply } from "../src/lib/voicePlayback";
import type { ReikaSettings } from "../src/lib/reikaApi";

const settings = {
  voice: {
    speakAgentReplies: true,
    defaultVoice: { provider: "fish", voiceId: "global-voice", voiceLabel: "Global" },
    agents: {}
  }
} as unknown as ReikaSettings;

const inheritedAgent = {
  key: "device::commandcenter::orchestrator",
  agentId: "orchestrator",
  providerId: "commandcenter",
  voiceProvider: "fish",
  voiceId: "provider-voice",
  voiceLabel: "Astra",
  voiceAvailable: true
};

assert.deepEqual(resolveAgentVoice(inheritedAgent, settings), {
  provider: "fish",
  voiceId: "provider-voice",
  voiceLabel: "Astra",
  source: "provider-inherited",
  available: true,
  inheritedProvider: "fish",
  transport: "local"
});
assert.equal(resolveAgentVoice({ ...inheritedAgent, voiceId: "" }, settings).source, "reika-default");

settings.voice.agents[inheritedAgent.key] = {
  spokenChat: "never",
  callEnabled: true,
  override: { provider: "fish", voiceId: "override-voice", voiceLabel: "Override" }
};
assert.equal(resolveAgentVoice(inheritedAgent, settings).source, "user-override");
assert.equal(resolveAgentVoice(inheritedAgent, settings).voiceId, "override-voice");
assert.equal(shouldSpeakAgentReply(inheritedAgent.key, settings), false);

settings.voice.agents[inheritedAgent.key] = { spokenChat: "always", callEnabled: true };
settings.voice.speakAgentReplies = false;
assert.equal(resolveAgentVoice(inheritedAgent, settings).source, "provider-inherited");
assert.equal(shouldSpeakAgentReply(inheritedAgent.key, settings), true);

delete settings.voice.agents[inheritedAgent.key];
settings.voice.defaultVoice = { provider: "system", voiceId: "", voiceLabel: "" };
assert.equal(resolveAgentVoice({ ...inheritedAgent, voiceId: "" }, settings).source, "fallback");

const mappedAgent = mapDevice({
  id: "device",
  name: "Device",
  type: "server",
  status: "online",
  location: "remote",
  lastSeenAt: new Date(0).toISOString(),
  agentVersion: "test",
  providers: [{
    id: "commandcenter",
    deviceId: "device",
    kind: "commandcenter",
    name: "CommandCenter",
    status: "online",
    lastSeenAt: new Date(0).toISOString(),
    capabilities: ["voice"],
    remote: true,
    agents: [{
      id: "orchestrator",
      providerId: "commandcenter",
      deviceId: "device",
      name: "Astra",
      role: "orchestrator",
      status: "online",
      capabilities: ["voice"],
      updatedAt: new Date(0).toISOString(),
      voiceProvider: "fish",
      voiceId: "exact-inherited-id",
      voiceLabel: "Exact inherited voice",
      voiceAvailable: true
    }]
  }]
} as never).providers[0]?.agents[0];
assert.equal(mappedAgent?.voiceProvider, "fish");
assert.equal(mappedAgent?.voiceId, "exact-inherited-id");
assert.equal(mappedAgent?.voiceLabel, "Exact inherited voice");

console.log("voice resolution contracts passed");
