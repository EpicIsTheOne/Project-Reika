# Project Reika Agent Server

Project Reika Agent Server is the **device-side service** for Reika.

This is not the main visual app client. It is the local agent/device server that reports device/provider/agent state upward through the relay.

## Current Phase

**Phase 1: local device agent server + safe relay uplink**

Included now:

- Node/TypeScript device-agent service scaffold
- platform-aware device identity for Windows, Linux, macOS, and unknown hosts
- Windows single-file `.exe` build path
- Windows local pairing UI at the device server root URL
- Linux terminal-first pairing flow
- Windows Run-key startup registration
- Linux user-level `systemd` startup registration
- Reika as the represented mascot/agent fallback
- local HTTP status surface for development
- modular boundaries for Device, Provider, Agent, Event, Commands, Uplink, and shared protocol
- local provider detection for CommandCenter, OpenClaw direct, and Hermes direct
- CommandCenter-first active provider selection
- mock/offline fallback provider state
- versioned shared `AgentHubEnvelope` protocol
- disabled-by-default outbound relay client
- safe command dispatcher for state, roster, provider refresh, and agent chat requests
- direct provider chat for CommandCenter, OpenClaw, Hermes, and mock
- durable Project Reika session/message history for local dev calls
- provider-native session id mapping persistence for provider continuity
- provider-native history preview/import for CommandCenter and Hermes
- CommandCenter-style session search/detail and file/link attachment endpoints
- Agent Art Studio persistence for art profiles, categories, prompts, references, uploaded art, linked art, and selection modes
- GitHub update check/apply endpoints with changed-file and description reporting
- SSE turn lifecycle events for local chat calls
- tested against the dev relay in `../Relay`
- no external uplink enabled by default

## Not Included Yet

- production relay/pairing credentials
- per-device keypair challenge auth
- remote sync persistence
- voice
- production UI wiring beyond the Phase 1 relay/device surface
- Live2D / VRM
- Twitch integration
- additional mascots

## Architecture Rule

The hierarchy stays clean:

```text
Account -> Device -> Provider -> Agent -> Session -> Message/Event
```

Important boundaries:

- This folder is the **device agent server**, not the app client.
- Devices are not providers.
- Providers are not agents.
- CommandCenter is the preferred rich local provider when available.
- Project Reika owns normalized state and protocol envelopes.
- The relay routes envelopes; it should not scan providers or execute local work.
- The device agent executes only explicitly supported safe commands.

## Local Development

```bash
cd server
npm install
npm run build
npm run dev
```

Default local server:

```text
http://127.0.0.1:47840
```

Session data is persisted by default to `~/.local/share/project-reika/sessions.json`. Override with `REIKA_SESSION_STORE_PATH` for tests or alternate packaging.

Development endpoints:

- `GET /`
- `GET /health`
- `GET /state`
- `GET /events`
- `GET /providers`
- `GET /providers/:id/agents`
- `GET /providers/:id/history`
- `POST /providers/:id/history/import`
- `GET /updates/status`
- `POST /updates/check`
- `POST /updates/apply`
- `GET /art`
- `GET /art/oauth/status`
- `POST /art/oauth/connect`
- `POST /art/oauth/disconnect`
- `POST /art/profiles`
- `POST /art/profiles/:id/duplicate`
- `DELETE /art/profiles/:id`
- `POST /art/profiles/:id/categories`
- `PATCH /art/profiles/:id/categories/:categoryId`
- `DELETE /art/profiles/:id/categories/:categoryId`
- `POST /art/profiles/:id/categories/:categoryId/assets/upload`
- `POST /art/profiles/:id/categories/:categoryId/assets/link`
- `DELETE /art/profiles/:id/categories/:categoryId/assets/:assetId`
- `POST /art/profiles/:id/categories/:categoryId/generate`
- `GET /art/assets/:id/content`
- `GET /sessions`
- `GET /sessions/search`
- `GET /sessions/:id`
- `POST /sessions`
- `GET /sessions/:id/messages`
- `POST /sessions/:id/messages`
- `POST /sessions/:id/messages/stream`
- `POST /chat`
- `POST /chat/stream`
- `GET /files`
- `POST /files/upload`
- `POST /files/link`
- `GET /files/:id/download`
- `GET /uplink`
- `GET /startup`
- `POST /uplink/connect`
- `POST /uplink/disconnect`
- `POST /startup/enable`
- `POST /startup/disable`
- `POST /providers/refresh`
- `POST /commands/simulate`

These endpoints expose local server/provider/uplink state for development. They are not the final external connection contract.

## GitHub Updates

The server can compare the local clone against:

```text
EpicIsTheOne/Project-Reika main
```

Override targets with:

```env
REIKA_UPDATE_REPO_OWNER=EpicIsTheOne
REIKA_UPDATE_REPO_NAME=Project-Reika
REIKA_UPDATE_BRANCH=main
REIKA_GITHUB_API_BASE=https://api.github.com
```

