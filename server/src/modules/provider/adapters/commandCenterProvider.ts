import type { ProviderAdapter, ProviderRecord } from '../types.js';

const baseUrl = process.env.COMMANDCENTER_LOCAL_API_BASE || 'http://127.0.0.1:3002/commandcenter/api/v1';

interface CommandCenterAgent {
  id?: string;
  name?: string;
  label?: string;
  model?: string;
  source?: string;
  bridge?: string;
  voice?: string;
}

interface CommandCenterVoiceState {
  provider?: string;
  defaultVoiceId?: string;
  fishVoiceId?: string;
  elevenlabsAgentVoices?: Record<string, string>;
  fishAgentVoices?: Record<string, string>;
}

export const commandCenterProvider: ProviderAdapter = {
  id: 'commandcenter-local',
  kind: 'commandcenter',
  priority: 10,
  async detect(): Promise<ProviderRecord> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const [response, voiceResponse] = await Promise.all([
        fetch(`${baseUrl}/agents`, { signal: controller.signal }),
        fetch(`${baseUrl}/voice`, { signal: controller.signal }).catch(() => undefined)
      ]);
      clearTimeout(timeout);

      if (!response.ok) {
        return offline(`HTTP ${response.status} from ${baseUrl}/agents`);
      }

      const body = await response.json() as { ok?: boolean; agents?: CommandCenterAgent[]; primaryAgentId?: string };
      if (!body.ok) return offline('CommandCenter returned ok=false');

      const voiceBody = voiceResponse?.ok ? await voiceResponse.json().catch(() => ({})) as { settings?: CommandCenterVoiceState } : {};
      const voiceSettings = voiceBody.settings || {};
      const voiceProvider = voiceSettings.provider === 'fish' ? 'fish' : voiceSettings.provider === 'elevenlabs' ? 'elevenlabs' : 'commandcenter';

      const agents = (body.agents || []).map((agent) => {
        const id = String(agent.id || agent.label || agent.name || 'unknown');
        const providerVoiceId = voiceProvider === 'fish'
          ? voiceSettings.fishAgentVoices?.[id] || voiceSettings.fishVoiceId
          : voiceProvider === 'elevenlabs'
            ? voiceSettings.elevenlabsAgentVoices?.[id] || voiceSettings.defaultVoiceId
            : agent.voice;
        return ({
        id,
        name: String(agent.name || agent.label || agent.id || 'Unknown agent'),
        label: agent.label,
        model: agent.model,
        source: agent.source || agent.bridge,
        voiceProvider,
        voiceId: String(providerVoiceId || '').trim() || undefined,
        voiceLabel: String(agent.voice || providerVoiceId || '').trim() || undefined,
        voiceAvailable: Boolean(providerVoiceId),
        voiceSettings: { transport: 'commandcenter', inherited: true }
      });
      });

      return {
        id: this.id,
        kind: this.kind,
        name: 'CommandCenter Local API',
        status: 'preferred',
        priority: this.priority,
        endpointLabel: baseUrl,
        notes: `Detected CommandCenter local API. Primary agent: ${body.primaryAgentId || 'unknown'}.`,
        agents,
        capabilities: [
          { id: 'roster', label: 'Roster discovery' },
          { id: 'sessions', label: 'Sessions/history' },
          { id: 'chat', label: 'Chat transport' },
          { id: 'sse', label: 'Turn lifecycle SSE' },
          { id: 'ws', label: 'Ambient WebSocket events' },
          { id: 'files', label: 'Files/attachments' },
          { id: 'voice', label: 'Voice metadata/audio extras' }
        ]
      };
    } catch (error) {
      return offline(error instanceof Error ? error.message : String(error));
    }
  }
};

function offline(error: string): ProviderRecord {
  return {
    id: 'commandcenter-local',
    kind: 'commandcenter',
    name: 'CommandCenter Local API',
    status: 'offline',
    priority: 10,
    endpointLabel: baseUrl,
    capabilities: [
      { id: 'roster', label: 'Roster discovery', planned: true },
      { id: 'sessions', label: 'Sessions/history', planned: true },
      { id: 'chat', label: 'Chat transport', planned: true }
    ],
    agents: [],
    notes: 'CommandCenter local API was not reachable during detection.',
    error
  };
}
