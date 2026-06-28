# Project Reika Client

Main Reika / AgentHub client app.

This folder contains the Vite + React UI, project-local visual assets, local development backend, and app-side relay client.

## Run

```bash
npm install
npm run dev
```

Default UI:

```text
http://127.0.0.1:5173
```

The Vite dev server proxies:

- `/api` to the local/dev app backend on `127.0.0.1:8787`
- `/v1` to the relay on `127.0.0.1:8790`

## Build

```bash
npm run build
```

This runs TypeScript checking and a production Vite build.

## Main Folders

```text
src/App.tsx                  Main visual shell and page views
src/data/relay.ts            App-side relay WebSocket/API client
src/shared/protocol/         Versioned AgentHub envelope helpers
src/backend/                 Local/dev app backend and provider scanner
assets/agenthub_phase1*/     Project-local visual assets
Refrence Docs/               Source planning/reference docs
```

## Relay Phase 1 Scope

The Devices UI can show relay-backed paired devices, provider snapshots, active provider state, and agent roster data.

Safe controls only:

- request state
- refresh providers
- request agent roster

No chat transport, file operations, shell commands, provider mutation, or generic remote admin controls are implemented in this phase.

## Relay Behavior

The app opens `WS /v1/app` through the Vite `/v1` proxy.

If relay data is available, the Devices page shows relay-backed devices. If the relay is offline or empty, the UI falls back to local mock/demo device rows so the visual shell stays usable.

The app sends only these safe request envelopes:

- `device.state.request`
- `provider.refresh.request`
- `agent.roster.request`

Responses from the relay can be in the simplified client shape or Astra server's `source`/`target` shape. `src/data/relay.ts` normalizes both for display.