`GET /updates/status` and `POST /updates/check` report:

- update availability
- commit titles/bodies as update descriptions
- changed file paths and statuses
- local/remote git state

`POST /updates/apply` runs a conservative `git pull --ff-only origin main` when the server is running from a git clone. It refuses automatic application if the local clone has commits ahead of GitHub. Settings has separate `autoUpdateServer` and `autoUpdateClient` toggles; if either is enabled, startup checks GitHub and applies a safe fast-forward update.

If auto-update is off, startup still checks GitHub and creates a local notification when an update is available. That notification includes the update description and changed file list. Duplicate unread notifications for the same remote commit are suppressed.

CLI controls:

```bash
reika-agent-server updates status
reika-agent-server updates check
reika-agent-server updates apply
reika-agent-server updates enable all
reika-agent-server updates enable server
reika-agent-server updates enable client
reika-agent-server updates disable all
```

## Uplink Config

Outbound relay mode is disabled by default.

```env
REIKA_UPLINK_ENABLED=false
REIKA_RELAY_URL=wss://relay.techexplore.us/v1/device
REIKA_DEVICE_ID=
REIKA_DEVICE_KEY_PATH=
REIKA_PAIRING_TOKEN=
REIKA_HEARTBEAT_MS=25000
REIKA_RECONNECT_MIN_MS=1000
REIKA_RECONNECT_MAX_MS=30000
REIKA_SESSION_STORE_PATH=~/.local/share/project-reika/sessions.json
REIKA_PAIRING_UI=true
REIKA_PAIRING_UI_OPEN=true
```

If `REIKA_DEVICE_ID` is empty, the server derives one from the detected platform and hostname.

## Windows Agent

Windows should be distributed as a single `.exe`:

```powershell
cd server
npm run build:windows-exe
.\release\reika-agent-server.exe
```

On Windows, the agent opens a simple local pairing UI at:

```text
http://127.0.0.1:47840/
```

Create a pairing code in AgentHub, paste it into the UI, and approve the device in the app. The device still connects outbound to the relay; no inbound public port is required.

The Windows UI includes startup controls. It registers the current user's Run key so the agent starts when Windows signs in. The main AgentHub Settings page can also toggle this while the local agent is reachable.

For headless Windows testing:

```powershell
.\release\reika-agent-server.exe --no-ui
.\release\reika-agent-server.exe pair --code <approved pairing code> --relay ws://127.0.0.1:8790/v1/device
.\release\reika-agent-server.exe startup status
.\release\reika-agent-server.exe startup enable --relay ws://127.0.0.1:8790/v1/device
.\release\reika-agent-server.exe startup disable
```

## Linux Agent

Linux stays terminal-first:

```bash
curl -fsSL https://raw.githubusercontent.com/EpicIsTheOne/Project-Reika/main/server/scripts/install-linux.sh | bash -s -- --code <approved pairing code> --relay ws://127.0.0.1:8790/v1/device
```

The installer clones/updates the repo, builds the server, creates `~/.local/bin/reika-agent-server`, enables the user-level startup service by default, and starts the CLI pairing flow. Users can list commands with:

```bash
reika-agent-server --help
```

After install, pairing can be repeated without reinstalling:

```bash
reika-agent-server pair --code <approved pairing code> --relay wss://relay.example.com/v1/device
```

Startup can be changed from the CLI:

```bash
reika-agent-server startup status
reika-agent-server startup enable --relay wss://relay.example.com/v1/device
reika-agent-server startup disable
```

Linux startup uses `~/.config/systemd/user/reika-agent-server.service` when `systemctl --user` is available. On a headless server, the user service starts when that user session starts; production packaging can add linger/system-service setup later if we want true boot-before-login behavior.

For local dev relay testing:

```env
REIKA_UPLINK_ENABLED=true
REIKA_RELAY_URL=ws://127.0.0.1:8790/v1/device
REIKA_PAIRING_TOKEN=<approved pairing code>
REIKA_DEVICE_ID=
```

When enabled, the server connects outward to the relay over WS/WSS and sends:

- `device.hello`
- `device.heartbeat`
- `device.state.snapshot`
- `device.provider.snapshot`
- `agent.roster.snapshot`
- `agent.chat.request`
- `agent.chat.response`

## Supported Command Envelopes

The current command dispatcher supports:

- `device.state.request`
- `provider.refresh.request`
- `agent.roster.request`
- `agent.chat.request`

Unsupported messages return `command.rejected` with `UNSUPPORTED_COMMAND`. Invalid chat payloads return `INVALID_PAYLOAD`.

Supported requests return snapshot/response envelopes directly. The current dispatcher does not emit a separate `command.completed` envelope after every successful request.

Chat requests are intentionally limited to provider/agent/message/session fields and route through the same local provider service used by `POST /chat`. Sessions/messages and provider-native session IDs are persisted locally so restarts can keep Project Reika history and resume-capable providers aligned.

Intentionally unsupported in this phase:

