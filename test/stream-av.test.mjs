// Behavioural tests for authenticated HomeKit video + AAC transport over fMP4.
import { EventEmitter } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/config.mjs";
import { createState } from "../src/state.mjs";

process.env.BRIDGE_STREAM_CONSUMER_LOG_MS = "0";
const { createHttpHandler } = await import("../src/http-routes.mjs");

class MockResponse extends EventEmitter {
  constructor() {
    super();
    this.status = null;
    this.headersSent = false;
    this.destroyed = false;
    this.ended = false;
    this.chunks = [];
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }

  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  end(chunk) {
    if (chunk) this.chunks.push(Buffer.from(chunk));
    this.ended = true;
    this.emit("close");
  }

  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
}

function setup({ authorised = true, recordFragments, backoffMs = 0 } = {}) {
  const opened = [];
  let sdkCalls = 0;
  const config = loadConfig({ EUFY_EMAIL: "x@y.z", EUFY_PASSWORD: "pw" });
  const state = createState();
  state.flags.ready = true;
  const ctx = {
    ...config,
    state,
    accessControl: { authorize: () => authorised },
    eventLog: () => {},
    streamBackoffMs: () => backoffMs,
    streamClientFor: async () => {
      sdkCalls += 1;
      return {
        getDevice: async () => ({
          camera: () => ({ recordFragments: (opts) => {
            opened.push(opts);
            return recordFragments();
          } }),
          describe: () => ({ model: "UNKNOWN", capabilities: ["battery"] }),
        }),
      };
    },
  };
  return { handler: createHttpHandler(ctx), opened, sdkCalls: () => sdkCalls };
}

function request(handler, url = "/stream-av/CAMERA01") {
  const req = new EventEmitter();
  req.url = url;
  req.headers = { host: "localhost" };
  req.socket = { remoteAddress: "127.0.0.1" };
  const res = new MockResponse();
  return { req, res, done: handler(req, res) };
}

test("anonymous or malformed A/V requests never touch the SDK", async () => {
  const denied = setup({ authorised: false });
  const a = request(denied.handler);
  await a.done;
  assert.equal(a.res.status, 401);
  assert.equal(denied.sdkCalls(), 0);

  const valid = setup({ authorised: true });
  for (const url of ["/stream-av/CAMERA01/extra", "/stream-av/CAMERA01?bad=1"]) {
    const item = request(valid.handler, url);
    await item.done;
    assert.equal(item.res.status, 404);
  }
  assert.equal(valid.sdkCalls(), 0);
});

test("fragmented MP4 passes init and media fragments and releases the recording", async () => {
  let stopped = 0;
  let budgetCallback;
  const muxed = {
    on(event, callback) {
      if (event === "budget") budgetCallback = callback;
      return this;
    },
    stop() {
      stopped += 1;
    },
    async *[Symbol.asyncIterator]() {
      yield { init: Buffer.from("ftyp"), data: Buffer.from("moofmdat") };
    },
  };
  const { handler, opened } = setup({ recordFragments: () => muxed });
  const item = request(handler);
  await item.done;
  assert.equal(item.res.status, 200);
  assert.equal(item.res.headers["content-type"], "video/mp4");
  assert.equal(Buffer.concat(item.res.chunks).toString(), "ftypmoofmdat");
  assert.equal(item.res.ended, true);
  assert.ok(stopped >= 1);
  assert.equal(opened[0].powered, "battery");
  assert.equal(opened[0].fragmentSeconds, 1);
  let extended = 0;
  budgetCallback({ extend: () => { extended += 1; } });
  assert.equal(extended, 0, "a closed stream cannot extend the camera budget");
});

test("disconnect stops a fragment producer without waiting for another frame", async () => {
  let ready;
  let release;
  let stopped = 0;
  const entered = new Promise((resolve) => { ready = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const producer = {
    on() { return this; },
    stop() {
      stopped += 1;
      release();
    },
    async *[Symbol.asyncIterator]() {
      ready();
      await blocked;
      yield { init: Buffer.from("late"), data: Buffer.alloc(0) };
    },
  };
  const { handler } = setup({ recordFragments: () => producer });
  const item = request(handler);
  await entered;
  item.res.destroy();
  await item.done;
  assert.ok(stopped >= 1);
  assert.equal(item.res.chunks.length, 0);
});

test("backoff denies A/V streams without opening a P2P session", async () => {
  const { handler, sdkCalls } = setup({ backoffMs: 10000 });
  const item = request(handler);
  await item.done;
  assert.equal(item.res.status, 503);
  assert.equal(sdkCalls(), 0);
});
