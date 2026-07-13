# Connection Plan

> Historical plan. Use `../../docs/CURRENT_ARCHITECTURE.md` for current behavior and supported boundaries.

Project Reika uses an outbound relay model:

```text
Reika Node  --->  Reika Relay  <---  Main App Client
          outbound WSS 443          outbound WSS 443
```

No port forwarding. No public device IPs. No raw inbound device sockets.

## Current Implementation

Implemented in this repo:

- local device/provider state server in `server/`
- CommandCenter/OpenClaw/Hermes/mock provider detection
- CommandCenter-first active provider selection
- versioned shared `AgentHubEnvelope` protocol
- disabled-by-default outbound relay client
- heartbeat/hello/snapshot senders
- safe command dispatcher
- local `/commands/simulate` endpoint for contract testing
- Phase 1 dev relay in `Relay/`
- Phase 1 client relay UI in `client/`

Still intentionally not implemented:

- production relay deployment
- durable pairing storage
- per-device keypair challenge auth
- chat transport
- shell/file/system commands
- provider mutation

## Shared Protocol

The server's envelope shape:

```ts
interface AgentHubEnvelope<TPayload = unknown> {
  v: 1;
  id: string;
  type: ReikaMessageType;
  timestamp: string;
  source: { kind: "app" | "device" | "relay"; id: string };
  target?: { kind: "app" | "device" | "relay"; id: string };
  replyTo?: string;
  correlationId?: string;
  payload: TPayload;
}
```

Supported message types in this phase:

```text
device.hello
device.heartbeat
device.state.request
device.state.snapshot
device.provider.snapshot
provider.refresh.request
agent.roster.request
agent.roster.snapshot
command.accepted
command.rejected
command.completed
command.failed
```

The Phase 1 relay also accepts the simpler client envelope shape that uses top-level `deviceId`. Long term, all packages should import one shared protocol package instead of carrying compatibility shims.

## Safe Command Scope

Accepted inbound commands:

- `device.state.request` - return current normalized local state
- `provider.refresh.request` - re-run provider detection and return provider snapshot
- `agent.roster.request` - return active provider's visible agent roster

Everything else is rejected with:

```json
{
  "type": "command.rejected",
  "payload": {
    "reason": "UNSUPPORTED_COMMAND"
  }
}
```

## Relay Responsibilities

The Phase 1 dev relay in `Relay/` does:

- create short-lived pairing codes
- let devices claim pairing codes
- let the app approve claimed devices
- accept outbound device WebSockets at `WS /v1/device`
- accept app WebSockets at `WS /v1/app`
- maintain in-memory presence
- store latest provider and roster snapshots
- route only safe request envelopes between app and device
- adapt the app envelope shape to the server envelope shape

The relay does not:

- scan local providers
- execute commands locally
- mutate provider configuration
- route chat
- touch files
- provide shell access

## Device Responsibilities

The device agent should:

- detect local providers
- normalize device/provider/agent state
- connect outbound to relay
- send `device.hello`, `device.heartbeat`, and snapshots
- respond only to safe command envelopes

## Client Responsibilities

The Phase 1 client in `client/` does:

- show paired devices
- show online/offline presence
- request state/provider/agent snapshots
- display provider snapshots
- display active provider
- display agent roster state
- avoid chat/file/system controls until the safe relay foundation works

## Local Phase 1 Flow

```text
1. Start Relay with `cd Relay && npm run dev`.
2. Start client with `cd client && npm run dev`.
3. Create a pairing code in the Devices UI or via `POST /v1/pairing/create`.
4. Claim and approve the device.
5. Start server uplink with `REIKA_UPLINK_ENABLED=true` and `REIKA_PAIRING_TOKEN=<code>`.
6. The Devices UI should show the connected device, providers, active provider, and roster.
```

## Security Staging

Phase 1:

- WS/WSS relay connection
- pairing token/dev auth
- command allowlist
- disabled-by-default server uplink
- in-memory relay state

Phase 2:

- per-device keypair generation
- signed relay challenge
- device revocation
- key rotation
- durable pairing/session storage

Phase 3:

- optional end-to-end encrypted envelopes
- offline delivery/storage policy

## Provider Priority

The device server chooses providers in this order:

1. CommandCenter local API
2. OpenClaw direct
3. Hermes direct
4. Mock/offline

CommandCenter is preferred when installed/running locally because it provides the richest normalized local surface and prevents duplicated provider histories.
