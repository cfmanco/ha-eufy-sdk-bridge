#!/bin/sh
# Supervisor configuration is supplied as /data/options.json.
# Root reads it once, prepares private state, then drops to the node user.
set -eu
umask 077

OPTIONS=/data/options.json
PRIVATE=/data/private

if [ ! -f "$OPTIONS" ]; then
  echo '[eufy-app] Supervisor options unavailable' >&2
  exit 1
fi

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

# Never recursively change ownership of Supervisor's /data volume.
install -d -m 0700 -o node -g node "$PRIVATE"
token_tmp="$(mktemp "$PRIVATE/.bridge-token.XXXXXX")"
trap 'rm -f "$token_tmp"' EXIT HUP INT TERM
printf '%s' "$bridge_token" > "$token_tmp"
chown node:node "$token_tmp"
chmod 0600 "$token_tmp"
mv -f "$token_tmp" "$PRIVATE/bridge-token"
trap - EXIT HUP INT TERM
unset bridge_token token_tmp

export BRIDGE_AUTH_TOKEN_FILE="$PRIVATE/bridge-token"
export BRIDGE_HOST=127.0.0.1
export BRIDGE_SELF_HOST=127.0.0.1
export BRIDGE_PORT="$(jq -r '.bridge_port // 3000' "$OPTIONS")"
export BRIDGE_APP_DIR=/app
export EUFY_SESSION="$PRIVATE/.eufy-session.json"
export GO2RTC_CONFIG="$PRIVATE/go2rtc.yaml"
export GO2RTC_ENABLE=0
export EUFY_POLL_MS="$(jq -r '.poll_ms // 600000' "$OPTIONS")"
export STREAM_IDLE_MS="$(jq -r '.stream_idle_ms // 0' "$OPTIONS")"
export STREAM_FAIL_BACKOFF_MS="$(jq -r '.stream_fail_backoff_ms // 30000' "$OPTIONS")"

case "$(jq -r '.snapshot_live // "auto"' "$OPTIONS")" in
  auto) export SNAPSHOT_LIVE=auto ;;
  on) export SNAPSHOT_LIVE=1 ;;
  off) export SNAPSHOT_LIVE=0 ;;
  *) echo '[eufy-app] Invalid snapshot_live value' >&2; exit 1 ;;
esac

if [ "$(jq -r '.event_log // true' "$OPTIONS")" = false ]; then
  export BRIDGE_EVENT_LOG=0
fi
if [ "$(jq -r '.debug // false' "$OPTIONS")" = true ]; then
  export BRIDGE_DEBUG=1
fi

cd /app
exec su-exec node:node node /app/server.mjs
