#!/bin/sh
# Supervisor's private Docker bridge only: app port is NOT published on the host.
# Configuration and account secrets stay in /data; the daemon runs as node.
set -eu
umask 077

OPTIONS=/data/options.json
PRIVATE=/data/private
[ -f "$OPTIONS" ] || { echo '[eufy-app] Supervisor options unavailable' >&2; exit 1; }

bridge_token="$(jq -er '.bridge_token // empty' "$OPTIONS")" || {
  echo '[eufy-app] Configure a 64-hex bridge_token in the app options' >&2
  exit 1
}
case "$bridge_token" in
  *[!0-9a-f]*|'') echo '[eufy-app] Invalid bridge token format' >&2; exit 1 ;;
esac
if [ "${#bridge_token}" -ne 64 ]; then
  echo '[eufy-app] Invalid bridge token length' >&2
  exit 1
fi

export EUFY_EMAIL="$(jq -r '.email // ""' "$OPTIONS")"
export EUFY_PASSWORD="$(jq -r '.password // ""' "$OPTIONS")"
export EUFY_COUNTRY="$(jq -r '.country // "GB"' "$OPTIONS")"
if [ -z "$EUFY_EMAIL" ] || [ -z "$EUFY_PASSWORD" ]; then
  echo '[eufy-app] Eufy account credentials must be configured' >&2
  exit 1
fi

install -d -m 0700 -o node -g node "$PRIVATE"
token_tmp="$(mktemp "$PRIVATE/.bridge-token.XXXXXX")"
trap 'rm -f "$token_tmp"' EXIT HUP INT TERM
printf '%s' "$bridge_token" > "$token_tmp"
chown node:node "$token_tmp"
chmod 0600 "$token_tmp"
mv -f "$token_tmp" "$PRIVATE/bridge-token"
trap - EXIT HUP INT TERM
unset bridge_token token_tmp

# Generate a distinct certificate on the appliance, NEVER during image build.
# Its public SHA256 fingerprint is pinned by the Home Assistant integration.
TLS_KEY="$PRIVATE/tls.key"
TLS_CERT="$PRIVATE/tls.crt"
if [ ! -e "$TLS_KEY" ] && [ ! -e "$TLS_CERT" ]; then
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -nodes -sha256 -days 1825 -subj "/CN=$(hostname)" \
    -addext "subjectAltName=DNS:$(hostname)" \
    -keyout "$TLS_KEY" -out "$TLS_CERT" >/dev/null 2>&1
fi
if [ ! -s "$TLS_KEY" ] || [ ! -s "$TLS_CERT" ]; then
  echo '[eufy-app] TLS certificate/key absent or incomplete; refusing to start' >&2
  exit 1
fi
openssl x509 -in "$TLS_CERT" -noout >/dev/null || exit 1
openssl pkey -in "$TLS_KEY" -noout >/dev/null || exit 1
chown node:node "$TLS_KEY" "$TLS_CERT"
chmod 0600 "$TLS_KEY"
chmod 0644 "$TLS_CERT"

export BRIDGE_TLS_KEY_FILE="$TLS_KEY"
export BRIDGE_TLS_CERT_FILE="$TLS_CERT"
export BRIDGE_AUTH_TOKEN_FILE="$PRIVATE/bridge-token"
# All interfaces *inside* the private Supervisor Docker network; no host ports.
export BRIDGE_HOST=0.0.0.0
export BRIDGE_SELF_HOST="$(hostname)"
export BRIDGE_PORT="$(jq -r '.bridge_port // 3000' "$OPTIONS")"
export BRIDGE_APP_DIR=/app
export EUFY_SESSION="$PRIVATE/.eufy-session.json"
export GO2RTC_CONFIG="$PRIVATE/go2rtc.yaml"
export GO2RTC_ENABLE=0
# The Supervisor app runs no bundled or external RTSP converter.
# This does NOT alter GO2RTC_ENABLE=0 for separate Frigate/go2rtc deployments.
export GO2RTC_RTSP_AVAILABLE=0
export EUFY_POLL_MS="$(jq -r '.poll_ms // 600000' "$OPTIONS")"
export STREAM_IDLE_MS="$(jq -r '.stream_idle_ms // 0' "$OPTIONS")"
export STREAM_FAIL_BACKOFF_MS="$(jq -r '.stream_fail_backoff_ms // 30000' "$OPTIONS")"

case "$(jq -r '.snapshot_live // "auto"' "$OPTIONS")" in
  auto) export SNAPSHOT_LIVE=auto ;;
  on) export SNAPSHOT_LIVE=1 ;;
  off) export SNAPSHOT_LIVE=0 ;;
  *) echo '[eufy-app] Invalid snapshot_live value' >&2; exit 1 ;;
esac

[ "$(jq -r '.event_log // true' "$OPTIONS")" = false ] && export BRIDGE_EVENT_LOG=0
[ "$(jq -r '.debug // false' "$OPTIONS")" = true ] && export BRIDGE_DEBUG=1

fingerprint="$(openssl x509 -in "$TLS_CERT" -outform DER | sha256sum | cut -d ' ' -f 1)"
printf '[eufy-app] Supervisor internal host: %s\n' "$(hostname)"
printf '[eufy-app] Pinned TLS certificate SHA256: %s\n' "$fingerprint"
printf '[eufy-app] Internal HTTPS/WSS port: %s (no host port published)\n' "$BRIDGE_PORT"
unset fingerprint
cd /app
exec su-exec node:node node /app/server.mjs
