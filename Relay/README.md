# Project Reika Relay

Relay service for pairing, presence, provider snapshots, agent rosters, optional chat envelopes, and safe AgentHub envelope routing.

## Run

```bash
npm install
npm run dev
```

Defaults:

```text
REIKA_RELAY_HOST=127.0.0.1
REIKA_RELAY_PORT=8790
REIKA_RELAY_ACCOUNT_ID=epic-local
REIKA_RELAY_STORE_PATH=%USERPROFILE%\.local\share\project-reika\relay-store.json
REIKA_RELAY_OFFLINE_QUEUE_TTL_MS=900000
REIKA_RELAY_OFFLINE_QUEUE_LIMIT=50
```

## Build

```bash
npm run build
```

This compiles the relay TypeScript package into `dist/`.

## Relay CLI

After building, the relay package includes a small operator CLI:

```bash
npm run relay -- status
npm run relay -- update
npm run relay -- start
npm run relay -- stop
npm run relay -- restart
```

If the package is linked or installed globally, the same commands are available as:

```bash
reika-relay status
reika-relay update
reika-relay start
reika-relay stop
reika-relay restart
```

The CLI assumes a systemd service named `reika-relay` by default. Override it when needed:

```bash
reika-relay status --service project-reika-relay
reika-relay restart --user --service reika-relay
reika-relay status --url https://relay.example.com/v1/health
```

`reika-relay update` runs a conservative update flow from the git checkout:

1. `git fetch origin`
2. `git pull --ff-only origin <current-branch>`
3. `npm install`
4. `npm run build --workspace project-reika-relay`
5. restart the service if it was active before the update

Useful environment defaults:

```text
REIKA_RELAY_SERVICE=reika-relay
REIKA_RELAY_SYSTEMD_MODE=system
REIKA_RELAY_HEALTH_URL=http://127.0.0.1:8790/v1/health
```

## Production Container

```bash
docker build -t project-reika-relay ./Relay
docker run -p 8790:8790 -v reika-relay-data:/data project-reika-relay
```

For production, put the relay behind TLS and expose WebSockets at:

- `wss://<relay-host>/v1/device`
- `wss://<relay-host>/v1/app`

Persist `/data/relay-store.json`. That file contains paired device state, public keys, latest snapshots, and offline queued envelopes.

## Endpoints

- `GET /v1/health`
- `GET /v1/policy`
- `GET /v1/devices`
- `POST /v1/pairing/create`
- `POST /v1/pairing/claim`
- `POST /v1/pairing/approve`
- `POST /v1/device/challenge`
- `POST /v1/devices/:id/revoke`
- `POST /v1/devices/:id/rotate-key`
- `WS /v1/device`
- `WS /v1/app`

## Pairing Flow

1. The app creates a short-lived code with `POST /v1/pairing/create`.
2. A device claims that code with `POST /v1/pairing/claim`.
3. The app approves the claimed device with `POST /v1/pairing/approve`.
4. The device connects outbound to `WS /v1/device` and sends `device.hello`.
5. The app connects to `WS /v1/app` and receives current device state.

The relay persists pairing sessions, approved devices, public keys, provider snapshots, roster snapshots, and offline queued envelopes to `REIKA_RELAY_STORE_PATH`.

## Scope

The relay tracks paired devices, online presence, provider snapshots, and agent rosters, then routes these request envelopes:

- `device.state.request`
- `provider.refresh.request`
- `agent.roster.request`
- `agent.chat.request`

It does not scan local providers, execute shell commands, mutate provider configuration, touch files, or provide shell access. Chat envelopes are routed only to a paired device agent; the relay does not inspect provider internals.

## Security

- Pairing sessions are short-lived and require app approval.
- Approved devices can carry a PEM public key.
- Devices with a stored public key can authenticate reconnects by requesting `/v1/device/challenge` and signing the returned challenge before sending `device.hello`.
- Devices can be revoked with `/v1/devices/:id/revoke`.
- Device public keys can be rotated with `/v1/devices/:id/rotate-key`.
- Envelopes may include an `encrypted` marker. The relay treats encrypted payloads as routing-only data.

## Offline Delivery

When a paired device is offline, the relay queues safe request envelopes for that device up to:

- `REIKA_RELAY_OFFLINE_QUEUE_TTL_MS`
- `REIKA_RELAY_OFFLINE_QUEUE_LIMIT`

Queued envelopes are flushed when the device reconnects. Expired envelopes are dropped.

## Device Compatibility

The relay accepts the simplified Phase 1 client envelope shape:

```ts
{
  v: 1,
  id: string,
  type: string,
  timestamp: string,
  deviceId?: string,
  payload: unknown
}
```

It also adapts Astra's device-server envelope shape:

```ts
{
  v: 1,
  id: string,
  type: string,
  timestamp: string,
  source: { kind: "app" | "device" | "relay"; id: string },
  target?: { kind: "app" | "device" | "relay"; id: string },
  correlationId?: string,
  payload: unknown
}
```

When routing app requests to the device server, the relay injects `source`, `target`, and `correlationId` if the app did not provide them.
