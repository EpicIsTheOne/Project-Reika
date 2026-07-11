# Project Reika

> Current implementation and safety status: see [`docs/CURRENT_ARCHITECTURE.md`](docs/CURRENT_ARCHITECTURE.md) and [`AUDIT_FIX_CHECKLIST.md`](AUDIT_FIX_CHECKLIST.md). Older phase plans are historical context, not current release constraints.

Project Reika is the workspace for Reika's multi-device AgentHub system.

The repo is split into clear lanes so Astra and Codex can work in parallel without turning the architecture into soup.

## Folders

```text
server/  Device-side agent server
client/  Main AgentHub app/client
Relay/   Tiny dev relay service
shared/  Canonical Phase 1 protocol/model reference
```

## Current Status

Phase 1 has a working vertical slice:

```text
Device Agent Server  --->  Reika Relay  <---  Main App Client
          outbound WS             dev WS/API
```

The important shape is real: devices call home, the app connects to the relay, pairing/device state is durable, and state/provider/roster/chat request envelopes can be routed without adding shell or file-control scope.

### `server/`

Implemented:

- Node/TypeScript device-agent server scaffold
- platform-aware Windows/Linux/macOS device identity
- Windows `.exe` build with local pairing UI
- Linux CLI pairing flow
- Windows and Linux startup registration
- local provider detection for CommandCenter, OpenClaw direct, Hermes direct, and mock fallback
- CommandCenter, Hermes, and OpenClaw direct history import
- CommandCenter-first provider priority
- versioned `AgentHubEnvelope` protocol
- safe command dispatcher
- disabled-by-default outbound relay/uplink client
- local development endpoints for health/state/providers/uplink/events
- local Agent Art Studio endpoints for art profiles, categories, prompts, uploads, references, saved image auth, and OpenAI-backed image generation
- tested outbound connection against the dev relay

See:

```text
server/README.md
server/docs/CONNECTION-PLAN.md
```

### `client/`

Implemented:

- Vite + React AgentHub UI
- Windows desktop client shell using Electron
- modular client architecture with app, feature, component, domain, data, and runtime layers
- generated/local Reika and AgentHub visual assets
- local/dev app backend for provider scanning
- Agent Art Studio page for agent/global art profiles, categories, selection modes, prompts, references, and manual uploads
- Devices page relay integration
- Agent Connection Wizard for Windows/Linux/existing-device pairing, provider verification, and roster confirmation
- local agent startup toggle in Settings and Devices
- working notification preferences, theme selection, cache controls, security/session status, and update status
- relay-backed device presence, provider snapshots, active provider, and agent roster display
- safe controls only: request state, refresh providers, request agent roster, and paired-device chat envelopes

See:

```text
client/README.md
docs/CLIENT_ARCHITECTURE.md
```

### `Relay/`

Implemented:

- standalone TypeScript relay package
- durable JSON relay store for pairing sessions, approved devices, snapshots, and offline queues
- `POST /v1/pairing/create`
- `POST /v1/pairing/claim`
- `POST /v1/pairing/approve`
- `POST /v1/device/challenge`
- `POST /v1/devices/:id/revoke`
- `POST /v1/devices/:id/rotate-key`
- `GET /v1/policy`
- `WS /v1/device`
- `WS /v1/app`
- `GET /v1/devices` for dev-time relay state inspection
- device presence tracking
- safe envelope routing between app and device
- optional encrypted-envelope marker support
- offline request delivery policy for reconnecting devices
- Dockerfile for production relay deployment
- compatibility shim for the client envelope shape and Astra's server envelope shape

### `shared/`

Added as the canonical protocol/model reference and root npm workspace package. Update `shared/` first, then run:

```bash
npm run sync:protocol
npm run check:protocol
```

## Local Development

Install dependencies once from the root or in each lane:

```bash
npm install
```

Lane-by-lane still works:

```bash
cd Relay && npm install
cd ../server && npm install
cd ../client && npm install
```

