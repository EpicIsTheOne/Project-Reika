# Project Reika Relay

Reserved for the tiny relay service implementation.

Codex should place relay-side work here.

Initial relay goals:

- `POST /v1/pairing/create`
- `POST /v1/pairing/claim`
- `POST /v1/pairing/approve`
- `WS /v1/device`
- `WS /v1/app`
- single-account in-memory dev mode
- device presence tracking
- envelope routing between app and device

The relay routes messages. It must not scan local providers, execute commands, or become a remote shell with better branding.
