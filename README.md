# Project Reika

Project Reika is the workspace for Reika's multi-device AgentHub system.

The repo is split into clear lanes so Astra and Codex can work in parallel without turning the architecture into soup.

## Folders

```text
server/  Device-side agent server
client/  Main AgentHub app/client
Relay/   Tiny dev relay service
```

## Current Status

Phase 1 has a working vertical slice:

```text
Device Agent Server  --->  Reika Relay  <---  Main App Client
          outbound WS             dev WS/API
```

The relay is still dev-only and in-memory, but the important shape is real: devices call home, the app connects to the relay, and only safe state/provider/roster requests are routed.

### `server/`

Implemented:

- Node/TypeScript device-agent server scaffold
- local provider detection for CommandCenter, OpenClaw direct, Hermes direct, and mock fallback
- CommandCenter-first provider priority
- versioned `AgentHubEnvelope` protocol
- safe command dispatcher
- disabled-by-default outbound relay/uplink client
- local development endpoints for health/state/providers/uplink/events
- tested outbound connection against the dev relay

See:

```text
server/README.md
server/docs/CONNECTION-PLAN.md
```

### `client/`

Implemented:

- Vite + React AgentHub UI
- generated/local Reika and AgentHub visual assets
- local/dev app backend for provider scanning
- Devices page relay integration
- pairing UI skeleton
- relay-backed device presence, provider snapshots, active provider, and agent roster display
- safe controls only: request state, refresh providers, request agent roster

### `Relay/`

Implemented:

- standalone TypeScript relay package
- in-memory dev pairing flow
- `POST /v1/pairing/create`
- `POST /v1/pairing/claim`
- `POST /v1/pairing/approve`
- `WS /v1/device`
- `WS /v1/app`
- device presence tracking
- safe envelope routing between app and device
- compatibility shim for the client envelope shape and Astra's server envelope shape

## Local Development

Install dependencies once in each lane:

```bash
cd Relay && npm install
cd ../server && npm install
cd ../client && npm install
```

Start the relay:

```bash
cd Relay
npm run dev
```

Start the device server without uplink for local inspection:

```bash
cd server
npm run dev
```

Start the client UI:

```bash
cd client
npm run dev
```

Default local URLs:

```text
client UI:       http://127.0.0.1:5173
client backend:  http://127.0.0.1:8787
relay:           http://127.0.0.1:8790
device server:   http://127.0.0.1:47840
```

To connect the device server through the relay, create/claim/approve a pairing code through the relay and run the server with:

```env
REIKA_UPLINK_ENABLED=true
REIKA_RELAY_URL=ws://127.0.0.1:8790/v1/device
REIKA_PAIRING_TOKEN=<approved pairing code>
REIKA_DEVICE_ID=linux-device-local
```

## Guardrails

Phase 1 intentionally does not include chat routing, file operations, shell commands, provider mutation, service control, or generic remote administration.

The relay routes allowed envelopes. The device server performs local detection and answers safe requests. Keep command scope narrow until presence, pairing, and state sync are boringly reliable.
