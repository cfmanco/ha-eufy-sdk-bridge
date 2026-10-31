# Eufy SDK Bridge — hardened Home Assistant app

A Supervisor-managed, local-only build of `cfmanco/ha-eufy-sdk-bridge` for Home Assistant Green.
The existing `eufy_sdk` Python integration still provides entities, doorbell events and HomeKit camera support.

The app listens on IPv4 loopback only, requires an independent 256-bit bearer credential and does not expose a port to the LAN. No upstream prebuilt image is used.

Read [DOCS.md](DOCS.md) before starting or migrating from the Raspberry Pi.
