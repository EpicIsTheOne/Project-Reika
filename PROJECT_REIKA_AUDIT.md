# Project Reika Engineering and Product Audit

**Audit date:** 2026-07-10  
**Revision:** `cdbc744c483be08438ccd2bc773ced9d772308d1` (`main`, equal to `origin/main` after fetch)  
**Mode:** Read-only defensive quality audit. No fixes, tracked-file edits, exploit attempts, credential attacks, bypass attempts, destructive tests, commits, or pull requests were performed.  
**Scope:** Client/Electron, relay, agent server, shared protocol, packaging, current documentation, representative live UI, and core local/relay chat paths.

## Executive summary

Project Reika has a compelling product identity and a surprisingly broad working vertical slice: a clean checkout installs and builds, the Windows desktop package is produced, an isolated relay and agent can pair, the packaged client proxies both services, and local mock chat works visibly. Its visual identity is unusually coherent for this maturity level.

The project is **safe for active development with isolated/local data**, and **ready for limited internal testing by technical users who understand the rough edges**. It is **not ready for public testing on an internet-facing relay** and **not production-ready**. The main blockers are the relay trust model, message-integrity failures, misleading connection state, and the absence of a green automated regression gate.

**Overall health:** Amber/Red — promising product and build foundation, unreliable core messaging under failure/concurrency.  
**Confidence:** High for the findings marked Confirmed; runtime tests were executed against isolated services and the packaged app.  
**Finding totals:** 1 Critical, 7 High, 16 Medium, 4 Low, 3 Observations (31 total).

### Five most important findings

1. `SECURITY-001`: the relay exposes device, chat, pairing, and control operations without an effective application/account authorization boundary.
2. `AGENT-001`: a failed provider turn permanently stores the user message, creating an orphan/duplicate-prone history.
3. `PROTOCOL-001`: concurrent turns in one session are persisted in completion order, producing interleaved conversation history.
4. `RELAY-001`: “Disconnect relay” reconnects automatically about one second later.
5. `TEST-001`: both shipped regression commands fail on current `main`, leaving no trustworthy release gate.

### Strongest areas

- Clean `npm ci` and complete monorepo build work from a fresh checkout.
- Electron uses `contextIsolation: true` and `nodeIntegration: false`.
- Shared protocol copies are checked for drift by a repository script.
- Most agent-side JSON stores use temporary-file replacement rather than direct overwrite.
- The existing desktop smoke rig uses isolated ports/state and attempts two-agent relay coverage.
- The character-led visual system, navigation, loading states, and major settings surfaces are coherent.

### Weakest areas

- Relay authentication/authorization and tenant isolation are architectural gaps.
- Chat has no per-session serialization, idempotency, or transactional failure model.
- Runtime controls and UI status copy sometimes claim a state the system does not actually have.
- Production data structures are unbounded and often rewritten in full.
- Tests are sparse, implementation-string-coupled, and currently red.
- Documentation describes several earlier phases simultaneously and cannot be treated as authoritative.

## Architecture overview

```text
Electron renderer
  |-- /agent/* --> Electron local proxy --> reika-agent-server.exe / dev agent
  |-- /v1/*    --> Electron local proxy --> relay HTTP/WebSocket
  |-- direct app WebSocket fallback ----> relay /v1/app

Agent server
  |-- provider discovery/chat ----------> CommandCenter / OpenClaw / Hermes / Mock
  |-- device WebSocket -----------------> relay /v1/device
  |-- JSON persistence -----------------> sessions, files, art, settings, notifications

Relay
  |-- app/device WebSockets + REST
  |-- device roster, pairing, offline queue, relay-backed chat history
  `-- single JSON store rewritten synchronously
