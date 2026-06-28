import { createHash } from "node:crypto";
import { arch, hostname, platform } from "node:os";
import { backendConfig } from "./config";
import { CommandCenterProviderAdapter } from "./adapters/commandCenter";
import { HermesProviderAdapter } from "./adapters/hermes";
import { MockProviderAdapter } from "./adapters/mock";
import type { DeviceRegistrationRequest, DeviceType, ProviderSnapshot } from "../shared/agenthub";

export function getLocalDeviceRegistration(): DeviceRegistrationRequest {
  const name = process.env.AGENTHUB_DEVICE_NAME ?? hostname();
  return {
    accountId: backendConfig.accountId,
    name,
    type: getDeviceType(),
    fingerprint: getLocalFingerprint(),
    agentVersion: backendConfig.agentVersion,
    location: "local"
  };
}

export function getLocalFingerprint() {
  return createHash("sha256")
    .update([hostname(), platform(), arch(), process.env.USERNAME ?? process.env.USER ?? ""].join("|"))
    .digest("hex");
}

export async function scanLocalProviders(deviceId: string): Promise<ProviderSnapshot> {
  const adapters = [
    ...(backendConfig.includeMockProvider ? [new MockProviderAdapter()] : []),
    new HermesProviderAdapter(backendConfig.hermesBaseUrl),
    new CommandCenterProviderAdapter(backendConfig.commandCenterBaseUrl)
  ];

  const providers = await Promise.all(adapters.map((adapter) => adapter.probe(deviceId)));
  return { deviceId, providers };
}

function getDeviceType(): DeviceType {
  if (platform() === "win32") return "pc";
  if (platform() === "linux") return "server";
  if (platform() === "darwin") return "laptop";
  return "unknown";
}