- shell execution
- arbitrary file access
- process/service control
- provider mutation
- agent install/update
No remote-admin nonsense. We are behaving, unfortunately.


## Files and Attachments

Project Reika supports a lightweight CommandCenter-style file/link library without native multipart dependencies:

```bash
# Link an external resource
curl -X POST http://127.0.0.1:47840/files/link \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/doc","name":"Example doc","notes":"reference"}'

# Upload one or more base64-encoded files
curl -X POST http://127.0.0.1:47840/files/upload \
  -H 'Content-Type: application/json' \
  -d '{"name":"note.txt","mimeType":"text/plain","base64":"SGVsbG8="}'

# Use attachments in chat
curl -X POST http://127.0.0.1:47840/chat \
  -H 'Content-Type: application/json' \
  -d '{"providerId":"mock-local","agent":"reika","message":"summarize attachments","fileIds":["<file-id>"]}'
```

Storage defaults to `~/.local/share/project-reika/files/manifest.json` and `~/.local/share/project-reika/files/`. Override with:

```env
REIKA_FILE_STORE_DIR=/some/path/files
REIKA_FILE_MANIFEST_PATH=/some/path/files/manifest.json
```

Attachments are currently passed to providers as structured context metadata (file/link names, IDs, MIME types, sizes, URLs, notes). Binary/image-native provider upload can be added later per adapter.

## Agent Art Studio Storage

The local server persists Agent Art Studio state separately from chat/session data:

```env
REIKA_ART_STORE_PATH=~/.local/share/project-reika/art-library.json
REIKA_ART_ASSET_DIR=~/.local/share/project-reika/art-assets
```

The seeded library uses the project-local AgentHub/Reika assets as production defaults. User uploads and generated images are stored under `REIKA_ART_ASSET_DIR` and served through `GET /art/assets/:id/content`.

`POST /art/profiles/:id/categories/:categoryId/generate` now attempts real OpenAI image generation and inserts the returned image into the selected category as a `generated` asset. Auth is resolved in this order:

1. `OPENAI_API_KEY` or `REIKA_OPENAI_API_KEY`
2. saved local image key from `POST /art/oauth/connect`
3. `OPENAI_API_KEY` inside the local Codex auth file
4. Codex/ChatGPT OAuth access token from `~/.codex/auth.json`

The saved local key is written to `~/.local/share/project-reika/image-auth.json` by default. Override that path for tests or alternate packaging with:

```env
REIKA_IMAGE_AUTH_STORE_PATH=C:\path\to\image-auth.json
```

Connect or clear the saved local key through the API:

```bash
curl -X POST http://127.0.0.1:47840/art/oauth/connect \
  -H "Content-Type: application/json" \
  -d "{\"apiKey\":\"sk-...\"}"

curl -X POST http://127.0.0.1:47840/art/oauth/disconnect
```

Useful image-generation overrides:

```env
REIKA_CODEX_AUTH_PATH=C:\Users\Epic\.codex\auth.json
REIKA_ART_IMAGE_MODEL=gpt-image-2
REIKA_ART_IMAGE_SIZE=1024x1024
REIKA_ART_IMAGE_QUALITY=high
REIKA_OPENAI_IMAGES_URL=https://api.openai.com/v1/images/generations
```

If the OpenAI API rejects the ChatGPT OAuth bearer token, save an API key through Agent Art Studio/Settings or set `OPENAI_API_KEY` / `REIKA_OPENAI_API_KEY`. The server returns the upstream error clearly instead of pretending the image was generated.

## Provider History Import

Project Reika can preview/import provider-native history into its durable local session store:

```bash
# Preview sessions exposed by a provider
curl http://127.0.0.1:47840/providers/commandcenter-local/history?limit=10
curl http://127.0.0.1:47840/providers/hermes-direct/history?limit=10

# Import sessions into Project Reika's local durable store
curl -X POST http://127.0.0.1:47840/providers/commandcenter-local/history/import \
  -H 'Content-Type: application/json' \
  -d '{"limit":10,"includeMessages":true}'

curl -X POST http://127.0.0.1:47840/providers/hermes-direct/history/import \
  -H 'Content-Type: application/json' \
  -d '{"limit":10}'
```

Current behavior:

- CommandCenter imports session metadata and full message transcripts through its local API.
- Hermes imports native session IDs/previews from `hermes sessions list`; imported Hermes sessions can resume via the stored `hermesSessionId`.
- OpenClaw direct history import is not implemented yet; Project Reika-created OpenClaw sessions are still stored locally.

## Provider Priority

Active-provider priority is:

1. CommandCenter local API
2. OpenClaw direct
3. Hermes direct
4. Mock/offline

Provider detection exists for CommandCenter, OpenClaw, and Hermes. Chat/session transport is still intentionally deferred.

## Design Intent

Reika gets the first real vertical slice. The server should become the boring, reliable local daemon underneath the pretty app. Tragic, yes. Useful, also yes.