Build everything from the root:

```bash
npm run build
```

Start the relay:

```bash
cd Relay
npm run dev
```

Start the device server without uplink for local inspection:

```bash
cd server
npm run dev
```

Start the client UI:

```bash
cd client
npm run dev
```

Default local URLs:

```text
client UI:       http://127.0.0.1:5173
client backend:  http://127.0.0.1:8787
relay:           http://127.0.0.1:8790
device server:   http://127.0.0.1:47840
```

Run the Windows desktop client during development:

```powershell
cd client
npm run dev:desktop
```

Build the Windows desktop `.exe`:

```powershell
cd client
npm run build:desktop
```

Create or refresh the Desktop shortcut:

```powershell
cd client
npm run desktop:shortcut
```

The desktop shell packages the React client in a normal app window while keeping the browser/Vite path available for fast testing.

To connect another device server through the relay, open AgentHub, choose **Add Device** or **Connect Agent** on the Devices page, and follow the Agent Connection Wizard. The wizard creates the pairing code, shows Windows/Linux instructions, approves claimed devices, then verifies state, providers, and agent roster with safe relay requests only.

The local Windows agent server auto-pairs itself to the saved relay URL on boot when the relay is reachable and the device is not already registered. Set `REIKA_AUTO_PAIR_LOCAL_RELAY=false` to disable that local convenience behavior.

Manual relay environment for development:

```env
REIKA_UPLINK_ENABLED=true
REIKA_RELAY_URL=ws://127.0.0.1:8790/v1/device
REIKA_PAIRING_TOKEN=<approved pairing code>
REIKA_DEVICE_ID=
```

Windows agent build:

```powershell
cd server
npm run build:windows-exe
.\release\reika-agent-server.exe
```

The Windows executable opens a local pairing UI with startup controls. Startup can also be managed from the app Settings page while the local agent is running.

Linux remains CLI-first, and the one-line installer enables the user-level startup service by default:

```bash
curl -fsSL https://raw.githubusercontent.com/EpicIsTheOne/Project-Reika/main/server/scripts/install-linux.sh | bash -s -- --code <pairing code> --relay ws://127.0.0.1:8790/v1/device
```

After install, Linux users can list commands with:

```bash
reika-agent-server --help
```

Linux startup commands:

```bash
reika-agent-server relay status
reika-agent-server relay set --relay ws://relay-host:8790/v1/device
reika-agent-server startup status
reika-agent-server startup enable --relay ws://relay-host:8790/v1/device
reika-agent-server startup disable
```

## GitHub Auto Updates

AgentHub can check the Project Reika GitHub repo for updates from the local device-agent server.

Settings includes separate toggles for:

- Server Auto Update
- Client Auto Update

Auto-update supports two modes:

- **Git clone mode:** compares local `HEAD` against `EpicIsTheOne/Project-Reika` on `main`, reports commit descriptions and changed files, and can apply a safe `git pull --ff-only origin main`.
- **Packaged mode:** when no `.git` clone is present, checks the latest GitHub Release, stages the Windows installer asset, writes an update manifest, and launches the installer on Windows.

If the local clone has commits ahead of GitHub, the updater refuses to apply automatically.

Update API:

```text
GET  /updates/status
POST /updates/check
POST /updates/apply
```

Update notifications include the update description and changed file list so users can see what changed before or after applying.

When auto-update is off, AgentHub still checks GitHub on server startup and creates a local notification if a new update is available. The notification includes the changed files and update description.

CLI update controls:

```bash
reika-agent-server updates status
reika-agent-server updates check
reika-agent-server updates apply
reika-agent-server updates enable all
reika-agent-server updates enable server
reika-agent-server updates disable client
```

## Guardrails

Phase 1 intentionally does not include chat routing, file operations, shell commands, provider mutation, service control, or generic remote administration.

The relay routes allowed envelopes. The device server performs local detection and answers safe requests. Keep command scope narrow until presence, pairing, and state sync are boringly reliable.
