/// <reference types="vite/client" />

interface ReikaVoiceSecretStatus { configured: boolean; secureStorageAvailable: boolean; updatedAt?: string; lastValidatedAt?: string; }
interface ReikaVoiceSearchItem { id: string; title: string; description: string; tags: string[]; languages: string[]; coverImage?: string; matchReasons: string[]; }
interface ReikaVoiceSynthesisResult { requestId: string; audioBase64: string; contentType: string; taggedText: string; spokenText: string; tags: string[]; cacheHit: boolean; }
interface Window {
  reikaDesktop?: {
    platform: string;
    version: string;
    voice: {
      secretStatus(): Promise<ReikaVoiceSecretStatus>;
      saveSecret(apiKey: string): Promise<ReikaVoiceSecretStatus>;
      testSecret(): Promise<ReikaVoiceSecretStatus>;
      removeSecret(): Promise<ReikaVoiceSecretStatus>;
      search(query: string): Promise<{ query: string; items: ReikaVoiceSearchItem[] }>;
      tag(text: string): Promise<{ taggedText: string; spokenText: string; tags: string[] }>;
      synthesize(input: { requestId: string; text: string; voiceId: string }): Promise<ReikaVoiceSynthesisResult>;
      cancel(requestId: string): Promise<{ cancelled: boolean }>;
      stopAll(): Promise<{ stopped: boolean }>;
    };
    stt: {
      secretStatus(): Promise<ReikaVoiceSecretStatus>;
      saveSecret(apiKey: string): Promise<ReikaVoiceSecretStatus>;
      testSecret(): Promise<ReikaVoiceSecretStatus>;
      removeSecret(): Promise<ReikaVoiceSecretStatus>;
      transcribe(input: { requestId: string; audioBase64: string; format: string }): Promise<{ requestId: string; text: string; seconds: number; cost: number }>;
      cancel(requestId: string): Promise<{ cancelled: boolean }>;
    };
  };
}
