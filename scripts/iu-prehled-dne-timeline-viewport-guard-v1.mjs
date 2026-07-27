#!/usr/bin/env node
/**
 * Guard: Přehled dne timeline visible on desktop / mobile / tablet viewports.
 * Run: npm run iu-prehled-dne-timeline-viewport-guard
 */
import { createRequire } from "module";
import { spawn } from "child_process";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_SCRIPT = path.join(REPO, "server", "projects-static.mjs");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8932", 10);
const ORIGIN = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "")
  : `http://127.0.0.1:${PORT}`;
const APP_URL = ORIGIN + "/";
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const VIEWPORTS = [
  { name: "pc", width: 1280, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

async function probeTimeline(page) {
  return page.evaluate(() => {
    const timeline = document.querySelector(".iuPrehledDne__timeline, #iuPrehledDneTimeline");
    const dots = document.querySelectorAll(".iuPrehledDne__dot");
    const cards = document.querySelectorAll(".iuPrehledDne__card, .iuPdCard");
    const saveBtns = Array.from(document.querySelectorAll("button, a, [role='button']")).filter((el) =>
      /uložit/i.test(el.textContent || "")
    );
    const hideBtns = Array.from(document.querySelectorAll("button, a, [role='button']")).filter((el) =>
      /skrýt|skryt/i.test(el.textContent || "")
    );
    const style = timeline ? getComputedStyle(timeline) : null;
    return {
      hasTimeline: !!timeline,
      timelineDisplay: style ? style.display : null,
      dotCount: dots.length,
      cardCount: cards.length,
      saveCount: saveBtns.length,
      hideCount: hideBtns.length,
    };
  });
}

async function openPrehled(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("a,button,[role='button'],.iuNavItem,.nav-item"));
    const hit = candidates.find((el) => /přehled dne|prehled dne/i.test(el.textContent || el.getAttribute("aria-label") || ""));
    if (hit) {
      hit.click();
      return true;
    }
    try {
      location.hash = "#prehled-dne";
    } catch (_) {}
    return false;
  });
  await page.waitForTimeout(2500);
  await page.waitForSelector(".iuPrehledDne__timeline, #iuPrehledDneTimeline, .iuPrehledDne", {
    timeout: 45000,
  }).catch(() => null);
  return clicked;
}

async function main() {
  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    serverProc = spawn(process.execPath, [SERVER_SCRIPT], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const tick = () => {
        const req = http.get(`http://127.0.0.1:${PORT}/`, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve();
          else if (Date.now() >= deadline) reject(new Error("server not ready"));
          else setTimeout(tick, 300);
        });
        req.on("error", () => {
          if (Date.now() >= deadline) reject(new Error("server not ready"));
          else setTimeout(tick, 300);
        });
      };
      tick();
    });
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  const failures = [];

  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
      const page = await context.newPage();
      try {
        await openPrehled(page);
        const probe = await probeTimeline(page);
        const ok =
          probe.hasTimeline &&
          probe.timelineDisplay !== "none" &&
          (probe.dotCount > 0 || probe.cardCount > 0);
        results.push({ viewport: vp.name, ok, ...probe });
        if (!ok) failures.push({ viewport: vp.name, probe });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
  }

  const pass = failures.length === 0;
  console.log(JSON.stringify({ pass, origin: ORIGIN, results, failures }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
