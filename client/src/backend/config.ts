import { join } from "node:path";

export const backendConfig = {
  host: process.env.AGENTHUB_HOST ?? "127.0.0.1",
  port: Number(process.env.AGENTHUB_PORT ?? 8787),
  accountId: process.env.AGENTHUB_ACCOUNT_ID ?? "epic-local",
  accountName: process.env.AGENTHUB_ACCOUNT_NAME ?? "Epic",
  agentVersion: process.env.AGENTHUB_AGENT_VERSION ?? "0.1.0",
  allowLocalBootstrap: process.env.AGENTHUB_ALLOW_LOCAL_BOOTSTRAP !== "false",
  includeMockProvider: process.env.AGENTHUB_INCLUDE_MOCK_PROVIDER !== "false",
  hermesBaseUrl: process.env.HERMES_BASE_URL ?? process.env.AGENTHUB_HERMES_URL ?? "",
  commandCenterBaseUrl:
    process.env.COMMANDCENTER_BASE_URL ??
    process.env.AGENTHUB_COMMANDCENTER_URL ??
    "",
  registryPath:
    process.env.AGENTHUB_REGISTRY_PATH ??
    join(process.cwd(), ".agenthub", "registry.json")
};
