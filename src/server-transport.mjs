// Use direct TLS for the isolated Supervisor app. Existing Pi deployments
// may continue terminating TLS at their restricted Nginx reverse proxy.
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";

export function createBridgeServer(handler, env = process.env) {
  const certPath = env.BRIDGE_TLS_CERT_FILE;
  const keyPath = env.BRIDGE_TLS_KEY_FILE;
  if (Boolean(certPath) !== Boolean(keyPath)) {
    throw new Error("configure both BRIDGE_TLS_CERT_FILE and BRIDGE_TLS_KEY_FILE");
  }
  if (!certPath) return http.createServer(handler);

  return https.createServer(
    {
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
      minVersion: "TLSv1.3",
    },
    handler,
  );
}
