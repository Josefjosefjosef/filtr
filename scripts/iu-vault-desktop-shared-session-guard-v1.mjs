#!/usr/bin/env node
/**
 * Desktop shared session — unlock once, new tab joins without second PIN.
 * Negative: IU_NEG_BLOCK_DESKTOP_SESSION_JOIN=1 → new tab must stay locked.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
  closePlaywrightSession,
} from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const fs = require("fs");

const PIN = "654321";
const BLOCK_JOIN = process.env.IU_NEG_BLOCK_DESKTOP_SESSION_JOIN === "1";

function staticChecks(fails) {
  const lock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");
  const boot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  const session = fs.readFileSync(path.join(REPO, "assets", "iu-vault-desktop-session-v1.js"), "utf8");
  const worker = fs.readFileSync(path.join(REPO, "assets", "iu-vault-desktop-session-worker-v1.js"), "utf8");
  if (!/publishDesktopSession/.test(lock)) fails.push("lock_missing_publish_desktop_session");
  if (!/invalidateDesktopSession/.test(lock)) fails.push("lock_missing_invalidate_desktop_session");
  if (!/tryJoinDesktopSession/.test(boot)) fails.push("bootstrap_missing_try_join");
  if (!/shouldSkipDesktopBackgroundAutoLock/.test(lock)) fails.push("lock_missing_desktop_background_skip");
  if (!/SharedWorker/.test(session)) fails.push("session_missing_shared_worker");
  if (!/session-ready/.test(worker)) fails.push("worker_missing_session_ready");
  if (!/invalidated/.test(worker)) fails.push("worker_missing_invalidate");
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let pageA = null;
  let pageB = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8898, 400));
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 1400, height: 900 },
      isMobile: false,
      hasTouch: false,
      webauthnStub: true,
    });
    pageA = await context.newPage();
    pageB = await context.newPage();
    const base = `http://127.0.0.1:${server.port}/projects/`;

    if (BLOCK_JOIN) {
      await pageB.addInitScript(() => {
        window.__IU_NEG_BLOCK_DESKTOP_SESSION_JOIN = true;
      });
    }

    await pageA.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await pageA.waitForFunction(() => !!(window.iuVault && window.iuVault.setupPin), null, { timeout: 60000 });
    await pageA.evaluate(async (pin) => {
      await window.iuVault.setupPin(pin, pin);
    }, PIN);

    await pageA.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await pageA.waitForSelector("#iuVaultPinInput", { state: "visible", timeout: 60000 });
    await pageA.fill("#iuVaultPinInput", PIN);
    await pageA.click("#iuVaultUnlockPinBtn");
    await pageA.waitForFunction(() => !document.documentElement.classList.contains("iu-vault-app-locked"), null, {
      timeout: 30000,
    });

    await pageB.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await pageB.waitForFunction(() => !!(window.iuVault && window.iuVault.getState), null, { timeout: 60000 });

    await pageB.waitForTimeout(1500);
    const snapB = await pageB.evaluate(async () => {
      const st = window.iuVault.getState();
      return {
        appLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
        unlocked: !!st.unlocked,
        screenHidden: (() => {
          const screen = document.getElementById("iuVaultAppLockScreen");
          return !!(screen && screen.hidden);
        })(),
      };
    });

    if (snapB.appLocked) fails.push("new_tab_still_app_locked");
    if (!snapB.unlocked) fails.push("new_tab_not_unlocked");

    if (!BLOCK_JOIN) {
      await pageA.evaluate(async () => {
        await window.iuVault.lock();
      });
      await pageB.waitForFunction(
        () => document.documentElement.classList.contains("iu-vault-app-locked"),
        null,
        { timeout: 10000 }
      );
      const afterLock = await pageB.evaluate(() => ({
        appLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
        unlocked: !!window.iuVault.getState().unlocked,
      }));
      if (!afterLock.appLocked) fails.push("remote_lock_tab_b_still_unlocked");
      if (afterLock.unlocked) fails.push("remote_lock_tab_b_state_unlocked");
    }
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(pageB, null, null);
    await closePlaywrightSession(pageA, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({
    IU_VAULT_DESKTOP_SHARED_SESSION_GUARD: pass ? "PASS" : "FAIL",
    fails,
    blockJoin: BLOCK_JOIN,
  }));
  if (!pass) {
    console.error("IU_VAULT_DESKTOP_SHARED_SESSION_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_DESKTOP_SHARED_SESSION_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
