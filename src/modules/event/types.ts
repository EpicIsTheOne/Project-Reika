export type ServerEventType =
  | 'server.boot'
  | 'server.ready'
  | 'device.state'
  | 'provider.state'
  | 'agent.state'
  | 'uplink.planned'
  | 'uplink.disabled'
  | 'uplink.connecting'
  | 'uplink.connected'
  | 'uplink.disconnected'
  | 'uplink.invalid_message'
  | 'uplink.reconnect_scheduled'
  | 'uplink.error';

export interface ServerEvent<T = unknown> {
  id: string;
  type: ServerEventType;
  timestamp: string;
  payload: T;
}
