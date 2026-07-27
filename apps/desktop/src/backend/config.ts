import { join } from "node:path";
import { existsSync } from "node:fs";

const reikaRegistryPath = join(process.cwd(), ".reika", "registry.json");
const legacyRegistryPath = join(process.cwd(), ".agenthub", "registry.json");
const defaultRegistryPath = existsSync(reikaRegistryPath) || !existsSync(legacyRegistryPath) ? reikaRegistryPath : legacyRegistryPath;

export const backendConfig = {
  host: process.env.REIKA_HOST ?? process.env.AGENTHUB_HOST ?? "127.0.0.1",
  port: Number(process.env.REIKA_PORT ?? process.env.AGENTHUB_PORT ?? 8787),
  accountId: process.env.REIKA_ACCOUNT_ID ?? process.env.AGENTHUB_ACCOUNT_ID ?? "epic-local",
  accountName: process.env.REIKA_ACCOUNT_NAME ?? process.env.AGENTHUB_ACCOUNT_NAME ?? "Epic",
  agentVersion: process.env.REIKA_NODE_VERSION ?? process.env.AGENTHUB_AGENT_VERSION ?? "0.1.0",
  allowLocalBootstrap: (process.env.REIKA_ALLOW_LOCAL_BOOTSTRAP ?? process.env.AGENTHUB_ALLOW_LOCAL_BOOTSTRAP) !== "false",
  includeMockProvider: (process.env.REIKA_INCLUDE_MOCK_PROVIDER ?? process.env.AGENTHUB_INCLUDE_MOCK_PROVIDER) !== "false",
  hermesBaseUrl: process.env.HERMES_BASE_URL ?? process.env.REIKA_HERMES_URL ?? process.env.AGENTHUB_HERMES_URL ?? "",
  commandCenterBaseUrl:
    process.env.COMMANDCENTER_BASE_URL ??
    process.env.REIKA_COMMANDCENTER_URL ??
    process.env.AGENTHUB_COMMANDCENTER_URL ??
    "",
  registryPath:
    process.env.REIKA_REGISTRY_PATH ??
    process.env.AGENTHUB_REGISTRY_PATH ??
    defaultRegistryPath
};
