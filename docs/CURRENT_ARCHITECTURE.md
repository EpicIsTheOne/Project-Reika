# Current Architecture and Support Status

This page is the authoritative current-state companion to the root README. Phase plans and design QA documents are historical intent, not release evidence.

Project Reika has four workspace layers: Electron/React client, device-local agent server, relay server, and shared protocol. The canonical protocol is `shared/protocol/index.ts`; run `npm run sync:protocol` after changes and `npm run check:protocol` before shipping.

## Supported today

- Local provider discovery, Mock chat, durable local sessions, files, art, settings, and notifications.
- Device pairing, relay presence, provider/agent rosters, relay chat, and relay-backed history for private/internal deployments.
- Windows desktop packaging with the agent server embedded.
- Per-session local turn serialization, provider HTTP deadlines, bounded relay payloads/history, atomic relay JSON replacement, and stale-heartbeat expiry.
- Agent-authoritative durable request deduplication with additive delivery states: accepted, delivered, executing, completed, and failed.
- Budgeted WebP production art and conservative responsive chat behavior at laptop widths.

## Safety boundary

Relay defaults to `ws://127.0.0.1:8790/v1/device` and is private, single-operator, testing-only infrastructure. Non-loopback binding requires the explicit `REIKA_RELAY_ALLOW_NONLOCAL=1` trusted-network override. Do not treat it as public multi-tenant infrastructure until account authentication, ownership, authorization, recovery, and audit logging exist. Device key/challenge support is not an app/account authorization boundary.

The agent server is the final idempotency authority before provider/tool execution. Its ledger is keyed by device, session, and request ID. Requests without delivery metadata are marked legacy but still deduplicated. No existing session or relay-store migration is required; the ledger is created on first use.

Original PNG art remains under `client/assets/agenthub_phase1_generated`. Production imports use generated WebP derivatives under `client/assets/agenthub_phase1_webp`; regenerate them with `npm run assets:webp --workspace agenthub-phase1-ui`.

Remote attachments are intentionally unavailable because local file IDs are not portable. Tray behavior and reactions are intentionally unavailable rather than presented as working controls.

## Verification

- `npm test`: focused audit and chat/relay contracts.
- `npm run lint`: current workspace type/build checks.
- `npm run verify`: protocol check, tests, and full monorepo build.
- `npm run smoke:desktop-relay-chat`: isolated two-agent Electron relay smoke with visible replies and navigation persistence.

See `AUDIT_FIX_CHECKLIST.md` for remaining decisions and deferred visual/performance work.
