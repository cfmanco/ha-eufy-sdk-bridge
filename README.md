# ha-eufy-sdk-bridge

> **Hardened HomeKit feature branch — implementation preview, not production-approved.**
> The original 25 October two-host security pilot established authenticated control,
> doorbell events and snapshots. This branch additionally implements isolated live
> media and HomeKit return audio, but Apple Home hardware acceptance is outstanding.
> The new Home Assistant Green app is host-loopback only; the historical Pi deployment
> remains available over verified HTTPS/WSS.
>
> For the tested two-host setup, requirements, checks and remaining release gates, use the
> [hardened deployment runbook](docs/security-deployment.md). The [architecture](docs/security-architecture.md)
> and [implementation plan](docs/security-implementation-plan.md) remain design references.
> **Do not run the upstream quick-start, host-networking or published-image instructions below on
> this branch.** They describe upstream behaviour, not a hardened deployment.

[![CI](https://github.com/mega-yfue/ha-eufy-sdk-bridge/actions/workflows/ci.yml/badge.svg)](https://github.com/mega-yfue/ha-eufy-sdk-bridge/actions/workflows/ci.yml)
[![node](https://img.shields.io/badge/node-%E2%89%A524-brightgreen?logo=nodedotjs&logoColor=white)](./package.json)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)

The host-facing daemon: one process that logs into eufy **once** and exposes the
[`eufy-sdk`](https://github.com/mega-yfue/eufy-sdk) to a frontend — Home Assistant, a web UI,
anything. Ships as a multi-arch Docker image with [go2rtc](https://github.com/AlexxIT/go2rtc)
bundled, so live camera video is available as RTSP / WebRTC / MSE / HLS with nothing else to install.

```
WS    :3000/ws             control, state, events     ← the frontend talks to this
HTTP  :3000/stream/<sn>    live video (Annex-B)       ← go2rtc pulls this
HTTP  :3000/snapshot/<sn>  a JPEG still
HTTP  :3000/clip/<sn>      the latest detection's recording, as an mp4 (HomeBase 2)
HTTP  :3000/healthz        which cameras are streaming
```

Video is deliberately **not** on the WebSocket: the WS hands back a URL, and _connecting to that URL
is what starts the camera — disconnecting is what stops it_. There is no "stream is running" flag to
drift out of sync.

## Home Assistant Green — hardened local app (feature preview)

This fork now includes a Supervisor-managed app at
[`eufy_sdk_bridge/`](./eufy_sdk_bridge). It builds the pinned forked bridge,
runs on aarch64 Home Assistant Green, serves pinned TLS 1.3 on the **private Supervisor Docker network** with
no published host ports and disables bundled go2rtc. The matching
`cfmanco/ha-eufy-sdk` integration can use the same host-loopback transport.

Install from this repository's `feat/local-p2p-live-view` branch; see the
[installation and rollback instructions](./eufy_sdk_bridge/DOCS.md). This
does **not** deploy to Green automatically, remove the Raspberry Pi
installation or claim real-world HomeKit talkback verification.

## Run it

Pull the published image and run it (bundles the SDK + go2rtc):

```bash
docker run -d --name eufy-bridge --network host \
  -e EUFY_EMAIL='you@example.com' -e EUFY_PASSWORD='…' -e EUFY_COUNTRY='GB' \
  -v /opt/eufy-bridge-data:/app/data \
  ghcr.io/mega-yfue/ha-eufy-sdk-bridge:latest
```

or with Compose (`cp .env.example .env` first): `docker compose up -d`.

**Full deploy guide (alongside Home Assistant, config reference, first-run 2FA/captcha):**
[docs/docker-compose.md](./docs/docker-compose.md) · **WS protocol:** [docs/ws-protocol.md](./docs/ws-protocol.md) ·
**Troubleshooting:** [docs/troubleshooting.md](./docs/troubleshooting.md)

## Where it fits

| Repo                                                                  | Role                                          |
| --------------------------------------------------------------------- | --------------------------------------------- |
| [`eufy-sdk`](https://github.com/mega-yfue/eufy-sdk)                   | the HA-agnostic library                       |
| **`ha-eufy-sdk-bridge`**                                              | **this** — WS + HTTP + go2rtc daemon (Docker) |
| [`ha-eufy-sdk-addon`](https://github.com/mega-yfue/ha-eufy-sdk-addon) | Home Assistant add-on wrapper                 |
| [`ha-eufy-sdk`](https://github.com/mega-yfue/ha-eufy-sdk)             | the HACS integration (front door)             |

> Status: working — WS control + auth-over-WS (2FA/captcha), device listing, snapshots, and go2rtc
> streaming. **Optional Anker Solix** support (power stations / smart meter / Solarbank, a separate account)
> via `SOLIX_EMAIL` / `SOLIX_PASSWORD` — see [docs/ws-protocol.md](./docs/ws-protocol.md) (`solix.*`).
> Published image: `ghcr.io/mega-yfue/ha-eufy-sdk-bridge` (multi-arch: `amd64` · `arm64`).
> **Publishing a GitHub Release** builds and pushes the versioned + `:latest` tags
> automatically ([`.github/workflows/publish-ghcr.yml`](./.github/workflows/publish-ghcr.yml)); the same
> build runs locally via [`scripts/publish-multiarch.sh`](./scripts/publish-multiarch.sh). A merge to the
> `dev` branch publishes a rolling `:dev` tag for testing.

## Contributing

Contributions are welcome — please branch from **`dev`** and open your PR against **`dev`** (not
`main`). See [CONTRIBUTING.md](./CONTRIBUTING.md) for the branch model, CI checks, and how releases
are cut.

## Develop

The bridge is ESM (no build step) and depends on the SDK as a normal npm package
([`@mega-yfue/eufy-sdk`](https://www.npmjs.com/package/@mega-yfue/eufy-sdk)) — `npm install` pulls it
from the registry, no sibling checkout needed.

```bash
npm install
npm test          # node --test
npm run lint      # prettier --check .   (npm run format to fix)
```

Every PR into `main` or `dev` runs the CI gate ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)):
`npm ci` → lint → compile (`node --check` on each `.mjs`) → test. `main` is the public release line;
`dev` is the development line (rolling `:dev` image).
