#!/usr/bin/env node
/**
 * Local combined server: static repo root + /projects/api/vin-decode
 * For hard proof: node server/projects-static-and-vin.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodeVinHandler, createDecodeEnv } from "./vin-decode-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const env = createDecodeEnv();

function mime(f) {
  if (f.endsWith(".html")) return "text/html; charset=utf-8";
  if (f.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (f.endsWith(".css")) return "text/css; charset=utf-8";
  if (f.endsWith(".svg")) return "image/svg+xml";
  /* P0: JSON musí být application/json — jinak SW (handleDataRequest) odmítne tělo a vrátí 503 → console errors při lokálním proof. */
  if (f.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(urlPath) {
  let u = urlPath.split("?")[0];
  if (u === "/" || u === "/projects" || u === "/projects/")
    u = "/projects/index.html";
  const fp = path.resolve(path.join(ROOT, u.replace(/^\//, "").split("/").join(path.sep)));
  if (!fp.startsWith(path.resolve(ROOT)) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory())
    return null;
  return fs.readFileSync(fp);
}

function clientIp(req) {
  const x = req.headers["x-forwarded-for"];
  if (x && typeof x === "string") return x.split(",")[0].trim();
  return req.socket.remoteAddress || "local";
}

const port = parseInt(process.env.PORT || "8890", 10);
http
  .createServer(async (req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    if (u.pathname.replace(/\/$/, "").endsWith("/projects/api/vin-decode")) {
      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false }));
        return;
      }
      const vin = u.searchParams.get("vin") || "";
      const out = await decodeVinHandler(vin, clientIp(req), env);
      res.writeHead(out.status, out.headers);
      res.end(out.body);
      return;
    }
    const data = serveStatic(u.pathname);
    if (data) {
      let ct = mime(u.pathname);
      if (!path.extname(u.pathname) || u.pathname.endsWith("/")) {
        ct = "text/html; charset=utf-8";
      }
      res.writeHead(200, { "Content-Type": ct });
      res.end(data);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () => {
    console.error("static+vin http://127.0.0.1:" + port + "/projects/");
  });
