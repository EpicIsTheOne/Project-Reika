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

## Endpoints

- `GET /v1/health`
- `POST /v1/pairing/create`
- `POST /v1/pairing/claim`
- `POST /v1/pairing/approve`
- `WS /v1/device`
- `WS /v1/app`

## Scope

The relay keeps all state in memory for dev mode. It tracks paired devices, online presence, provider snapshots, and agent rosters, then routes only these safe request envelopes:

- `device.state.request`
- `provider.refresh.request`
- `agent.roster.request`

It does not scan local providers, execute commands, mutate provider configuration, transport chat, touch files, or provide shell access.
