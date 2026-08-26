#!/usr/bin/env node
/**
 * Mobile/PWA notes + filter persistence write guard.
 * - Reproduces Silver save without lazy notes overlay boot (physical iPhone symptom).
 * - After unlock + overlay ensure: notes save must reach persistent backend (IDB/enc LS).
 * - Doprava/ČHMÚ prefs write must reach persistent backend.
 * Negative: IU_NEG_SKIP_FLUSH=1 or IU_NEG_BLOCK_SILVER_ENSURE=1
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

const PIN = "123456";
const MARKER = `IU_MOB_WRITE_${Date.now()}`;
const NOTES_KEY = "iu.notes.store.v1";
const PREFS_KEY = "iu.infoEvents.prefs.v1";
const SKIP_FLUSH = process.env.IU_NEG_SKIP_FLUSH === "1";
const BLOCK_SILVER_ENSURE = process.env.IU_NEG_BLOCK_SILVER_ENSURE === "1";

function staticChecks(fails) {
  const silver = fs.readFileSync(path.join(REPO, "assets", "iu-silver-p0-engine.js"), "utf8");
  const app = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const notes = fs.readFileSync(path.join(REPO, "assets", "iu-notes-overlay-v1.js"), "utf8");
  if (!/__iuNotesLazyStub/.test(app)) fails.push("app_missing_notes_lazy_stub");
  if (!/notesSaveSilverDraft/.test(notes)) fails.push("notes_missing_silver_save_api");
  if (/__iuEnsureNotesOverlay/.test(silver)) return;
  fails.push("silver_missing_ensure_notes_overlay_before_save");
  if (/Poznámky teď nejdou uložit/.test(silver) && /typeof svc\.notesSaveSilverDraft !== "function"/.test(silver)) {
    fails.push("silver_save_error_maps_to_lazy_stub");
  }
}

async function setupVault(page) {
  await page.evaluate(async ({ pin }) => {
    await window.iuVault.setupPin(pin, pin);
    await window.iuVault.unlockPin(pin);
    await window.iuVault.afterUnlock();
    await new Promise((r) => {
      if (window.__iuVaultHydrationComplete) return r();
      window.addEventListener("iu-vault-hydrated", () => r(), { once: true });
      setTimeout(r, 5000);
    });
  }, { pin: PIN });
}

async function readPersistentProof(page, storageKey) {
  return page.evaluate(async (key) => {
    const { readRecord } = await import("/assets/iu-vault-db-v1.js");
    const { encStorageKey, nativeLocalStorageGet } = await import("/assets/iu-vault-storage-v1.js");
    let idb = false;
    let idbErr = null;
    try {
      const env = await readRecord(key);
      idb = !!(env && env.ct);
    } catch (e) {
      idbErr = String(e && e.name ? e.name : e).slice(0, 64);
    }
    let lsEnc = false;
    try {
      lsEnc = !!nativeLocalStorageGet(encStorageKey(key));
    } catch (_) {}
    return { idb, lsEnc, idbErr, persisted: idb || lsEnc };
  }, storageKey);
}

async function probeSilverWithoutEnsure(page, marker) {
  return page.evaluate(async ({ markerText }) => {
    const svc = window.iuNotesService;
    const lazy = !!(svc && svc.__iuNotesLazyStub);
    const hasApi = !!(svc && typeof svc.notesSaveSilverDraft === "function");
    let silverPath = "missing_api";
    if (hasApi) {
      const res = await svc.notesSaveSilverDraft({ text: markerText + " silver probe" });
      silverPath = res && res.ok ? "unexpected_ok" : String(res && res.reason ? res.reason : "save_fail");
    }
    return { lazy, hasApi, silverPath };
  }, { markerText: marker });
}

async function saveNoteAfterEnsure(page, marker) {
  return page.evaluate(async ({ markerText }) => {
    if (typeof window.__iuEnsureNotesOverlay === "function") {
      await window.__iuEnsureNotesOverlay();
    }
    const svc = window.iuNotesService;
    if (!svc || typeof svc.notesSaveSilverDraft !== "function") {
      return { ok: false, reason: "missing_api_after_ensure" };
    }
    const res = await svc.notesSaveSilverDraft({ text: markerText + " direct ensure save" });
    if (!res || !res.ok) return { ok: false, reason: res && res.reason ? res.reason : "save_fail" };
    if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
      await window.iuVault.flushPendingWrites();
    }
    return { ok: true };
  }, { markerText: marker });
}

async function savePrefs(page, marker) {
  return page.evaluate(async ({ markerText, prefsKey }) => {
    const prefs = {
      sections: ["doprava", "chmi"],
      sourceGroups: ["doprava", "chmi"],
      homeObec: markerText + "_OBEC",
      feedFilter: { roads: [markerText + "_ROAD"] },
    };
    const mod = window.__iuInfoSystemCore || null;
    if (mod && typeof mod.setPrefs === "function") {
      const ok = mod.setPrefs(prefs);
      if (!ok) return { ok: false, reason: "setPrefs_returned_false" };
    } else {
      try {
        window.__iuVaultUserWriteDepth = (window.__iuVaultUserWriteDepth || 0) + 1;
        localStorage.setItem(prefsKey, JSON.stringify(prefs));
        window.__iuVaultUserWriteDepth = Math.max(0, (window.__iuVaultUserWriteDepth || 1) - 1);
      } catch (e) {
        return { ok: false, reason: String(e && e.message ? e.message : e) };
      }
    }
    if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
      await window.iuVault.flushPendingWrites();
    }
    return { ok: true };
  }, { markerText: marker, prefsKey: PREFS_KEY });
}

async function readNoteMarkerFromBackend(page, marker) {
  return page.evaluate(async ({ key, markerText }) => {
    const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
    const raw = await vaultGetItem(key);
    if (!raw) return { ok: false, reason: "vault_read_empty" };
    if (!String(raw).includes(markerText)) return { ok: false, reason: "marker_missing" };
    return { ok: true };
  }, { key: NOTES_KEY, markerText: marker });
}

async function readPrefsMarkerFromBackend(page, marker) {
  return page.evaluate(async ({ key, markerText }) => {
    const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
    const raw = await vaultGetItem(key);
    if (!raw) return { ok: false, reason: "vault_read_empty" };
    if (!String(raw).includes(markerText + "_OBEC")) return { ok: false, reason: "marker_missing" };
    return { ok: true };
  }, { key: PREFS_KEY, markerText: marker });
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let page = null;
  let context = null;

  try {
    const started = await startGuardStaticServer(pickGuardPort(8810, 400));
    server = started;
    const base = `http://127.0.0.1:${server.port}/projects/`;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(90000);
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page, 90000);
    await setupVault(page);

    const silverProbe = await probeSilverWithoutEnsure(page, MARKER);
    if (!silverProbe.lazy) fails.push("silver_overlay_not_lazy_before_first_open");
    if (silverProbe.hasApi) fails.push("silver_save_api_present_without_ensure");
    if (silverProbe.silverPath === "unexpected_ok") fails.push("silver_save_unexpected_ok_without_ensure");

  const vaultGate = await page.evaluate(() => ({
      unlocked: !!(window.iuVault && window.iuVault.getState && window.iuVault.getState().unlocked),
      hydrationPending: !!window.__iuVaultHydrationPending,
      hydrationComplete: !!window.__iuVaultHydrationComplete,
      bootPhase: String(window.__iuVaultBootPhase || ""),
    }));
    if (!vaultGate.unlocked) fails.push("vault_not_unlocked");
    if (vaultGate.hydrationPending) fails.push("hydration_still_pending");

    if (!BLOCK_SILVER_ENSURE) {
      const noteSave = await saveNoteAfterEnsure(page, MARKER);
      if (!noteSave.ok) fails.push(`notes_save_after_ensure:${noteSave.reason}`);
      if (!SKIP_FLUSH) {
        const notePersist = await readPersistentProof(page, NOTES_KEY);
        if (!notePersist.persisted) fails.push(`notes_backend_missing:idb=${notePersist.idb}:ls=${notePersist.lsEnc}:err=${notePersist.idbErr || ""}`);
        const noteRead = await readNoteMarkerFromBackend(page, MARKER);
        if (!noteRead.ok) fails.push(`notes_readback:${noteRead.reason}`);
      } else {
        const notePersist = await readPersistentProof(page, NOTES_KEY);
        if (notePersist.persisted) fails.push("notes_persisted_despite_skip_flush");
      }
    } else {
      fails.push("neg_block_silver_ensure_active");
    }

    const prefsSave = await savePrefs(page, MARKER);
    if (!prefsSave.ok) fails.push(`prefs_save:${prefsSave.reason}`);
    if (!SKIP_FLUSH) {
      const prefsPersist = await readPersistentProof(page, PREFS_KEY);
      if (!prefsPersist.persisted) fails.push(`prefs_backend_missing:idb=${prefsPersist.idb}:ls=${prefsPersist.lsEnc}`);
      const prefsRead = await readPrefsMarkerFromBackend(page, MARKER);
      if (!prefsRead.ok) fails.push(`prefs_readback:${prefsRead.reason}`);
    }

    const diag = await page.evaluate(async () => {
      if (!window.iuVault || typeof window.iuVault.getPersistenceDiag !== "function") {
        return { ok: false, reason: "diag_missing" };
      }
      return { ok: true, snap: await window.iuVault.getPersistenceDiag() };
    });
    if (!diag.ok) fails.push(`diag_api:${diag.reason}`);
    else {
      const noteRec = (diag.snap.records || []).find((r) => r.storageKey === NOTES_KEY);
      const prefRec = (diag.snap.records || []).find((r) => r.storageKey === PREFS_KEY);
      if (!noteRec || !noteRec.persisted) fails.push("diag_notes_not_persisted");
      if (!prefRec || !prefRec.persisted) fails.push("diag_prefs_not_persisted");
    }
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  const report = {
    IU_VAULT_MOBILE_NOTES_PERSIST_WRITE_GUARD: pass ? "PASS" : "FAIL",
    marker: MARKER,
    skipFlush: SKIP_FLUSH,
    blockSilverEnsure: BLOCK_SILVER_ENSURE,
    fails,
  };
  console.log(JSON.stringify(report));
  if (!pass) {
    console.error("IU_VAULT_MOBILE_NOTES_PERSIST_WRITE_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_MOBILE_NOTES_PERSIST_WRITE_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
