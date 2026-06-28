export interface PlannedUplinkContract {
  enabled: false;
  direction: 'device-server-to-main-app-client';
  transport: 'planned-websocket-or-local-bridge';
  note: string;
}

export const plannedUplink: PlannedUplinkContract = {
  enabled: false,
  direction: 'device-server-to-main-app-client',
  transport: 'planned-websocket-or-local-bridge',
  note: 'Placeholder only. Do not implement external connection behavior until the contract is planned.'
};
