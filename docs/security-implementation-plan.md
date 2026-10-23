# Security hardening implementation plan and pseudocode

Status: approved scope, design gate pending compatibility confirmation
Branch: `dev/security-hardening`
Deployment topology: Home Assistant appliance (Home Assistant OS appliance, HACS integration) communicates across the LAN with an isolated Eufy bridge container on Linux host. Home Assistant itself is not containerised. Remote bridge reachability requires a restricted listener and encrypted authenticated transport, not localhost-only binding.\nCompanion repository: `mega-yfue/ha-eufy-sdk` (read-only reference; no modification authorised there)

## Definition of done

Protect every WS message/event and media endpoint; run bridge as non-root; minimise listening ports; retain Home Assistant's normal doorbell, live-view and 2FA workflows; capture tests and deployment notes. The first implementation on this branch must not silently break the upstream Home Assistant integration.

## Stage 0 — verify contract and baseline

Files: `src/ws-server.mjs`, `src/http-routes.mjs`, `src/config.mjs`, `go2rtc-config.mjs`, `src/boot.mjs`, `Dockerfile`, `docker-compose.yml`, `docs/ws-protocol.md`, `test/*.test.mjs`.

* Capture `npm ci && npm test && npm run lint` baseline in an isolated checkout.
* Trace all Home Assistant references to WS URL, HTTP paths, RTSP URLs and WebRTC player URLs.
* Determine whether the actual Home Assistant instance uses the addon/integration or custom media relay. Choose a compatible companion frontend change and deployment procedure.
* Inspect go2rtc support for authenticated RTSP/WebRTC, HTTP API listener binding, and dynamic stream credentials. Reject any method that puts long-lived tokens in generated stream URLs.
* Inspect Linux host-mapped volume ownership and ARM64 target. Determine the Home Assistant appliance address and the permitted inter-VLAN flow; do not assume HA and bridge share localhost.\n* Verify the end-to-end encrypted transport between Green and Linux host, including certificate hostname validation and streaming protocol support.
* Dependency graph: Stage 0 precedes all security protocol modifications.

## Stage 1 — control-plane authentication

Files: add `src/access-control.mjs`, modify `src/config.mjs`, `src/ws-server.mjs`, `src/http-routes.mjs`; add `test/access-control.test.mjs`, `test/ws-auth.test.mjs`.

Interface: `readBearer(req)`, `authorizeClient(req, purpose)`, `requireWsUpgradeAuth(req, socket)`. Load token from a file secret or protected runtime environment, validate length/entropy and fail startup if missing. Never log token or request Authorization headers.

Pseudocode:

```text
load credentials:
  read BRIDGE_AUTH_TOKEN_FILE (preferred) or BRIDGE_AUTH_TOKEN
  reject if empty, weak, malformed or duplicated with internal stream credential
  store only in process memory

on HTTP upgrade:
  if path != /ws: reject upgrade
  if not constant_time_equal(bearer(req), configured_client_token):
      send HTTP 401 with no body containing state; close connection
  else: accept WebSocket and register authorised client

on outgoing WS broadcast:
  send only over admitted sockets

on any HTTP request:
  if health probe: respond with non-sensitive liveness only
  else: authenticate before invoking routes or touching camera state
  if missing/invalid: send 401 with WWW-Authenticate: Bearer
  if permitted: continue
```

Tests: missing/incorrect credentials; valid token; auth.* and device controls inaccessible before auth; redaction and constant-time compare; 2FA recovery under authenticated connection. Home Assistant integration client needs to send header on each WS connect and reconnect.

## Stage 2 — media isolation and authenticated delivery

Files: `go2rtc-config.mjs`, `src/http-routes.mjs`, `src/boot.mjs`, `src/config.mjs`, `docker-compose.yml`; add `test/media-security.test.mjs`; document client integration changes.

Decision criteria: direct RTSP and WebRTC transport **must not** circumvent authentication. Separate internal stream credentials from Home Assistant bearer tokens.

Pseudocode:

```text
when generating go2rtc config:
  bind go2rtc management API to container loopback only; bridge client endpoint must remain reachable from Home Assistant appliance over restricted encrypted LAN transport
  disable protocols not needed by verified HA media path
  use authenticated internal stream source (not a URL query parameter)
  prohibit accidental unrestricted RTSP/WebRTC listeners
  write generated config with restrictive permissions

on /stream or /snapshot or /clip:
  authenticate requested principal and capability
  refuse unknown methods and unauthorised clients
  only after auth: acquire device, read snapshot/clip/open P2P session
  end P2P feed on viewer disconnect
```

