export const deviceAgentCapabilities = [
  'device.state.read',
  'provider.refresh',
  'provider.snapshot.read',
  'agent.roster.read'
] as const;

export type DeviceAgentCapability = typeof deviceAgentCapabilities[number];

export const intentionallyUnsupportedCapabilities = [
  'shell.exec',
  'filesystem.read.local',
  'filesystem.write.local',
  'process.control',
  'system.service.restart',
  'provider.configure',
  'agent.install',
  'chat.transport'
] as const;
