# Home Assistant Supervisor builds this app from its own folder.
# Pin the fork's bridge revision; never pull an unrelated upstream image.
FROM node:24-alpine

ARG BUILD_VERSION=0.1.0
ARG BUILD_ARCH=aarch64
ARG BRIDGE_REV=919f3ef0a84173f8b10518cbf09d0303b280bd17

RUN apk add --no-cache ca-certificates curl jq su-exec ffmpeg
WORKDIR /app
RUN mkdir -p /app \
    && curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
      "https://codeload.github.com/cfmanco/ha-eufy-sdk-bridge/tar.gz/${BRIDGE_REV}" \
      | tar -xz --strip-components=1 -C /app \
    && test -f /app/package-lock.json \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY run.sh /run.sh
RUN chmod 0755 /run.sh

ENV BRIDGE_APP_DIR=/app \
    GO2RTC_ENABLE=0 \
    BRIDGE_HOST=127.0.0.1

LABEL io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      io.hass.type="app" \
      org.opencontainers.image.source="https://github.com/cfmanco/ha-eufy-sdk-bridge" \
      org.opencontainers.image.description="Hardened Home Assistant local-only Eufy SDK bridge"

CMD ["/run.sh"]
