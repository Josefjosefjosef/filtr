#!/usr/bin/env node
/** Capture baseline reference screenshots into docs/pre-aggregator-stable/screenshots (local only). */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(REPO, "docs", "pre-aggregator-stable", "screenshots");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8945", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function shot(page, name) {
  const fp = path.join(OUT, name);
  await page.screenshot({ path: fp, fullPage: false });
  console.log(`[shots] wrote ${fp}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    await mobile.addInitScript(() => {
      try {
        localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
        localStorage.setItem("iu:consent:analytics:v1", "denied");
      } catch (_) {}
    });
    await mobile.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "networkidle", timeout: 120000 });
    await mobile.waitForTimeout(1500);
    await shot(mobile, "mobile-feed.png");

    const tablet = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await tablet.addInitScript(() => {
      try {
        localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
        localStorage.setItem("iu:consent:analytics:v1", "denied");
      } catch (_) {}
    });
    await tablet.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "networkidle", timeout: 120000 });
    await tablet.waitForTimeout(1500);
    await shot(tablet, "tablet-feed.png");

    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await desktop.addInitScript(() => {
      try {
        localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
        localStorage.setItem("iu:consent:analytics:v1", "denied");
      } catch (_) {}
    });
    await desktop.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "networkidle", timeout: 120000 });
    await desktop.waitForTimeout(1500);
    await shot(desktop, "desktop-feed.png");

    await browser.close();
    console.log("[shots] RESULT=PASS");
  } finally {
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }
}

main().catch((e) => {
  console.error("[shots] RESULT=FAIL", e);
  process.exit(1);
});
