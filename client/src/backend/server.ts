import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { backendConfig } from "./config";
import { getRequestUrl, readJsonBody, sendJson, setCorsHeaders } from "./http";
import { getLocalDeviceRegistration, scanLocalProviders } from "./localDiscovery";
import { AgentHubRegistry, RegistrationError } from "./registry";
import type {
  AgentMessageRequest,
  DeviceAgentClientMessage,
  DeviceAgentServerMessage,
  DeviceRegistrationRequest,
  ProviderSnapshot
} from "../shared/agenthub";

const registry = new AgentHubRegistry();

async function bootstrapLocalDevice() {
  const registration = registry.registerDevice(getLocalDeviceRegistration());
  const snapshot = await scanLocalProviders(registration.device.id);
  registry.upsertProviderSnapshot(snapshot);
  console.log(`[agenthub] Local device registered: ${registration.device.name} (${registration.device.id})`);
}

const server = createServer(async (request, response) => {
  setCorsHeaders(response);
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  try {
    const url = getRequestUrl(request);
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, {
        ok: true,
        service: "agenthub-backend",
        account: registry.getAccount(),
        deviceCount: registry.listDevices().length,
        providerCount: registry.listProviders().length
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/account") {
      sendJson(response, 200, { ok: true, account: registry.getAccount() });
      return;
    }

    if (request.method === "GET" && pathname === "/api/devices") {
      sendJson(response, 200, { ok: true, devices: registry.listDevices() });
      return;
    }

    if (request.method === "GET" && pathname === "/api/providers") {
      sendJson(response, 200, { ok: true, providers: registry.listProviders() });
      return;
    }

    if (request.method === "GET" && pathname === "/api/agents") {
      sendJson(response, 200, { ok: true, agents: registry.listAgents() });
      return;
    }

    if (request.method === "POST" && pathname === "/api/pairing-codes") {
      const body = await readJsonBody<{ accountId?: string; ttlMs?: number }>(request);
      const pairingCode = registry.createPairingCode(body.accountId, body.ttlMs);
      sendJson(response, 201, { ok: true, pairingCode });
      return;
    }

    if (request.method === "POST" && pathname === "/api/devices/register") {
      const body = await readJsonBody<DeviceRegistrationRequest>(request);
      const registration = registry.registerDevice(body);
      sendJson(response, 201, registration);
      return;
    }

    if (request.method === "POST" && pathname === "/api/devices/local/scan") {
      const localRegistration = registry.registerDevice(getLocalDeviceRegistration());
      const snapshot = await scanLocalProviders(localRegistration.device.id);
      const device = registry.upsertProviderSnapshot(snapshot);
      sendJson(response, 200, { ok: true, device });
      return;
    }

    const heartbeatMatch = pathname.match(/^\/api\/devices\/([^/]+)\/heartbeat$/);
    if (request.method === "POST" && heartbeatMatch) {
      const deviceId = decodeURIComponent(heartbeatMatch[1]);
      assertDeviceToken(request.headers.authorization, deviceId);
      const body = await readJsonBody<{ providers?: ProviderSnapshot["providers"] }>(request);
      const device = registry.heartbeat(deviceId, body.providers);
      if (!device) {
        sendJson(response, 404, { ok: false, error: "Device not found" });
        return;
      }
      sendJson(response, 200, { ok: true, device });
      return;
    }

    const snapshotMatch = pathname.match(/^\/api\/devices\/([^/]+)\/providers\/snapshot$/);
    if (request.method === "POST" && snapshotMatch) {
      const deviceId = decodeURIComponent(snapshotMatch[1]);
      assertDeviceToken(request.headers.authorization, deviceId);
      const body = await readJsonBody<{ providers: ProviderSnapshot["providers"] }>(request);
      const device = registry.upsertProviderSnapshot({ deviceId, providers: body.providers });
      if (!device) {
        sendJson(response, 404, { ok: false, error: "Device not found" });
        return;
      }
      sendJson(response, 200, { ok: true, device });
      return;
    }

    const agentMessageMatch = pathname.match(/^\/api\/agents\/([^/]+)\/messages$/);
    if (request.method === "POST" && agentMessageMatch) {
      const agentId = decodeURIComponent(agentMessageMatch[1]);
      const body = await readJsonBody<AgentMessageRequest>(request);
      const context = registry.findAgentContext(agentId);
      if (!context) {
        sendJson(response, 404, { ok: false, error: "Agent not found" });
        return;
      }

      sendJson(response, 202, {
        ok: false,
        agentId,
        providerId: context.provider.id,
        deviceId: context.device.id,
        status: context.provider.status,
        error: `Message transport for ${context.provider.name} is registered, but not wired yet.`,
        received: body.message
      });
      return;
    }

    sendJson(response, 404, { ok: false, error: "Route not found" });
  } catch (error) {
    if (error instanceof RegistrationError) {
      sendJson(response, error.statusCode, { ok: false, error: error.message });
      return;
    }

    if (error instanceof SyntaxError) {
      sendJson(response, 400, { ok: false, error: "Invalid JSON body" });
      return;
    }

    sendJson(response, 500, { ok: false, error: String(error) });
  }
});

const deviceAgentSocket = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const url = getRequestUrl(request);
  if (url.pathname !== "/ws/device-agent") {
    socket.destroy();
    return;
  }

  deviceAgentSocket.handleUpgrade(request, socket, head, (ws) => {
    deviceAgentSocket.emit("connection", ws, request);
  });
});

deviceAgentSocket.on("connection", (socket) => {
  let registeredDeviceId: string | null = null;

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as DeviceAgentClientMessage;

      if (message.type === "hello") {
        const registration = registry.registerDevice(message.request);
        registeredDeviceId = registration.device.id;
        sendSocket(socket, { type: "registered", response: registration });
        return;
      }

      if (!registeredDeviceId) {
        sendSocket(socket, { type: "error", error: "Device agent must register before sending updates." });
        return;
      }

      if (message.type === "provider-snapshot") {
        if (message.snapshot.deviceId !== registeredDeviceId) {
          sendSocket(socket, { type: "error", error: "Provider snapshot deviceId does not match registered device." });
          return;
        }
        registry.upsertProviderSnapshot(message.snapshot);
        sendSocket(socket, { type: "ack", ok: true, at: new Date().toISOString() });
        return;
      }

      if (message.type === "heartbeat") {
        if (message.deviceId !== registeredDeviceId) {
          sendSocket(socket, { type: "error", error: "Heartbeat deviceId does not match registered device." });
          return;
        }
        registry.heartbeat(message.deviceId, message.providers);
        sendSocket(socket, { type: "ack", ok: true, at: new Date().toISOString() });
      }
    } catch (error) {
      sendSocket(socket, { type: "error", error: String(error) });
    }
  });
});

function assertDeviceToken(authorization: string | undefined, deviceId: string) {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!registry.validateDeviceToken(deviceId, token)) {
    throw new RegistrationError("Device token is required for this device update.");
  }
}

function sendSocket(socket: WebSocket, message: DeviceAgentServerMessage) {
  socket.send(JSON.stringify(message));
}

bootstrapLocalDevice()
  .then(() => {
    server.listen(backendConfig.port, backendConfig.host, () => {
      console.log(`[agenthub] Backend listening at http://${backendConfig.host}:${backendConfig.port}`);
    });
  })
  .catch((error) => {
    console.error(`[agenthub] Failed to start backend: ${String(error)}`);
    process.exitCode = 1;
  });
