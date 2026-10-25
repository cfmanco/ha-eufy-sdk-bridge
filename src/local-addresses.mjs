// Explicit station-to-LAN mappings. An override selects a local P2P candidate;
// it does NOT turn cloud login, device discovery, or push into offline services.
import { isIP } from "node:net";

export function parseLocalAddresses(value) {
  if (value == null || value === "") return undefined;
  let input;
  try {
    input = JSON.parse(value);
  } catch {
    throw new Error("EUFY_LOCAL_ADDRESSES must be a JSON object");
  }
  if (input == null || Array.isArray(input) || typeof input !== "object") {
    throw new Error("EUFY_LOCAL_ADDRESSES must be a JSON object");
  }
  const addresses = Object.create(null);
  for (const [station, ip] of Object.entries(input)) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(station) || typeof ip !== "string" || isIP(ip) !== 4) {
      throw new Error("EUFY_LOCAL_ADDRESSES requires station serials and IPv4 addresses");
    }
    const [a, b] = ip.split(".").map(Number);
    if (!(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168))) {
      throw new Error("EUFY_LOCAL_ADDRESSES permits only RFC1918 LAN addresses");
    }
    addresses[station] = ip;
  }
  return addresses;
}
