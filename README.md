# Project Reika

Project Reika is the workspace for Reika's multi-device AgentHub system.

This repo is intentionally split into clear lanes so Astra and Codex can work in parallel without turning the architecture into soup.

## Folders

```text
server/  Device-side agent server owned by Astra's current work
client/  Main app/client workspace for Codex
Relay/   Relay service workspace for Codex
```

## Current status

### `server/`

Implemented and pushed:

- device-agent server scaffold
- local provider detection for CommandCenter, OpenClaw direct, Hermes direct, and mock fallback
- CommandCenter-first provider priority
- versioned `AgentHubEnvelope` protocol
- safe command dispatcher
- disabled-by-default outbound WSS relay/uplink skeleton
- local development endpoints for health/state/providers/uplink/events

See:

```text
server/README.md
server/docs/CONNECTION-PLAN.md
```

### `client/`

Reserved for the main app/client implementation.

Codex should save client-side work here.

### `Relay/`

Reserved for the tiny relay service implementation.

Codex should save relay-side work here.

## Architecture summary

```text
Device Agent Server  --->  Reika Relay  <---  Main App Client
          outbound WSS 443          outbound WSS 443
```

No port forwarding. No public device IPs. No generic remote shell. Keep command scope narrow until presence, pairing, and state sync are boringly reliable.
