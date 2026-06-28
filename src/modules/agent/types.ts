export type AgentMood = 'ready' | 'thinking' | 'idle' | 'offline';

export interface AgentSummary {
  id: string;
  name: string;
  callsign: string;
  role: string;
  mood: AgentMood;
  providerId: string;
  accent: string;
  isMascot?: boolean;
}