If go2rtc cannot authenticate its upstream without leaking a secret in URLs, implement a protected localhost-only internal source and explicitly ensure only local go2rtc can reach it. Do not claim that source-IP restrictions alone authenticate clients on shared host networking.

Tests: anonymous access to every media route fails; authorised snapshots/video work; direct RTSP/WebRTC cannot bypass policy; no P2P start on denied request; stream disconnect closes feed.

## Stage 3 — least-privilege container and network

Files: `Dockerfile`, `Dockerfile.local`, `docker-compose.yml`, `docs/docker-compose.md`; add `test/deployment-security.test.mjs` where static tests are useful.

Pseudocode:

```text
build:
  create dedicated non-root UID/GID
  install runtime dependencies at build time
  chown app runtime paths to dedicated user
  USER dedicated UID
  expose only required listeners

deploy:
  create host data volume with owner matching UID/GID, mode 0700
  use isolated bridge network
  publish only explicitly required ports/interfaces
  drop Linux capabilities and set no-new-privileges where compatible
  set read-only rootfs with narrowly scoped writable dirs after runtime test
  pin image by immutable digest once verified
```

Do not claim a Docker `EXPOSE` line blocks access; actual listeners and published ports govern exposure. Verify go2rtc/ffmpeg startup as unprivileged user, including session, thumbnail and generated YAML writes.

## Stage 4 — companion frontend and release migration

Home Assistant appliance runs the companion HACS integration as part of Home Assistant OS. There is no requirement to put Home Assistant in Docker or install the bridge as a Green add-on. The upstream HA client's `api.py` currently does `ws_connect(self._url, heartbeat=30)` without auth headers; therefore a bridge-only change **cannot** satisfy functionality and authentication simultaneously. Create a compatible branch or patch for the HA integration after repository ownership/target is selected; add a protected token field in the HA config/options flow, include it in WS headers and HTTP image calls, and handle renew/reconnect without logs. Test migration of existing config entries. Do not commit to an unowned upstream repository.

Pseudocode:

```text
configure HA:
  require bridge token in integration options
  store token in HA protected config entry
  create client session:
      ws_connect(url, headers=Authorization bearer)
  for each camera HTTP request:
      send bearer header or request short-lived scoped ticket through authorised WS
  for reconnect:
      reuse configured secret, not a token embedded in URL
  if 401:
      mark integration auth required; never retry indefinitely with invalid secret
```

If Home Assistant media consumers cannot transmit a bearer header, use short-lived one-time media grants bound to stream/session or an authenticated local proxy. Validate this separately; do not expose a permanent bearer token in URL path/query.

## Stage 5 — verification and delivery gate

Commands: `npm ci`, `npm test`, `npm run lint`, `node --check server.mjs`, Docker build and container-level startup test on ARM64 or x86_64. Inspect listeners with `ss -ltnup`; verify access from Home Assistant appliance over encrypted transport and and disallowed VLAN; verify session renewal and stream teardown; check current npm advisories and image provenance.

Required report: git revision, file diff, tests pass/fail, unresolved integration dependencies, security checks, rollback procedure. Any failure keeps the branch labelled **not ready for deployment**. No merge to main or production deployment is part of this plan.

## Implementation quality constraints

Keep functions small and pure where possible; explicit result/error types; no implicit auth bypass for localhost; strong test naming; comments explain security invariants rather than narrating syntax; prefer dependency injection for testing. Do not refactor unrelated SDK functionality or remove capabilities that HA still calls.

## Open compatibility gate

Choose the companion Home Assistant integration target (the user's fork if available, otherwise a proposed patch). Its code changes must accompany enforcement or users cannot connect. The current plan is committed independently of code changes so this risk is visible and reviewable.

## Documentation disclosure boundary

Public architecture and deployment material describes device **roles**, trust boundaries, protocols and supported CPU architectures (for example, ARM64 and AMD64). It must not identify actual appliance models, server hardware models, serial numbers, hostnames, internal IP addresses or other installation-specific identifiers. Detailed inventory belongs in private deployment records only.
