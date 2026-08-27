#!/usr/bin/env node
/**
 * Notes loadNotes must not persist empty default during vault hydrate/lock opaque read.
 * Negative: IU_NEG_BYPASS_NOTES_OPAQUE=1 simulates removed opaque guard → must FAIL.
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

const PIN = "123456";
const MARKER = `IU_NOTES_OPAQUE_${Date.now()}`;
const NOTES_KEY = "iu.notes.store.v1";
const ENC_PREFIX = "iu:vault:enc:v1:";
const BYPASS_OPAQUE = process.env.IU_NEG_BYPASS_NOTES_OPAQUE === "1";

function staticChecks(fails) {
  const notes = fs.readFileSync(path.join(REPO, "assets", "iu-notes-overlay-v1.js"), "utf8");
  if (!/function isNotesReadOpaque/.test(notes)) fails.push("notes_missing_opaque_read_fn");
  if (!/isNotesReadOpaque\(\)/.test(notes.split("function loadNotes")[1] || "")) {
    fails.push("loadNotes_missing_opaque_guard");
  }
  if (!/hasVaultEncBlob\(STORE_KEY\) \|\| isNotesReadOpaque\(\)/.test(notes)) {
    fails.push("loadNotes_missing_enc_or_opaque_branch");
  }
}

async function waitVaultApi(page) {
  await page.waitForFunction(() => !!(window.iuVault && window.iuVault.setupPin && window.iuVault.unlockPin), null, {
    timeout: 60000,
  });
}

async function readMarkerFromVault(page, marker) {
  return page.evaluate(async ({ key, markerText }) => {
    const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
    const raw = await vaultGetItem(key);
    if (!raw) return { ok: false, reason: "vault_read_empty" };
    if (!String(raw).includes(markerText)) return { ok: false, reason: "marker_missing" };
    return { ok: true };
  }, { key: NOTES_KEY, markerText: marker });
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;

  try {
    const started = await startGuardStaticServer(pickGuardPort(8820, 400));
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
    await waitVaultApi(page);

    const seeded = await page.evaluate(async ({ pin, marker, notesKey }) => {
      const payload = JSON.stringify({
        schemaVersion: 1,
        notes: [{ id: "n1", title: marker + "_NOTE", content: "body", tags: [], createdAt: 1, updatedAt: 1 }],
      });
      await window.iuVault.setupPin(pin, pin);
      await window.iuVault.unlockPin(pin);
      await window.iuVault.afterUnlock();
      localStorage.setItem(notesKey, payload);
      await window.iuVault.flushPendingWrites();
      const enc = localStorage.getItem("iu:vault:enc:v1:" + notesKey);
      await window.iuVault.lock();
      return { encLen: enc ? enc.length : 0 };
    }, { pin: PIN, marker: MARKER, notesKey: NOTES_KEY });

    if (!seeded.encLen) fails.push("seed_enc_missing");

    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitVaultApi(page);

    const hydrationProbe = await page.evaluate(async ({ pin, marker, notesKey, bypassOpaque }) => {
      const encKey = "iu:vault:enc:v1:" + notesKey;
      await window.iuVault.unlockPin(pin);
      const hydrationPending = !!window.__iuVaultHydrationPending;
      const encBefore = localStorage.getItem(encKey);
      if (typeof window.__iuEnsureNotesOverlay === "function") {
        await window.__iuEnsureNotesOverlay();
      }
      if (bypassOpaque) {
        try {
          window.__iuVaultHydrationPending = false;
          window.__iuVaultHydrationComplete = true;
        } catch (_) {}
        localStorage.setItem(notesKey, JSON.stringify({ schemaVersion: 1, notes: [] }));
        await window.iuVault.flushPendingWrites();
      }
      const encAfterLoad = localStorage.getItem(encKey);
      await window.iuVault.afterUnlock();
      await new Promise((r) => setTimeout(r, 250));
      const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
      const raw = await vaultGetItem(notesKey);
      return {
        hydrationPending,
        encBeforeLen: encBefore ? encBefore.length : 0,
        encAfterLoadLen: encAfterLoad ? encAfterLoad.length : 0,
        encChangedDuringPending: String(encBefore || "") !== String(encAfterLoad || ""),
        markerPresent: !!(raw && String(raw).includes(marker + "_NOTE")),
      };
    }, { pin: PIN, marker: MARKER, notesKey: NOTES_KEY, bypassOpaque: BYPASS_OPAQUE });

    if (!hydrationProbe.hydrationPending) fails.push("hydration_not_pending_on_unlock");
    if (BYPASS_OPAQUE) {
      if (hydrationProbe.markerPresent) fails.push("neg_bypass_opaque_marker_still_present");
      fails.push("neg_bypass_opaque_active");
    } else {
      if (hydrationProbe.encChangedDuringPending) fails.push("enc_clobbered_during_hydration_pending");
      if (!hydrationProbe.markerPresent) fails.push("marker_missing_after_hydrate");
    }

    const readBack = await readMarkerFromVault(page, MARKER);
    if (!BYPASS_OPAQUE && !readBack.ok) fails.push(`readback:${readBack.reason}`);
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(
    JSON.stringify({
      IU_VAULT_NOTES_HYDRATION_OPAQUE_GUARD: pass ? "PASS" : "FAIL",
      marker: MARKER,
      bypassOpaque: BYPASS_OPAQUE,
      fails,
    })
  );
  if (!pass) {
    console.error("IU_VAULT_NOTES_HYDRATION_OPAQUE_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_NOTES_HYDRATION_OPAQUE_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
