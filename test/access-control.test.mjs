import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAccessControl, loadBridgeClientToken, readBearer } from "../src/access-control.mjs";

const token = "0123456789abcdef".repeat(4);
const otherToken = "fedcba9876543210".repeat(4);
const request = (authorization) => ({ headers: { authorization } });

test("access control refuses startup without exactly one configured token source", () => {
  assert.throws(() => loadBridgeClientToken({}), /required/);
  assert.throws(
    () => loadBridgeClientToken({ BRIDGE_AUTH_TOKEN: token, BRIDGE_AUTH_TOKEN_FILE: "/tmp/nope" }),
    /exactly one/,
  );
});

test("access control validates strong canonical token format", () => {
  for (const value of ["short", "a".repeat(63), "Z".repeat(64), token + "\n", "0".repeat(64) + " "]) {
    assert.throws(() => loadBridgeClientToken({ BRIDGE_AUTH_TOKEN: value }), /64 lowercase hexadecimal/);
  }
  assert.equal(loadBridgeClientToken({ BRIDGE_AUTH_TOKEN: token }), token);
});

test("access control only accepts precisely formed bearer header", () => {
  assert.equal(readBearer(request("Bearer " + token)), token);
  assert.equal(readBearer(request("bearer " + token)), token);
  for (const authorization of [undefined, "Basic " + token, "Bearer " + token + " extra", token, "Bearer  " + token]) {
    assert.equal(readBearer(request(authorization)), null);
  }
});

test("access control denies missing and incorrect secrets even for localhost", () => {
  const access = createAccessControl({ BRIDGE_AUTH_TOKEN: token });
  assert.equal(access.authorize(request("Bearer " + token)), true);
  assert.equal(access.authorize(request("Bearer " + otherToken)), false);
  assert.equal(access.authorize({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), false);
  assert.equal(access.authorize(request("Bearer " + token.toUpperCase())), false);
  assert.equal(access.authorize(request(["Bearer " + token])), false);
});

test("access control reads a private file and rejects accessible or linked token files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-auth-"));
  try {
    const file = path.join(dir, "token");
    const link = path.join(dir, "link");
    fs.writeFileSync(file, token + "\n", { mode: 0o600 });
    assert.equal(loadBridgeClientToken({ BRIDGE_AUTH_TOKEN_FILE: file }), token);
    fs.chmodSync(file, 0o644);
    assert.throws(() => loadBridgeClientToken({ BRIDGE_AUTH_TOKEN_FILE: file }), /private regular file/);
    fs.chmodSync(file, 0o600);
    fs.symlinkSync(file, link);
    assert.throws(() => loadBridgeClientToken({ BRIDGE_AUTH_TOKEN_FILE: link }), /private regular file/);
  } finally {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});
