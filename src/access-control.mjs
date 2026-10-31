// Bridge-client authentication is separate from the Eufy account login.
// Keep only a digest of the client secret in memory after startup.
import { createHash, timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

const TOKEN_FORMAT = /^[0-9a-f]{64}$/;
const BEARER_FORMAT = /^Bearer ([0-9a-f]{64})$/i;

function configError(reason) {
  throw new Error("Bridge client authentication: " + reason);
}

/**
 * Require exactly one 32-byte secret encoded as 64 lowercase hex characters.
 * The preferred source is a read-only file bind-mounted with mode 0400 or 0600.
 * A single trailing newline is accepted for compatibility with secret files.
 */
export function loadBridgeClientToken(env = process.env) {
  const file = env.BRIDGE_AUTH_TOKEN_FILE;
  const direct = env.BRIDGE_AUTH_TOKEN;
  if (file == null && direct == null) {
    configError("BRIDGE_AUTH_TOKEN_FILE or BRIDGE_AUTH_TOKEN is required");
  }
  if (file != null && direct != null) {
    configError("configure exactly one of BRIDGE_AUTH_TOKEN_FILE and BRIDGE_AUTH_TOKEN");
  }

  let token;
  if (file != null) {
    if (!file || file.trim() !== file) configError("token file path must be non-empty and exact");
    const stat = lstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
      configError("token file must be a private regular file (mode 0400 or 0600)");
    }
    token = readFileSync(file, "utf8").replace(/\r?\n$/, "");
  } else {
    token = direct;
  }
  if (!TOKEN_FORMAT.test(token)) {
    configError("token must contain 64 lowercase hexadecimal characters (32 random bytes)");
  }
  return token;
}

/** A malformed Authorization field is treated exactly like an absent field. */
export function readBearer(req) {
  const header = req.headers?.authorization;
  if (typeof header !== "string") return null;
  return BEARER_FORMAT.exec(header)?.[1] ?? null;
}

/**
 * All access checks use fixed-length SHA-256 digests and timing-safe comparison.
 * Neither the raw configured token nor an incoming Authorization value is logged.
 */
export function createAccessControl(env = process.env) {
  const digest = createHash("sha256").update(loadBridgeClientToken(env)).digest();
  return Object.freeze({
    authorize(req) {
      const token = readBearer(req);
      if (token == null) return false;
      const presented = createHash("sha256").update(token).digest();
      return timingSafeEqual(digest, presented);
    },
  });
}
