# Eufy SDK Bridge — isolated Home Assistant app

A Supervisor-managed, internally networked build of `cfmanco/ha-eufy-sdk-bridge` for Home Assistant Green.
The existing `eufy_sdk` Python integration still provides entities, doorbell events and HomeKit camera support.

The app uses the private Supervisor Docker network (no host networking or published ports), serves TLS 1.3 with a per-installation certificate, requires a 256-bit bearer token and runs the Node daemon unprivileged. No upstream prebuilt image is used.

Read [DOCS.md](DOCS.md) before starting or migrating from the Raspberry Pi.
