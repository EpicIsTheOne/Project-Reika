# Project Reika Relay

Tiny dev relay for pairing, presence, provider snapshots, and safe AgentHub envelope routing.

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
```

## Build

```bash
npm run build
```

This compiles the relay TypeScript package into `dist/`.

## Endpoints

- `GET /v1/health`
- `POST /v1/pairing/create`
- `POST /v1/pairing/claim`
- `POST /v1/pairing/approve`
- `WS /v1/device`
- `WS /v1/app`

## Pairing Flow

1. The app creates a short-lived code with `POST /v1/pairing/create`.
2. A device claims that code with `POST /v1/pairing/claim`.
3. The app approves the claimed device with `POST /v1/pairing/approve`.
4. The device connects outbound to `WS /v1/device` and sends `device.hello`.
5. The app connects to `WS /v1/app` and receives current device state.

The relay currently stores pairing sessions, approved devices, sockets, provider snapshots, and roster snapshots in memory. Restarting the relay clears all of it.

## Scope

The relay tracks paired devices, online presence, provider snapshots, and agent rosters, then routes only these safe request envelopes:

- `device.state.request`
- `provider.refresh.request`
- `agent.roster.request`

It does not scan local providers, execute commands, mutate provider configuration, transport chat, touch files, or provide shell access.

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
