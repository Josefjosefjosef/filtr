#!/usr/bin/env node
/**
 * V-KM-01 — vault kill-switch (?iuVault=0 / iu:vault:disabled:v1) must be inert.
 * Run: npm run iu-vault-killswitch-restrict-guard
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8991", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const PIN = "847291";
const PIN_WRONG = "111222";
const CANARY = "TEST_ONLY_VKM01_CANARY";

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

function staticChecks(fails) {
  const boot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  const appLock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-app-lock-v1.js"), "utf8");
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");

  if (!/function vaultDisabled\(/.test(boot)) fails.push("bootstrap_missing_vaultDisabled");
  if (!/function vaultDisabled\(/.test(appLock)) fails.push("applock_missing_vaultDisabled");
  if (/get\("iuVault"\)\s*===\s*"0"/.test(boot)) fails.push("bootstrap_still_honors_iuVault_query");
  if (/get\("iuVault"\)\s*===\s*"0"/.test(appLock)) fails.push("applock_still_honors_iuVault_query");
  if (/getItem\("iu:vault:disabled:v1"\)\s*===\s*"1"\s*\)\s*return true/.test(boot)) {
    fails.push("bootstrap_still_returns_true_on_disabled_flag");
  }
  if (/getItem\("iu:vault:disabled:v1"\)\s*===\s*"1"\s*\)\s*return true/.test(appLock)) {
    fails.push("applock_still_returns_true_on_disabled_flag");
  }
  if (!/localStorage\.removeItem\("iu:vault:disabled:v1"\)/.test(boot)) {
    fails.push("bootstrap_missing_legacy_flag_clear");
  }
  if (!/localStorage\.removeItem\("iu:vault:disabled:v1"\)/.test(appLock)) {
    fails.push("applock_missing_legacy_flag_clear");
  }
  if (!/return false;/.test(boot.split("function vaultDisabled")[1] || "")) {
    fails.push("bootstrap_vaultDisabled_not_always_false");
  }
  if (!/iu-vault-killswitch-restrict-v1-20260831/.test(index)) {
    fails.push("index_missing_killswitch_cache_bust");
  }
  if (!/iu-vault-app-lock-v1\.js\?v=iu-vault-killswitch-restrict-v1-20260831/.test(boot)) {
    fails.push("bootstrap_missing_applock_import_bust");
  }
}

async function snap(page) {
  return page.evaluate(async () => {
    const st = window.iuVault && window.iuVault.getState ? window.iuVault.getState() : null;
    let meta = null;
    try {
      meta = window.iuVault && window.iuVault.getMeta ? await window.iuVault.getMeta() : null;
    } catch (_) {}
    let pinWrap = false;
    let noteIdb = false;
    let noteCtLen = 0;
    let level1Key = false;
    try {
      const { readKeyRecord, readRecord } = await import("/assets/iu-vault-db-v1.js");
      const wrap = await readKeyRecord("mdk:pin");
      pinWrap = !!(wrap && (wrap.wrappedSeed || wrap.wrappedMdk));
      const l1 = await readKeyRecord("mdk:level1");
      level1Key = !!(l1 && l1.mdk);
      const rec = await readRecord("iu.notes.store.v1");
      noteIdb = !!(rec && rec.ct);
      noteCtLen = rec && rec.ct ? String(rec.ct).length : 0;
    } catch (_) {}
    const lsNotes = localStorage.getItem("iu.notes.store.v1");
    return {
      hasApi: !!window.iuVault,
      unlocked: !!(st && st.unlocked),
      hydrationComplete: !!window.__iuVaultHydrationComplete,
      disabledFlag: localStorage.getItem("iu:vault:disabled:v1"),
      metaPin: !!(meta && meta.pinEnabled),
      metaLevel: meta && meta.securityLevel,
      pinWrap,
      level1Key,
      noteIdb,
      noteCtLen,
      lsHasCanary: !!(lsNotes && lsNotes.includes("TEST_ONLY_VKM01_CANARY")),
      lockedClass: document.documentElement.classList.contains("iu-vault-app-locked"),
    };
  });
}

async function waitUnlocked(page) {
  await page.waitForFunction(
    () => !!(window.iuVault && window.iuVault.getState && window.iuVault.getState().unlocked),
    null,
    { timeout: 90000 }
  );
}

async function main() {
  const fails = [];
  staticChecks(fails);

  const server = await new Promise((resolve) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("127.0.0.1", PORT, 60000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });

  try {
    // --- TEST A: ?iuVault=0 must NOT disable vault ---
    {
      const ctx = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}?nosw=1&iuVault=0&cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await waitUnlocked(page);
      await page.waitForTimeout(800);
      const a = await snap(page);
      if (!a.hydrationComplete) fails.push("testA_hydration_incomplete");
      if (!a.unlocked) fails.push("testA_vault_not_unlocked");
      if (a.disabledFlag === "1") fails.push("testA_disabled_flag_present");
      if (!a.level1Key) fails.push("testA_missing_level1_key");
      await ctx.close();
    }

    // --- TEST B: legacy LS flag cleared; vault boots ---
    {
      const ctx = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 } });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem("iu:vault:disabled:v1", "1");
        } catch (_) {}
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await waitUnlocked(page);
      await page.waitForTimeout(800);
      const b = await snap(page);
      if (b.disabledFlag === "1") fails.push("testB_legacy_flag_still_active");
      if (!b.hydrationComplete || !b.unlocked) fails.push("testB_vault_still_disabled");
      await ctx.close();
    }

    // --- TEST C: SECURITY OFF persistence ---
    {
      const ctx = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await waitUnlocked(page);
      await page.evaluate(async (title) => {
        localStorage.setItem(
          "iu.notes.store.v1",
          JSON.stringify({
            schemaVersion: 1,
            notes: [{ id: "c1", title, body: "x", tags: [], createdAt: 1, updatedAt: 1 }],
          })
        );
        if (window.iuVault.flushPendingWrites) await window.iuVault.flushPendingWrites();
      }, CANARY);
      await page.waitForTimeout(500);
      const before = await snap(page);
      await page.goto(`${BASE}?nosw=1&cb=${Date.now() + 1}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await page.waitForFunction(
        () =>
          !!(
            window.iuVault &&
            window.iuVault.getState &&
            window.iuVault.getState().unlocked &&
            window.__iuVaultHydrationComplete
          ),
        null,
        { timeout: 90000 }
      );
      await page.waitForTimeout(1000);
      const after = await snap(page);
      if (before.metaPin) fails.push("testC_unexpected_pin");
      if (!after.unlocked || !after.hydrationComplete) fails.push("testC_sec_off_boot_fail");
      if (!after.noteIdb) fails.push("testC_missing_idb_ciphertext");
      if (!after.lsHasCanary) fails.push("testC_canary_not_hydrated");
      if (after.lockedClass) fails.push("testC_unexpected_lock_screen");
      await ctx.close();
    }

    // --- TEST D: PIN/L3 + ?iuVault=0 still enforces lock ---
    {
      const ctx = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await waitUnlocked(page);
      await page.evaluate(async (args) => {
        localStorage.setItem(
          "iu.notes.store.v1",
          JSON.stringify({
            schemaVersion: 1,
            notes: [{ id: "d1", title: args.title, body: "pin", tags: [], createdAt: 1, updatedAt: 1 }],
          })
        );
        if (window.iuVault.flushPendingWrites) await window.iuVault.flushPendingWrites();
        await window.iuVault.setupPin(args.pin, args.pin);
      }, { title: CANARY, pin: PIN });
      await page.waitForTimeout(800);
      const beforePin = await snap(page);
      await page.goto(`${BASE}?nosw=1&iuVault=0&cb=${Date.now() + 2}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      const withKill = await snap(page);
      if (withKill.unlocked) fails.push("testD_kill_unlocked_without_pin");
      if (!withKill.lockedClass) fails.push("testD_kill_skipped_lock_ui");
      if (!withKill.pinWrap || !withKill.noteIdb) fails.push("testD_data_lost_under_kill_url");
      if (withKill.noteCtLen !== beforePin.noteCtLen) fails.push("testD_ct_len_changed");

      let wrongOk = false;
      try {
        await page.evaluate(async (pin) => {
          await window.iuVault.unlockPin(pin);
        }, PIN_WRONG);
      } catch (_) {
        wrongOk = true;
      }
      if (!wrongOk) fails.push("testD_wrong_pin_should_fail");

      await page.waitForTimeout(1200);

      await page.evaluate(async (pin) => {
        await window.iuVault.unlockPin(pin);
        if (window.iuVault.afterUnlock) await window.iuVault.afterUnlock();
      }, PIN);
      await page.waitForFunction(
        () => !!(window.iuVault.getState().unlocked && window.__iuVaultHydrationComplete),
        null,
        { timeout: 90000 }
      );
      await page.waitForTimeout(1000);
      const afterUnlock = await snap(page);
      if (!afterUnlock.unlocked) fails.push("testD_correct_pin_fail");
      if (!afterUnlock.lsHasCanary) fails.push("testD_canary_missing_after_unlock");
      if (!afterUnlock.pinWrap || !afterUnlock.noteIdb) fails.push("testD_wrapper_or_ct_lost");
      await ctx.close();
    }

    // --- TEST E: existing ciphertext + legacy flag ---
    {
      const ctx = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 } });
      const page = await ctx.newPage();
      await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await waitUnlocked(page);
      await page.evaluate(async (args) => {
        localStorage.setItem(
          "iu.notes.store.v1",
          JSON.stringify({
            schemaVersion: 1,
            notes: [{ id: "e1", title: args.title, body: "legacy", tags: [], createdAt: 1, updatedAt: 1 }],
          })
        );
        if (window.iuVault.flushPendingWrites) await window.iuVault.flushPendingWrites();
        await window.iuVault.setupPin(args.pin, args.pin);
      }, { title: CANARY, pin: PIN });
      await page.waitForTimeout(800);
      const seeded = await snap(page);
      await page.evaluate(() => {
        localStorage.setItem("iu:vault:disabled:v1", "1");
      });
      await page.goto(`${BASE}?nosw=1&cb=${Date.now() + 3}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 });
      await page.waitForTimeout(1500);
      const remediating = await snap(page);
      if (remediating.disabledFlag === "1") fails.push("testE_legacy_flag_not_cleared");
      if (remediating.unlocked) fails.push("testE_should_remain_locked");
      if (!remediating.lockedClass) fails.push("testE_lock_ui_missing");
      if (!remediating.pinWrap) fails.push("testE_pin_wrap_lost");
      if (!remediating.noteIdb || remediating.noteCtLen !== seeded.noteCtLen) {
        fails.push("testE_ciphertext_not_preserved");
      }
      await page.evaluate(async (pin) => {
        await window.iuVault.unlockPin(pin);
        if (window.iuVault.afterUnlock) await window.iuVault.afterUnlock();
      }, PIN);
      await page.waitForFunction(
        () => !!(window.iuVault.getState().unlocked && window.__iuVaultHydrationComplete),
        null,
        { timeout: 90000 }
      );
      await page.waitForTimeout(1000);
      const unlocked = await snap(page);
      if (!unlocked.lsHasCanary) fails.push("testE_hydration_canary_fail");
      if (!unlocked.pinWrap || !unlocked.noteIdb) fails.push("testE_post_unlock_data_loss");
      await ctx.close();
    }
  } finally {
    await browser.close();
    try {
      server.kill();
    } catch (_) {}
  }

  if (fails.length) {
    console.log(JSON.stringify({ pass: false, fails }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        pass: true,
        tests: ["A_url_inert", "B_legacy_ls_cleared", "C_sec_off", "D_pin_with_url", "E_legacy_flag_existing_ct"],
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
