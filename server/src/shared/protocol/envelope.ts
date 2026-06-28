export type AgentHubEndpointKind = 'app' | 'device' | 'relay';

export interface AgentHubEndpoint {
  kind: AgentHubEndpointKind;
  id: string;
}

export type AgentHubMessageType =
  | 'device.hello'
  | 'device.heartbeat'
  | 'device.state.request'
  | 'device.state.snapshot'
  | 'device.provider.snapshot'
  | 'provider.refresh.request'
  | 'agent.roster.request'
  | 'agent.roster.snapshot'
  | 'command.accepted'
  | 'command.rejected'
  | 'command.completed'
  | 'command.failed';

export interface AgentHubEnvelope<TPayload = unknown> {
  v: 1;
  id: string;
  type: AgentHubMessageType;
  timestamp: string;
  source: AgentHubEndpoint;
  target?: AgentHubEndpoint;
  replyTo?: string;
  correlationId?: string;
  payload: TPayload;
}

export function createEnvelope<TPayload>(input: {
  type: AgentHubMessageType;
  source: AgentHubEndpoint;
  target?: AgentHubEndpoint;
  replyTo?: string;
  correlationId?: string;
  payload: TPayload;
}): AgentHubEnvelope<TPayload> {
  return {
    v: 1,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...input
  };
}

export function isAgentHubEnvelope(value: unknown): value is AgentHubEnvelope {
  if (!value || typeof value !== 'object') return false;
  const maybe = value as Partial<AgentHubEnvelope>;
  return maybe.v === 1
    && typeof maybe.id === 'string'
    && typeof maybe.type === 'string'
    && typeof maybe.timestamp === 'string'
    && !!maybe.source
    && typeof maybe.source === 'object'
    && typeof maybe.source.id === 'string';
}
