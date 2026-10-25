# Private LAN P2P and live-video bridge

The SDK /stream/<camera-serial> route serves authenticated H.264
Annex-B; /stream-av/<camera-serial> serves authenticated fragmented MP4
with the audio track when the source codec can be muxed. A successful local packet capture demonstrated a direct UDP media
path between a HomeBase and the bridge host, without video being carried
through a cloud relay. That observation does not prove cloud-free startup.

## Choose an explicit LAN station address

Set **EUFY_LOCAL_ADDRESSES** in the bridge's private environment file,
using the _parent station/HomeBase serial_ as key, rather than the camera
serial. For example, using wholly illustrative values:

```env
EUFY_LOCAL_ADDRESSES='{"STATION_SERIAL":"192.168.10.25"}'
```

The bridge validates JSON keys and permits only RFC1918 IPv4 destinations.
It passes this SDK-supported map to both the control EufyMega client and
the media-only EufyMega clients. It is optional: an omitted variable keeps
the existing discovery behaviour. It is **not** a cloud disable switch.
The bridge does not write station identities, device serials, LAN addresses
or credentials into Git.

## Media delivery

Do not expose the Node bridge port or unauthenticated RTSP/WebRTC to the LAN.
Both Node media routes require the 32-byte bearer on every
request. The Home Assistant integration's opt-in media proxy sends that
bearer in the Authorization header through HTTPS (with certificate
verification) and exposes only an ephemeral local listener: raw H.264 to
managed go2rtc, and fragmented MP4 to HomeKit's FFmpeg process.

On the Pi, only inside the **existing TLS Nginx server**, add a location
equivalent to the following after replacing the placeholder with the
actual HA host address:

```nginx
location ~ ^/(stream|stream-av)/ {
    allow HA_PRIVATE_IP;
    deny all;
    limit_except GET { deny all; }

    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
    access_log off;
}
```

Keep the Node bridge's own bearer validation. Set GO2RTC_ENABLE=0 on the
Pi, since Home Assistant uses its managed go2rtc process for WebRTC.
Detector-based idle suspension is disabled by default (STREAM_IDLE_MS=0)
so a viewer decides when live video ends. The new active-viewer
code extends SDK budget notices while the viewer is connected; it does
not impose a new viewing-time or battery policy.

Confirm Nginx syntax with `nginx -t` before reloading. Verify an
unauthorised stream request yields HTTP 401 or 403, and a different LAN
source receives HTTP 403. Never log, paste, or put a bridge bearer in a URL.

## Cloud independence: current boundary

The vendor SDK continues to use an account/cloud session for authentication
and cloud-derived device records. The primary realtime client uses cloud
FCM push for doorbell and motion notifications; some station P2P event
messages may also exist. Saved login credentials and a hardcoded LAN station
IP are not a complete offline substitute for cloud device discovery, session
renewal, or event delivery.

Do **not** block the HomeBase WAN or clear Eufy sessions in a working pilot.
For a reversible offline experiment, first collect baseline push/event
observations, then test local H.264, reconnection and doorbell notifications
with WAN disabled using a removable firewall policy. Restore the original
policy immediately if any required function fails. Full cloud independence
is not yet implemented or verified.

## HomeKit audio/video source

The separate authenticated `/stream-av/<serial>` route uses the SDK's
`recordFragments()` API to emit fragmented MP4 with video and an AAC audio
track when the camera sends AAC. This route is for HomeKit's direct FFmpeg
input; the existing `/stream/<serial>` raw H.264 route remains for go2rtc.
Both routes require the existing bearer and HTTPS controls. The Nginx
location in the Media delivery section matches both paths, applying the
same HA-host allowlist, bearer propagation, streaming timeout and
disabled response buffering. Remove any older overlapping `^~ /stream/`
location only after checking that the replacement covers both routes.
Do not expose either route to the public internet.

G.711 source audio is not carried by the SDK MP4 muxer and is not implicitly
converted to AAC. Confirm the particular camera's actual audio codec and
Apple Home playback before asserting complete support.
