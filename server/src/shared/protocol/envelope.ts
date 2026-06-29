export type AgentHubEndpointKind = 'app' | 'device' | 'relay';

export interface AgentHubEndpoint {
  kind: AgentHubEndpointKind;
  id: string;
}

export const agentHubEnvelopeTypes = [
  'device.hello',
  'device.heartbeat',
  'device.state.request',
  'device.state.snapshot',
  'device.provider.snapshot',
  'provider.refresh.request',
  'agent.roster.request',
  'agent.roster.snapshot',
  'agent.chat.request',
  'agent.chat.response',
  'command.accepted',
  'command.rejected',
  'command.completed',
  'command.failed'
] as const;

export type AgentHubMessageType = (typeof agentHubEnvelopeTypes)[number];

export interface AgentHubEnvelope<TPayload = unknown> {
  v: 1;
  id: string;
  type: AgentHubMessageType;
  timestamp: string;
  source?: AgentHubEndpoint;
  target?: AgentHubEndpoint;
  accountId?: string;
  deviceId?: string;
  replyTo?: string;
  correlationId?: string;
  commandId?: string;
  payload: TPayload;
}

export function createEnvelope<TPayload>(input: {
  type: AgentHubMessageType;
  source: AgentHubEndpoint;
  target?: AgentHubEndpoint;
  accountId?: string;
  deviceId?: string;
  replyTo?: string;
  correlationId?: string;
  commandId?: string;
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
    && agentHubEnvelopeTypes.includes(maybe.type as AgentHubMessageType)
    && typeof maybe.timestamp === 'string'
    && 'payload' in maybe;
}
