# Connection Plan Placeholder

No external provider connection code is implemented in this phase.

When ready, plan the adapter contract first:

- normalized provider discovery
- local provider health
- agent roster mapping
- session create/list/load
- message send
- turn lifecycle events
- ambient status/activity events
- attachments
- voice capability detection

The first likely real provider is CommandCenter via its local API and WebSocket feed, but Project Reika should not hard-couple its internal model to CommandCenter internals.
