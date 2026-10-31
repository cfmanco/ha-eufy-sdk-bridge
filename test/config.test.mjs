import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";

const base = { EUFY_EMAIL: "x@y.z", EUFY_PASSWORD: "pw" };

test("event pre-warm is OFF by default", () => {
  assert.equal(loadConfig(base).cfg.prewarm, false); // → client passes prewarmEvents: []
});

test("BRIDGE_PREWARM=1 turns pre-warm on (SDK default events)", () => {
  assert.equal(loadConfig({ ...base, BRIDGE_PREWARM: "1" }).cfg.prewarm, true);
  assert.equal(loadConfig({ ...base, BRIDGE_PREWARM: "true" }).cfg.prewarm, true);
  assert.equal(loadConfig({ ...base, BRIDGE_PREWARM: "0" }).cfg.prewarm, false);
});

test("FCM push store path is derived beside the session file", () => {
  assert.equal(loadConfig(base).cfg.pushSession, "data/.eufy-fcm.json"); // default session ./data/.eufy-session.json
  assert.equal(
    loadConfig({ ...base, EUFY_SESSION: "/app/data/.eufy-session.json" }).cfg.pushSession,
    "/app/data/.eufy-fcm.json",
  );
});

test("SOLIX_SCENE_POLL_MS: default 90s, and a custom value is honoured", () => {
  const solixEnv = { ...base, SOLIX_EMAIL: "s@a.z", SOLIX_PASSWORD: "sp" };
  assert.equal(loadConfig(solixEnv).cfg.solix.scenePollMs, 90_000); // default
  assert.equal(loadConfig({ ...solixEnv, SOLIX_SCENE_POLL_MS: "30000" }).cfg.solix.scenePollMs, 30_000);
  // A non-numeric / empty value falls back to the default rather than NaN.
  assert.equal(loadConfig({ ...solixEnv, SOLIX_SCENE_POLL_MS: "" }).cfg.solix.scenePollMs, 90_000);
});

test("SOLIX_RETRY_BASE_MS / SOLIX_RETRY_MAX_MS: defaults and custom values", () => {
  const solixEnv = { ...base, SOLIX_EMAIL: "s@a.z", SOLIX_PASSWORD: "sp" };
  const def = loadConfig(solixEnv).cfg.solix;
  assert.equal(def.retryBaseMs, 15 * 60 * 1000); // 15 min
  assert.equal(def.retryMaxMs, 60 * 60 * 1000); // 1 h
  const custom = loadConfig({ ...solixEnv, SOLIX_RETRY_BASE_MS: "60000", SOLIX_RETRY_MAX_MS: "300000" }).cfg.solix;
  assert.equal(custom.retryBaseMs, 60_000);
  assert.equal(custom.retryMaxMs, 300_000);
});

test("openudid is undefined by default and taken from BRIDGE_OPENUDID when set", () => {
  assert.equal(loadConfig(base).cfg.openudid, undefined); // → SDK derives from email
  assert.equal(loadConfig({ ...base, BRIDGE_OPENUDID: "abcd1234abcd1234" }).cfg.openudid, "abcd1234abcd1234");
  assert.equal(loadConfig({ ...base, BRIDGE_OPENUDID: "" }).cfg.openudid, undefined); // empty → default
});

test("separate go2rtc does not suppress RTSP discovery", () => {
  const external = loadConfig({ ...base, GO2RTC_ENABLE: "0" }).cfg;
  assert.equal(external.go2rtcEnable, false);
  assert.equal(external.rtspAvailable, true);
  assert.equal(external.rtspBase, "rtsp://127.0.0.1:8554");
});

test("Supervisor without a converter explicitly disables RTSP discovery", () => {
  const app = loadConfig({ ...base, GO2RTC_ENABLE: "0", GO2RTC_RTSP_AVAILABLE: "0" }).cfg;
  assert.equal(app.go2rtcEnable, false);
  assert.equal(app.rtspAvailable, false);
});

test("external Frigate RTSP host and port can be advertised independently", () => {
  const external = loadConfig({
    ...base,
    GO2RTC_ENABLE: "0",
    GO2RTC_RTSP_BASE: "rtsp://frigate.internal:8558",
  }).cfg;
  assert.equal(external.rtspBase, "rtsp://frigate.internal:8558");
  assert.equal(external.rtspAvailable, true);
});

test("RTSP endpoint configuration rejects credentials and non-RTSP URLs", () => {
  for (const endpoint of [
    "http://frigate.internal:8554",
    "rtsp://admin:secret@frigate.internal:8554",
    "rtsp://frigate.internal:8554/path",
    "rtsp://frigate.internal:8554?token=secret",
    " rtsp://frigate.internal:8554",
  ]) {
    assert.throws(() => loadConfig({ ...base, GO2RTC_RTSP_BASE: endpoint }), /GO2RTC_RTSP_BASE/);
  }
});
