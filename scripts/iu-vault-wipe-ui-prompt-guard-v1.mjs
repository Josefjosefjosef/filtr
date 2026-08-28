#!/usr/bin/env node
/**
 * Real wipe UI flow — click Forgot PIN, fill in-DOM phrase, confirm.
 * Negative: IU_NEG_SKIP_REFRESH_UI=1 → FAIL; wrong phrase must keep data.
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
const MARKER = `IU_WIPE_UI_${Date.now()}`;
const SKIP_REFRESH = process.env.IU_NEG_SKIP_REFRESH_UI === "1";

function staticChecks(fails) {
  const appLock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-app-lock-v1.js"), "utf8");
  const wipe = fs.readFileSync(path.join(REPO, "assets", "iu-vault-wipe-v1.js"), "utf8");
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  if (/window\.prompt\(/.test(appLock)) fails.push("forgot_pin_still_uses_prompt");
  if (!/isWipeConfirmPhraseAccepted/.test(appLock)) fails.push("missing_phrase_accept_helper_use");
  if (!/normalizeWipeConfirmPhrase/.test(wipe)) fails.push("missing_normalize_wipe_phrase");
  if (!/iuVaultWipeConfirm/.test(index)) fails.push("missing_wipe_confirm_dom");
  if (!/iuVaultWipePhraseInput/.test(index)) fails.push("missing_wipe_phrase_input");
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8880, 400));
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    const base = `http://127.0.0.1:${server.port}/projects/`;
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVaultReady(page, 60000);

    await page.evaluate(async ({ pin, marker }) => {
      localStorage.setItem(
        "iu.notes.store.v1",
        JSON.stringify({
          schemaVersion: 1,
          notes: [{ id: "w1", title: marker, body: "x", tags: [], createdAt: 1, updatedAt: 1 }],
        })
      );
      await window.iuVault.flushPendingWrites();
      await window.iuVault.setupPin(pin, pin);
    }, { pin: PIN, marker: MARKER });

    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => !!(window.iuVault && window.iuVault.wipePersonal), null, { timeout: 60000 });
    await page.waitForSelector("#iuVaultForgotPinBtn", { state: "visible", timeout: 30000 });

    // Wrong phrase — no wipe
    await page.click("#iuVaultForgotPinBtn");
    await page.waitForSelector("#iuVaultWipeConfirm:not([hidden])", { timeout: 10000 });
    await page.fill("#iuVaultWipePhraseInput", "SPATNE");
    await page.waitForTimeout(120);
    const wrongBtnDisabled = await page.evaluate(() => {
      const btn = document.getElementById("iuVaultWipeConfirmBtn");
      return !!(btn && btn.disabled);
    });
    if (!wrongBtnDisabled) fails.push("wrong_phrase_enabled_btn");
    await page.waitForTimeout(300);
    const wrong = await page.evaluate(async () => {
      let idbEnc = false;
      try {
        const { readRecord } = await import("/assets/iu-vault-db-v1.js");
        idbEnc = !!(await readRecord("iu.notes.store.v1"));
      } catch (_) {}
      return {
        locked: document.documentElement.classList.contains("iu-vault-app-locked"),
        enc: !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1") || idbEnc,
        err: (document.getElementById("iuVaultLockErr") || {}).textContent || "",
      };
    });
    if (!wrong.locked) fails.push("wrong_phrase_unlocked");
    if (!wrong.enc) fails.push("wrong_phrase_wiped_data");

    await page.click("#iuVaultWipeCancelBtn");
    const afterCancel = await page.evaluate(() => {
      const panel = document.getElementById("iuVaultWipeConfirm");
      return !!(panel && panel.hidden);
    });
    if (!afterCancel) fails.push("cancel_did_not_hide_wipe_panel");

    // Lowercase + spaces accepted (accents optional)
    await page.click("#iuVaultForgotPinBtn");
    await page.waitForSelector("#iuVaultWipeConfirm:not([hidden])", { timeout: 10000 });
    const beforeUrl = page.url();
    if (SKIP_REFRESH) {
      await page.evaluate(async () => {
        window.__IU_NEG_SKIP_REFRESH_UI = true;
        await window.iuVault.wipePersonal();
        // Simulate missing UI sync after wipe (negative proof).
        document.documentElement.classList.add("iu-vault-app-locked");
        const screen = document.getElementById("iuVaultAppLockScreen");
        if (screen) {
          screen.hidden = false;
          screen.removeAttribute("aria-hidden");
          try {
            screen.style.removeProperty("display");
          } catch (_) {}
        }
      });
    } else {
      await page.evaluate(() => {
        window.__IU_NEG_SKIP_REFRESH_UI = false;
      });
      await page.fill("#iuVaultWipePhraseInput", "  vymazat osobni data  ");
      await page.waitForFunction(() => {
        const btn = document.getElementById("iuVaultWipeConfirmBtn");
        return btn && !btn.disabled;
      }, null, { timeout: 5000 });
      const accepted = await page.evaluate(async () => {
        return window.iuVault.isWipeConfirmPhraseAccepted(
          document.getElementById("iuVaultWipePhraseInput").value
        );
      });
      if (!accepted) fails.push("phrase_not_accepted_in_ui");
      await page.click("#iuVaultWipeConfirmBtn");
      try {
        await page.waitForFunction(
          () =>
            window.iuVault.getState().unlocked === true &&
            window.__iuVaultHydrationComplete === true &&
            !document.documentElement.classList.contains("iu-vault-app-locked"),
          null,
          { timeout: 30000 }
        );
      } catch (_) {
        const snap = await page.evaluate(async () => ({
          err: (document.getElementById("iuVaultLockErr") || {}).textContent || "",
          unlocked: !!(window.iuVault.getState && window.iuVault.getState().unlocked),
          method: (await window.iuVault.getSecurityConfigured()).unlockMethod,
          wipeHidden: !!(document.getElementById("iuVaultWipeConfirm") || {}).hidden,
          pending: !!window.__iuVaultHydrationPending,
          complete: !!window.__iuVaultHydrationComplete,
        }));
        fails.push(`unlock_wait_timeout:${JSON.stringify(snap)}`);
      }
    }
    const after = await page.evaluate(async () => {
      const skipRefresh = !!(window.__IU_NEG_SKIP_REFRESH_UI);
      try {
        if (!skipRefresh && window.iuVault && window.iuVault.refreshAppLockUi) {
          await window.iuVault.refreshAppLockUi();
        }
      } catch (_) {}
      const screen = document.getElementById("iuVaultAppLockScreen");
      const cs = screen ? getComputedStyle(screen) : null;
      let idbEnc = false;
      try {
        const { readRecord } = await import("/assets/iu-vault-db-v1.js");
        idbEnc = !!(await readRecord("iu.notes.store.v1"));
      } catch (_) {}
      return {
        url: location.href,
        appLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
        screenHidden:
          !document.documentElement.classList.contains("iu-vault-app-locked") &&
          (!!screen?.hidden || (cs && cs.display === "none") || screen?.getAttribute("aria-hidden") === "true"),
        note: localStorage.getItem("iu.notes.store.v1"),
        enc: localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1") || (idbEnc ? "idb" : null),
        unlocked: !!(window.iuVault.getState && window.iuVault.getState().unlocked),
        method: (await window.iuVault.getSecurityConfigured()).unlockMethod,
        pending: !!window.__iuVaultHydrationPending,
      };
    });
    if (after.url !== beforeUrl) fails.push("unexpected_navigation");
    if (after.appLocked) fails.push("still_app_locked");
    if (!after.screenHidden) fails.push(`lock_screen_visible:method=${after.method}:pending=${after.pending}`);
    if (after.method && after.method !== "none" && !SKIP_REFRESH) fails.push(`method_not_none:${after.method}`);
    if (after.note && String(after.note).includes(MARKER)) fails.push("old_note_present");
    if (after.enc) fails.push("old_enc_present");
    if (!after.unlocked && !SKIP_REFRESH) fails.push("not_unlocked");

    const canWrite = await page.evaluate(async (marker) => {
      const payload = JSON.stringify({
        schemaVersion: 1,
        notes: [{ id: "n2", title: marker + "_NEW", body: "y", tags: [], createdAt: 2, updatedAt: 2 }],
      });
      localStorage.setItem("iu.notes.store.v1", payload);
      await window.iuVault.flushPendingWrites();
      const ls = localStorage.getItem("iu.notes.store.v1") || "";
      if (ls.includes(marker + "_NEW")) return true;
      try {
        const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
        const v = await vaultGetItem("iu.notes.store.v1");
        return !!(v && String(v).includes(marker + "_NEW"));
      } catch (_) {
        return false;
      }
    }, MARKER);
    if (!canWrite) fails.push("cannot_write_after_wipe");
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({ IU_VAULT_WIPE_UI_PROMPT_GUARD: pass ? "PASS" : "FAIL", fails, skipRefresh: SKIP_REFRESH }));
  if (!pass) {
    console.error("IU_VAULT_WIPE_UI_PROMPT_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_WIPE_UI_PROMPT_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
