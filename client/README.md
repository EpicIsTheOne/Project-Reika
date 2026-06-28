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

## Relay Phase 1 Scope

The Devices UI can show relay-backed paired devices, provider snapshots, active provider state, and agent roster data.

Safe controls only:

- request state
- refresh providers
- request agent roster

No chat transport, file operations, shell commands, provider mutation, or generic remote admin controls are implemented in this phase.
