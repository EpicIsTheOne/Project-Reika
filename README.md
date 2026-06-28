# Project Reika Agent Server

Project Reika Agent Server is the **Linux device-side service** for Reika.

This is not the main visual app client. It is the local agent/device server that will eventually report device/provider/agent state upward to the main app client after that connection contract is planned.

## Current phase

**Phase 0: local device agent server scaffold**

Included now:

- Linux-first Node/TypeScript service scaffold
- Reika as the only represented mascot/agent
- local HTTP status surface for development
- modular boundaries for:
  - Device
  - Provider
  - Agent
  - Event
  - Uplink
- local provider detection for CommandCenter, OpenClaw direct, and Hermes direct
- CommandCenter-first active provider selection
- mock/offline fallback provider state
- explicit planned uplink placeholder
- no chat transport implementation yet
- no external/main app client uplink code yet

## Not included yet

- CommandCenter chat/session adapter
- OpenClaw direct chat/session adapter
- Hermes direct chat adapter
- WebSocket uplink to the main app client
- remote sync
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
- CommandCenter can become the preferred rich local provider later, but Project Reika owns its own normalized state model.
- The future uplink should send normalized state/events to the main app client, not leak raw provider internals everywhere.

## Local development

```bash
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
- `POST /providers/refresh`

These endpoints expose local server/provider state for development. They are not the final external connection contract.

## Provider priority, later

When provider connectivity is planned, intended priority is:

1. CommandCenter
2. OpenClaw direct
3. Hermes direct
4. Mock/offline

Provider detection now exists for CommandCenter, OpenClaw, and Hermes. Chat/session transport is still intentionally deferred.

## Design intent

Reika gets the first real vertical slice. The Linux server should become the boring, reliable local daemon underneath the pretty app. Yes, tragic: the foundation has to be useful before it gets sparkles.
