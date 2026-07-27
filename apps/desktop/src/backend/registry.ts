import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { backendConfig } from "./config";
import { slug } from "./adapters/common";
import type {
  AgentHubAccount,
  AgentHubAgent,
  AgentHubDevice,
  AgentHubProvider,
  DeviceRegistrationRequest,
  DeviceRegistrationResponse,
  PairingCode,
  ProviderSnapshot
} from "../shared/agenthub";

interface PersistedDeviceToken {
  tokenHash: string;
  accountId: string;
  deviceId: string;
  fingerprint: string;
  createdAt: string;
  lastUsedAt: string;
}

interface PersistedRegistry {
  accounts: AgentHubAccount[];
  devices: AgentHubDevice[];
  deviceTokens: PersistedDeviceToken[];
}

export class RegistrationError extends Error {
  statusCode = 401;
}

export class AgentHubRegistry {
  private readonly accounts = new Map<string, AgentHubAccount>();
  private readonly devices = new Map<string, AgentHubDevice>();
  private readonly deviceTokens = new Map<string, PersistedDeviceToken>();
  private readonly pairingCodes = new Map<string, PairingCode>();

  constructor(private readonly storagePath = backendConfig.registryPath) {
    this.load();
    this.ensureAccount(backendConfig.accountId);
  }

  getAccount(accountId = backendConfig.accountId) {
    return this.ensureAccount(accountId);
  }

  listDevices() {
    return [...this.devices.values()]
      .map((device) => clone(device))
      .sort((a, b) => locationRank(a.location) - locationRank(b.location) || a.name.localeCompare(b.name));
  }

  listProviders() {
    return this.listDevices().flatMap((device) => device.providers);
  }

  listAgents() {
    return this.listProviders().flatMap((provider) => provider.agents);
  }

  createPairingCode(accountId = backendConfig.accountId, ttlMs = 10 * 60 * 1000): PairingCode {
    const account = this.ensureAccount(accountId);
    const code = `${randomBytes(2).toString("hex")}-${randomBytes(2).toString("hex")}`.toUpperCase();
    const pairingCode = {
      code,
      accountId: account.id,
      expiresAt: new Date(Date.now() + ttlMs).toISOString()
    };
    this.pairingCodes.set(code, pairingCode);
    return clone(pairingCode);
  }

  registerDevice(request: DeviceRegistrationRequest): DeviceRegistrationResponse {
    const now = new Date().toISOString();
    const requestedAccountId = request.accountId ?? backendConfig.accountId;
    const account = this.ensureAccount(requestedAccountId);
    const existingByToken = this.findDeviceByToken(request.deviceToken, request.fingerprint, now);
    const existingByFingerprint = this.findDeviceByFingerprint(account.id, request.fingerprint);
    const claimedPairing = request.pairingCode ? this.claimPairingCode(request.pairingCode, now) : null;
    const localBootstrapAllowed =
      backendConfig.allowLocalBootstrap &&
      (request.location ?? "remote") === "local" &&
      (request.accountId === undefined || request.accountId === backendConfig.accountId);

    if (!existingByToken && !claimedPairing && !localBootstrapAllowed) {
      throw new RegistrationError("Device registration requires a valid pairing code or device token.");
    }

    const deviceId = existingByToken?.deviceId ?? existingByFingerprint?.id ?? makeDeviceId(request.name, request.fingerprint);
    const existingDevice = this.devices.get(deviceId);
    const device: AgentHubDevice = {
      id: deviceId,
      accountId: claimedPairing?.accountId ?? account.id,
      name: request.name,
      type: request.type,
      status: "online",
      location: existingDevice?.location ?? request.location ?? "remote",
      agentVersion: request.agentVersion,
      fingerprint: request.fingerprint,
      trusted: true,
      lastSeenAt: now,
      providers: existingDevice?.providers ?? []
    };

    this.devices.set(device.id, device);
    let deviceToken: string | undefined;

    if (!existingByToken && (!existingByFingerprint || Boolean(claimedPairing))) {
      deviceToken = randomBytes(32).toString("base64url");
      this.deviceTokens.set(hashToken(deviceToken), {
        tokenHash: hashToken(deviceToken),
        accountId: device.accountId,
        deviceId: device.id,
        fingerprint: device.fingerprint,
        createdAt: now,
        lastUsedAt: now
      });
    }

    this.save();
    return {
      ok: true,
      account: clone(account),
      device: clone(device),
      deviceToken
    };
  }

  validateDeviceToken(deviceId: string, token: string | undefined) {
    if (!token) return false;
    const tokenRecord = this.deviceTokens.get(hashToken(token));
    if (!tokenRecord || tokenRecord.deviceId !== deviceId) return false;
    tokenRecord.lastUsedAt = new Date().toISOString();
    this.save();
    return true;
  }

