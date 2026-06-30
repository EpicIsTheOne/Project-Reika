# Project Reika

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

The relay is still dev-only and in-memory, but the important shape is real: devices call home, the app connects to the relay, and only safe state/provider/roster requests are routed.

### `server/`

Implemented:

- Node/TypeScript device-agent server scaffold
- platform-aware Windows/Linux/macOS device identity
- Windows `.exe` build with local pairing UI
- Linux CLI pairing flow
- Windows and Linux startup registration
- local provider detection for CommandCenter, OpenClaw direct, Hermes direct, and mock fallback
- CommandCenter-first provider priority
- versioned `AgentHubEnvelope` protocol
- safe command dispatcher
- disabled-by-default outbound relay/uplink client
- local development endpoints for health/state/providers/uplink/events
- local Agent Art Studio endpoints for art profiles, categories, prompts, uploads, references, and generation readiness
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
- local agent startup toggle in Settings
- relay-backed device presence, provider snapshots, active provider, and agent roster display
- safe controls only: request state, refresh providers, request agent roster

See:

```text
client/README.md
docs/CLIENT_ARCHITECTURE.md
```

### `Relay/`

Implemented:

- standalone TypeScript relay package
- in-memory dev pairing flow
- `POST /v1/pairing/create`
- `POST /v1/pairing/claim`
- `POST /v1/pairing/approve`
- `WS /v1/device`
- `WS /v1/app`
- `GET /v1/devices` for dev-time relay state inspection
- device presence tracking
- safe envelope routing between app and device
- compatibility shim for the client envelope shape and Astra's server envelope shape

### `shared/`

Added as the canonical Phase 1 protocol/model reference. Until this repo becomes a real workspace/package setup, update `shared/` first and mirror protocol changes into `server/`, `client/`, and `Relay/`.

## Local Development

Install dependencies once in each lane:

```bash
cd Relay && npm install
cd ../server && npm install
cd ../client && npm install
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

To connect the device server through the relay, open AgentHub, choose **Add Device** or **Connect Agent** on the Devices page, and follow the Agent Connection Wizard. The wizard creates the pairing code, shows Windows/Linux instructions, approves claimed devices, then verifies state, providers, and agent roster with safe relay requests only.

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

Phase 1 auto-update is git-clone based. When the app is running from a local clone, the server compares the current `HEAD` against `EpicIsTheOne/Project-Reika` on `main`, reports available commit descriptions, and lists changed files. If either auto-update toggle is enabled, startup will attempt a safe `git pull --ff-only origin main`. If the local clone has commits ahead of GitHub, the updater refuses to apply automatically.

Update API:

```text
GET  /updates/status
POST /updates/check
POST /updates/apply
```

Update notifications include the update description and changed file list so users can see what changed before or after applying. Packaged self-replacement is intentionally not part of this pass; installed `.exe` builds should still be rebuilt from the updated repo.

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
