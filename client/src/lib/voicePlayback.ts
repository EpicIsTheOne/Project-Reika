import type { ReikaAgentSummary, ReikaSettings } from "./reikaApi";

export type ResolvedVoiceSource = "user-override" | "provider-inherited" | "reika-default" | "fallback";
export interface ResolvedVoice {
  provider: "fish" | "commandcenter" | "system";
  voiceId: string;
  voiceLabel: string;
  source: ResolvedVoiceSource;
  available: boolean;
  fallbackReason?: string;
  inheritedProvider?: string;
  transport?: "commandcenter" | "local";
}

export interface VoiceAgentContext {
  key: string;
  agentId: string;
  providerId: string;
  deviceId?: string;
  voiceProvider?: unknown;
  voiceId?: unknown;
  voiceLabel?: unknown;
  voiceAvailable?: unknown;
  voiceSettings?: unknown;
}

export function voiceAgentKey(input: { deviceId?: unknown; providerId?: unknown; id?: unknown; relayAgentId?: unknown }) {
  return [input.deviceId || "local", input.providerId || "provider", input.relayAgentId || input.id || "agent"].map(String).join("::");
}

export function resolveAgentVoice(agent: VoiceAgentContext, settings: ReikaSettings): ResolvedVoice {
  const preference = settings.voice.agents[agent.key];
  if (preference?.override) return { ...preference.override, source: "user-override", available: true, transport: "local" };
  const inheritedVoiceId = typeof agent.voiceId === "string" ? agent.voiceId.trim() : "";
  const inheritedProvider = typeof agent.voiceProvider === "string" ? agent.voiceProvider.trim().toLowerCase() : "";
  if (inheritedVoiceId) {
    const useLocalFishAdapter = inheritedProvider === "fish";
    return {
      provider: useLocalFishAdapter ? "fish" : "commandcenter",
      voiceId: inheritedVoiceId,
      voiceLabel: typeof agent.voiceLabel === "string" && agent.voiceLabel.trim() ? agent.voiceLabel.trim() : inheritedVoiceId,
      source: "provider-inherited",
      available: agent.voiceAvailable !== false,
      inheritedProvider: inheritedProvider || "commandcenter",
      transport: useLocalFishAdapter ? "local" : "commandcenter"
    };
  }
  if (settings.voice.defaultVoice?.voiceId) {
    return { ...settings.voice.defaultVoice, source: "reika-default", available: true, transport: "local" };
  }
  return { provider: "system", voiceId: "system-default", voiceLabel: "System default", source: "fallback", available: true, transport: "local", fallbackReason: "No provider or global voice is configured." };
}

export function shouldSpeakAgentReply(agentKey: string, settings: ReikaSettings) {
  const preference = settings.voice.agents[agentKey]?.spokenChat ?? "global";
  return preference === "always" || (preference === "global" && settings.voice.speakAgentReplies);
}

export type PlaybackPhase = "idle" | "loading" | "speaking" | "paused" | "error";
export interface PlaybackState { phase: PlaybackPhase; messageId?: string; muted: boolean; error?: string; }
type RemoteSynthesizer = (input: { requestId: string; text: string }) => Promise<{ audioBase64: string; contentType: string }>;

class SpeechPlaybackController {
  private audio?: HTMLAudioElement;
  private utterance?: SpeechSynthesisUtterance;
  private requestId?: string;
  private generation = 0;
  private state: PlaybackState = { phase: "idle", muted: false };
  private listeners = new Set<(state: PlaybackState) => void>();
  private spoken = new Set<string>();
  private cache = new Map<string, { audioBase64: string; contentType: string }>();

