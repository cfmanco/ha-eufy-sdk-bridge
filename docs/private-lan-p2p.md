# Private LAN P2P and live-video bridge

The existing SDK /stream/<camera-serial> route serves authenticated H.264
Annex-B. A successful local packet capture demonstrated a direct UDP media
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
The existing Node HTTP route still requires the 32-byte bearer on every
request. The Home Assistant integration's opt-in media proxy sends that
bearer in the Authorization header through HTTPS (with certificate
verification) and relays video only to its own 127.0.0.1 listener, for
Home Assistant-managed go2rtc.

On the Pi, only inside the **existing TLS Nginx server**, add a location
equivalent to the following after replacing the placeholder with the
actual HA host address:

```nginx
location ^~ /stream/ {
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
