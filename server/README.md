# Project Reika Agent Server

Project Reika Agent Server is the **device-side service** for Reika.

This is not the main visual app client. It is the local agent/device server that reports device/provider/agent state upward once a relay contract exists.

## Current phase

**Phase 1: local device agent server + safe uplink skeleton**

Included now:

- Node/TypeScript device-agent service scaffold
- Reika as the represented mascot/agent fallback
- local HTTP status surface for development
- modular boundaries for Device, Provider, Agent, Event, Commands, Uplink, and shared protocol
- local provider detection for CommandCenter, OpenClaw direct, and Hermes direct
- CommandCenter-first active provider selection
- mock/offline fallback provider state
- versioned shared `AgentHubEnvelope` protocol
- disabled-by-default outbound relay client skeleton
- safe command dispatcher for read-only/provider-refresh commands
- no chat transport implementation yet
- no external uplink enabled by default

## Not included yet

- CommandCenter chat/session adapter
- OpenClaw direct chat/session adapter
- Hermes direct chat adapter
- production relay/pairing credentials
- per-device keypair challenge auth
- remote sync persistence
- real chat/session transport
- voice
- UI/client screens
- Live2D / VRM
- Twitch integration
- additional mascots

## Architecture rule

The hierarchy stays clean:

```text
Account -> Device -> Provider -> Agent -> Session -> Message/Event
```

Important boundaries:

- This repo is the **device agent server**, not the app client.
- Devices are not providers.
- Providers are not agents.
- CommandCenter is the preferred rich local provider when available.
- Project Reika owns normalized state and protocol envelopes.
- The relay should route envelopes; it should not scan providers or execute local work.
- The device agent executes only explicitly supported safe commands.

## Local development

```bash
cd server
npm install
npm run build
npm run dev
```

Default local server:

```text
http://127.0.0.1:47840
```

Development endpoints:

- `GET /health`
- `GET /state`
- `GET /events`
- `GET /providers`
- `GET /uplink`
- `POST /providers/refresh`
- `POST /commands/simulate`

These endpoints expose local server/provider/uplink state for development. They are not the final external connection contract.

## Uplink config

Outbound relay mode is disabled by default.

```env
REIKA_UPLINK_ENABLED=false
REIKA_RELAY_URL=wss://relay.techexplore.us/v1/device
REIKA_DEVICE_ID=linux-device-local
REIKA_DEVICE_KEY_PATH=
REIKA_PAIRING_TOKEN=
REIKA_HEARTBEAT_MS=25000
REIKA_RECONNECT_MIN_MS=1000
REIKA_RECONNECT_MAX_MS=30000
```

When enabled, the server connects outward to the relay over WSS and sends:

- `device.hello`
- `device.heartbeat`
- `device.state.snapshot`
- `device.provider.snapshot`
- `agent.roster.snapshot`

## Supported command envelopes

The current command dispatcher only supports:

- `device.state.request`
- `provider.refresh.request`
- `agent.roster.request`

Unsupported messages return `command.rejected` with `UNSUPPORTED_COMMAND`.

Intentionally unsupported in this phase:

- shell execution
- arbitrary file access
- process/service control
- provider mutation
- agent install/update
- chat transport

No cute remote-admin malware. We are behaving, unfortunately.

## Provider priority

Active-provider priority is:

1. CommandCenter local API
2. OpenClaw direct
3. Hermes direct
4. Mock/offline

Provider detection exists for CommandCenter, OpenClaw, and Hermes. Chat/session transport is still intentionally deferred.

## Design intent

Reika gets the first real vertical slice. The server should become the boring, reliable local daemon underneath the pretty app. Yes, tragic: the foundation has to be useful before it gets sparkles.
