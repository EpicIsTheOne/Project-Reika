# Shared Reika Contract

This folder is the canonical protocol/model reference for Project Reika Phase 1.

Current implementation folders still compile independently:

```text
server/
client/
Relay/
```

But protocol changes should be made here first, then mirrored into the implementation folders until the repo graduates to a real workspace/package setup.

Canonical files:

```text
shared/agenthub.ts
shared/protocol/index.ts
```

Phase 1 message scope stays intentionally narrow:

- `device.hello`
- `device.heartbeat`
- `device.state.request`
- `device.state.snapshot`
- `device.provider.snapshot`
- `provider.refresh.request`
- `agent.roster.request`
- `agent.roster.snapshot`
- `command.accepted`
- `command.rejected`
- `command.completed`
- `command.failed`

No chat transport, shell commands, file operations, provider mutation, or remote service control in this phase.
