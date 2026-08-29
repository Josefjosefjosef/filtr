#!/usr/bin/env node
/**
 * Mobile/tablet durability: in-flight vaultSetItem must survive hydrationPending
 * armed by lock/pagehide BEFORE flush (PC desktop skips background lock).
 *
 * Also static: no persist_blocked_pre_write after encrypt; prefs durable await.
 *
 * Run: node scripts/iu-vault-inflight-write-durability-guard-v1.mjs
 */
import path from "path";
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
const NOTE = "iu.notes.store.v1";
const MARKER = `IU_INFLIGHT_${Date.now()}`;

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

function notePayload(tag) {
  return JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "n1", title: tag, body: "b", tags: [], createdAt: 1, updatedAt: 1 }],
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

async function main() {
  const fails = [];
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const storageJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
    const coreJs = fs.readFileSync(path.join(REPO, "assets", "iu-info-system-core-v1.js"), "utf8");
    const prehledJs = fs.readFileSync(path.join(REPO, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
    if (/persist_blocked_pre_write/.test(storageJs)) fails.push("static_still_aborts_inflight_on_pending");
    if (!/In-flight writes must NOT re-check isVaultPersistBlocked/.test(storageJs)) {
      fails.push("static_missing_inflight_comment");
    }
    if (!/__iuPrefsDurableWrite/.test(coreJs)) fails.push("static_prefs_missing_durable_track");
    if (!/awaitPrefsDurable/.test(prehledJs)) fails.push("static_persistDraft_missing_await_durable");

    const started = await startGuardStaticServer(pickGuardPort(9410, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    browser = await chromium.launch({ headless: true });
    // Mobile viewport: same path that enables background auto-lock on real devices.
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVaultReady(page, 60000);
    await waitHydrated(page);

    const PIN = "123456";
    await page.evaluate(async (pin) => {
      await window.iuVault.setupPin(pin, pin);
      await window.iuVault.unlockPin(pin);
      await window.iuVault.afterUnlock();
    }, PIN);

    const goodPrefs = prefsPayload(MARKER);
    const goodNote = notePayload(MARKER);

    // A — mid-flight hydrationPending must not drop IDB write
    const a = await page.evaluate(
      async ({ PREFS, NOTE, goodPrefs, goodNote, MARKER }) => {
        window.__iuVaultUserWriteDepth = 1;
        let writePromise;
        try {
          writePromise = localStorage.setItem(PREFS, goodPrefs);
          const noteRet = localStorage.setItem(NOTE, goodNote);
          if (noteRet && noteRet.then) await noteRet;
        } finally {
          window.__iuVaultUserWriteDepth = 0;
        }
        // Arm the same gate lockVault/pagehide uses BEFORE flush.
        window.__iuVaultHydrationPending = true;
        window.__iuVaultHydrationComplete = false;
        if (writePromise && writePromise.then) await writePromise;
        await window.iuVault.flushPendingWrites();
        // Clear gate like afterUnlock would after successful flush path.
        window.__iuVaultHydrationPending = false;
        window.__iuVaultHydrationComplete = true;
        const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
        const prefs = await vaultGetItem(PREFS, { bypassMemoryCache: true });
        const note = await vaultGetItem(NOTE, { bypassMemoryCache: true });
        return {
          prefsOk: !!(prefs && prefs.includes(MARKER)),
          noteOk: !!(note && note.includes(MARKER)),
        };
      },
      { PREFS, NOTE, goodPrefs, goodNote, MARKER }
    );
    if (!(a.prefsOk && a.noteOk)) fails.push("A_INFLIGHT_SURVIVES_HYDRATION_PENDING");

    // B — prefs durable await leaves IDB marker (SECURITY OFF style after disable pin)
    await page.evaluate(async (pin) => {
      await window.iuVault.disableMindMenuLock(pin);
    }, PIN);
    await waitHydrated(page);
    const b = await page.evaluate(async ({ PREFS, MARKER, goodPrefs }) => {
      const core = await import("/assets/iu-info-system-core-v1.js");
      const ok = core.setPrefs(JSON.parse(goodPrefs));
      if (!ok) return { ok: false };
      if (typeof core.awaitPrefsDurable === "function") await core.awaitPrefsDurable();
      else await window.iuVault.flushPendingWrites();
      const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
      const prefs = await vaultGetItem(PREFS, { bypassMemoryCache: true });
      return { ok: !!(prefs && prefs.includes(MARKER)) };
    }, { PREFS, MARKER, goodPrefs });
    if (!b.ok) fails.push("B_PREFS_DURABLE_COMMIT");

    // C — PC regression: cold reopen still SAME (SECURITY OFF)
    await page.evaluate(async ({ PREFS, NOTE, goodPrefs, goodNote }) => {
      window.__iuVaultUserWriteDepth = 1;
      try {
        for (const [k, v] of [
          [PREFS, goodPrefs],
          [NOTE, goodNote],
        ]) {
          const ret = localStorage.setItem(k, v);
          if (ret && ret.then) await ret;
        }
      } finally {
        window.__iuVaultUserWriteDepth = 0;
      }
      await window.iuVault.flushPendingWrites();
    }, { PREFS, NOTE, goodPrefs, goodNote });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVaultReady(page, 60000);
    await waitHydrated(page);
    const c = await page.evaluate(async ({ PREFS, NOTE, MARKER }) => {
      const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
      const prefs = await vaultGetItem(PREFS, { bypassMemoryCache: true });
      const note = await vaultGetItem(NOTE, { bypassMemoryCache: true });
      const sec = await window.iuVault.getSecurityConfigured();
      return {
        prefsOk: !!(prefs && prefs.includes(MARKER)),
        noteOk: !!(note && note.includes(MARKER)),
        unlockMethod: sec && sec.unlockMethod,
      };
    }, { PREFS, NOTE, MARKER });
    if (!(c.prefsOk && c.noteOk)) fails.push("C_PC_REGRESSION_RELOAD_SAME");

    const report = {
      IU_VAULT_INFLIGHT_WRITE_DURABILITY_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      marker: MARKER,
      fails,
      A_INFLIGHT_SURVIVES_HYDRATION_PENDING: fails.includes("A_INFLIGHT_SURVIVES_HYDRATION_PENDING")
        ? "FAIL"
        : "PASS",
      B_PREFS_DURABLE_COMMIT: fails.includes("B_PREFS_DURABLE_COMMIT") ? "FAIL" : "PASS",
      C_PC_REGRESSION_RELOAD_SAME: fails.includes("C_PC_REGRESSION_RELOAD_SAME") ? "FAIL" : "PASS",
      a,
      b,
      c,
    };
    console.log(JSON.stringify(report, null, 2));
    if (fails.length) process.exit(1);
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  } finally {
    await closePlaywrightSession(page, context, browser);
    if (server) await stopGuardProcess(server.proc || null);
  }
}

main();
