export interface LocalAgentStartupStatus {
  supported: boolean;
  enabled: boolean;
  method: string;
  command?: string;
  configPath?: string;
  message?: string;
}

export interface LocalAgentStartupOptions {
  relayUrl?: string;
  deviceId?: string;
}

interface StartupResponse {
  ok: boolean;
  startup: LocalAgentStartupStatus;
}

export async function getLocalAgentStartup() {
  const response = await fetch('/agent/startup');
  if (!response.ok) throw new Error(`Local agent startup status failed: ${response.status}`);
  const body = (await response.json()) as StartupResponse;
  return body.startup;
}

export async function setLocalAgentStartup(enabled: boolean, options: LocalAgentStartupOptions = {}) {
  const response = await fetch(enabled ? '/agent/startup/enable' : '/agent/startup/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options)
  });
  if (!response.ok) throw new Error(`Local agent startup update failed: ${response.status}`);
  const body = (await response.json()) as StartupResponse;
  return body.startup;
}
