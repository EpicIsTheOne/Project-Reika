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
- `/agent` to the local device-agent server on `127.0.0.1:47840`
- `/v1` to the relay on `127.0.0.1:8790`

## Desktop Window

The browser workflow stays intact, but the Windows desktop client can be run in an Electron window:

```powershell
npm run dev:desktop
```

For packaged Windows builds:

```powershell
npm run build:desktop
```

The packaged app serves the built React client from a tiny local desktop server and preserves the same paths used by Vite:

- `/agent` proxies to `http://127.0.0.1:47840`
- `/v1` proxies HTTP/WebSocket relay traffic to `http://127.0.0.1:8790`
- `/api` proxies to `http://127.0.0.1:8787`

Create or refresh Epic's Desktop shortcut:

```powershell
npm run desktop:shortcut
```

If a packaged build exists, the shortcut points to `AgentHub.exe`. Otherwise it starts the repo dev desktop launcher.

## Build

```bash
npm run build
```

This runs TypeScript checking and a production Vite build.

## Updates

The Settings page has a Developer section for GitHub updates:

- Server Auto Update
- Client Auto Update
- Check
- Apply Update

The UI reads update status from the local agent server at `/agent/updates/status`. A check or apply response includes:

- whether an update is available
- commit title/body as the update description
- changed files and their status
- whether the local clone can safely apply the update

Auto-update applies only when the project is running from a git clone and the server can fast-forward from `origin/main`. The browser/Vite workflow remains intact, and packaged desktop builds still need to be rebuilt after repo files update.

If auto-update is off, the server still creates a local notification when GitHub has a newer update. The notification includes the same changed-file list and update description shown in Settings.

## Agent Art Studio

The sidebar includes `Agent Art`, a production-asset manager for AgentHub visuals.

Current Phase 1 behavior:

- Agent Art vs Global Art scopes
- agent/global profile selection
- profile create, duplicate, and delete for non-default profiles
- art categories with `single` or `random` selection modes
- selected art pool management
- prompt and system-prompt editing
- reference image toggles
- manual image upload and linked-image add
- generation readiness surfaced through the server

The page uses the existing AgentHub/Reika asset library as seeded production art. GPT-image 2 generation is represented honestly: the button checks the local server generation path and reports that Codex/ChatGPT OAuth is not connected yet instead of fabricating a generated image.

## Main Folders

```text
src/App.tsx                  Main visual shell and page views
desktop/                     Electron desktop shell and local packaged proxy
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
