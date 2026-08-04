#!/usr/bin/env node
/**
 * Local static server for repo root (Playwright / guard proofs).
 * Mirrors production hub contract:
 *   - app at /
 *   - /projects HTML hub → 301 to /
 *   - /projects/data/* + /projects/version.json passthrough
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

function legacyProjectsRedirect(pathname, search) {
  const p = String(pathname || "");
  if (p === "/projects/data" || p.startsWith("/projects/data/")) return null;
  if (p === "/projects/version.json") return null;
  if (!(p === "/projects" || p === "/projects/" || p.startsWith("/projects/"))) return null;
  let rest = p === "/projects" || p === "/projects/" ? "/" : "/" + p.slice("/projects/".length);
  if (rest.length > 1 && rest.endsWith("/")) {
    // keep trailing slash for directory-like pages
  } else if (rest === "") {
    rest = "/";
  }
  return rest + (search || "");
}

function serveStatic(urlPath) {
  let u = urlPath.split("?")[0];
  try {
    u = decodeURIComponent(u);
  } catch (_) {}
  // Hub is site root. Local checkout stores SPA under projects/index.html.
  if (u === "/") u = "/projects/index.html";
  // Local checkout mirrors Pages publish: root PWA assets live under projects/.
  if (u === "/manifest.json") u = "/projects/manifest.json";
  if (u.startsWith("/icons/")) u = "/projects/icons/" + u.slice("/icons/".length);
  if (u === "/statistiky" || u === "/statistiky/") u = "/projects/statistiky/index.html";
  if (u === "/zdroje-a-licence" || u === "/zdroje-a-licence/") u = "/projects/zdroje-a-licence/index.html";
  const fp = path.resolve(path.join(ROOT, u.replace(/^\//, "").split("/").join(path.sep)));
  if (!fp.startsWith(path.resolve(ROOT)) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) return null;
  return fs.readFileSync(fp);
}

const port = parseInt(process.env.PORT || "8890", 10);
http
  .createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    const redir = legacyProjectsRedirect(u.pathname, u.search);
    if (redir) {
      res.writeHead(301, { Location: redir });
      res.end();
      return;
    }
    const data = serveStatic(u.pathname);
    if (data) {
      let ct = mime(u.pathname);
      if (!path.extname(u.pathname) || u.pathname.endsWith("/")) ct = "text/html; charset=utf-8";
      let body = data;
      // Local HTTP proofs: CSP upgrade-insecure-requests breaks WebKit (forces https://127.0.0.1).
      if (ct.indexOf("text/html") === 0) {
        body = Buffer.from(String(data).replace(/upgrade-insecure-requests;?/gi, ""), "utf8");
      }
      res.writeHead(200, { "Content-Type": ct });
      res.end(body);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(port, "127.0.0.1", () => {
    console.error("static http://127.0.0.1:" + port + "/");
  });
