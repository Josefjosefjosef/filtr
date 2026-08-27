#!/usr/bin/env node
/**
 * Wipe forgot-PIN must remove APP_LOCKED immediately without reload.
 * Negative: IU_NEG_KEEP_APP_LOCKED=1 leaves lock UI → FAIL.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";
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
const PIN = "666666";
const KEEP_LOCKED = process.env.IU_NEG_KEEP_APP_LOCKED === "1";

function staticChecks(fails) {
  const wipeJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-wipe-v1.js"), "utf8");
  const appLockJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-app-lock-v1.js"), "utf8");
  if (!/clearAppLockHint/.test(wipeJs)) fails.push("wipe_missing_clear_app_lock_hint");
  if (!/mindMenuUnlockMethod = \"none\"/.test(wipeJs) && !/mindMenuUnlockMethod = 'none'/.test(wipeJs)) {
    fails.push("wipe_missing_method_none");
  }
  if (/window\.location\.reload\(\)/.test(appLockJs) && /wipePersonal/.test(appLockJs)) {
    // only fail if wipe path still reloads
    const wipeHandler = appLockJs.slice(appLockJs.indexOf("iuVaultForgotPinBtn"));
    if (/location\.reload/.test(wipeHandler.slice(0, 800))) fails.push("forgot_pin_still_reloads");
  }
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8850, 400));
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`http://127.0.0.1:${server.port}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVaultReady(page, 60000);

    await page.evaluate(async ({ pin, marker }) => {
      localStorage.setItem(
        "iu.notes.store.v1",
        JSON.stringify({ schemaVersion: 1, notes: [{ id: "w1", title: marker, body: "x", tags: [], createdAt: 1, updatedAt: 1 }] })
      );
      await window.iuVault.flushPendingWrites();
      await window.iuVault.setupPin(pin, pin);
    }, { pin: PIN, marker: `IU_WIPE_${Date.now()}` });

    await page.goto(`http://127.0.0.1:${server.port}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(() => !!(window.iuVault && window.iuVault.wipePersonal), null, { timeout: 60000 });

    await page.waitForFunction(
      () => {
        if (document.documentElement.classList.contains("iu-vault-app-init")) return false;
        const phase = window.__iuVaultBootPhase;
        if (phase === "locked") return document.documentElement.classList.contains("iu-vault-app-locked");
        if (phase === "unlocked") return false;
        return document.documentElement.classList.contains("iu-vault-app-locked");
      },
      null,
      { timeout: 30000 }
    );

    const beforeWipeLocked = await page.evaluate(() => document.documentElement.classList.contains("iu-vault-app-locked"));
    if (!beforeWipeLocked) fails.push("not_locked_before_wipe");

    const wipeResult = await page.evaluate(async (keepLocked) => {
      const beforeUrl = location.href;
      await window.iuVault.wipePersonal();
      if (keepLocked) {
        document.documentElement.classList.add("iu-vault-app-locked");
        const screen = document.getElementById("iuVaultAppLockScreen");
        if (screen) {
          screen.hidden = false;
          screen.removeAttribute("aria-hidden");
        }
      } else if (window.iuVault.refreshAppLockUi) {
        await window.iuVault.refreshAppLockUi();
      }
      return {
        urlSame: location.href === beforeUrl,
        appLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
        screenHidden: !!(document.getElementById("iuVaultAppLockScreen") && document.getElementById("iuVaultAppLockScreen").hidden),
        unlocked: !!(window.iuVault.getState && window.iuVault.getState().unlocked),
        method: (await window.iuVault.getSecurityConfigured()).unlockMethod,
        noteAfter: localStorage.getItem("iu.notes.store.v1"),
        noteEnc: localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1"),
      };
    }, KEEP_LOCKED);

    if (!wipeResult.urlSame) fails.push("unexpected_navigation");
    if (wipeResult.appLocked) fails.push("app_still_locked_after_wipe");
    if (!wipeResult.screenHidden && !KEEP_LOCKED) fails.push("lock_screen_visible_after_wipe");
    if (!wipeResult.unlocked) fails.push("not_unlocked_after_wipe");
    if (wipeResult.method !== "none") fails.push(`method_not_none:${wipeResult.method}`);
    if (wipeResult.noteAfter || wipeResult.noteEnc) fails.push("old_note_still_present");

    const canWrite = await page.evaluate(async (marker) => {
      const payload = JSON.stringify({ schemaVersion: 1, notes: [{ id: "n2", title: marker, body: "ok", tags: [], createdAt: 2, updatedAt: 2 }] });
      localStorage.setItem("iu.notes.store.v1", payload);
      await window.iuVault.flushPendingWrites();
      return localStorage.getItem("iu.notes.store.v1") === payload || !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1");
    }, `IU_WIPE_NEW_${Date.now()}`);
    if (!canWrite) fails.push("cannot_write_after_wipe");
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({ IU_VAULT_WIPE_IMMEDIATE_UNLOCK_GUARD: pass ? "PASS" : "FAIL", fails, keepLocked: KEEP_LOCKED }));
  if (!pass) {
    console.error("IU_VAULT_WIPE_IMMEDIATE_UNLOCK_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_WIPE_IMMEDIATE_UNLOCK_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
