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
- mock/offline provider state
- explicit planned uplink placeholder
- no external provider connection code yet
- no main app client connection code yet

## Not included yet

- CommandCenter local API adapter
- OpenClaw direct adapter
- Hermes direct adapter
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

These endpoints expose mock local state only. They are not the final external connection contract.

## Provider priority, later

When provider connectivity is planned, intended priority is:

1. CommandCenter
2. OpenClaw direct
3. Hermes direct
4. Mock/offline

For now, only `mock/offline` exists in code.

## Design intent

Reika gets the first real vertical slice. The Linux server should become the boring, reliable local daemon underneath the pretty app. Yes, tragic: the foundation has to be useful before it gets sparkles.
