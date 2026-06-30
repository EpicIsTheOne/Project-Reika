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

Auto-update has two modes:

- clone mode applies a safe fast-forward from `origin/main`
- packaged mode checks the latest GitHub Release, stages the Windows installer, and launches it on Windows

The browser/Vite workflow remains intact.

If auto-update is off, the server still creates a local notification when GitHub has a newer update. The notification includes the same changed-file list and update description shown in Settings.

Settings also persists real local preferences for theme, relay URL, mock provider use, notification categories, startup behavior, cache clearing, and security/session status.

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
- real image generation through the local server when OpenAI API key or Codex/ChatGPT OAuth auth is available

The page uses the existing AgentHub/Reika asset library as seeded production art. **Generate More** calls the local server, which stores successful generations as normal Art Studio assets and selects the new asset automatically. If ChatGPT OAuth is not accepted by the OpenAI image endpoint, the server reports that upstream error and can be switched to `OPENAI_API_KEY` / `REIKA_OPENAI_API_KEY`.

## Main Folders

```text
src/App.tsx                  Compatibility export for the Vite entrypoint
src/app/                     App orchestration, boot state, routing, constants, app types
src/features/                Page-level modules for boot, home, chat, devices, notifications, settings, and art
src/components/              Shared UI primitives
src/domain/                  Pure API/relay-to-UI mapping helpers
src/lib/                     API helpers, art runtime, motion helpers
src/data/                    Client data adapters, assets, relay/startup helpers
desktop/                     Electron desktop shell and local packaged proxy
src/shared/protocol/         Versioned AgentHub envelope helpers
src/backend/                 Local/dev app backend and provider scanner
assets/agenthub_phase1*/     Project-local visual assets
Refrence Docs/               Source planning/reference docs
```

More detail lives in `../docs/CLIENT_ARCHITECTURE.md`.

## Relay Phase 1 Scope

The Devices UI can show relay-backed paired devices, provider snapshots, active provider state, and agent roster data.

Use **Add Device** on Home or **Connect Agent** on Devices to open the Agent Connection Wizard. It supports:

- Windows agent pairing through the local `.exe` pairing UI
- Linux CLI pairing with the current relay URL embedded in the one-line command
- existing paired-device verification
- automatic safe requests after approval for state, provider refresh, and roster

Safe controls only:

- request state
- refresh providers
- request agent roster
- relay chat request

File operations, shell commands, provider mutation, and generic remote admin controls are intentionally not implemented.

## Relay Behavior

The app opens `WS /v1/app` through the Vite `/v1` proxy.

If relay data is available, the Devices page shows relay-backed devices. If the relay is offline or empty, the UI falls back to local mock/demo device rows so the visual shell stays usable.

The app can send these relay request envelopes:

- `device.state.request`
- `provider.refresh.request`
- `agent.roster.request`
- `agent.chat.request`

Responses from the relay can be in the simplified client shape or Astra server's `source`/`target` shape. `src/data/relay.ts` normalizes both for display.