  snapshot() { return this.state; }
  subscribe(listener: (state: PlaybackState) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener); }; }
  private update(next: Partial<PlaybackState>) { this.state = { ...this.state, ...next }; for (const listener of this.listeners) listener(this.state); }

  async speak(input: { messageId: string; text: string; voice: ResolvedVoice; remoteSynthesizer?: RemoteSynthesizer; force?: boolean }) {
    if (!input.force && this.spoken.has(input.messageId)) return;
    await this.stop();
    const generation = ++this.generation;
    this.requestId = `voice_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.update({ phase: "loading", messageId: input.messageId, error: undefined });
    try {
      if (input.voice.provider === "system") {
        this.playSystem(input.messageId, input.text, generation);
        this.spoken.add(input.messageId);
        return;
      }
      const cacheKey = `${input.voice.provider}:${input.voice.voiceId}:${input.text}`;
      let audio = this.cache.get(cacheKey);
      if (!audio) {
        if (input.voice.transport === "commandcenter") {
          if (!input.remoteSynthesizer) throw new Error("Command Center voice transport is unavailable.");
          let text = input.text;
          if (input.voice.inheritedProvider === "fish") {
            const tagged = await window.reikaDesktop?.voice.tag(input.text);
            if (!tagged) throw new Error("Fish toolkit is unavailable in this build.");
            text = tagged.taggedText;
          }
          audio = await input.remoteSynthesizer({ requestId: this.requestId, text });
        } else {
          const result = await window.reikaDesktop?.voice.synthesize({ requestId: this.requestId, text: input.text, voiceId: input.voice.voiceId });
          if (!result) throw new Error("Fish Audio requires the packaged Reika desktop app.");
          audio = result;
        }
        this.cache.set(cacheKey, audio);
        while (this.cache.size > 12) this.cache.delete(this.cache.keys().next().value as string);
      }
      if (generation !== this.generation) return;
      this.playAudio(input.messageId, audio, generation);
      this.spoken.add(input.messageId);
    } catch (error) {
      if (generation !== this.generation) return;
      this.update({ phase: "error", error: error instanceof Error ? error.message : String(error), messageId: input.messageId });
    }
  }

  private playAudio(messageId: string, result: { audioBase64: string; contentType: string }, generation: number) {
    const bytes = Uint8Array.from(atob(result.audioBase64), (character) => character.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: result.contentType || "audio/mpeg" }));
    const audio = new Audio(url);
    audio.muted = this.state.muted;
    audio.onplay = () => { if (generation === this.generation) this.update({ phase: "speaking", messageId }); };
    audio.onended = () => { URL.revokeObjectURL(url); if (generation === this.generation) this.update({ phase: "idle", messageId: undefined }); };
    audio.onerror = () => { URL.revokeObjectURL(url); if (generation === this.generation) this.update({ phase: "error", messageId, error: "Audio playback failed." }); };
    this.audio = audio;
    void audio.play().catch((error) => {
      URL.revokeObjectURL(url);
      if (generation === this.generation) {
        this.update({ phase: "error", messageId, error: error instanceof Error ? error.message : "Audio playback failed." });
      }
    });
  }

  private playSystem(messageId: string, text: string, generation: number) {
    if (!("speechSynthesis" in window)) throw new Error("System speech synthesis is unavailable.");
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => { if (generation === this.generation) this.update({ phase: "speaking", messageId }); };
    utterance.onend = () => { if (generation === this.generation) this.update({ phase: "idle", messageId: undefined }); };
    utterance.onerror = () => { if (generation === this.generation) this.update({ phase: "error", messageId, error: "System speech synthesis failed." }); };
    utterance.volume = this.state.muted ? 0 : 1;
    this.utterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  pauseOrResume() {
    if (this.audio) {
      if (this.audio.paused) { void this.audio.play(); } else { this.audio.pause(); this.update({ phase: "paused" }); }
      return;
    }
    if (this.state.phase === "paused") { window.speechSynthesis.resume(); this.update({ phase: "speaking" }); }
    else { window.speechSynthesis.pause(); this.update({ phase: "paused" }); }
  }

  setMuted(muted: boolean) {
    if (this.audio) this.audio.muted = muted;
    if (this.utterance) this.utterance.volume = muted ? 0 : 1;
    this.update({ muted });
  }

  async stop() {
    this.generation += 1;
    this.audio?.pause();
    this.audio = undefined;
    window.speechSynthesis?.cancel();
    this.utterance = undefined;
    if (this.requestId) await window.reikaDesktop?.voice.cancel(this.requestId).catch(() => undefined);
    this.requestId = undefined;
    this.update({ phase: "idle", messageId: undefined, error: undefined });
  }
}

export const speechPlayback = new SpeechPlaybackController();

export function agentVoiceContext(agent: ReikaAgentSummary, providerId: string): VoiceAgentContext {
  return { key: voiceAgentKey({ ...agent, providerId }), agentId: agent.id, providerId, deviceId: agent.deviceId, voiceProvider: agent.voiceProvider, voiceId: agent.voiceId, voiceLabel: agent.voiceLabel, voiceAvailable: agent.voiceAvailable, voiceSettings: agent.voiceSettings };
}