  heartbeat(deviceId: string, providers?: ProviderSnapshot["providers"]) {
    const device = this.devices.get(deviceId);
    if (!device) return null;

    device.status = "online";
    device.lastSeenAt = new Date().toISOString();
    if (providers) this.upsertProviderSnapshot({ deviceId, providers });
    else this.save();
    return clone(device);
  }

  upsertProviderSnapshot(snapshot: ProviderSnapshot) {
    const device = this.devices.get(snapshot.deviceId);
    if (!device) return null;

    const now = new Date().toISOString();
    device.status = "online";
    device.lastSeenAt = now;
    device.providers = snapshot.providers.map((provider) => {
      const providerId = provider.id ?? `${device.id}-${slug(provider.kind)}`;
      const normalizedProvider: AgentHubProvider = {
        id: providerId,
        deviceId: device.id,
        kind: provider.kind,
        name: provider.name,
        status: provider.status,
        endpoint: provider.endpoint,
        version: provider.version,
        lastSeenAt: now,
        capabilities: provider.capabilities,
        agents: provider.agents.map((agent) => normalizeAgent(device.id, providerId, agent, now, provider.capabilities)),
        error: provider.error,
        remote: device.location !== "local"
      };
      return normalizedProvider;
    });

    this.devices.set(device.id, device);
    this.save();
    return clone(device);
  }

  findAgentContext(agentId: string) {
    for (const device of this.devices.values()) {
      for (const provider of device.providers) {
        const agent = provider.agents.find((candidate) => candidate.id === agentId);
        if (agent) return { device: clone(device), provider: clone(provider), agent: clone(agent) };
      }
    }
    return null;
  }

  private ensureAccount(accountId: string): AgentHubAccount {
    const existing = this.accounts.get(accountId);
    if (existing) return existing;

    const account = {
      id: accountId,
      displayName: accountId === backendConfig.accountId ? backendConfig.accountName : accountId,
      createdAt: new Date().toISOString()
    };
    this.accounts.set(account.id, account);
    this.save();
    return account;
  }

  private findDeviceByFingerprint(accountId: string, fingerprint: string) {
    return [...this.devices.values()].find(
      (device) => device.accountId === accountId && device.fingerprint === fingerprint
    );
  }

  private findDeviceByToken(deviceToken: string | undefined, fingerprint: string, now: string) {
    if (!deviceToken) return null;
    const token = this.deviceTokens.get(hashToken(deviceToken));
    if (!token || token.fingerprint !== fingerprint) return null;
    token.lastUsedAt = now;
    return token;
  }

  private claimPairingCode(code: string, now: string) {
    const normalized = code.trim().toUpperCase();
    const pairingCode = this.pairingCodes.get(normalized);
    if (!pairingCode || pairingCode.claimedAt || Date.parse(pairingCode.expiresAt) < Date.now()) return null;
    pairingCode.claimedAt = now;
    return pairingCode;
  }

  private load() {
    if (!existsSync(this.storagePath)) return;

    try {
      const snapshot = JSON.parse(readFileSync(this.storagePath, "utf8")) as PersistedRegistry;
      for (const account of snapshot.accounts ?? []) this.accounts.set(account.id, account);
      for (const device of snapshot.devices ?? []) this.devices.set(device.id, device);
      for (const token of snapshot.deviceTokens ?? []) this.deviceTokens.set(token.tokenHash, token);
    } catch (error) {
      console.warn(`[reika] Registry load failed: ${String(error)}`);
    }
  }

  private save() {
    const snapshot: PersistedRegistry = {
      accounts: [...this.accounts.values()],
      devices: [...this.devices.values()],
      deviceTokens: [...this.deviceTokens.values()]
    };

    mkdirSync(dirname(this.storagePath), { recursive: true });
    writeFileSync(this.storagePath, JSON.stringify(snapshot, null, 2));
  }
}

function normalizeAgent(
  deviceId: string,
  providerId: string,
  agent: ProviderSnapshot["providers"][number]["agents"][number],
  now: string,
  providerCapabilities: AgentHubProvider["capabilities"]
): AgentHubAgent {
  const id = agent.id ?? `${providerId}-${slug(agent.name)}`;
  return {
    id,
    providerId,
    deviceId,
    name: agent.name,
    role: agent.role,
    status: agent.status,
    characterId: agent.characterId,
    avatar: agent.avatar,
    lastActivity: agent.lastActivity ?? "Discovered by device agent",
    capabilities: agent.capabilities ?? providerCapabilities,
    updatedAt: now
  };
}

function makeDeviceId(name: string, fingerprint: string) {
  const suffix = createHash("sha256").update(fingerprint).digest("hex").slice(0, 8);
  return `${slug(name) || "device"}-${suffix}`;
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function locationRank(location: AgentHubDevice["location"]) {
  if (location === "local") return 0;
  if (location === "lan") return 1;
  return 2;
}
