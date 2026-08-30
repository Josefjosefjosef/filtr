#!/usr/bin/env node
/**
 * Central L1 invariants:
 * - no late plaintext override of authoritative IDB
 * - preload must not keep pre-hydrate memory poison
 * - SECURITY OFF save → cold reopen → SAME DATA
 *
 * Run: node scripts/iu-vault-l1-authoritative-idb-guard-v1.mjs
 */
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import fs from "fs";
import {
  bootstrapGuardContext,
  waitForVaultReady,
} from "./guards/guard-playwright-bootstrap.mjs";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
  closePlaywrightSession,
} from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PREFS = "iu.infoEvents.prefs.v1";
const CAL = "iu.calendar.store.v1";
const NOTE = "iu.notes.store.v1";
const MARKER = `IU_AUTH_IDB_${Date.now()}`;

function prefsPayload(tag) {
  return JSON.stringify({
    sections: ["doprava"],
    sourceGroups: [],
    sourceIds: [],
    lanes: [],
    localities: [{ id: "x", name: tag }],
    homeKraj: "",
    homeOkres: "",
    homeObec: tag,
    localityQuery: tag,
    feedFilter: { roads: [tag + "_ROAD"], chmi: { orpCodes: ["9999"] } },
    unreadOnly: false,
    savedOnly: false,
    favoritesOnly: false,
    searchQuery: tag,
  });
}

function calPayload(tag) {
  return JSON.stringify({
    schemaVersion: 1,
    events: [{ id: "e1", title: tag, date: "2026-08-29", start: "10:00", end: "11:00" }],
  });
}

function notePayload(tag) {
  return JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "n1", title: tag, body: "b", tags: [], createdAt: 1, updatedAt: 1 }],
  });
}

function competingPrefs() {
  return JSON.stringify({
    sections: ["doprava", "chmi"],
    sourceGroups: [],
    sourceIds: [],
    lanes: [],
    localities: [],
    homeKraj: "",
    homeOkres: "",
    homeObec: "",
    localityQuery: "",
    feedFilter: { roads: ["D1"], chmi: { orpCodes: [] } },
    unreadOnly: false,
    savedOnly: false,
    favoritesOnly: false,
    searchQuery: "",
  });
}

async function waitHydrated(page) {
  await page.waitForFunction(
    () =>
      !!(
        window.iuVault &&
        window.iuVault.getState &&
        window.iuVault.getState().unlocked &&
        window.__iuVaultHydrationComplete === true
      ),
    null,
    { timeout: 60000 }
  );
}

async function userSave(page, payloads) {
  await page.evaluate(async ({ PREFS, CAL, NOTE, goodPrefs, goodCal, goodNote }) => {
    window.__iuVaultUserWriteDepth = 1;
    try {
      for (const [k, v] of [
        [PREFS, goodPrefs],
        [CAL, goodCal],
        [NOTE, goodNote],
      ]) {
        if (window.iuVault && typeof window.iuVault.durableSet === "function") {
          await window.iuVault.durableSet(k, v);
        } else {
          const ret = localStorage.setItem(k, v);
          if (ret && ret.then) await ret;
        }
      }
    } finally {
      window.__iuVaultUserWriteDepth = 0;
    }
    if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
      await window.iuVault.flushPendingWrites();
    }
  }, payloads);
}

async function readback(page) {
  return page.evaluate(async ({ PREFS, CAL, NOTE, MARKER }) => {
    const { vaultGetItem, nativeLocalStorageGet } = await import("/assets/iu-vault-storage-v1.js");
    const prefs = await vaultGetItem(PREFS, { bypassMemoryCache: true });
    const cal = await vaultGetItem(CAL, { bypassMemoryCache: true });
    const note = await vaultGetItem(NOTE, { bypassMemoryCache: true });
    const sec = await window.iuVault.getSecurityConfigured();
    return {
      prefsOk: !!(prefs && prefs.includes(MARKER)),
      calOk: !!(cal && cal.includes(MARKER)),
      noteOk: !!(note && note.includes(MARKER)),
      prefsPlainGone: nativeLocalStorageGet(PREFS) == null,
      calPlainGone: nativeLocalStorageGet(CAL) == null,
      unlockMethod: sec && sec.unlockMethod,
    };
  }, { PREFS, CAL, NOTE, MARKER });
}

