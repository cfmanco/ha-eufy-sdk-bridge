import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";

import { createBridgeServer } from "../src/server-transport.mjs";

test("reverse-proxy installs retain plain HTTP support", () => {
  assert.ok(createBridgeServer(() => {}, {}) instanceof http.Server);
});

test("incomplete TLS settings fail closed", () => {
  assert.throws(
    () => createBridgeServer(() => {}, { BRIDGE_TLS_CERT_FILE: "/cert" }),
    /both BRIDGE_TLS_CERT_FILE and BRIDGE_TLS_KEY_FILE/,
  );
  assert.throws(
    () => createBridgeServer(() => {}, { BRIDGE_TLS_KEY_FILE: "/key" }),
    /both BRIDGE_TLS_CERT_FILE and BRIDGE_TLS_KEY_FILE/,
  );
});

test("a missing TLS key or cert never falls back to HTTP", () => {
  assert.throws(
    () =>
      createBridgeServer(() => {}, {
        BRIDGE_TLS_CERT_FILE: "/invalid/cert.pem",
        BRIDGE_TLS_KEY_FILE: "/invalid/key.pem",
      }),
    /ENOENT/,
  );
});
