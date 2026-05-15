#!/usr/bin/env node
/**
 * Standalone HTTP server: GET /projects/api/vin-decode?vin=XXX
 * Run: node server/vin-decode-http.mjs
 * Env: VIN_UPSTREAM_URL, VIN_UPSTREAM_KEY, VIN_RATE_MAX, VIN_CACHE_TTL_MS, PORT (default 8787)
 */
import http from "http";
import { decodeVinHandler, createDecodeEnv } from "./vin-decode-core.mjs";

const env = createDecodeEnv();

function clientIp(req) {
  const x = req.headers["x-forwarded-for"];
  if (x && typeof x === "string") return x.split(",")[0].trim();
  return req.socket.remoteAddress || "local";
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://localhost");
  if (!u.pathname.replace(/\/$/, "").endsWith("/projects/api/vin-decode")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Not found" }));
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: false, error: "Method not allowed" }));
    return;
  }
  const vin = u.searchParams.get("vin") || "";
  const out = await decodeVinHandler(vin, clientIp(req), env);
  res.writeHead(out.status, out.headers);
  res.end(out.body);
});

const port = parseInt(process.env.PORT || "8787", 10);
server.listen(port, "127.0.0.1", () => {
  console.error("vin-decode listening " + port);
});
