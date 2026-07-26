#!/usr/bin/env node
/**
 * Local static server for repo root (Playwright / guard proofs).
 * Serves /projects/ and assets with correct JSON MIME for SW compatibility.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function mime(f) {
  if (f.endsWith(".html")) return "text/html; charset=utf-8";
  if (f.endsWith(".js") || f.endsWith(".mjs")) return "application/javascript; charset=utf-8";
  if (f.endsWith(".css")) return "text/css; charset=utf-8";
  if (f.endsWith(".svg")) return "image/svg+xml";
  if (f.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(urlPath) {
  let u = urlPath.split("?")[0];
  try {
    u = decodeURIComponent(u);
  } catch (_) {}
  if (u === "/" || u === "/projects" || u === "/projects/") u = "/projects/index.html";
  // Local checkout mirrors Pages publish: root PWA assets live under projects/.
  if (u === "/manifest.json") u = "/projects/manifest.json";
  if (u.startsWith("/icons/")) u = "/projects/icons/" + u.slice("/icons/".length);
  const fp = path.resolve(path.join(ROOT, u.replace(/^\//, "").split("/").join(path.sep)));
  if (!fp.startsWith(path.resolve(ROOT)) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return null;
  return fs.readFileSync(fp);
}

const port = parseInt(process.env.PORT || "8890", 10);
http
  .createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const data = serveStatic(u.pathname);
    if (data) {
      let ct = mime(u.pathname);
      if (!path.extname(u.pathname) || u.pathname.endsWith("/")) ct = "text/html; charset=utf-8";
      res.writeHead(200, { "Content-Type": ct });
      res.end(data);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () => {
    console.error("static http://127.0.0.1:" + port + "/projects/");
  });
