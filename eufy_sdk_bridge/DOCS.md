# Eufy SDK Bridge — isolated Home Assistant app (v0.2.0)

**Feature preview:** Apple Home microphone audio is not yet verified on the
physical Eufy doorbell. Installing this app does not replace the HomeKit Bridge.

## Actual security boundary

- Uses the **Supervisor internal Docker network**, never host network. The
  app declares **no published ports**, ingress, host hardware access or
  privileged capabilities. Expected Supervisor security rating: **7/8**
  (5 base + 2 for no host network and no mapped ports).
- The Node process binds to 0.0.0.0 **inside its isolated container network**
  and serves **TLS 1.3** on the configured internal port (default 3000).
  Other installed apps on the internal network can reach the socket but must
  authenticate. The network is **not** a per-app private overlay.
- A unique self-signed TLS certificate and private key are generated at first
  startup in the app's persistent private directory. The key is never baked
  into the image or printed in logs.
- The app logs the SHA256 fingerprint of its public certificate. The
  companion `cfmanco/ha-eufy-sdk` integration can pin that fingerprint for
  authenticated **WSS and HTTPS** requests. This prevents certificate
  substitution by other containers on the shared internal network.
- Bearer authentication is additionally required for WebSocket commands
  and camera media, including the HomeKit talkback endpoint. The bridge
  has no listener reachable from other LAN or WAN VLANs.
- The Node daemon runs as an unprivileged account. Eufy credentials, FCM
  state and persistent sessions remain under Supervisor's `/data`.

The score is a configuration rating, not a security audit or proof of
protection against a compromised Supervisor or host.

## Install (leave the app stopped at first)

1. Add the repository `https://github.com/cfmanco/ha-eufy-sdk-bridge`
   under **Settings → Apps → App store → Repositories** after this
   feature is merged and the repository is refreshed.
2. Install **Eufy SDK Bridge (hardened local)**, version 0.2.0 or newer,
   but leave it stopped. Configure the Eufy account and a random, private
   64-character lowercase hexadecimal `bridge_token`. Copying the
   existing Pi bridge token is permitted, but do not place it in a public
   issue, chat, or source file.
3. Back up Home Assistant's configuration and independently preserve the
   Pi bridge's session files. Keep the Pi deployment available for rollback.

## Cutover when ready

1. Stop (do not delete) the existing Pi bridge so two clients do not fight
   over the same Eufy account session.
2. Start the app and read **Supervisor internal host**, **TLS certificate
   SHA256** and **port** from its log. The host contains a repository ID;
   do not guess or hardcode that prefix.
3. Reconfigure the *existing* `eufy_sdk` integration entry using that
   internal DNS host, port, the same bearer token and the public TLS
   fingerprint shown in the app log. Use the matching Python feature
   branch with certificate pinning; **the older published integration
   cannot validate this self-signed certificate**.
4. Reload the Eufy integration and HomeKit Bridge, then verify camera
   inventory, doorbell events, thumbnails, browser WebRTC, Apple Home
   playback/listening and microphone-to-doorbell audio.
5. To roll back, stop this app, restore the old Pi HTTPS host and port in
   the integration and restart the Pi container. Preserve both instances'
   session state. Do not use duplicate integration entries.

## Rebuilds and rotation

The image fetches pinned fork source at
`c160b435f8e0bcef28127b0345a152792ac0aad9` and installs locked
dependencies. A new app release should update this pin deliberately.
Do not delete the app's private TLS key or certificate: replacing them
changes the fingerprint and interrupts connection until the integration
pin is updated. TLS certificates are initially valid for five years and
require planned renewal before expiry.

The isolated app has not been built on the physical Green. Eufy's P2P
behaviour behind the Supervisor Docker bridge is unverified; UDP
connectivity to the HomeBase must be validated before retiring the Pi.