```

The intended boundary is sensible: the client presents agents and devices; the agent server owns local provider execution and local state; the relay connects remote clients to remote agent servers and stores relay chat history. In practice, identity, authorization, delivery semantics, and session ordering are insufficiently explicit at those boundaries.

## Findings

### SECURITY-001 — Internet-facing relay lacks an effective app/account authorization boundary

1. **Title:** Relay data and control APIs are broadly unauthenticated.
2. **Severity:** Critical
3. **Confidence:** Confirmed by code review; no exploitation attempted.
4. **Affected component:** Relay server, remote app/device trust boundary.
5. **Affected files/lines:** `Relay/src/relay/server.ts:155-345`, `:358-452`, `:474-556`, `:1049-1065`; `client/src/data/relay.ts:190-306`.
6. **Description:** Device lists, relay-backed chat sessions/messages, pairing actions, device requests, revocation/key rotation, and app WebSocket operations do not establish an authenticated user/account principal before acting. CORS is permissive and app sockets are not scoped to a tenant.
7. **Evidence:** Endpoint handlers route requests using caller-supplied IDs/codes; the app WebSocket receives/broadcasts shared device state. The configured default is a public relay URL.
8. **Reproduction steps:** Static inspection only, per the defensive scope. Trace REST and `/v1/app` handlers and observe no required authorization middleware or account-to-resource checks.
9. **Expected behavior:** Every app request is authenticated and authorized to a specific account; devices, sessions, pairings, and commands are tenant-scoped.
10. **Actual behavior:** Resource identifiers are treated as authority for many operations.
11. **User impact:** Privacy loss, unauthorized device actions, chat exposure, and remote agent invocation are plausible if the relay is internet-accessible.
12. **Technical cause:** The prototype relay model evolved into a public control plane before an identity/authorization layer was introduced.
13. **Recommended fix:** Make authentication and tenancy a prerequisite: authenticated app sessions, device credentials, account ownership on every record, origin policy, resource-level authorization, rotation/revocation, and audit logs. Keep the public relay disabled until this exists.
14. **Estimated effort:** Architectural
15. **Dependencies/related:** `RELAY-003`, `SECURITY-002`, protocol versioning.
16. **Suggested regression test:** Two isolated accounts and devices; prove every cross-account REST/WS read and command is denied, and revoked credentials cannot reconnect.

### RELAY-001 — Manual uplink disconnect immediately reconnects

1. **Title:** Disconnect control cannot keep the agent offline.
2. **Severity:** High
3. **Confidence:** Confirmed at runtime.
4. **Affected component:** Agent server relay uplink.
5. **Affected files/lines:** `server/src/main.ts:1405-1407`; `server/src/modules/uplink/relayClient.ts:77-84`, `:104-113`, `:124-132`, `:158-168`.
6. **Description:** `stop()` closes the socket but leaves reconnection enabled. The close path schedules a new connection.
7. **Evidence:** Isolated runtime: status changed to disconnected immediately, remained disconnected at 0.4/0.8 seconds, and returned to connected at ~1.2 seconds without another user action.
8. **Reproduction steps:** Start relay and agent, POST `/uplink/disconnect`, poll `/uplink` for five seconds.
9. **Expected behavior:** The uplink remains disconnected until an explicit connect action.
10. **Actual behavior:** It reconnects automatically.
11. **User impact:** Users cannot intentionally take a device offline; UI state and operational intent diverge.
12. **Technical cause:** `RelayClient.stop()` does not disable reconnect scheduling or distinguish manual shutdown from transport failure.
13. **Recommended fix:** Add explicit desired state (`enabled`/`manualStop`), cancel reconnect timers, and gate close/error reconnect paths.
14. **Estimated effort:** Small
15. **Dependencies/related:** `UI-001`, `RELAY-004`.
16. **Suggested regression test:** Disconnect, wait beyond several backoff periods, assert no new socket; reconnect explicitly and assert recovery.

### AGENT-001 — Failed provider turns persist orphan user messages

1. **Title:** Provider rejection mutates durable history before validation succeeds.
2. **Severity:** High
3. **Confidence:** Confirmed at runtime.
4. **Affected component:** Agent server chat/session persistence.
5. **Affected files/lines:** `server/src/main.ts:565-632`, especially `:589-591` before provider execution.
6. **Description:** A session is created and the user message is stored before provider lookup/execution succeeds. Failure returns 500 but the mutation is retained.
7. **Evidence:** A request using provider `missing-provider` returned 500; the newly created `audit failed turn` session contained one persisted user message and no failure marker/assistant response.
8. **Reproduction steps:** POST a new chat turn with an invalid provider, then list/read the created session.
9. **Expected behavior:** Reject before mutation, or persist an explicit failed-turn state that can safely retry.
10. **Actual behavior:** A normal-looking user message remains in history.
11. **User impact:** Duplicate prompts on retry, confusing history, and provider context divergence.
12. **Technical cause:** `runChatTurn` is not transactional; persistence precedes provider validation and error handling performs no rollback/status transition.
13. **Recommended fix:** Validate provider/agent first, introduce turn records with pending/succeeded/failed states, and commit user+assistant results atomically or expose recoverable failure state.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `PROTOCOL-001`, `PROTOCOL-002`.
16. **Suggested regression test:** Force provider-not-found, timeout, and crash; assert one failed turn with retry semantics and no duplicate user message.

### PROTOCOL-001 — Concurrent turns interleave one session’s history

1. **Title:** Per-session chat execution is not serialized.
2. **Severity:** High
3. **Confidence:** Confirmed at runtime.
4. **Affected component:** Agent server/session protocol.
5. **Affected files/lines:** `server/src/main.ts:587-632`, `:1150-1238`; `server/src/modules/session/sessionStore.ts`.
6. **Description:** Multiple turns mutate the same session concurrently; assistant replies are appended when providers finish, not in request/turn order.
7. **Evidence:** A deterministic delayed provider fixture produced: user slow, user fast, assistant fast, assistant slow. Fast completed in ~91 ms and slow in ~762 ms.
8. **Reproduction steps:** Send two concurrent session-message requests where the first provider response is slower.
9. **Expected behavior:** Turns are serialized per session, or the data model preserves explicit turn pairing/order.
10. **Actual behavior:** Message order becomes semantically ambiguous.
11. **User impact:** Replies appear attached to the wrong conversational moment; provider history and later context can be corrupted.
12. **Technical cause:** Shared mutable session state has no mutex/queue/turn sequence and stores only flat messages.
13. **Recommended fix:** Add a per-session execution queue plus immutable turn IDs/sequence numbers. Decide whether subsequent prompts wait or fork.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `AGENT-001`, `PROTOCOL-002`.
16. **Suggested regression test:** Fire 10 variably delayed turns at one session and assert deterministic turn and persistence order across restart.

### PROTOCOL-002 — Relay fallback can execute a chat request twice

1. **Title:** Retry across sockets has no delivery idempotency.
2. **Severity:** High
3. **Confidence:** Highly Likely (deterministic code path; destructive duplicate execution was not induced).
4. **Affected component:** Client relay transport, relay server, agent server.
5. **Affected files/lines:** `client/src/data/relay.ts:190-276`; `Relay/src/relay/server.ts:474-529`, `:926-945`; `server/src/main.ts:164-218`.
6. **Description:** The client tries the same-origin relay socket and, on any error/timeout, retries the same request through the direct relay URL. The relay/agent have no processed-request ledger. An accepted first send can later complete as the fallback also executes.
7. **Evidence:** Same request ID is reused across both attempts, but no endpoint deduplicates it; offline accepted requests are queued while the UI may time out and retry.
8. **Reproduction steps:** Code trace; a future safe integration test should drop the first response after relay acceptance and allow both paths to deliver.
9. **Expected behavior:** At-most-once execution or explicit idempotent retry semantics.
10. **Actual behavior:** Delivery is at-least-once without deduplication.
11. **User impact:** Duplicate agent actions, duplicate messages, and potentially duplicate tool effects.
12. **Technical cause:** Request ID is correlation-only, not an idempotency key; ambiguous transport errors are retried as if unsent.
13. **Recommended fix:** Persist idempotency keys at relay/device, acknowledge accepted/executing/completed states, and retry by querying status rather than resending work.
14. **Estimated effort:** Architectural
15. **Dependencies/related:** `RELAY-003`, `AGENT-001`.
16. **Suggested regression test:** Disconnect after acceptance before response and assert exactly one provider invocation and one stored assistant turn.

### CLIENT-001 — Attachments selected in remote chat are local-only IDs

1. **Title:** Relay chat sends attachment identifiers the remote device cannot resolve.
2. **Severity:** High
3. **Confidence:** Confirmed by end-to-end code trace.
4. **Affected component:** Chat UI, local agent file store, relay/device chat.
5. **Affected files/lines:** `client/src/features/chat/ChatView.tsx:397-425`, `:670-705`; `server/src/main.ts:472-491`, `:184-209`.
6. **Description:** The UI uploads files to its local `/agent/files`, then includes those local file IDs in a relay request. The remote agent resolves IDs against its own unrelated file store.
7. **Evidence:** There is no relay upload/transfer step and the server attachment context resolves only local IDs. The attachment control remains enabled for relay providers.
8. **Reproduction steps:** Select a remote agent, upload a file, inspect the outgoing relay payload and remote resolution path.
9. **Expected behavior:** File bytes/metadata are transferred to the selected device or attachments are clearly disabled for remote chat.
10. **Actual behavior:** The prompt appears to include a file, but the remote agent receives no resolvable attachment.
11. **User impact:** Silent loss of intended context and confidently wrong agent responses.
12. **Technical cause:** File ownership/scope is absent from the protocol; `fileIds` are treated as globally meaningful.
13. **Recommended fix:** Define device-scoped file handles and authenticated transfer, or disable remote attachments with explicit copy until supported.
14. **Estimated effort:** Medium (disable) / Architectural (transfer)
15. **Dependencies/related:** `SECURITY-001`, protocol versioning.
16. **Suggested regression test:** Upload on app device, relay to agent device, verify remote checksum/content and clear errors for expired/missing handles.

### AGENT-002 — Provider discovery uses Unix HOME/PATH rules on Windows

1. **Title:** OpenClaw/Hermes discovery resolves the wrong paths on Windows and packaged builds.
2. **Severity:** High
3. **Confidence:** Confirmed at runtime and in code.
4. **Affected component:** Agent provider runtime and Electron launcher.
5. **Affected files/lines:** `server/src/modules/provider/providerRuntime.ts:68-75`, `:148`, `:476`; `client/desktop/localAgent.ts:40-50`.
6. **Description:** Provider discovery uses `process.env.HOME`, `/.local/bin`, colon PATH separation, and string-built paths. Windows commonly has no HOME; packaged Electron substitutes its user-data directory.
7. **Evidence:** Isolated Windows runtime attempted `C:\.openclaw\openclaw.json`. Packaged execution can instead look under AgentHub userData rather than the real user home.
8. **Reproduction steps:** Launch on Windows without HOME and inspect provider refresh diagnostics.
9. **Expected behavior:** Use `os.homedir()`, `path.join`, and `path.delimiter`, with explicit configurable paths.
10. **Actual behavior:** Discovery may miss installed providers or search inconsistent locations.
11. **User impact:** Providers appear offline/missing even when installed; packaged and development behavior differ.
12. **Technical cause:** Unix-specific environment assumptions and Electron overriding HOME.
13. **Recommended fix:** Centralize platform path resolution; never repurpose HOME for app state; validate candidate binaries/configs and show searched paths in diagnostics.
14. **Estimated effort:** Small
15. **Dependencies/related:** `DOCS-001`, diagnostics UX.
16. **Suggested regression test:** Windows tests with HOME unset, HOME set, paths containing spaces, and packaged userData separate from OS home.

### TEST-001 — Current main has no green regression gate

1. **Title:** Both shipped regression commands fail on current source.
2. **Severity:** High
3. **Confidence:** Confirmed.
4. **Affected component:** Test suite/release process.
5. **Affected files/lines:** `scripts/test-chat-relay.mjs:50-65`; `client/scripts/smoke-desktop-relay-chat.mjs:125-140`; root `package.json:8-15`.
6. **Description:** The static chat-relay test string-matches the retired OpenClaw CLI implementation. The desktop smoke selects Nyxie successfully in the UI but waits for obsolete visible text containing `/ nyxie-smoke`, then times out before second-agent persistence coverage.
7. **Evidence:** `npm run test:chat-relay` failed at its OpenClaw CLI assertion. `npm run smoke:desktop-relay-chat` verified Astra, then timed out in `selectRelayAgent` while captured page text showed Nyxie selected.
8. **Reproduction steps:** Run both root scripts on audited commit.
9. **Expected behavior:** Release-critical tests pass or fail only on product regressions.
10. **Actual behavior:** Tests fail because assertions encode outdated implementation/presentation details.
11. **User impact:** Real regressions can be ignored as “the test is stale,” and releases lack trusted evidence.
12. **Technical cause:** Source-string testing and UI copy/ID coupling instead of behavioral contracts and stable selectors.
13. **Recommended fix:** Replace string assertions with provider adapter tests and stable test IDs/protocol assertions; make both commands mandatory CI checks.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `TEST-002`, `DOCS-001`.
16. **Suggested regression test:** The repaired tests themselves: clean install, two-agent relay chat, navigation persistence, reconnect, and packaged smoke on CI Windows.

### SECURITY-002 — Electron hardening is incomplete

1. **Title:** Renderer isolation is good, but navigation/external-link policy remains permissive.
2. **Severity:** Medium
3. **Confidence:** Confirmed by code review.
4. **Affected component:** Electron shell.
5. **Affected files/lines:** `client/desktop/main.ts:23-42`; `client/index.html`; renderer HTML/CSS entry.
6. **Description:** The window has `sandbox: false`; arbitrary `window.open` URLs are handed to `shell.openExternal`; no `will-navigate` guard or explicit CSP was found.
7. **Evidence:** Main-process options and link handler are direct; no scheme/host allowlist exists.
8. **Reproduction steps:** Static inspection only; no unsafe URL was launched.
9. **Expected behavior:** Sandboxed renderer where feasible, strict CSP, blocked unexpected navigation, and allowlisted `https:` external URLs.
10. **Actual behavior:** A renderer/content bug has a wider path to external protocol handling.
11. **User impact:** Increased blast radius of future content/rendering mistakes.
12. **Technical cause:** Desktop hardening stopped at context isolation/Node integration.
13. **Recommended fix:** Enable sandbox after compatibility testing; add CSP; prevent navigation; parse URLs and allow only intended schemes/hosts; log rejections.
14. **Estimated effort:** Small/Medium
15. **Dependencies/related:** `SECURITY-001`.
16. **Suggested regression test:** Attempt `javascript:`, `file:`, custom protocol, malformed, and unapproved host navigation; assert all are blocked.

### RELAY-002 — Relay persistence is synchronous, whole-store, and non-atomic

1. **Title:** Every mutation can block the event loop and a partial write can erase recoverable state.
2. **Severity:** Medium
3. **Confidence:** Confirmed by code review.
4. **Affected component:** Relay persistence.
5. **Affected files/lines:** `Relay/src/relay/server.ts:947-999`, especially `:992`.
6. **Description:** Relay state is serialized in full with synchronous direct overwrite. Load failure is tolerated by starting empty.
7. **Evidence:** `writeFileSync(storePath, JSON.stringify(...))` targets the live file; no temp file, fsync, journal, schema version, or backup is used.
8. **Reproduction steps:** Add messages/devices and inspect write path; crash corruption was not intentionally induced.
9. **Expected behavior:** Atomic durable writes or a transactional store with recoverable migrations.
10. **Actual behavior:** Persistence latency grows with all state and interrupted writes can make the entire store unreadable.
11. **User impact:** Relay stalls under growth and can lose devices, queues, and chats after a crash.
12. **Technical cause:** Prototype JSON persistence remained in the production request path.
13. **Recommended fix:** Short term temp+rename with backup/versioning and debounced writer; before production use SQLite or another transactional store.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `RELAY-003`, `PERF-001`.
16. **Suggested regression test:** Large-store latency benchmark plus forced termination at each write phase and verified recovery.

### RELAY-003 — Relay inputs and retained state are broadly unbounded

1. **Title:** HTTP/WS payloads, chats, pairings, and text can grow without practical quotas.
2. **Severity:** Medium
3. **Confidence:** Confirmed by code review.
4. **Affected component:** Relay server.
5. **Affected files/lines:** `Relay/src/relay/server.ts:199-345`, `:358-556`, `:926-945`, `:1049-1065`.
6. **Description:** JSON bodies buffer until end; message text/counts, sessions, pairing records, and several payload objects lack caps. The offline queue caps item count but not bytes.
7. **Evidence:** `readJsonBody` concatenates chunks without a byte limit; retention/pruning policies are absent.
8. **Reproduction steps:** Static review only; no denial-of-service testing performed.
9. **Expected behavior:** Explicit byte/count/rate/TTL limits with 413/429 errors and predictable cleanup.
10. **Actual behavior:** Memory, disk, serialization cost, and broadcast traffic can grow with caller input.
11. **User impact:** Progressive slowdown, storage exhaustion, and relay instability.
12. **Technical cause:** Schemas describe shapes but not resource budgets/lifecycle.
13. **Recommended fix:** Central request limits, WS max payload, per-account/device quotas, chat pagination/retention, pairing expiry cleanup, and metrics.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `SECURITY-001`, `RELAY-002`.
16. **Suggested regression test:** Boundary tests one byte/item below and above every limit, plus sustained-load memory assertions.

### RELAY-004 — Online status has no stale-heartbeat watchdog

1. **Title:** Device presence relies primarily on socket closure.
2. **Severity:** Medium
3. **Confidence:** Highly Likely.
4. **Affected component:** Relay presence/device UI.
5. **Affected files/lines:** `Relay/src/relay/server.ts:358-452`, `:688-724`; `client/src/data/relay.ts:86-113`.
6. **Description:** Heartbeat timestamps are recorded, but no periodic expiry transitions a silent half-open device offline.
7. **Evidence:** No heartbeat deadline scan/watchdog was found; UI maps supplied timestamps/status.
8. **Reproduction steps:** Future safe test: create a half-open connection that stops traffic without a close frame.
9. **Expected behavior:** Mark stale after a documented heartbeat budget and surface reconnecting/degraded separately.
10. **Actual behavior:** Status can remain online until transport-level timeout.
11. **User impact:** Users send work to devices that are no longer reachable.
12. **Technical cause:** Heartbeats update metadata but do not drive a presence state machine.
13. **Recommended fix:** Add server-side heartbeat deadlines, ping/pong, stale cleanup, and reasoned presence transitions.
14. **Estimated effort:** Small/Medium
15. **Dependencies/related:** `UI-001`, `PROTOCOL-002`.
16. **Suggested regression test:** Suppress heartbeats without closing socket; assert stale then offline and later clean recovery.

### AGENT-003 — Provider HTTP work has no consistent timeout or cancellation

1. **Title:** Chat/history calls can remain active after the UI gives up.
2. **Severity:** Medium
3. **Confidence:** Confirmed by code review.
4. **Affected component:** Agent provider runtime, client chat.
5. **Affected files/lines:** `server/src/modules/provider/providerRuntime.ts:185-210`, `:237-260`, `:421-465`; `client/src/features/chat/ChatView.tsx:379-477`.
6. **Description:** Fetch calls lack AbortSignals/timeouts; the API and UI expose no cancellation contract. SSE emits coarse state and a final complete response rather than cancellable token streaming.
7. **Evidence:** Fetch calls are awaited directly; no request-close abort propagation or Stop control was found.
8. **Reproduction steps:** Point to a provider that accepts and never responds; close/navigate the UI.
9. **Expected behavior:** Deadline, user cancellation, provider abort propagation, and terminal turn state.
10. **Actual behavior:** Work may continue until provider/network timeout while UI has no control.
11. **User impact:** Stuck spinners, resource leaks, late surprise replies, and unclear retry safety.
12. **Technical cause:** Provider contract returns one promise and lacks cancellation/stream lifecycle primitives.
13. **Recommended fix:** Thread AbortSignal through HTTP/API/provider adapters; model turn states; add Cancel and explicit timeout UX.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `AGENT-001`, `PROTOCOL-002`.
16. **Suggested regression test:** Cancel and disconnect at accepted/thinking/streaming phases; assert provider abort and exactly one terminal state.

### CLIENT-002 — “Minimize to tray” setting has no tray implementation

1. **Title:** A visible setting promises behavior the desktop shell does not implement.
2. **Severity:** Medium
3. **Confidence:** Confirmed by code review.
4. **Affected component:** Settings/Electron lifecycle.
5. **Affected files/lines:** `client/src/features/settings/SettingsView.tsx:278-291`; `client/desktop/main.ts` (no Tray usage; window closes via standard lifecycle).
6. **Description:** The toggle is stored and enabled by default, but the Electron main process never reads it or creates a tray icon.
7. **Evidence:** Repository search finds `minimizeToTray` only in settings/default/API types and no `Tray` construction.
8. **Reproduction steps:** Toggle setting, minimize/close packaged app, observe normal window/process behavior.
9. **Expected behavior:** Minimize/close behavior follows the setting with a visible tray menu.
10. **Actual behavior:** Toggle has no desktop effect.
11. **User impact:** Lost trust in settings and accidental app termination.
12. **Technical cause:** Renderer setting was shipped before Electron integration.
13. **Recommended fix:** Implement end-to-end tray behavior or hide/label the setting unavailable.
14. **Estimated effort:** Small/Medium
15. **Dependencies/related:** shutdown/restart behavior.
16. **Suggested regression test:** Packaged test for enabled/disabled minimize, close, restore, and quit paths.

### CLIENT-003 — Server/client update toggles are not independent

1. **Title:** Update controls imply separate targets but the updater acts on the whole delivery.
2. **Severity:** Medium
3. **Confidence:** Confirmed by code review.
4. **Affected component:** Settings/update service.
5. **Affected files/lines:** `client/src/features/settings/SettingsView.tsx:300-335`; `server/src/modules/update/updateService.ts`.
6. **Description:** UI offers server and client automatic-update switches, while eligibility is effectively OR-combined and apply paths update the repository or installer as a unit.
7. **Evidence:** No independently versioned/downloaded server target is selected from those two toggles.
8. **Reproduction steps:** Enable only one target, check/apply an update, trace the selected apply path.
9. **Expected behavior:** Each toggle controls exactly the named component, or UI exposes one app update policy.
10. **Actual behavior:** Separate controls do not map to separate artifacts.
11. **User impact:** Unexpected updates and misleading operational control.
12. **Technical cause:** UI model is more granular than packaging/release architecture.
13. **Recommended fix:** Collapse to one desktop update control now; only split after independently versioned/signed artifacts exist.
14. **Estimated effort:** Small
15. **Dependencies/related:** packaging/release design.
16. **Suggested regression test:** Matrix of toggle states against reported/applicable targets.

### UI-001 — Home reports “All systems operational” while providers are offline

1. **Title:** Health summary reflects backend mode, not actual dependencies.
2. **Severity:** Medium
3. **Confidence:** Confirmed visually and at runtime.
4. **Affected component:** Home dashboard.
5. **Affected files/lines:** `client/src/features/home/HomePage.tsx:49-58`; provider status from app state.
6. **Description:** The status copy becomes healthy whenever the client is not in fallback mode, even if configured providers are unavailable.
7. **Evidence:** Current screenshot showed “All systems operational” while the agent runtime reported CommandCenter and OpenClaw offline.
8. **Reproduction steps:** Start local agent with unavailable providers and open Home.
9. **Expected behavior:** Summarize relay, agent server, and selected provider separately or say “App connected; 2 providers unavailable.”
10. **Actual behavior:** A global green operational claim is displayed.
11. **User impact:** Users misdiagnose why chat/provider workflows fail.
12. **Technical cause:** Presentation derives health from renderer backend fallback only.
13. **Recommended fix:** Create a typed aggregate health model with degraded reasons and scoped status copy.
14. **Estimated effort:** Small
15. **Dependencies/related:** `AGENT-002`, `RELAY-004`.
16. **Suggested regression test:** Provider/relay/agent health matrix with expected headline and CTA.
17. **Visual details:** Home; requested browser viewport 1540×940 at 100%; `audit-artifacts/2026-07-10/screenshots/01-home-1540x940.jpg`; always reproducible in tested state.

### UI-002 — Chat chrome crowds the core conversation at laptop width

1. **Title:** Large portrait plus two sidebars leaves a narrow chat column.
2. **Severity:** Medium
3. **Confidence:** Confirmed visually.
4. **Affected component:** Chat.
5. **Affected files/lines:** `client/src/features/chat/ChatView.tsx:540-756`; `client/src/styles.css` chat layout rules.
6. **Description:** At the tested laptop-like viewport, the agent portrait is extremely large/cropped, agent title wraps to three lines, and persistent global/chat sidebars consume much of the width.
7. **Evidence:** Screenshot `02-chat-empty-mock-1540x940.jpg`.
8. **Reproduction steps:** Open Chat at requested 1540×940 browser viewport.
9. **Expected behavior:** Conversation/composer is primary; supporting art and navigation adapt or collapse.
10. **Actual behavior:** Character art dominates while useful message width is compressed.
11. **User impact:** Long messages/code are harder to scan; the app feels decorative before functional.
12. **Technical cause:** Fixed desktop proportions lack an intermediate responsive breakpoint.
13. **Recommended fix:** Collapse the secondary chat rail or shrink portrait/header between roughly 1180–1600px; keep agent identity in a compact header.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `PERF-001`, `UI-004`.
16. **Suggested regression test:** Screenshot matrix at min window, 1366×768, 1536×864, and 1920×1080 with long code/message fixtures.
17. **Visual details:** Chat; requested 1540×940/100%; screenshot above; always reproduced at tested size.

### UI-003 — Heart reaction looks interactive but does nothing

1. **Title:** Reaction pill has no action or disabled semantics.
2. **Severity:** Medium
3. **Confidence:** Confirmed by code review and visible UI.
4. **Affected component:** Chat message actions.
5. **Affected files/lines:** `client/src/features/chat/ChatView.tsx:731-733`.
6. **Description:** A normal button with hover affordance and aria-label has no click handler.
7. **Evidence:** Source contains the button/icon only; it appears under a live response in `03-chat-mock-response-1540x940.jpg`.
8. **Reproduction steps:** Send a mock message and click Heart.
9. **Expected behavior:** Persist a reaction or omit/disable the control with an explanation.
10. **Actual behavior:** No state or feedback changes.
11. **User impact:** Dead-control frustration and reduced trust.
12. **Technical cause:** Visual component shipped ahead of behavior.
13. **Recommended fix:** Remove until reactions have a data contract, or implement optimistic/persistent reaction state.
14. **Estimated effort:** Small
15. **Dependencies/related:** protocol reaction schema if implemented.
16. **Suggested regression test:** Keyboard/click toggle, persistence, failure rollback, and accessible pressed state.
17. **Visual details:** Chat response; requested 1540×940/100%; screenshot above; always reproducible.

### UI-004 — Chat does not render Markdown or code blocks

1. **Title:** Agent output is displayed as plain paragraph text.
2. **Severity:** Medium
3. **Confidence:** Confirmed by code review.
4. **Affected component:** Chat renderer.
5. **Affected files/lines:** `client/src/features/chat/ChatView.tsx:708-734`.
6. **Description:** Messages use plain text in a paragraph with no Markdown, code block, copy, wrapping, or syntax treatment.
7. **Evidence:** Render path directly inserts message body.
8. **Reproduction steps:** Ask an agent for fenced code, a list, table, or links.
9. **Expected behavior:** Safe Markdown subset with readable code blocks and copy behavior.
10. **Actual behavior:** Markdown markers remain literal and complex technical output is difficult to use.
11. **User impact:** Core developer/agent workflows are materially less useful.
12. **Technical cause:** Initial text renderer was never promoted to a structured message renderer.
13. **Recommended fix:** Add sanitized Markdown with explicit URL policy, code scrolling/copy, and very-long-token wrapping.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `SECURITY-002`, `UI-002`.
16. **Suggested regression test:** XSS corpus plus Markdown/code/long-token visual snapshots.

### UI-005 — Long chat growth lacks auto-scroll and virtualization

1. **Title:** All messages render and new responses are not deliberately brought into view.
2. **Severity:** Medium
3. **Confidence:** Highly Likely from code review.
4. **Affected component:** Chat performance/UX.
5. **Affected files/lines:** `client/src/features/chat/ChatView.tsx:340-477`, `:700-735`.
6. **Description:** The entire message array is mapped into DOM; no list virtualization, bottom-anchor policy, or unread/new-message affordance was found.
7. **Evidence:** No scroll ref/effect or virtual list in the chat component.
8. **Reproduction steps:** Load a large conversation, scroll upward, receive/send a new response.
9. **Expected behavior:** Bounded rendering and predictable “follow latest unless user is reading history” behavior.
10. **Actual behavior:** Rendering cost grows linearly and new replies may arrive below the viewport.
11. **User impact:** Slower long sessions and apparently missing responses.
12. **Technical cause:** Prototype list rendering without a scroll-state model.
13. **Recommended fix:** Paginate history, virtualize large lists, add bottom sentinel/new-message chip, and preserve reading position.
14. **Estimated effort:** Medium
15. **Dependencies/related:** session pagination and `PERF-001`.
16. **Suggested regression test:** 10k-message fixture, memory/frame timing, scroll-up response, navigation restoration.

### A11Y-001 — Modal and custom interactive semantics are incomplete

1. **Title:** Connection/settings interactions lack robust keyboard/focus behavior.
2. **Severity:** Medium
3. **Confidence:** Highly Likely from code review; full assistive-technology pass not performed.
4. **Affected component:** Connection wizard and settings controls.
5. **Affected files/lines:** connection wizard component under `client/src/features/connections`; `client/src/features/settings/SettingsView.tsx` custom clickable rows; global styles.
6. **Description:** No complete focus trap/restore/Escape lifecycle was found for the wizard; at least one `div role=button` path lacks equivalent key activation; no reduced-motion media policy was found.
7. **Evidence:** Manual DOM/code inspection. The browser capture could not reliably capture the wizard layer and is excluded as visual evidence.
8. **Reproduction steps:** Keyboard-only open/use/close wizard; Tab through settings; enable OS reduced motion.
9. **Expected behavior:** Native controls where possible, trapped/restored modal focus, Escape close, visible focus, and motion reduction.
10. **Actual behavior:** Keyboard behavior is incomplete/inconsistent.
11. **User impact:** Keyboard and motion-sensitive users may be blocked or disoriented.
12. **Technical cause:** Accessibility behaviors were applied per element rather than through shared primitives.
13. **Recommended fix:** Introduce tested Dialog/Button/Switch primitives and a reduced-motion token policy.
14. **Estimated effort:** Medium
15. **Dependencies/related:** UI component system.
16. **Suggested regression test:** axe plus keyboard Playwright flows and reduced-motion snapshots.

### PERF-001 — Main client payload includes many multi-megabyte portraits

1. **Title:** Agent art dominates the renderer payload.
2. **Severity:** Medium
3. **Confidence:** Confirmed by production build.
4. **Affected component:** Client startup/package size.
5. **Affected files/lines:** `client/src/data/assets.ts`; static imports in feature components; generated `client/dist/assets`.
6. **Description:** The Vite build emitted many individual PNG assets between roughly 1.5 MB and 2.3 MB, all associated with the main app build.
7. **Evidence:** Production build output listed more than a dozen 1.5–2.3 MB images; JS itself was ~309 kB and CSS ~84 kB, showing imagery is the dominant payload.
8. **Reproduction steps:** Run `npm run build --workspace agenthub-phase1-ui` and inspect asset sizes/network load.
9. **Expected behavior:** Responsive WebP/AVIF variants, lazy page/agent loading, thumbnails, and bounded decoded image memory.
10. **Actual behavior:** Large source PNGs are bundled directly.
11. **User impact:** Slower cold start, larger installer/update, higher memory, and UI jank on lower-end machines.
12. **Technical cause:** Static eager asset catalog and no image pipeline.
13. **Recommended fix:** Generate size-specific modern formats, lazy import per agent/page, preload only the selected agent, and budget bundle/image bytes in CI.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `UI-002`.
16. **Suggested regression test:** Cold-start timing and bundle budget on clean Windows VM; assert no portrait exceeds target dimensions/bytes.

### ARCH-001 — Core modules combine too many responsibilities

1. **Title:** Several files are large coordination monoliths.
2. **Severity:** Medium
3. **Confidence:** Confirmed.
4. **Affected component:** Maintainability across agent, relay, and UI.
5. **Affected files/lines:** `server/src/main.ts` (~1,535 lines); `Relay/src/relay/server.ts` (~1,068); `server/src/modules/art/artStore.ts` (~977); `client/src/features/chat/ChatView.tsx` (~908); `client/src/features/art/AgentArtStudio.tsx` (~887); `client/src/lib/reikaApi.ts` (~796).
6. **Description:** Transport routing, validation, domain mutation, persistence, and presentation state are colocated.
7. **Evidence:** Line counts and cross-cutting responsibilities; critical chat behavior is nested inside HTTP server setup.
8. **Reproduction steps:** Trace a chat failure or add one protocol field across files.
9. **Expected behavior:** Explicit domain services with testable boundaries and thin adapters.
10. **Actual behavior:** Small changes require broad contextual reasoning and encourage string-coupled tests.
11. **User impact:** Slower fixes and higher regression probability.
12. **Technical cause:** Vertical-slice growth without a subsequent boundary extraction.
13. **Recommended fix:** Extract chat turn coordinator, relay repositories/auth/router, provider adapters, and view-model hooks incrementally—do not perform a broad rewrite.
14. **Estimated effort:** Architectural, incremental
15. **Dependencies/related:** `TEST-001`, `RELAY-002`.
16. **Suggested regression test:** Contract tests around each extracted boundary before moving code.

### DOCS-001 — Documentation describes incompatible product phases

1. **Title:** Setup/architecture claims contradict current implementation.
2. **Severity:** Medium
3. **Confidence:** Confirmed.
4. **Affected component:** Repository documentation/developer experience.
5. **Affected files/lines:** `README.md:270`; `shared/README.md`; `server/README.md:406`; `server/docs/CONNECTION-PLAN.md:27+`; `client/design-qa.md:2`.
6. **Description:** Root guardrails say chat routing/file operations are excluded while they exist; connection plan lists now-implemented items as absent; provider-history statements conflict; design QA claims no P0/P1/P2 findings.
7. **Evidence:** Direct comparison of docs with source and runtime.
8. **Reproduction steps:** Read documentation in stated onboarding order, then inspect current routes/scripts.
9. **Expected behavior:** One current architecture/status source with historical plans clearly archived.
10. **Actual behavior:** A new contributor cannot know which constraints or features are current.
11. **User impact:** Incorrect setup expectations, duplicated work, and false confidence.
12. **Technical cause:** Phase documents were updated additively instead of superseded/versioned.
13. **Recommended fix:** Publish a current-state architecture/status page; mark old plans historical; link generated API/protocol references; remove self-certifying QA claims.
14. **Estimated effort:** Small
15. **Dependencies/related:** `TEST-001`, product onboarding.
16. **Suggested regression test:** Documentation CI checks commands/paths plus a release checklist requiring status-page update.

### UI-006 — Remote chat refresh can switch back to a local provider

1. **Title:** Refresh action is scoped to local provider discovery.
2. **Severity:** Low
3. **Confidence:** Highly Likely.
4. **Affected component:** Chat provider selector.
5. **Affected files/lines:** `client/src/features/chat/ChatView.tsx:312-326`.
6. **Description:** Refresh always calls local `refreshProviders()` and selects its active provider even when the user is chatting through a relay device.
7. **Evidence:** Handler does not branch on remote selection/device identity.
8. **Reproduction steps:** Select remote agent/provider, press refresh, inspect selected provider.
9. **Expected behavior:** Refresh the selected device roster or preserve remote selection.
10. **Actual behavior:** Local active provider may replace the current context.
11. **User impact:** Accidental agent/provider switch and confusing empty history.
12. **Technical cause:** Local and remote provider discovery share one UI action without scope.
13. **Recommended fix:** Label and scope refresh to current device; preserve identity if still present.
14. **Estimated effort:** Small
15. **Dependencies/related:** device/provider identity model.
16. **Suggested regression test:** Refresh local and two remote device contexts without selection drift.

### CLIENT-004 — “View Profile” navigates to chat

1. **Title:** Profile CTA is an alias for Chat Now.
2. **Severity:** Low
3. **Confidence:** Confirmed.
4. **Affected component:** Home/notifications navigation.
5. **Affected files/lines:** `client/src/features/home/HomePage.tsx:68-81`; `client/src/features/notifications/NotificationsView.tsx:213`.
6. **Description:** The profile-labeled control invokes the chat route rather than profile/art/details.
7. **Evidence:** Both CTAs call the same open-chat callback.
8. **Reproduction steps:** Click View Profile from Home or Notifications.
9. **Expected behavior:** Open agent profile/details, or label the button Chat.
10. **Actual behavior:** Opens chat.
11. **User impact:** Navigation feels unreliable and agent customization is harder to discover.
12. **Technical cause:** Placeholder navigation survived after profile/art surfaces were added.
13. **Recommended fix:** Route to a real profile/art summary or rename consistently.
14. **Estimated effort:** Small
15. **Dependencies/related:** product journey recommendations.
16. **Suggested regression test:** Route assertion for every card CTA.

### CLIENT-005 — Hard-coded demo account/build identity leaks into normal UI

1. **Title:** Account shell presents Epic/epic@agenthub.dev and “Local Build” as if real.
2. **Severity:** Low
3. **Confidence:** Confirmed visually/code review.
4. **Affected component:** App shell/settings.
5. **Affected files/lines:** app shell/account constants under `client/src`.
6. **Description:** Development identity is displayed without being connected to an account model.
7. **Evidence:** Visible in the tested client and sourced from constants.
8. **Reproduction steps:** Open account/settings area on a clean launch.
9. **Expected behavior:** Honest local-only identity or real account data.
10. **Actual behavior:** Product-looking placeholder data.
11. **User impact:** Confusion about login, privacy, and cloud sync.
12. **Technical cause:** Design fixture became production shell copy.
13. **Recommended fix:** Replace with “Local profile” and device-local explanation until accounts exist.
14. **Estimated effort:** Small
15. **Dependencies/related:** `SECURITY-001` future account model.
16. **Suggested regression test:** Clean-profile screenshot/text assertion contains no hard-coded personal identity.

### TEST-002 — No standard test/lint/CI entry point

1. **Title:** Common quality commands and visible CI workflow are absent.
2. **Severity:** Low
3. **Confidence:** Confirmed.
4. **Affected component:** Developer experience.
5. **Affected files/lines:** root/workspace `package.json`; repository `.github` metadata.
6. **Description:** Root `npm test` and `npm run lint` fail because scripts do not exist; no repository CI workflow was found.
7. **Evidence:** Both commands returned “Missing script”; GitHub showed no open quality work and local metadata had no workflow.
8. **Reproduction steps:** Run the commands from root and inspect `.github/workflows`.
9. **Expected behavior:** One documented `npm run verify`/CI pipeline.
10. **Actual behavior:** Quality checks are fragmented and optional.
11. **User impact:** Contributors and releases omit different checks.
12. **Technical cause:** Build-first monorepo scripts were not consolidated into a gate.
13. **Recommended fix:** Add lint, unit/integration test, protocol check, build, dependency audit policy, and Windows smoke to CI.
14. **Estimated effort:** Medium
15. **Dependencies/related:** `TEST-001`.
16. **Suggested regression test:** Clean CI job is itself the enforcement.

### OBS-001 — Clean install/build is reproducible

1. **Title:** Fresh checkout installs and builds successfully.
2. **Severity:** Observation
3. **Confidence:** Confirmed.
4. **Affected component:** Whole monorepo.
5. **Affected files/lines:** package lock and workspace manifests.
6. **Description/Evidence:** A temporary clean clone at the audited commit completed `npm ci` (405 packages) and `npm run build` successfully.
7. **Reproduction:** Clone, checkout commit, `npm ci`, `npm run build`.
8. **Expected/Actual:** Both succeeded.
9. **Impact:** Strong baseline for repair work.
10. **Cause/Fix/Effort/Dependencies/Test:** Preserve lockfile determinism; enforce in CI; Small.

### OBS-002 — Windows package and embedded server build successfully

1. **Title:** NSIS packaging completes and the unpacked app starts with isolated services.
2. **Severity:** Observation
3. **Confidence:** Confirmed.
4. **Affected component:** Client packaging.
5. **Affected files/lines:** `client/electron-builder.json`; desktop build scripts.
6. **Description/Evidence:** Desktop build completed in ~128 seconds, produced installer/unpacked app, launched, and proxied isolated agent and relay health successfully.
7. **Reproduction:** `npm run build:desktop --workspace agenthub-phase1-ui`, launch unpacked executable with isolated state.
8. **Expected/Actual:** Package created and health passed.
9. **Impact:** Packaging foundation is viable.
10. **Cause/Fix/Effort/Dependencies/Test:** Address packaging warnings: missing description/author and SEA “signature seems corrupted” warning; verify Authenticode/reproducibility before release.

### OBS-003 — Local mock chat visibly works

1. **Title:** Core local happy path produces and persists a response.
2. **Severity:** Observation
3. **Confidence:** Confirmed.
4. **Affected component:** Client + local agent.
5. **Affected files/lines:** Chat UI and mock provider adapter.
6. **Description/Evidence:** At the audited viewport, Mock was selected, a user message was sent, an assistant response appeared, and a session was created.
7. **Reproduction:** Start isolated agent/client, select Mock, send a message.
8. **Expected/Actual:** Successful.
9. **Impact:** The principal local vertical slice is usable.
10. **Cause/Fix/Effort/Dependencies/Test:** Protect with behavioral UI smoke.

## Visual and UX flow audit

Current-run screenshots are under `audit-artifacts/2026-07-10/screenshots/`. The browser viewport override was 1540×940 at 100%; captured content bitmaps were 1525×931 after browser chrome. Visual review was intentionally limited after sufficient evidence was collected.

| Step | Health | Evidence | Result/blocker |
|---|---|---|---|
| 1. Loading → Home | Healthy with misleading status | `01-home-1540x940.jpg` | Strong branded transition and layout; global health claim is inaccurate (`UI-001`). |
| 2. Home → Chat (Mock) | Degraded | `02-chat-empty-mock-1540x940.jpg` | Navigation works; art/title/sidebar balance crowds the conversation (`UI-002`). |
| 3. Send local message | Healthy with dead affordance | `03-chat-mock-response-1540x940.jpg` | Response visible and session persisted; reaction does nothing (`UI-003`). |
| 4. Devices | Mostly healthy | `04-devices-1540x940.jpg` | Summary and selection are clear; many unknown/dash metrics and deeper details fall below fold. |
| 5. Connection wizard | Not visually verified | rejected capture `05-connection-wizard-1540x940.jpg` | DOM showed the dialog, but in-app capture repeatedly recorded only the dim backdrop. Not reported as a confirmed z-index bug. |
| 6. Settings | Healthy with misleading controls | `06-settings-general-1540x940.jpg` | Coherent design; tray and split update controls do not match runtime behavior (`CLIENT-002/003`). |
| 7. Minimum/1080p/high-DPI matrix | Not run | — | Cut for time after the user requested a faster code-focused audit. `UI-002` should be the starting regression case. |

## Repository and documentation inconsistencies

- Root README still frames chat/file operations as excluded Phase 1 scope while those systems are central to current code.
- Connection planning and server README mix historical “not implemented” notes with newer implementations.
- Shared protocol docs lag chat/activity message types.
- `client/design-qa.md` claims no P0/P1/P2 issues and references external/missing screenshot paths; it is not a reliable current QA record.
- Package metadata is incomplete for Electron distribution.
- The repository tracks sizable `.agents` logs/screenshots; useful audit evidence should be intentionally retained elsewhere or excluded to control clone size.

## Data and protocol assessment

- The canonical shared protocol sync check passes for its managed copies.
- Runtime payload validation is much weaker than TypeScript types: several handlers validate envelope headers but trust nested payloads and caller IDs.
- `fileIds` lack device/store scope (`CLIENT-001`).
- Request IDs lack idempotent delivery meaning (`PROTOCOL-002`).
- Chat data is a flat message sequence rather than explicit turns (`AGENT-001`, `PROTOCOL-001`).
- Imported provider session IDs are sanitized/truncated to 80 characters without a collision-resistant suffix (`server/src/main.ts:512-518`), a Low-risk collision/data-merge concern worth fixing when import is expanded.
- There is no explicit compatibility negotiation for independently deployed client/relay/agent versions beyond protocol fields.

## Performance and reliability summary

Main risks are large eager imagery, full-store JSON rewrites, full conversation rendering, full state broadcasts, polling plus fixed reconnect loops, and unbounded retention. None prevented the small isolated smoke, but all worsen nonlinearly with real users/devices/history. Establish budgets before optimizing blindly: cold launch, time-to-home, time-to-chat, relay p95 event-loop lag, store size/write latency, reconnect traffic, and 10k-message chat memory/frame time.

## Test coverage gaps

Critical missing behavioral tests:

1. Per-session concurrent turn ordering and failed-turn rollback/state.
2. Relay delivery deduplication across reconnect/fallback/offline queue.
3. Account/device authorization isolation.
4. Manual disconnect vs unexpected network reconnect.
5. Half-open heartbeat expiry.
6. Remote attachment transfer or explicit prohibition.
7. Windows provider discovery with HOME unset/packaged userData.
8. Provider timeout/cancel and shutdown during work.
9. Large/malformed payload boundaries without destructive load testing.
10. Packaged UI tests for tray, update copy, agent selection, persistence, and responsive layouts.

## Dependency and security hygiene

`npm audit` reported 7 advisories (6 high, 1 moderate) in the current dependency graph, including Electron, `tar` through packaging dependencies, and an `esbuild` development-server advisory. Suggested automated fixes require major-version movement (Electron 43 / electron-builder 26), so update deliberately with packaged regression coverage. No active exploitation was attempted. Treat dependency updates as defense-in-depth after `SECURITY-001` and messaging integrity, not a substitute for those architectural fixes.

## Commands executed and results

| Command/test | Result |
|---|---|
| `git fetch --prune` and compare `HEAD`/`origin/main` | PASS; both `cdbc744...` |
| Repository/GitHub metadata, branches, issues, PRs | PASS; public repo, no open issues/PRs observed |
| `npm ci` in fresh temporary clone | PASS; 405 packages |
| `npm run build` in fresh clone | PASS |
| `npm run build` in workspace | PASS |
| Shared/server/relay typechecks | PASS |
| `npm run check:protocol` | PASS |
| `npm run build:desktop --workspace agenthub-phase1-ui` | PASS with metadata/SEA warning |
| Launch isolated relay + agent + Vite client | PASS |
| Launch unpacked packaged app and check agent/relay proxies | PASS |
| Local Mock chat and session persistence | PASS |
| Agent→relay pairing/uplink | PASS |
| `POST /uplink/disconnect` persistence | FAIL; reconnects ~1.2 s |
| Invalid-provider turn durability | FAIL; orphan user message stored |
| Concurrent delayed turns | FAIL; assistant completion order interleaves turns |
| `npm run test:chat-relay` | FAIL; stale OpenClaw source assertion |
| `npm run smoke:desktop-relay-chat` | FAIL; stale Nyxie selector assertion after Astra passed |
| `npm test` | FAIL; missing script |
| `npm run lint` | FAIL; missing script |
| `npm audit` | 7 advisories (6 high, 1 moderate) |
| Existing workspace `npm ls --all --depth=0` | FAIL; local node_modules has unmet workspace links; clean `npm ci` disproved a repository install blocker |

## Areas not tested / limitations

- No exploit development, penetration test, auth bypass attempt, credential attack, malicious-message execution, destructive load, or deliberate state corruption was performed.
- Real CommandCenter/OpenClaw/Hermes conversations were not sent; Mock and deterministic local provider fixtures were used.
- Microsoft installer signing/trust prompts, updater installation, tray behavior, multi-instance collision, OS suspend/resume, and system reboot were not fully exercised.
- Full minimum-size, 1920×1080, maximized, 125%/150% DPI, screen-reader, and keyboard-only matrices were not completed.
- The connection wizard screenshot was rejected because the capture omitted the modal layer; code review still informed accessibility notes.
- Server restart persistence was inspected through stores and existing smoke intent but not exhaustively fault-injected.
- GitHub showed current public metadata, but historical closed issues/PR discussions were not exhaustively mined after scope was shortened.

## Quick wins

1. Fix manual disconnect desired-state handling.
2. Validate provider before appending a chat message; visibly mark failed turns.
3. Repair both regression commands and run them in CI.
4. Replace false Home health copy with scoped status.
5. Hide/disable remote attachments and unimplemented tray/reaction controls.
6. Use `homedir()`, `path.join`, and `path.delimiter` for provider discovery.
7. Add HTTP/WS body limits and atomic relay writes.
8. Compress/lazy-load portraits.
9. Consolidate current documentation and archive historical phase notes.

## Architectural concerns

The largest strategic risk is adding more orchestration features before defining four contracts:

1. **Identity/trust:** who is the app, account, device, provider, and agent; what may each do?
2. **Delivery:** at-most-once vs at-least-once, acknowledgement states, retry, deduplication, offline policy.
3. **Conversation:** turns, sequence, concurrency, failure, cancellation, provider session mapping.
4. **Data scope/lifecycle:** which device owns files/history/art, retention/quotas, migration/versioning.

These should become small domain modules and tests, not a sweeping rewrite.

## Prioritized remediation plan

### 1. Fix immediately

- Disable public/untrusted relay use or place it behind a real authenticated tenant boundary (`SECURITY-001`).
- Repair failed-turn integrity and per-session ordering (`AGENT-001`, `PROTOCOL-001`).
- Fix manual disconnect (`RELAY-001`).
- Repair the two red regression commands and make a single green verification command (`TEST-001`).

### 2. Fix before additional feature development

- Define idempotent relay delivery/acknowledgements (`PROTOCOL-002`).
- Fix Windows provider paths (`AGENT-002`).
- Disable or implement remote attachments (`CLIENT-001`).
- Add provider timeouts/cancellation and terminal turn states (`AGENT-003`).
- Extract chat/relay domain boundaries behind tests (`ARCH-001`).

### 3. Fix before public testing

- Add relay quotas, atomic persistence, heartbeat expiry, and observability.
- Harden Electron navigation/CSP/sandbox policy.
- Make health, tray, update, and profile UI honest.
- Add Markdown/code, long-chat scroll behavior, and responsive chat layout.
- Run keyboard, min-size, DPI, and packaged Windows matrices.

### 4. Fix before production

- Transactional relay store and migrations/backups.
- Signed/verifiable update pipeline and dependency upgrades.
- Auditable device credential lifecycle and account recovery.
- Load/capacity tests, retention controls, diagnostics export with redaction.
- Version negotiation and backward-compatibility policy.

### 5. Optional polish

- Reactions, richer profile routing, deeper art studio flow, visual animation refinements, and additional account presentation.

## Recommended regression-test plan

Build a layered gate:

1. **Unit:** turn state machine, idempotency ledger, auth decisions, path resolution, payload limits, store migrations.
2. **Contract:** all protocol messages validated from fixtures shared by client/relay/agent.
3. **Integration:** isolated relay + two agents + app client, including offline queue, reconnect, duplicate response suppression, and scoped files.
4. **Packaged Windows:** launch installer/unpacked app, visible two-agent replies, persistence after navigation/restart, tray/lifecycle, provider paths.
5. **Visual/accessibility:** stable screenshot states at four viewports, keyboard-only journeys, axe, reduced motion, long content.
6. **Failure injection:** timeouts, half-open sockets, process exit during turn/write, stale versions, full quotas—safe deterministic fixtures only.

## Product assessment (recommendations, not confirmed defects)

### Current experience and differentiation

Project Reika is strongest when it feels like a **living control surface for persistent agents**, not another model dropdown. Character identity, device presence, provider-backed execution, relay connectivity, art, notifications, and history already point toward that. The interface is polished enough to communicate personality, but the nouns “device,” “provider,” “agent,” “relay,” and “agent server” are presented as peers when they are actually a hierarchy. Technical users can infer it; normal users will not.

Best current audience: developers and enthusiasts running several local agent stacks or machines. Users with one cloud model may see extra setup without enough benefit. The value proposition becomes clear only after a user sees the same persistent agent available across devices with understandable location, capability, history, and trust.

### Ranked next steps

| Rank/category | Recommendation | Problem/opportunity and why | Beneficiary/impact | Foundation/dependencies | Risks | Effort | Phase/timing |
|---|---|---|---|---|---|---|---|
| 1 Core stability | Trustworthy turn pipeline | Ordering, retry, failure, and cancellation are the core product contract | Everyone; prevents wrong/duplicate work | Turn IDs, queue, idempotency, terminal states | Migration complexity | Large | Stability phase; before public testing |
| 2 Core stability | Account/device trust boundary | Relay cannot safely be the product’s connective tissue without ownership | Remote/multi-device users | Auth, tenant scope, device keys, audit | Recovery/support burden | Architectural | Stability phase; before any public relay |
| 3 UX | Unified connection health center | Current global status hides which layer failed | New and technical users; faster recovery | Typed health model/diagnostics | Information overload | Medium | Before public testing |
| 4 UX | Guided first-agent journey | Setup nouns are too infrastructure-first | New users; faster first success | Provider detection, connection wizard, honest state | Provider variability | Medium | Before public testing |
| 5 Near-term feature | Conversation workspace | Search, Markdown/code, reliable history, retry/cancel make agents useful daily | Power users | Stable turn pipeline/pagination | Scope creep | Medium/Large | After core repairs |
| 6 Near-term feature | Agent presence card | Show where agent runs, availability, capabilities, current work, last sync | Multi-device users; makes Reika distinct | Identity/presence model | Stale-state risk | Medium | After reliable health |
| 7 Strategic | Permission-aware remote actions | Users approve capabilities by agent/device/task | Remote automation users | Auth, tool model, audit logs | High safety complexity | Large | Production phase |
| 8 Postpone | Multi-agent autonomous orchestration | Exciting but amplifies every current delivery/trust ambiguity | Niche advanced users | All preceding contracts | Invisible complexity and duplicate effects | Architectural | After production foundation |

### Important user journeys

| Journey | Current likely experience | Main friction/missing feedback | Recommended improved flow | Reduce steps / make it alive |
|---|---|---|---|---|
| First launch | Branded loading then populated-looking Home | Demo identity/agents obscure what is real | Choose Local-only or Connect devices; run automatic diagnostics; first-success checklist | One guided path ending in a real reply |
| Connect first device | Wizard plus pairing concepts | Relay purpose/trust and progress unclear | Explain “secure bridge,” show app↔relay↔device diagram, expiring code, named errors | Detect local device; one primary CTA |
| Connect first provider | Provider list with availability | Missing provider may look like app failure | Auto-detect, show searched locations, test connection, actionable install/config guidance | Fix path detection; one Test button |
| Discover/select agent | Agent cards and provider selector | Duplicate identities across providers; location hidden | Canonical agent with provider/device availability chips and preferred route | Select the agent first; route automatically but visibly |
| First conversation | Attractive chat; local Mock works | Narrow layout, no Markdown, failure/route ambiguity | Preflight selected route, show agent/location, safe pending/failed/retry/cancel states | Default to healthy route; composer owns recovery |
| Understand local/remote/online | Status scattered across pages | Global healthy claim masks provider failures | One presence sentence: “Reika is online on Desktop via Hermes” with expandable path | Use plain language first, topology second |
| Recover disconnect | Automatic reconnect, manual disconnect broken | No desired-state vs transient-state distinction | Offline/Reconnecting/Paused with reason, retry countdown, manual pause | Inline action and diagnostics link |
| Several devices/providers/agents | Separate lists/selectors | Hierarchy and identity collisions increase cognitive load | Agent-centric inventory; expand routes/devices/capabilities | Remember preferred route per agent |
| Review conversations | Sessions exist but long-list behavior is basic | Search, grouping, failures, route provenance limited | Agent-first history with global search, date groups, failed-turn markers | Resume from agent profile/Home |
| Configure identity/art/behavior | Rich art surface exists | Profile/settings/art feel separate | One agent profile with Identity, Appearance, Providers, Memory/Behavior, Permissions | Live preview and scoped save state |
| Understand relay | Mostly infrastructure terminology | Trust/data residency/offline queue unclear | “Remote bridge” explainer showing what is stored and for how long | Hide advanced URL details by default |
| Diagnose failures | Status and logs distributed | Users must understand architecture | Diagnostics center: path visualization, last error, test each hop, copy redacted report | One “Why isn’t this working?” action |

### Feature opportunities that fit the product

| Feature | User problem/example | Why Reika / minimum useful version | Expansion | Complexity/risks | Priority/prerequisites |
|---|---|---|---|---|---|
| Agent route & presence card | “Where is Reika running and can she act?” | Reika already aggregates agents/devices/providers; show chosen route, health, capabilities, last seen | Route policy and failover | Medium; stale presence | High; identity + health model |
| Turn timeline | “Did my message send, run, fail, or retry?” | Makes distributed execution legible; pending→accepted→running→streaming→done/failed | Tool steps and artifacts | Medium; event consistency | High; stable turn protocol |
| Diagnostics export | “Why can’t my remote agent reply?” | Reika controls every hop; provide redacted health bundle | Guided repair automation | Medium; privacy/redaction | High; before public testing |
| Agent-first global search | Find a prior decision across providers/devices | Existing relay/local history is a base; search titles/messages and filter agent/device | Semantic/local indexing | Medium; retention/privacy | Medium; after history correctness |
| Permission profiles | Allow chat but not file/tool actions remotely | Matches persistent cross-device agents; start with capability toggles + confirmation | Time/task-scoped grants | Large; false assurance | Later; auth/audit required |
| Background task inbox | Understand long-running work without living in chat | Notifications/activity already exist; minimum is task status/result tied to agent | Schedules/collaboration | Large; lifecycle complexity | Later; cancel/idempotency first |

### What not to build yet

- Autonomous multi-agent delegation or arbitrary workflow graphs.
- A plugin marketplace or broad third-party tool ecosystem.
- Complex automatic model routing based on opaque heuristics.
- Social/community surfaces, public agent sharing, or cosmetic monetization.
- More provider adapters until the adapter contract has timeouts, cancellation, tests, and honest detection.
- Rich reactions until core message/turn persistence is reliable.

These are exciting in exactly the way loose wiring is exciting. Stabilize the current promise first.

### Strongest possible differentiators

1. **Persistent agent identity across environments** — partly supported now; needs canonical identity and route presentation.
2. **A living, visual presence rather than a model chat tab** — strongly supported by current art/UI; needs functional status to match personality.
3. **Understandable local/remote execution** — architecture supports it; UX and trust controls are incomplete.
4. **One recoverable history of agent work across devices/providers** — foundations exist; ordering/idempotency/data scope must be repaired.
5. **Human-readable agent operations** — future turn/tool timeline can distinguish Reika from developer orchestration dashboards.

### Challenge to the product direction

- The application risks making infrastructure nouns the product. Users want “talk to Reika on my desktop,” not to continuously manage a relay/provider/device graph.
- Character art is a genuine differentiator, but it currently receives more visual space and bundle budget than conversation usefulness.
- Multiple independent identity systems (agent ID, provider ID, provider session, device ID, relay session, art identity) need one user-facing canonical agent concept.
- Automatic routing before explicit trust/status can make failures feel supernatural rather than helpful.
- The project should validate that target users actually run multiple agent providers/devices frequently enough to justify the control-plane complexity.

## Final product recommendation

- **Single most important next accomplishment:** make one conversation provably ordered, retry-safe, cancellable, recoverable, and identical across local/remote paths.
- **Best next feature after critical repairs:** an agent route/presence card tied to a unified diagnostics model.
- **Best UX improvement:** an agent-first onboarding flow that hides infrastructure until it is needed.
- **Best technical investment:** explicit identity, turn, delivery, and data-scope contracts with behavioral tests.
- **Feature most likely to explain why Reika is special:** a living agent presence showing the same persistent agent, history, capabilities, and current location across devices.
- **Postpone:** autonomous multi-agent orchestration.

### Suggested three-phase plan

1. **Trustworthy Core:** auth/tenancy, turn state machine, ordering/idempotency, cancellation, storage limits/migrations, green CI/package smoke.
2. **Understandable Agent Experience:** first-agent onboarding, presence/route card, diagnostics, responsive Markdown chat, searchable/recoverable history.
3. **Living Agent Platform:** permissioned background tasks, tool timelines, deliberate routing/failover, carefully scoped collaboration.

An excellent mature Project Reika is a calm, characterful desktop home for persistent agents: users choose an agent, immediately understand where it is running and what it can do, trust every message/action to happen once, recover failures without knowing the topology, and move between devices without losing identity or history.

## Questions requiring clarification

1. Is the hosted relay intended for public multi-tenant use now, private testing only, or single-operator deployment?
2. Should a chat session permit concurrent turns, queue them, or branch them?
3. Is remote file transfer an intended near-term capability, or should attachments be local-only?
4. Are OpenClaw/Hermes configurations expected from the Windows user home or an AgentHub-managed profile?
5. Are the server/client update toggles intended to map to independently released artifacts?
6. What is the authoritative current roadmap/status document, and which phase docs should be archived?

---

**Audit conclusion:** Project Reika is worth continuing. The visual/product concept is ahead of the reliability model. Freeze feature expansion long enough to make identity, delivery, conversation turns, and health truthful; then the product’s unusual “living agent across devices” idea has a credible foundation.
