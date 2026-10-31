# Eufy SDK Bridge — hardened local Home Assistant app

**Preview:** Incoming and outgoing HomeKit audio still require an Apple Home
hardware test. This app installs the existing Node bridge alongside Core.

## Security and transport

- Supervisor uses host networking for this app, but the bridge binds its
  HTTP/WebSocket listener to **127.0.0.1** only. No Home Assistant LAN
  port, ingress service or management UI is published.
- The Eufy integration must use **127.0.0.1**, app **bridge_port** (default
  3000), and the same 64-character bridge token entered in app options.
  This literal host-loopback endpoint uses bearer-authenticated HTTP/WS;
  other hosts continue using verified HTTPS/WSS.
- The bundled go2rtc is disabled. Browser WebRTC and HomeKit run in Core.
- Authentication secrets, session state and thumbnails live in the app's
  private persistent directory, with the Node daemon running unprivileged.

## Installation — leave stopped initially

1. In Home Assistant, open **Settings → Apps → App store → Repositories**.
   Add this branch as a repository:
   `https://github.com/cfmanco/ha-eufy-sdk-bridge#feat/local-p2p-live-view`.
   Enable **Advanced Mode** if the experimental app is hidden.
2. Install **Eufy SDK Bridge (hardened local)**. Configure your Eufy
   account and a mandatory lowercase 64-character hexadecimal
   `bridge_token`. You can reuse the Raspberry Pi bridge's existing
   token to avoid changing the integration's credential. Never paste
   tokens into chat or repository files.
3. Save a Home Assistant backup and independently preserve the Pi's
   session files. Do not delete or reset the running Raspberry Pi
   installation yet.

## Cutover when ready

1. **Stop**, but do not remove, the Pi bridge. Running both concurrently
   can displace the account's login and push session.
2. Start this app. Its log should show a listener at
   `127.0.0.1:3000` (or your configured bridge_port).
3. Update the **existing Eufy SDK integration entry** to host
   `127.0.0.1` and the app's port; retain the shared bridge token.
   Do not add a duplicate integration entry.
4. Reload the Eufy integration and the existing HomeKit Bridge. Verify
   inventory, a physical doorbell press, snapshots, browser WebRTC,
   Apple Home video/listening and return microphone audio.
5. If validation fails, stop this app, restart the Pi container and
   restore the prior integration hostname and port. Preserve both sets
   of session files.

## Build details and known limitations

The app builds source from the pinned fork commit
`919f3ef0a84173f8b10518cbf09d0303b280bd17` and installs the
commit's npm lockfile dependencies. It does **not** pull the upstream
bridge image. Update the pinned revision only after reviewing future
bridge changes. Supervisor needs internet access to GitHub and the
public npm registry when building the app.

The app has **not** been built on the physical Green or validated against
the live doorbell. Moving from the Raspberry Pi does not automatically
migrate Eufy/FCM session files; an Eufy login or 2FA prompt may be
necessary. Keep both installations until end-to-end validation passes.
