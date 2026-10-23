// End-to-end HTTP upgrade tests: no SDK login or camera is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";
import { createAccessControl } from "../src/access-control.mjs";
import { createWsServer } from "../src/ws-server.mjs";

const token = "0123456789abcdef".repeat(4);

async function setup(t) {
  const server = http.createServer();
  const ctx = {
    accessControl: createAccessControl({ BRIDGE_AUTH_TOKEN: token }),
    state: { clients: new Set(), flags: { ready: false } },
    SCHEMA_VERSION: 1,
    bridgeId: "fixture-bridge",
    authStatus: () => ({ state: "pending" }),
  };
  createWsServer(ctx, server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return "ws://127.0.0.1:" + server.address().port;
}

function rejected(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers, handshakeTimeout: 3000 });
    ws.once("open", () => reject(new Error("Unexpected WebSocket upgrade")));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => {
      res.resume();
      resolve({ status: res.statusCode, challenge: res.headers["www-authenticate"] });
    });
  });
}

function firstMessage(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers, handshakeTimeout: 3000 });
    ws.once("error", reject);
    ws.once("message", (data) => {
      const result = JSON.parse(data.toString());
      ws.close();
      resolve(result);
    });
  });
}

test("WebSocket handshake rejects missing and incorrect bearer before hello", async (t) => {
  const url = (await setup(t)) + "/ws";
  for (const headers of [undefined, { Authorization: "Bearer " + "f".repeat(64) }]) {
    const result = await rejected(url, headers);
    assert.equal(result.status, 401);
    assert.match(result.challenge, /^Bearer/);
  }
});

test("WebSocket handshake admits a valid bearer and retains hello shape", async (t) => {
  const url = (await setup(t)) + "/ws";
  const message = await firstMessage(url, { Authorization: "Bearer " + token });
  assert.deepEqual(message, {
    event: "hello",
    schemaVersion: 1,
    bridgeId: "fixture-bridge",
    auth: { state: "pending" },
  });
});

test("WebSocket upgrade rejects unknown paths without revealing authorisation state", async (t) => {
  const url = (await setup(t)) + "/incorrect";
  const result = await rejected(url, { Authorization: "Bearer " + token });
  assert.equal(result.status, 404);
  assert.equal(result.challenge, undefined);
});
