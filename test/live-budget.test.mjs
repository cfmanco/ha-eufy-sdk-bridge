import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { keepLiveUntilDisconnect } from "../src/live-budget.mjs";

test("extend while viewer is active, without an imposed time limit", async () => {
  const handle = new EventEmitter();
  let stops = 0;
  let extended = 0;
  handle.stop = () => {
    stops++;
  };
  let connected = true;
  const release = await keepLiveUntilDisconnect({ live: async () => handle }, () => connected);
  for (let n = 0; n < 4; n++) handle.emit("budget", { extend: () => extended++ });
  assert.equal(extended, 4);
  connected = false;
  handle.emit("budget", { extend: () => extended++ });
  assert.equal(extended, 4);
  release();
  release();
  assert.equal(stops, 1);
});
test("missing live API leaves old stream behaviour available", async () => {
  const release = await keepLiveUntilDisconnect({}, () => true);
  release();
});
