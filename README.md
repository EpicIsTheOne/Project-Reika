# Project Reika

Project Reika is the Linux-first agent client shell for **Reika**, the main agent mascot for the app.

This repository intentionally starts with the client shape before real external provider wiring. The goal is to make the app model clean before networking tries to turn it into soup.

## Current phase

**Phase 0: local shell + mock runtime**

Included now:

- Linux-first Vite/React/TypeScript client shell
- Reika as the only active mascot/agent
- modular boundaries for:
  - Device
  - Provider
  - Agent
  - Chat
  - Settings
  - Notification
  - Asset
- mock provider state
- planned CommandCenter provider boundary
- no external provider connection code yet

Not included yet:

- CommandCenter local API connection
- OpenClaw direct connection
- Hermes direct connection
- remote sync
- real WebSocket uplink
- voice
- Live2D / VRM
- Twitch integration
- additional mascots

## Architecture rule

The hierarchy stays clean:

```text
Account -> Device -> Provider -> Agent -> Session -> Message/Event
```

Important boundaries:

- Devices are not providers.
- Providers are not agents.
- CommandCenter can become the preferred rich local provider, but it is not the canonical Project Reika data model.
- The client should normalize provider events into its own internal model.

## Provider priority, later

When external connectivity is planned, the intended discovery/activation priority is:

1. CommandCenter
2. OpenClaw direct
3. Hermes direct
4. Mock/offline

For now, only `mock/offline` exists in code.

## Development

```bash
npm install
npm run dev
npm run build
```

## Design target

Aesthetic direction:

> What if Zenless Zone Zero, Persona, JARVIS, and a visual novel had a baby?

Reika gets the first real vertical slice. Everybody else can wait their turn like civilized chaos gremlins.
