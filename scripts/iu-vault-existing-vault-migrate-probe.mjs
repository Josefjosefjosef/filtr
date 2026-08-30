#!/usr/bin/env node
/**
 * Single existing-vault migration probe for migrate guard + negative proof child.
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

const GUARD_PIN = "847291";

async function seedFixtures(page, marker) {
  return page.evaluate(async (marker) => {
    const {
      nativeLocalStorageGet,
      nativeLocalStorageSet,
      nativeLocalStorageRemove,
      memoryCacheSet,
      flushPendingVaultWrites,
      clearVaultMemoryCache,
    } = await import("/assets/iu-vault-storage-v1.js");
    const nativeGet = nativeLocalStorageGet;
    const nativeSet = nativeLocalStorageSet;
    const nativeRemove = nativeLocalStorageRemove;
    const encKey = (k) => "iu:vault:enc:v1:" + k;
    const expected = {
      validEnc: JSON.stringify({ schemaVersion: 1, notes: [{ id: "v1", title: marker + "_VALID_ENC" }] }),
      legacyPlain: JSON.stringify({ items: [{ label: marker + "_LEGACY", slot: 1 }] }),
      cacheOnly: JSON.stringify({ order: [marker + "_CACHE"] }),
      pending: JSON.stringify({ schemaVersion: 1, tasks: [{ id: "p1", title: marker + "_PENDING" }] }),
      calendar: JSON.stringify({ schemaVersion: 1, events: [{ id: "c1", title: marker + "_CAL" }] }),
    };
    const { getMdk } = await import("/assets/iu-vault-lock-v1.js");
    const { encryptString } = await import("/assets/iu-vault-core-v1.js");
    clearVaultMemoryCache();
    const mdk = getMdk();
    nativeSet(encKey("iu.notes.store.v1"), JSON.stringify(await encryptString(mdk, "iu.notes.store.v1", expected.validEnc)));
    nativeRemove("iu.notes.store.v1");
    nativeSet(encKey("iu.calendar.store.v1"), JSON.stringify(await encryptString(mdk, "iu.calendar.store.v1", expected.calendar)));
    nativeRemove("iu.calendar.store.v1");
    const orphanKeyName = "iu_moje_sluzby_bakalari_v1";
    nativeRemove(encKey(orphanKeyName));
    nativeRemove(orphanKeyName);
    const orphanRaw = crypto.getRandomValues(new Uint8Array(32));
    const orphanKey = await crypto.subtle.importKey("raw", orphanRaw, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode("iu-vault-v1|" + orphanKeyName);
    const orphanPt = new TextEncoder().encode(JSON.stringify({ orphan: true, marker: marker + "_ORPHAN" }));
    const orphanCt = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, orphanKey, orphanPt);
    nativeSet(
      encKey(orphanKeyName),
      JSON.stringify({
        v: 1,
        alg: "AES-GCM",
        iv: btoa(String.fromCharCode(...iv)),
        aad: btoa(String.fromCharCode(...aad)),
        ct: btoa(String.fromCharCode(...new Uint8Array(orphanCt))),
      })
    );
    nativeSet("iu_moje_sluzby_banks_state_v1", expected.legacyPlain);
    nativeRemove(encKey("iu_moje_sluzby_banks_state_v1"));
    nativeSet("iu.tasks.mvp.v1", expected.pending);
    await flushPendingVaultWrites();
    clearVaultMemoryCache();
    memoryCacheSet("iu_desktop_homecards_order_v1", expected.cacheOnly);
    window.__iuMigrateProbe = {
      marker,
      expected,
      orphanKeyName,
      orphanBefore: nativeGet(encKey(orphanKeyName)),
    };
    return nativeGet("iu_moje_sluzby_banks_state_v1") === expected.legacyPlain;
  }, marker);
}

async function runSetupPin(page, pin, expectFailMode) {
  return page.evaluate(async (payload) => {
    const pin = payload.pin;
    const expectFailMode = !!payload.expectFailMode;
    const { nativeLocalStorageGet } = await import("/assets/iu-vault-storage-v1.js");
    const nativeGet = nativeLocalStorageGet;
    const state = window.__iuMigrateProbe;
    const { setupPin } = await import("/assets/iu-vault-pin-v1.js");
    const { readRecord } = await import("/assets/iu-vault-db-v1.js");
    await setupPin(pin, pin);
    if (expectFailMode) {
      const idbRec = await readRecord("iu_moje_sluzby_banks_state_v1");
      const quickChecks = {
        legacyIdbCreated: !!idbRec,
        legacyPlainNative: nativeGet("iu_moje_sluzby_banks_state_v1") === state.expected.legacyPlain,
      };
      return {
        pass: quickChecks.legacyIdbCreated && quickChecks.legacyPlainNative,
        checks: quickChecks,
      };
    }
    return { ok: true };
  }, { pin, expectFailMode });
}

async function runHydrate(page, pin) {
  return page.evaluate(async (pin) => {
    await window.iuVault.unlockPin(pin);
    const { preloadAllVaultRecords, notifyVaultMemoryHydrated } = await import("/assets/iu-vault-storage-v1.js");
    await preloadAllVaultRecords();
    notifyVaultMemoryHydrated();
    await window.iuVault.flushPendingWrites();
    return true;
  }, pin);
}

async function readBackChecks(page) {
  return page.evaluate(async () => {
    const { nativeLocalStorageGet, vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
    const nativeGet = nativeLocalStorageGet;
    const encKey = (k) => "iu:vault:enc:v1:" + k;
    const state = window.__iuMigrateProbe;
    const expected = state.expected;
    const orphanKeyName = state.orphanKeyName;
    const orphanBefore = state.orphanBefore;
    const { getMdk } = await import("/assets/iu-vault-lock-v1.js");
    const { decryptString } = await import("/assets/iu-vault-core-v1.js");
    const { readRecord } = await import("/assets/iu-vault-db-v1.js");
    const mdkNow = getMdk();
    const readPlainKey = async (key) => {
      try {
        const viaVault = await vaultGetItem(key);
        if (viaVault != null) return viaVault;
      } catch (_) {}
      const rawEnc = nativeGet(encKey(key));
      if (!rawEnc) return null;
      try {
        return await decryptString(mdkNow, key, JSON.parse(rawEnc));
      } catch (_) {
        return null;
      }
    };
    const eqStored = (actual, expectedText) => {
      if (actual === expectedText) return true;
      try {
        return JSON.stringify(JSON.parse(actual)) === JSON.stringify(JSON.parse(expectedText));
      } catch (_) {
        return false;
      }
    };
    const after = {
      validEnc: await readPlainKey("iu.notes.store.v1"),
      legacyPlain: await readPlainKey("iu_moje_sluzby_banks_state_v1"),
      cacheOnly: await readPlainKey("iu_desktop_homecards_order_v1"),
      pending: await readPlainKey("iu.tasks.mvp.v1"),
      calendar: await readPlainKey("iu.calendar.store.v1"),
      orphanEnc: nativeGet(encKey(orphanKeyName)),
    };
    const checks = {
      validEnc: eqStored(after.validEnc, expected.validEnc),
      legacyPlain: eqStored(after.legacyPlain, expected.legacyPlain),
      cacheOnly: eqStored(after.cacheOnly, expected.cacheOnly),
      pending: eqStored(after.pending, expected.pending),
      calendar: eqStored(after.calendar, expected.calendar),
      orphanPreserved: !!after.orphanEnc && after.orphanEnc === orphanBefore,
      legacyIdbCreated: !!(await readRecord("iu_moje_sluzby_banks_state_v1")),
    };
    return { pass: Object.values(checks).every(Boolean), checks };
  });
}

function isCliRun() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const self = path.resolve(fileURLToPath(import.meta.url));
  return entry.toLowerCase() === self.toLowerCase();
}

export async function runExistingVaultMigrateProbe(options = {}) {
  const preferredPort = Number(options.port || pickGuardPort());
  const expectFailMode = !!options.expectFail;
  const pin = String(options.pin || GUARD_PIN);
  const marker = `IU_MIGRATE_PROBE_${Date.now()}`;

  let started = null;
  let browser = null;
  let context = null;
  let page = null;
  let result = { pass: false, checks: { startup: false } };

  try {
    started = await startGuardStaticServer(preferredPort);
    const base = `http://127.0.0.1:${started.port}/projects/`;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 1366, height: 768 },
      isMobile: false,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVaultReady(page, 60000);
    const seeded = await seedFixtures(page, marker);
    if (!seeded) {
      result = { pass: false, checks: { fixtureLegacyNative: false } };
      return result;
    }
    const setup = await runSetupPin(page, pin, expectFailMode);
    if (expectFailMode) {
      result = { pass: !!setup.pass, checks: setup.checks || {}, expectFail: true };
      return result;
    }
    if (!setup.ok) {
      result = { pass: false, checks: { setupPin: false } };
      return result;
    }
    await runHydrate(page, pin);
    result = await readBackChecks(page);
    result.expectFail = false;
    return result;
  } catch (err) {
    result = { pass: false, checks: { error: String(err && err.message ? err.message : err) } };
    return result;
  } finally {
    await Promise.race([
      (async () => {
        await closePlaywrightSession(page, context, browser);
        if (started && started.proc) await stopGuardProcess(started.proc, 2000);
      })(),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
  }
}

async function main() {
  const expectFail = process.argv.includes("expect-fail");
  const port = parseInt(process.env.IU_GUARD_PORT || "0", 10) || pickGuardPort();
  const hardTimer = setTimeout(() => {
    console.log(JSON.stringify({ pass: false, checks: { hard_timeout: true } }));
    process.exit(1);
  }, 75000);
  hardTimer.unref?.();
  let result = { pass: false, checks: { startup: false } };
  try {
    result = await runExistingVaultMigrateProbe({ port, expectFail });
  } finally {
    clearTimeout(hardTimer);
  }
  console.log(JSON.stringify(result));
  process.exit(expectFail ? (result.pass ? 0 : 1) : result.pass ? 0 : 1);
}

if (isCliRun()) {
  main().catch((e) => {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
