export interface PresenceRecord {
  id: string;
}

export function mergeLocalAndRelayPresence<T extends PresenceRecord>(local: T[], relay: T[]) {
  const localIds = new Set(local.map((record) => record.id));
  return [...local, ...relay.filter((record) => !localIds.has(record.id))];
}

export function excludeLocallyObservedRelayRecords<T extends { device: PresenceRecord }>(local: PresenceRecord[], relay: T[]) {
  const localIds = new Set(local.map((record) => record.id));
  return relay.filter((record) => !localIds.has(record.device.id));
}
