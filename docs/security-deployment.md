# Hardened bridge deployment and acceptance gate

**Status: development only — not safe to deploy to Home Assistant yet.**

The Home Assistant integration does not yet support the new bridge bearer credential. Remote video export is deliberately disabled in the hardened Compose example. This file documents the expected installation and verification process; it is **not** evidence of a working deployment.

## Topology and disclosure rules

- Home Assistant runs on a separate Home Assistant OS appliance and uses its HACS client.
- The Eufy bridge runs as an unprivileged container on a Linux host (ARM64 or AMD64).
- Client traffic crosses a restricted LAN/VLAN route. Never publish the bridge on the WAN.
- go2rtc's API and RTSP endpoints currently bind to the container's loopback; WebRTC is disabled.
- Do not put actual hardware models, serial numbers, hostnames, addresses or tokens into public documentation or issue reports.

## Authentication contract

The bridge rejects startup unless **exactly one** of `BRIDGE_AUTH_TOKEN_FILE` and `BRIDGE_AUTH_TOKEN` exists. The credential is 32 random bytes represented as 64 lowercase hex characters. Use a file rather than a plain environment variable for production. It must be a regular file (not a symlink), owned by the service account where practical, with no group or other permissions.

- Client WebSocket handshake: `GET /ws` with `Authorization: Bearer <token>`. Invalid requests receive HTTP 401 before upgrade.
- Client media requests: `GET /snapshot/<serial>`, `/event-image/<serial>`, `/clip/<serial>` and `/stream/<serial>` with the same header. Rejected requests must not wake cameras or read cached images.
- `GET /healthz` without a token exposes only `{"ok":true}`. Operational state requires the bearer header.
- Never send a bearer token in an URL, log, query string, RTSP URI, diagnostic dump or exception report.

Because the Home Assistant client and bridge run on different hosts, a bearer token **must not traverse plaintext HTTP or WebSocket over the LAN**. Use an authenticated encrypted connection (TLS with peer verification or a controlled encrypted network overlay). The companion client needs a coordinated WSS/HTTPS update.

## Development configuration (do not start until compatibility is complete)

1. Copy `.env.example` to `.env`; set the Eufy account country and credentials, the `BRIDGE_AUTH_TOKEN_HOST_FILE`. The file contains *paths* but not the bridge token.
2. Generate the token into a **private directory outside the repository**, using a local administrator session:

   ```sh
   umask 077
   openssl rand -hex 32 > /path/to/private/bridge-client-token
   chmod 600 /path/to/private/bridge-client-token
   ```

3. Make the token file readable by container UID 1000 and prepare `./data` with UID/GID 1000 and directory mode 0700. Preserve any existing session files during migration; do not erase or recreate them.
4. Validate the Compose model without printing interpolated secret values: `docker compose -f docker-compose.yml config --quiet`.
5. **Do not start or expose the service yet.** Current go2rtc media transport cannot serve the separate Home Assistant appliance, and the installed HACS client cannot authenticate. Completing those integrations is an explicit release prerequisite.

The development Compose service uses Docker bridge networking rather than `network_mode: host`. It publishes only TCP port 3000 on host loopback (127.0.0.1), pending a separate authenticated and encrypted gateway, with a read-only root filesystem, a writable private data mount, a bounded `/tmp` tmpfs, dropped capabilities and `no-new-privileges`. These configuration properties require runtime validation; file inspection alone is insufficient.

## Acceptance checklist

- [ ] Home Assistant integration version supports the bridge access token on initial WS connection, reconnect, snapshots and clips.
- [ ] Camera live view uses a verified encrypted/authenticated cross-host media route; no unprotected go2rtc listener or credential in a stream URL.
- [ ] Node tests, format check, all `.mjs` syntax checks and an ARM64/AMD64 container build succeed; verify runtime UID is not zero.
- [ ] HTTP/WS requests without credentials receive 401 without media, metadata or side effects; authenticated clients work from the intended appliance and other VLAN clients fail.
- [ ] Doorbell presses, detection events, 2FA, authentication renewal, thumbnail retrieval, live stream open/close and persistence across container restart work on an actual test installation.

## Rollback and evidence

Keep the original `main` branch unchanged. Preserve the Eufy session volume. Before deploying a hardened version, capture the old image digest, current HACS integration version and configuration backup. If acceptance fails, stop the development service and revert to the previously verified deployment; do not delete the session or credentials as an incidental cleanup.

Evidence must include the exact commit SHA, checked configuration, test output and permitted/denied network checks. Do not claim production safety from unit tests alone.
