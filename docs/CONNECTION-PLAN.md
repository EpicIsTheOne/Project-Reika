# Connection Plan

Project Reika uses an outbound relay model:

```text
Device Agent Server  --->  Reika Relay  <---  Main App Client
          outbound WSS 443          outbound WSS 443
```

No port forwarding. No public device IPs. No raw inbound device sockets.

## Current server-side implementation

Implemented in this repo:

- local device/provider state server
- CommandCenter/OpenClaw/Hermes/mock provider detection
- CommandCenter-first active provider selection
- versioned shared `AgentHubEnvelope` protocol
- disabled-by-default outbound relay client skeleton
- heartbeat/hello/snapshot senders
- safe command dispatcher
- local `/commands/simulate` endpoint for contract testing before the relay exists

Still intentionally not implemented:

- production relay service
- pairing storage
- per-device keypair challenge auth
- chat transport
- shell/file/system commands
- provider mutation

## Shared protocol

Envelope shape:

```ts
interface AgentHubEnvelope<TPayload = unknown> {
  v: 1;
  id: string;
  type: AgentHubMessageType;
  timestamp: string;
  source: { kind: 'app' | 'device' | 'relay'; id: string };
  target?: { kind: 'app' | 'device' | 'relay'; id: string };
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

## Safe command scope

Accepted inbound commands:

- `device.state.request` — return current normalized local state
- `provider.refresh.request` — re-run provider detection and return provider snapshot
- `agent.roster.request` — return active provider's visible agent roster

Everything else is rejected with:

```json
{
  "type": "command.rejected",
  "payload": {
    "reason": "UNSUPPORTED_COMMAND"
  }
}
```

## Relay responsibilities

The relay should:

- pair devices
- authenticate app/device sockets
- maintain presence
- route envelopes between app and device
- enforce account/device boundaries

The relay should not:

- scan local providers
- execute commands locally
- mutate provider configuration
- become a generic remote shell

## Device responsibilities

The device agent should:

- detect local providers
- normalize device/provider/agent state
- connect outbound to relay
- send `device.hello`, `device.heartbeat`, and snapshots
- respond only to safe command envelopes

## Client responsibilities

The app/client should:

- show paired devices
- show online/offline presence
- request state/provider/agent snapshots
- display provider and agent roster state
- avoid chat/file/system controls until the safe relay foundation works

## Security staging

Phase 1:

- WSS/TLS
- pairing token/dev auth
- command allowlist
- disabled-by-default server uplink

Phase 2:

- per-device keypair generation
- signed relay challenge
- device revocation
- key rotation

Phase 3:

- optional end-to-end encrypted envelopes
- offline delivery/storage policy

## Provider priority

The device server chooses providers in this order:

1. CommandCenter local API
2. OpenClaw direct
3. Hermes direct
4. Mock/offline

CommandCenter is preferred when installed/running locally because it provides the richest normalized local surface and prevents duplicated provider histories.