async function main() {
  const fails = [];
  let a = null;
  let c = null;
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  const profiles = [];
  try {
    const migrateJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-migrate-v1.js"), "utf8");
    const storageJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
    const bootJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
    if (!/Authoritative encrypted IDB wins/.test(migrateJs)) fails.push("static_migrate_missing_idb_authority");
    if (!/pre_unlock_no_native_staging/.test(storageJs)) fails.push("static_shim_still_native_sets");
    if (!/bypassMemoryCache/.test(storageJs)) fails.push("static_preload_missing_bypass");
    if (!/__iuVaultHydrationPending = true/.test(bootJs)) fails.push("static_boot_missing_pending_gate");

    const started = await startGuardStaticServer(pickGuardPort(9360, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;
    const goodPrefs = prefsPayload(MARKER);
    const goodCal = calPayload(MARKER);
    const goodNote = notePayload(MARKER);
    const payloads = { PREFS, CAL, NOTE, goodPrefs, goodCal, goodNote };

    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);

    // A — late plaintext must NOT override IDB
    await page.goto(`${base}?nosw=1&cb=${Date.now()}&a=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVaultReady(page, 60000);
    await waitHydrated(page);
    await userSave(page, payloads);
    await page.evaluate(async ({ PREFS, CAL, competing }) => {
      // Plant competing plaintext via true native LS (bypass vault shim).
      // Storage.prototype.setItem is now the vault bridge — cannot use it as a native probe.
      const { nativeLocalStorageSet } = await import("/assets/iu-vault-storage-v1.js");
      nativeLocalStorageSet(PREFS, competing);
      nativeLocalStorageSet(CAL, JSON.stringify({ schemaVersion: 1, events: [] }));
      const { migratePlaintextToVault } = await import("/assets/iu-vault-migrate-v1.js");
      await migratePlaintextToVault();
    }, { PREFS, CAL, competing: competingPrefs() });
    a = await readback(page);
    if (!(a.prefsOk && a.calOk && a.noteOk && a.prefsPlainGone)) fails.push("A_NO_LATE_PLAINTEXT_OVERRIDE");

    // B — memory poison before preload must not stick
    await page.evaluate(async ({ PREFS, MARKER }) => {
      const { memoryCacheSet, preloadAllVaultRecords, vaultGetItem } = await import(
        "/assets/iu-vault-storage-v1.js"
      );
      memoryCacheSet(PREFS, JSON.stringify({ sections: [], homeObec: "", feedFilter: null }));
      await preloadAllVaultRecords();
      const after = await vaultGetItem(PREFS);
      window.__iuPoisonProbe = !!(after && after.includes(MARKER));
    }, { PREFS, MARKER });
    const bOk = await page.evaluate(() => !!window.__iuPoisonProbe);
    if (!bOk) fails.push("B_HYDRATION_NO_POISON");
    await closePlaywrightSession(page, context, browser);
    page = null;
    context = null;
    browser = null;

    // C — SECURITY OFF cold reopen SAME DATA
    const pC = fs.mkdtempSync(path.join(os.tmpdir(), "iu-auth-c-"));
    profiles.push(pC);
    const ctxC1 = await chromium.launchPersistentContext(pC, {
      headless: true,
      viewport: { width: 1280, height: 800 },
    });
    await ctxC1.addInitScript(() => {
      try {
        localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
        localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      } catch (_) {}
    });
    const pageC1 = await ctxC1.newPage();
    pageC1.setDefaultTimeout(60000);
    await pageC1.goto(`${base}?nosw=1&cb=${Date.now()}&c=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVaultReady(pageC1, 60000);
    await waitHydrated(pageC1);
    await userSave(pageC1, payloads);
    await ctxC1.close();

    const ctxC2 = await chromium.launchPersistentContext(pC, {
      headless: true,
      viewport: { width: 1280, height: 800 },
    });
    const pageC2 = await ctxC2.newPage();
    pageC2.setDefaultTimeout(60000);
    await pageC2.goto(`${base}?nosw=1&cb=${Date.now()}&c=2`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVaultReady(pageC2, 60000);
    await waitHydrated(pageC2);
    c = await readback(pageC2);
    if (!(c.prefsOk && c.calOk && c.noteOk && c.unlockMethod === "none")) fails.push("C_SEC_OFF_COLD_SAME_DATA");
    await ctxC2.close();

    const report = {
      IU_VAULT_L1_AUTHORITATIVE_IDB_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      marker: MARKER,
      fails,
      A_NO_LATE_PLAINTEXT_OVERRIDE: fails.includes("A_NO_LATE_PLAINTEXT_OVERRIDE") ? "FAIL" : "PASS",
      B_HYDRATION_NO_POISON: fails.includes("B_HYDRATION_NO_POISON") ? "FAIL" : "PASS",
      C_SEC_OFF_COLD_SAME_DATA: fails.includes("C_SEC_OFF_COLD_SAME_DATA") ? "FAIL" : "PASS",
      a,
      c,
    };
    console.log(JSON.stringify(report, null, 2));
    if (fails.length) process.exit(1);
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  } finally {
    for (const p of profiles) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch (_) {}
    }
    await closePlaywrightSession(page, context, browser);
    if (server) await stopGuardProcess(server.proc || null);
  }
}

main();
