import test from "node:test";
import assert from "node:assert/strict";
import { parseLocalAddresses } from "../src/local-addresses.mjs";

test("unset LAN override is inert", () => {
  assert.equal(parseLocalAddresses(undefined), undefined);
});
test("a station's RFC1918 address is retained for the SDK", () => {
  const input = parseLocalAddresses('{"STATION_A":"192.168.10.25","STATION_B":"10.3.2.1"}');
  assert.equal(input.STATION_A, "192.168.10.25");
  assert.equal(input.STATION_B, "10.3.2.1");
});
test("invalid JSON, public IP and unsafe serials are rejected", () => {
  for (const value of [
    "{",
    "[]",
    '{"BAD!":"192.168.1.1"}',
    '{"STATION":"8.8.8.8"}',
    '{"STATION":"127.0.0.1"}',
    '{"STATION":"example.com"}',
    '{"STATION":"192.168.1.1:32100"}',
  ])
    assert.throws(() => parseLocalAddresses(value), /EUFY_LOCAL_ADDRESSES/);
});
