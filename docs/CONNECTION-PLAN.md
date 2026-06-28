# Connection Plan Placeholder

No external provider connection code is implemented in this phase.

This repository represents the **device agent server**. Later, it should connect upward to the main app client, likely through a local bridge/WebSocket/uplink layer after the contract is planned.

## Future uplink direction

```text
Linux Device Agent Server -> Main App Client
```

The main app client should not have to understand every provider's raw quirks. The server should normalize local device/provider/agent state first.

## Future adapter contract topics

Plan before implementing:

- device identity
- local server health
- provider discovery
- active provider selection
- provider capabilities
- agent roster mapping
- session create/list/load
- message send
- turn lifecycle events
- ambient status/activity events
- attachment capability detection
- voice capability detection
- error/state normalization

The first likely real provider is CommandCenter via its local API and WebSocket feed, but Project Reika must not hard-couple its internal model to CommandCenter internals.
