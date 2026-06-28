import type { ProviderAdapter, ProviderRecord } from '../types.js';

const baseUrl = process.env.COMMANDCENTER_LOCAL_API_BASE || 'http://127.0.0.1:3002/commandcenter/api/v1';

interface CommandCenterAgent {
  id?: string;
  name?: string;
  label?: string;
  model?: string;
  source?: string;
  bridge?: string;
}

export const commandCenterProvider: ProviderAdapter = {
  id: 'commandcenter-local',
  kind: 'commandcenter',
  priority: 10,
  async detect(): Promise<ProviderRecord> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(`${baseUrl}/agents`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        return offline(`HTTP ${response.status} from ${baseUrl}/agents`);
      }

      const body = await response.json() as { ok?: boolean; agents?: CommandCenterAgent[]; primaryAgentId?: string };
      if (!body.ok) return offline('CommandCenter returned ok=false');

      const agents = (body.agents || []).map((agent) => ({
        id: String(agent.id || agent.label || agent.name || 'unknown'),
        name: String(agent.name || agent.label || agent.id || 'Unknown agent'),
        label: agent.label,
        model: agent.model,
        source: agent.source || agent.bridge
      }));

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
