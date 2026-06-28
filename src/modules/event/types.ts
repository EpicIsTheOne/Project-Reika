export type ServerEventType =
  | 'server.boot'
  | 'server.ready'
  | 'device.state'
  | 'provider.state'
  | 'agent.state'
  | 'uplink.planned';

export interface ServerEvent<T = unknown> {
  id: string;
  type: ServerEventType;
  timestamp: string;
  payload: T;
}
