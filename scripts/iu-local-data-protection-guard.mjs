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
        sessionStorage.removeItem(k);
        sessionStorage.removeItem("iu:tool-local-storage-consent:v1");
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

    await page.evaluate((k) => {
      try {
        localStorage.removeItem(k);
        localStorage.removeItem("iu:tool-local-storage-consent:v1");
        localStorage.removeItem("iu:legal-confirm:contracts:v1");
        localStorage.removeItem("iu:legal-confirm:invoice:v1");
        sessionStorage.removeItem(k);
        sessionStorage.removeItem("iu:tool-local-storage-consent:v1");
      } catch (_) {}
    }, KEY);

    const cancelFlow = await page.evaluate(async () => {
      const ldp = window.iuLocalDataProtection;
      if (!ldp) return { ok: false, reason: "missing ldp for cancel test" };
      const pending = ldp.ensureLocalDataProtectionBeforeSave();
      await new Promise((r) => setTimeout(r, 400));
      const visible = !!document.querySelector(".iu-ldp-backdrop");
      if (!visible) return { ok: false, reason: "dialog not shown for cancel test" };
      const ghost = document.querySelector(".iu-ldp-backdrop .iu-ldp-btn--ghost");
      if (!ghost) return { ok: false, reason: "cancel button missing" };
      ghost.click();
      const ok = await pending;
      const accepted = ldp.isLocalDataProtectionNoticeAccepted();
      const stillOpen = !!document.querySelector(".iu-ldp-backdrop");
      return {
        ok: ok === false && !accepted && !stillOpen,
        reason: ok ? "cancel returned true" : accepted ? "accepted after cancel" : stillOpen ? "backdrop still open" : "",
      };
    });
    if (!cancelFlow.ok) fails.push(cancelFlow.reason || "cancel flow failed");

    const guardCancel = await page.evaluate(async () => {
      let mod;
      try {
        mod = await import("/assets/iu-tool-guard.js");
      } catch (err) {
        return { ok: false, reason: "import iu-tool-guard failed" };
      }
      if (!mod || typeof mod.guardProtectedAction !== "function") {
        return { ok: false, reason: "guardProtectedAction export missing" };
      }
      let actionRan = false;
      const pending = mod.guardProtectedAction("contract", async () => {
        actionRan = true;
      });
      for (let i = 0; i < 40; i++) {
        if (document.querySelector(".iu-ldp-backdrop")) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const ldpVisible = !!document.querySelector(".iu-ldp-backdrop");
      if (!ldpVisible) {
        const accepted = window.iuLocalDataProtection && window.iuLocalDataProtection.isLocalDataProtectionNoticeAccepted();
        return {
          ok: false,
          reason: accepted ? "already accepted before guard cancel" : "ldp dialog missing for guard cancel",
        };
      }
      const ghost = document.querySelector(".iu-ldp-backdrop .iu-ldp-btn--ghost");
      if (ghost) ghost.click();
      await pending;
      await new Promise((r) => setTimeout(r, 200));
      const legalVisible = !!document.querySelector(".iu-tool-guard-backdrop");
      return {
        ok: !actionRan && !legalVisible,
        reason: actionRan ? "action ran after ldp cancel" : legalVisible ? "legal dialog after ldp cancel" : "",
      };
    });
    if (!guardCancel.ok) fails.push(guardCancel.reason || "guardProtectedAction cancel failed");

    const parallel = await page.evaluate(async (k) => {
      try {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
        localStorage.removeItem("iu:tool-local-storage-consent:v1");
        sessionStorage.removeItem("iu:tool-local-storage-consent:v1");
      } catch (_) {}
      const ldp = window.iuLocalDataProtection;
      const p1 = ldp.ensureLocalDataProtectionBeforeSave();
      const p2 = ldp.ensureLocalDataProtectionBeforeSave();
      await new Promise((r) => setTimeout(r, 300));
      const backdrops = document.querySelectorAll(".iu-ldp-backdrop").length;
      const btn = document.querySelector(".iu-ldp-backdrop .iu-ldp-btn--secondary");
      if (btn) btn.click();
      await Promise.all([p1, p2]);
      await new Promise((r) => setTimeout(r, 200));
      return { ok: backdrops === 1, reason: backdrops > 1 ? "parallel backdrops=" + backdrops : "" };
    }, KEY);
    if (!parallel.ok) fails.push(parallel.reason || "parallel dialog dedupe failed");

    const clickThrough = await page.evaluate(async () => {
      try {
        localStorage.removeItem(KEY);
        sessionStorage.removeItem(KEY);
        localStorage.removeItem("iu:tool-local-storage-consent:v1");
      } catch (_) {}
      const ldp = window.iuLocalDataProtection;
      const pending = ldp.ensureLocalDataProtectionBeforeSave();
      await new Promise((r) => setTimeout(r, 350));
      const ghost = document.querySelector(".iu-ldp-backdrop .iu-ldp-btn--ghost");
      if (ghost) ghost.click();
      await pending;
      await new Promise((r) => setTimeout(r, 200));
      const backdropCount = document.querySelectorAll(".iu-ldp-backdrop").length;
      const bodyLock = document.body.classList.contains("iu-ldp-dialog-open");
      const cx = Math.round(window.innerWidth / 2);
      const cy = Math.round(window.innerHeight / 2);
      const hit = document.elementFromPoint(cx, cy);
      const blockedByLdp = !!(hit && hit.closest && hit.closest(".iu-ldp-backdrop"));
      if (typeof ldp.purgeLdpBackdrops === "function") ldp.purgeLdpBackdrops();
      return {
        ok: backdropCount === 0 && !bodyLock && !blockedByLdp,
        backdropCount,
        bodyLock,
        blockedByLdp,
      };
    });
    if (!clickThrough.ok) {
      fails.push(
        "backdrop blocks clicks after close (count=" +
          clickThrough.backdropCount +
          " bodyLock=" +
          clickThrough.bodyLock +
          " blocked=" +
          clickThrough.blockedByLdp +
          ")"
      );
    }

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
