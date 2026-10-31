# Source-pinned Supervisor app: no host-network mode, no published ports.
# No upstream/prebuilt bridge image is trusted for this fork.
FROM node:24-alpine

ARG BUILD_VERSION=0.2.1
ARG BUILD_ARCH=aarch64
ARG BRIDGE_REV=3354698b21cb415ca5f01771051a60111e7d9c8f

RUN apk add --no-cache ca-certificates curl jq su-exec ffmpeg openssl
WORKDIR /app
RUN mkdir -p /app \
    && curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
      "https://codeload.github.com/cfmanco/ha-eufy-sdk-bridge/tar.gz/${BRIDGE_REV}" \
      | tar -xz --strip-components=1 -C /app \
    && test -f /app/src/server-transport.mjs \
    && test -f /app/package-lock.json \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY run.sh /run.sh
RUN chmod 0755 /run.sh

ENV BRIDGE_APP_DIR=/app GO2RTC_ENABLE=0

LABEL io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      io.hass.type="app" \
      org.opencontainers.image.source="https://github.com/cfmanco/ha-eufy-sdk-bridge" \
      org.opencontainers.image.description="Isolated, TLS-authenticated Home Assistant Eufy SDK bridge"

CMD ["/run.sh"]
