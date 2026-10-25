import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccessControl } from "../src/access-control.mjs";
import { loadConfig } from "../src/config.mjs";
import { createState } from "../src/state.mjs";
import { createHttpHandler } from "../src/http-routes.mjs";

const token = "0123456789abcdef".repeat(4);

function setup() {
  const state = createState();
  state.flags.ready = true;
  let sdkCalls = 0;
  const ctx = {
    ...loadConfig({ EUFY_EMAIL: "user@example.invalid", EUFY_PASSWORD: "secret" }),
    state,
    bridgeId: "private-bridge-id",
    eventImageDir: "/never-read",
    accessControl: createAccessControl({ BRIDGE_AUTH_TOKEN: token }),
    authStatus: () => ({ state: "ok" }),
    eufy: {
      getDevice: async () => {
        sdkCalls += 1;
        throw new Error("Camera must not be touched before access check");
      },
    },
  };
  return { handler: createHttpHandler(ctx), calls: () => sdkCalls };
}

async function get(handler, path, authorization, method = "GET") {
  const out = {};
  const req = {
    url: path,
    method,
    headers: { host: "untrusted.invalid", ...(authorization ? { authorization } : {}) },
    socket: { remoteAddress: "127.0.0.1" },
  };
  await handler(req, {
    writeHead(code, headers) {
      out.code = code;
      out.headers = headers;
    },
    end(body) {
      out.body = body;
    },
  });
  return out;
}

test("all media endpoints reject anonymous access before SDK state is read", async () => {
  const { handler, calls } = setup();
  for (const path of ["/snapshot/SN", "/event-image/SN", "/clip/SN", "/stream/SN", "/stream-av/SN", "/not-a-route"]) {
    const out = await get(handler, path);
    assert.equal(out.code, 401, path);
    assert.deepEqual(JSON.parse(out.body), { error: "unauthorized" });
    assert.match(out.headers["www-authenticate"], /^Bearer/);
  }
  assert.equal(calls(), 0);
});

test("invalid bearer receives the same 401 as no bearer, including on localhost", async () => {
  const { handler, calls } = setup();
  const out = await get(handler, "/snapshot/SN", "Bearer " + "f".repeat(64));
  assert.equal(out.code, 401);
  assert.equal(calls(), 0);
});

test("unauthenticated health reveals only liveness, authenticated health returns operational state", async () => {
  const { handler } = setup();
  const anonymous = await get(handler, "/healthz");
  assert.equal(anonymous.code, 200);
  assert.deepEqual(JSON.parse(anonymous.body), { ok: true });
  const authorised = await get(handler, "/healthz", "Bearer " + token);
  assert.equal(authorised.code, 200);
  const body = JSON.parse(authorised.body);
  assert.equal(body.bridgeId, "private-bridge-id");
  assert.equal(body.auth.state, "ok");
});

test("authenticated requests reject unsupported HTTP methods", async () => {
  const { handler, calls } = setup();
  const out = await get(handler, "/snapshot/SN", "Bearer " + token, "POST");
  assert.equal(out.code, 405);
  assert.equal(out.headers.allow, "GET");
  assert.equal(calls(), 0);
});
