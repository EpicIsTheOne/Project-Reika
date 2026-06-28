export type AgentState = 'ready' | 'thinking' | 'responding' | 'idle' | 'offline';

export interface AgentRecord {
  id: string;
  name: string;
  callsign: string;
  role: string;
  state: AgentState;
  providerId: string;
  isMascot: boolean;
}
