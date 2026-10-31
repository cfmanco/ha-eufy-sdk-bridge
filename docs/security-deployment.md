# Hardened bridge deployment: private pilot and acceptance record

**Status (25 October 2026): Private pilot operational for authenticated control, device entities, doorbell events and still images. Not production-approved. Live video remains disabled.**

This document describes the security-hardening branch, not the upstream host-networking or published-image deployment. It records a tested two-host private pilot and distinguishes verified observations from release requirements. Do not treat successful installation or a staging certificate renewal as a full security assessment.

## Scope and reproducible baseline

- Bridge source: [security-hardening branch](https://github.com/cfmanco/ha-eufy-sdk-bridge/tree/dev/security-hardening), tested code commit `42c868bea554bb0df5fea7db047d153aa5c523b7`.
- Companion Home Assistant integration: [security-hardening branch](https://github.com/cfmanco/ha-eufy-sdk/tree/dev/security-hardening), tested code commit `442c207693ba70c2714a32069536320f4c217baf`.
- The bridge runs in Docker on a separate Linux host; the integration runs on a separate Home Assistant OS appliance. The bridge uses an Eufy account that can access the intended devices. Shared-device invitations must be accepted by that account before inventory can appear.
- A validated HTTPS/WSS gateway on the Linux host is the only cross-host entry point. Docker publishes TCP 3000 on host loopback only, while the gateway listens on a restricted LAN address. Client access is constrained to an authorised administrative subnet.
- The deployed Compose configuration forces `GO2RTC_ENABLE=0`. Direct RTSP/WebRTC, live-stream source URLs and cross-host video are not available in this pilot.
- **Disclosure boundary:** never commit or publish real hostnames, internal IPs/subnet identifiers, device models or serial numbers, account details, media paths, bearer tokens, private keys, session files or unredacted Eufy push payloads. Preserve deployment-specific inventory in private operational records.

## Prepare the bridge host

1. Check out and record the intended security-hardening commit. Do not deploy the upstream `docker run --network host` example or assume a published image matches this fork.
2. Copy `.env.example` to a private `.env` and set `EUFY_EMAIL`, `EUFY_PASSWORD`, the correct `EUFY_COUNTRY` and `BRIDGE_AUTH_TOKEN_HOST_FILE`. Keep the Eufy session and generated configuration inside the private `/app/data` mount (for example, `EUFY_SESSION=/app/data/.eufy-session.json` and `GO2RTC_CONFIG=/app/data/go2rtc.yaml`). Never commit `.env` or the data directory.
3. Generate one 256-bit bridge-client credential as exactly 64 lowercase hexadecimal characters plus an optional trailing newline. Put it in an owner-only regular file (not a symlink), outside the repository. For example:

```sh
umask 077
install -d -m 0700 /private/eufy-secrets
openssl rand -hex 32 > /private/eufy-secrets/bridge-client-token
chown 1000:1000 /private/eufy-secrets/bridge-client-token
chmod 0600 /private/eufy-secrets/bridge-client-token
```

4. Provision `./data` for UID/GID 1000 with directory mode 0700 and protect the session files. Do not recursively change or delete a pre-existing session during an upgrade.
5. Confirm the hardened Compose model keeps `127.0.0.1:3000:3000/tcp`, `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`, a bounded `/tmp` tmpfs, private data/token mounts, and `GO2RTC_ENABLE=0`. The Compose environment overrides optional go2rtc defaults in `.env.example`.
6. Validate without printing expanded credentials, build and start the selected service:

```sh
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml build ha-eufy-sdk-bridge
docker compose -f docker-compose.yml up -d --no-build ha-eufy-sdk-bridge
```

The bridge rejects missing, malformed or conflicting credential sources. A successful cloud authentication status **does not** prove that any shared devices are visible; verify device inventory separately.

## Configure a restricted TLS gateway

Use an appropriately trusted certificate that covers the bridge DNS name. Terminate TLS on the Linux host and proxy only the required endpoints to `127.0.0.1:3000`. The client sends the bridge credential as an `Authorization: Bearer` header over **WSS/HTTPS**; never place it in a URL, WebSocket subprotocol, access log or RTSP URI.

Example Nginx configuration (replace all uppercase placeholders; do not publish their real values):

```nginx
server {
    listen BRIDGE_LAN_ADDRESS:443 ssl;
    server_name BRIDGE_DNS_NAME;

    ssl_certificate /etc/letsencrypt/live/BRIDGE_DNS_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/BRIDGE_DNS_NAME/privkey.pem;
    ssl_protocols TLSv1.3;

    allow AUTHORISED_SUBNET_CIDR;
    deny all;

    location = /healthz {
        proxy_pass http://127.0.0.1:3000/healthz;
    }

    location = /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Authorization $http_authorization;
        proxy_read_timeout 3600s;
    }

    location ~ ^/(snapshot|event-image|clip)/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Authorization $http_authorization;
    }

    # Do not proxy /stream or expose go2rtc listeners.
    location / {
        return 404;
    }
}
```

The example illustrates the required access and authentication boundaries; adapt it to the host's existing Nginx layout and validate inherited `allow`/`deny` directives. Keep the gateway restricted by LAN/router policy as well. Binding to a LAN IP is not a substitute for independently checking WAN reachability.

After creating a configuration backup, run `nginx -t` before `systemctl reload nginx`. Never reload a configuration that fails validation. A minimal `/healthz` response can be anonymous **within the authorised subnet**; state, WebSocket commands and media require the bearer credential at the bridge.

### Certificate renewal

A DNS-01 Cloudflare Certbot renewal timer was used in the pilot. Confirm `certbot.timer` is active and use a deploy hook that validates Nginx and reloads it **after successful renewal**, without exposing the DNS API credential:

```sh
#!/bin/sh
set -eu
[ "${RENEWED_LINEAGE:-}" = "/etc/letsencrypt/live/BRIDGE_DNS_NAME" ] || exit 0
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
```

Store this executable in `/etc/letsencrypt/renewal-hooks/deploy/`. Verify with `certbot renew --cert-name BRIDGE_DNS_NAME --dry-run --run-deploy-hooks`. This checks staging renewal and hook execution; **it does not prove a future live renewal**. In the pilot, Certbot completed its dry run but emitted a Python Cloudflare dependency deprecation warning requiring a future compatibility review. Nginx's successful `-t` messages on stderr were reported as hook error output despite the successful renewal simulation.

## Install and connect Home Assistant

1. Use the matching [hardened integration](https://github.com/cfmanco/ha-eufy-sdk/tree/dev/security-hardening), not an unmodified upstream HACS client. The pilot copied `custom_components/eufy_sdk/` from the pinned source into `/config/custom_components/eufy_sdk/` on Home Assistant OS and restarted Home Assistant Core. Back up the configuration and record the exact source commit before installing.
2. In **Settings > Devices & Services > Add Integration > eufy-sdk**, enter the TLS DNS **hostname only** (not an `http://` or `https://` URL), port `443`, and the bridge-client bearer token. The hostname must match the certificate; do not disable certificate verification.
3. Wait for the bridge to authenticate to Eufy and list devices. If authentication reports `ok` but the inventory is empty, confirm that the bridge account has accepted any Eufy sharing invitation and uses the correct account/region. Re-query inventory before altering sessions.
4. Reload the Home Assistant config entry after inventory appears so its device and entity platforms register newly available devices. Do not create a duplicate entry or clear the Eufy session merely because devices were absent initially.
5. Confirm that a new WSS connection from the Home Assistant appliance is established after applying the gateway access policy.

## Operational verification record

The following checks were observed on the private pilot on 25 October 2026, not inferred from code:

- **Inventory and registration:** Device listing succeeded without description errors; Home Assistant registered the devices.
- **Doorbell push:** A physical press generated `eufy_sdk_event` with `event: doorbellPress`.
- **Ringing state:** The binary sensor changed to on and returned to off after approximately 30 seconds.
- **Still images:** The Last Event and camera still images appeared in Home Assistant.
- **Authentication:** Authenticated WSS and HTTPS worked; anonymous requests to tested protected routes received HTTP 401.
- **Authorised subnet:** The Nginx configuration validated and reloaded; `/healthz` returned HTTP 200.
- **Denied subnet:** `/healthz`, `/ws`, `/snapshot/test`, `/event-image/test` and `/clip/test` returned HTTP 403.
- **Reconnect:** Home Assistant established a fresh HTTPS/WebSocket connection after the network policy was applied.
- **Lifecycle:** Docker was enabled and active; the bridge ran as `node:node` with `restart: unless-stopped`.
- **Port isolation:** Compose and the host socket showed only `127.0.0.1:3000` listening for the bridge.
- **Certificate:** Certbot's staging renewal and the Nginx deployment hook executed successfully.

A 403 verifies the Nginx network restriction for the tested source; a 401 verifies bridge authentication.

These results do not establish production security or all possible network paths.

## Outstanding acceptance work

- [ ] Design, implement and independently test an authenticated, encrypted cross-host live-video path. Do **not** enable go2rtc, proxy `/stream`, expose direct RTSP/WebRTC or claim live-stream support before this is complete.
- [ ] Verify Eufy 2FA/captcha challenge handling, cloud session expiry/reauthentication, bridge token rotation and denial behaviour across fresh reconnects.
- [ ] Test recovery after container restart and physical host reboot; verify persisted Eufy/FCM session continuity without losing device push events.
- [ ] Test a real successful certificate renewal and the post-renewal certificate served by Nginx. Review the Certbot Cloudflare Python library compatibility warning.
- [ ] Review CI/test results, architecture-specific image build, dependency provenance, runtime permissions, and negative security cases at the exact release candidate.
- [ ] Verify WAN isolation and all intended/unintended route paths independently of the single denied-VLAN test.
- [ ] Complete formal security acceptance and release governance before describing either repository as production-ready.

## Recovery, rollback and diagnostic hygiene

Preserve `.env`, the private bearer-token file, `./data` (including the Eufy session and FCM registration), the previous image/commit identifier and Nginx/HA configuration backups. To recover a failed upgrade, restore the last verified source and configuration, keeping the session material intact; do not run `docker compose down -v` or delete device/session files as a diagnostic shortcut.

For diagnostics, share status codes, counts and redacted messages only. Raw `eufy_sdk_event` payloads can contain serials, account/session identifiers and recording paths. Avoid exposing real addresses, screenshots of private security settings or bearer credentials in public issues.

Related design references: [bridge security architecture](security-architecture.md) and [Home Assistant integration security architecture](https://github.com/cfmanco/ha-eufy-sdk/blob/dev/security-hardening/docs/security-architecture.md).
