#!/usr/bin/env node
/**
 * Guard: globální dialog ochrany lokálních dat — jednou zobrazit, pak ne.
 * Run: npm run iu-local-data-protection-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8900", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL = !process.env.IU_GUARD_BASE_URL;

const KEY = "iu:local-data-protection:notice-accepted:v1";

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

async function main() {
  let server = null;
  if (USE_LOCAL) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const fails = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
      localStorage.setItem("iu:consent:analytics:v1", "denied");
    } catch (_) {}
  });
  const page = await context.newPage();

  try {
    await page.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.evaluate(async () => {
      if (window.iuLocalDataProtection) return;
      try {
        await import("/assets/iu-local-data-protection.js");
      } catch (_) {}
    });
    await page.waitForFunction(
      () => !!(window.iuLocalDataProtection && window.iuLocalDataProtection.ensureLocalDataProtectionBeforeSave),
      null,
      { timeout: 30000 }
    );
    await page.evaluate((k) => {
      try {
        localStorage.removeItem(k);
        localStorage.removeItem("iu:tool-local-storage-consent:v1");
      } catch (_) {}
    }, KEY);

    const first = await page.evaluate(async () => {
      const ldp = window.iuLocalDataProtection;
      if (!ldp || typeof ldp.ensureLocalDataProtectionBeforeSave !== "function") {
        return { ok: false, reason: "missing iuLocalDataProtection" };
      }
      const p = ldp.ensureLocalDataProtectionBeforeSave();
      await new Promise((r) => setTimeout(r, 500));
      const dialogVisible = !!document.querySelector(".iu-ldp-backdrop");
      if (!dialogVisible) return { ok: false, reason: "dialog not shown on first save" };
      return { ok: true, reason: "" };
    });

    if (!first.ok) fails.push(first.reason || "first dialog flow failed");
    else {
      await page.locator(".iu-ldp-backdrop").first().locator(".iu-ldp-btn--secondary").click({ timeout: 10000, force: true });
      await page.waitForFunction(() => !document.querySelector(".iu-ldp-backdrop"), null, { timeout: 10000 });
      const accepted = await page.evaluate(() => window.iuLocalDataProtection.isLocalDataProtectionNoticeAccepted());
      if (!accepted) fails.push("not accepted after click");
    }

    const second = await page.evaluate(async () => {
      const ldp = window.iuLocalDataProtection;
      const before = document.querySelector(".iu-ldp-backdrop");
      const ok = await ldp.ensureLocalDataProtectionBeforeSave();
      await new Promise((r) => setTimeout(r, 300));
      const after = document.querySelector(".iu-ldp-backdrop");
      return { ok: ok && !after, reason: after ? "dialog shown twice" : ok ? "" : "second call not ok" };
    });

    if (!second.ok) fails.push(second.reason || "second call showed dialog again");

    const apiOk = await page.evaluate(() => {
      const ldp = window.iuLocalDataProtection;
      return !!(ldp && typeof ldp.getStorageEstimate === "function" && typeof ldp.isPersistentStorageSupported === "function");
    });
    if (!apiOk) fails.push("storage API surface missing");
  } catch (err) {
    fails.push(String(err && err.message ? err.message : err));
  }

  await browser.close();
  if (server) server.kill("SIGTERM");

  const report = {
    measuredAt: new Date().toISOString(),
    baseUrl: BASE,
    pass: fails.length === 0,
    fails,
  };

  console.log("IU_LOCAL_DATA_PROTECTION_GUARD_RESULT");
  console.log(JSON.stringify(report, null, 2));
  if (fails.length) {
    console.error("FAIL");
    fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
