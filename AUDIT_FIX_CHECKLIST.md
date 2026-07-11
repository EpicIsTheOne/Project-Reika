# Project Reika Audit Fix Checklist

Status is tracked against `PROJECT_REIKA_AUDIT.md` (2026-07-10). “Partial” means the immediate failure is contained, but the production architecture remains intentionally unresolved.

| Audit ID | Status | Resolution / remaining decision |
|---|---|---|
| SECURITY-001 | Fixed for current phase | Relay is explicitly private/single-operator/testing-only, defaults to loopback, refuses non-loopback binds without an explicit trusted-network override, and restricts browser origins. Authenticated tenancy remains mandatory before public deployment. |
| RELAY-001 | Fixed | Manual stop disables reconnect; explicit connect re-enables it. |
| AGENT-001 | Fixed | Provider availability is validated before durable user-message mutation. |
| PROTOCOL-001 | Fixed with queue semantics | Turns are serialized per local session. Branching remains a future product decision. |
| PROTOCOL-002 | Fixed | Agent server owns an atomic durable ledger scoped by device, session, and request ID. Duplicate and legacy requests return stored state/results without provider re-execution; additive accepted/delivered/executing/completed/failed status messages are supported. |
| CLIENT-001 | Fixed (safe disable) | Remote attachment selection is disabled and relay requests omit local file IDs. |
| AGENT-002 | Fixed | Discovery uses OS home/path APIs; Electron no longer repurposes `HOME`. |
| TEST-001 | Fixed | Obsolete OpenClaw and relay-selector assertions were replaced with current stable contracts. |
| SECURITY-002 | Fixed | Renderer sandbox, CSP, navigation blocking, and HTTPS-only external opening are enabled. |
| RELAY-002 | Fixed (short term) | Relay writes use temporary replacement with backup. A transactional database remains a production migration. |
| RELAY-003 | Fixed (bounded prototype) | HTTP/WS/message/session limits and bounded list responses are enforced. Tenant quotas depend on SECURITY-001. |
| RELAY-004 | Fixed | Heartbeat watchdog expires and closes stale sockets. |
| AGENT-003 | Partial | Provider HTTP has a configurable deadline. User cancellation and durable terminal turn states depend on the versioned turn protocol. |
| CLIENT-002 | Fixed (safe disable) | Unsupported tray toggle is disabled and labelled unavailable. |
| CLIENT-003 | Fixed | UI exposes one bundled app-update policy. |
| UI-001 | Fixed | Home reports scoped app/provider state instead of global health. |
| UI-002 | Fixed | At laptop widths the profile/session rail becomes a drawer, portrait/header are compact, titles truncate, and conversation width is prioritized; large layouts are unchanged. |
| UI-003 | Fixed (safe removal) | Nonfunctional reaction control removed. |
| UI-004 | Fixed (safe subset) | Fenced code/multiline text render as safe React text with scrollable code blocks. |
| UI-005 | Fixed (bounded rendering) | Chat follows latest while at bottom and renders the latest 500 messages. Pagination remains later architecture work. |
| A11Y-001 | Fixed for confirmed paths | Dialog focus trap/restore/Escape, native settings button, and reduced motion added. Full AT matrix remains QA. |
| PERF-001 | Fixed | Production catalog uses budgeted WebP derivatives with native lazy loading for non-selected lists. Original PNG sources remain outside the emitted production bundle. |
| ARCH-001 | Partial | Turn queue and provider helpers create testable seams; no broad rewrite was performed. |
| DOCS-001 | Fixed | Current status is documented here and in `docs/CURRENT_ARCHITECTURE.md`; phase docs are historical. |
| UI-006 | Fixed | Remote refresh preserves remote selection. |
| CLIENT-004 | Fixed | Profile-labelled chat aliases now say Open Chat. |
| CLIENT-005 | Fixed | Hard-coded personal account/email/build identity replaced with local-profile copy. |
| TEST-002 | Fixed | Root `test`, `lint`, `verify`, and Windows CI gate added. |
| OBS-001 | Preserved | Clean build remains the baseline. |
| OBS-002 | Preserved | Windows packaging remains supported; manifest metadata corrected. Signing remains a release responsibility. |
| OBS-003 | Preserved | Local Mock chat behavior is retained. |

## Deferred production architecture

- Public relay deployment remains blocked on authenticated tenancy, ownership checks, recovery, and audit logging.
- The JSON relay store may later migrate to a transactional database without changing the additive delivery-status contract.
