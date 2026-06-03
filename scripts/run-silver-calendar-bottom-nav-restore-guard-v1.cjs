#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { runGuard } = require("./silver-calendar-bottom-nav-restore-guard-v1-shared.cjs");

const ROOT = path.join(__dirname, "..");
const PORT = 8091;
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media`;

function freePort(port) {
  try {
    const { execSync } = require("child_process");
    if (process.platform === "win32") {
      execSync(
        'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ' +
          port +
          ' -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"',
        { stdio: "ignore" }
      );
    }
  } catch (_) {}
}

function serveFile(urlPath) {
  let filePath = path.join(ROOT, (urlPath === "/" || urlPath === "") ? "index.html" : urlPath.replace(/^\//, "").replace(/\/$/, "") || "index.html");
  if (urlPath && urlPath !== "/" && !urlPath.startsWith("/projects")) {
    const lastSeg = (urlPath.split("?")[0] || "").split("/").filter(Boolean).pop() || "";
    if (!path.extname(lastSeg)) {
      const p = path.join(ROOT, urlPath.replace(/^\//, "").split("/")[0]);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) filePath = path.join(p, "index.html");
    }
  }
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT)) && !filePath.includes(ROOT)) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    return fs.readFileSync(filePath);
  } catch (_) {
    return null;
  }
}

function startServer() {
  freePort(PORT);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath);
        const ct =
          ext === ".css" ? "text/css" :
          ext === ".js" ? "application/javascript" :
          ext === ".json" ? "application/json" :
          "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const staticGuard = spawnSync(process.execPath, [path.join(__dirname, "silver-calendar-bottom-nav-restore-guard-v1.cjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  process.stdout.write(staticGuard.stdout || "");
  if (staticGuard.status !== 0) process.exit(staticGuard.status || 1);

  const server = await startServer();
  try {
    process.env.SILVER_CALENDAR_BOTTOM_NAV_GUARD_URL = BASE;
    const out = await runGuard();
    process.stdout.write(JSON.stringify(out) + "\n");
    if (!out.pass) process.exit(1);
  } finally {
    if (server) server.close();
  }
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exit(1);
});
