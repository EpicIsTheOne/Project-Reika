# Client Architecture

The Reika client is organized so new features can land without growing a single giant app file.

## Boundaries

```text
apps/desktop/src/App.tsx              Compatibility export for the Vite entrypoint
apps/desktop/src/app/                 App orchestration, routing, boot state, constants, shared app types
apps/desktop/src/features/            Page-level feature modules
apps/desktop/src/components/          Shared UI primitives used across features
apps/desktop/src/domain/              Pure mapping/filtering helpers between API records and UI models
apps/desktop/src/lib/                 API, art runtime, motion, and other runtime helpers
apps/desktop/src/data/                Client-side data adapters, assets, relay/startup helpers
apps/desktop/src/shared/protocol/     Versioned Reika envelope helpers mirrored from shared/
apps/desktop/electron/                 Electron desktop shell and local proxy runtime
```

## Feature Modules

```text
features/art/           Agent Art Studio
features/boot/          Loading screen and boot step definitions
features/chat/          Chat surface, sessions, provider selection, composer attachments
features/connection/    Agent Connection Wizard for pairing and safe relay verification
features/devices/       Relay/local devices, pairing, provider snapshots, safe relay controls
features/home/          Home dashboard and device cards
features/notifications/ Real notification inbox and detail panel
features/settings/      Settings tabs, relay URL, startup, mock, update controls
```

## Rules

- Keep `apps/desktop/src/app/App.tsx` focused on boot, top-level state, routing, and cross-feature handoff.
- Put new pages in `apps/desktop/src/features/<name>/`.
- Put reusable visual pieces in `apps/desktop/src/components/`.
- Put server/relay record transformations in `apps/desktop/src/domain/`, not inside page JSX.
- Put network calls in `apps/desktop/src/lib/reikaApi.ts` or focused adapters under `apps/desktop/src/data/`.
- Keep feature modules owning their local UI state unless another page genuinely needs it.
- Keep guided pairing and provider verification in `features/connection/`; Devices owns the live relay socket and passes safe actions into the wizard.
- Keep hardcoded demo data isolated to `apps/desktop/src/data/mockData.ts` and respect the `mockEnabled` setting when rendering fallbacks.
- Do not add chat, device, notification, or art logic back into `App.tsx`; export a feature component instead.

## Runtime Flow

```text
App boot
  -> health/settings/art/state/notifications/uplink/startup/relay checks
  -> shared art runtime creation
  -> feature route selection

Feature pages
  -> read app state through props
  -> own local panel/search/form state
  -> call lib/data adapters
  -> return updated app-level state through callbacks only when needed
```

## Validation

Use these checks after client architecture work:

```powershell
cd client
npm run build

cd ../server
npm run build

cd ../Relay
npm run build

cd ../client
npm run build:desktop
```

The browser/Vite client remains the fast testing path, and the Electron desktop build uses the same compiled React client through the desktop proxy.