#!/usr/bin/env node
/**
 * MULTI_CANARY_BOOT_DIVERGENCE_GUARD
 *
 * Proves weather (UI/onboarding) + prefs + notes share vault-protected storage
 * and that cold reopen after durableSet keeps all three; early boot shim is opaque
 * until hydrate.
 *
 * Run: node scripts/iu-vault-multi-canary-boot-divergence-guard-v1.mjs
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import fs from "fs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const MARKER = `IU_CANARY_${Date.now()}`;
const TMP = process.env.TEMP || process.env.TMPDIR || "/tmp";

const KEYS = {
  weatherGps: "iuWeatherGpsSelectedV1",
  weatherMode: "iu_location_mode",
  prefs: "iu.infoEvents.prefs.v1",
  notes: "iu.notes.store.v1",
};

function staticChecks(fails) {
  const prot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-protected-keys-v1.js"), "utf8");
  const backup = fs.readFileSync(path.join(REPO, "assets", "iu-user-data-backup-core.js"), "utf8");
  const weather = fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  const diag = fs.readFileSync(path.join(REPO, "assets", "iu-vault-persistence-diag-v1.js"), "utf8");
  const overlay = fs.readFileSync(path.join(REPO, "assets", "iu-vault-physical-diag-overlay-v1.js"), "utf8");
  if (!/iuWeatherGpsSelectedV1/.test(backup)) fails.push("static_weather_gps_not_in_module_defs");
  if (!/MODULE_DEFS/.test(prot)) fails.push("static_protected_keys_missing_module_defs");
  if (!/iuWeatherWriteGpsSelected/.test(weather)) fails.push("static_weather_write_missing");
  if (!/durableSet\(IU_WEATHER_GPS_SELECTED_KEY/.test(weather)) {
    fails.push("static_weather_write_not_via_durableSet");
  }
  if (!/captureMultiCanaryBootTrace/.test(diag)) fails.push("static_canary_capture_missing");
  if (!/iuCanaryDiag/.test(overlay)) fails.push("static_canary_overlay_missing");
}

async function main() {
  const fails = [];
  staticChecks(fails);

  let server = null;
  let browser = null;
  const profile = fs.mkdtempSync(path.join(TMP, "iu-canary-"));
  try {
    const started = await startGuardStaticServer(pickGuardPort(9470, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    browser = await chromium.launch({ headless: true });

    // Prove keys are protected at runtime
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForVaultReady(page, 60000);
      const prot = await page.evaluate(async (keys) => {
        const m = await import("/assets/iu-vault-protected-keys-v1.js");
        const out = {};
        for (const [n, k] of Object.entries(keys)) out[n] = m.isProtectedStorageKey(k);
        return out;
      }, KEYS);
      if (!prot.weatherGps || !prot.weatherMode || !prot.prefs || !prot.notes) {
        fails.push("runtime_keys_not_all_protected:" + JSON.stringify(prot));
      }
      await ctx.close();
    }

    // SAVE via durableSet → cold reopen
    {
      const ctx1 = await chromium.launchPersistentContext(profile, {
        headless: true,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await ctx1.addInitScript(() => {
        try {
          localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
          localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
        } catch (_) {}
      });
      const p1 = await ctx1.newPage();
      await p1.goto(`${base}?nosw=1&iuCanaryDiag=1&cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await waitForVaultReady(p1, 90000);
      await p1.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 60000 });

      const before = await p1.evaluate(async ({ KEYS, MARKER }) => {
        const weatherVal = JSON.stringify({ name: "Poloha", lat: 50.1, lon: 14.4, marker: MARKER });
        const prefsVal = JSON.stringify({
          schemaVersion: 6,
          sections: ["doprava"],
          homeObec: MARKER,
          sourceGroups: [],
          sourceIds: [],
          lanes: [],
          localities: [],
          feedFilter: null,
        });
        const notesVal = JSON.stringify({
          schemaVersion: 1,
          notes: [{ id: "n1", title: MARKER, body: "b", tags: [], createdAt: 1, updatedAt: 1 }],
        });
        await window.iuVault.durableSet(KEYS.weatherMode, "gps");
        await window.iuVault.durableSet(KEYS.weatherGps, weatherVal);
        await window.iuVault.durableSet(KEYS.prefs, prefsVal);
        await window.iuVault.durableSet(KEYS.notes, notesVal);
        return window.iuVault.captureMultiCanaryBootTrace("BEFORE_RELOAD_AFTER_SAVE");
      }, { KEYS, MARKER });

      if (!before || !before.canaries || !before.canaries.weatherGps.idbPresent) {
        fails.push("before_weather_idb_missing");
      }
      if (!before.canaries.prefs.idbPresent) fails.push("before_prefs_idb_missing");
      if (!before.canaries.notes.idbPresent) fails.push("before_notes_idb_missing");
      if (before.weatherUi && before.weatherUi.wouldShowFirstVisitDialog === true) {
        fails.push("before_would_still_show_first_visit");
      }

      await ctx1.close();

      const ctx2 = await chromium.launchPersistentContext(profile, {
        headless: true,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const p2 = await ctx2.newPage();
      await p2.goto(`${base}?nosw=1&iuCanaryDiag=1&cold=1&cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await waitForVaultReady(p2, 90000);

      const early = await p2.evaluate(() => window.__iuCanaryEarlyBoot || null);
      if (!early) fails.push("early_boot_snapshot_missing");
      if (early && early.canaries && early.canaries.weatherGps) {
        // Pre-hydrate: shim must be opaque even if IDB already has ciphertext.
        if (early.hydrationComplete === true) fails.push("early_boot_already_hydrated");
        if (early.canaries.weatherGps.shimGetPresent) fails.push("early_boot_shim_not_opaque");
        if (!early.canaries.weatherGps.idbPresent) fails.push("early_boot_idb_missing_weather");
      }

      await p2.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 60000 });
      const after = await p2.evaluate(() =>
        window.iuVault.captureMultiCanaryBootTrace("AFTER_RELOAD_HYDRATED_UI")
      );

      if (!after.canaries.weatherGps.shimGetPresent || !after.canaries.weatherGps.decryptOk) {
        fails.push("after_weather_shim_or_decrypt_fail");
      }
      if (!after.canaries.prefs.shimGetPresent || !after.canaries.prefs.decryptOk) {
        fails.push("after_prefs_shim_or_decrypt_fail");
      }
      if (!after.canaries.notes.shimGetPresent || !after.canaries.notes.decryptOk) {
        fails.push("after_notes_shim_or_decrypt_fail");
      }
      if (after.weatherUi && after.weatherUi.wouldShowFirstVisitDialog === true) {
        fails.push("after_first_visit_dialog_would_show");
      }
      if (
        before.canaries.weatherGps.decryptFp &&
        after.canaries.weatherGps.decryptFp &&
        before.canaries.weatherGps.decryptFp !== after.canaries.weatherGps.decryptFp
      ) {
        fails.push("weather_fp_changed_across_cold");
      }

      // Divergence proof: all three fail or pass together at early shim opacity
      if (early && early.canaries) {
        const names = ["weatherGps", "prefs", "notes"];
        const shimOpaque = names.every((n) => early.canaries[n] && !early.canaries[n].shimGetPresent);
        const idbAll = names.every((n) => early.canaries[n] && early.canaries[n].idbPresent);
        if (!(shimOpaque && idbAll)) {
          fails.push("common_early_divergence_not_aligned");
        }
      }

      await ctx2.close();
    }

    let fireForgetLostOnCold = null;

    // Production weather path: fire-and-forget setItem (no durableSet / no await flush)
    {
      const profileFf = fs.mkdtempSync(path.join(TMP, "iu-canary-ff-"));
      const ctx1 = await chromium.launchPersistentContext(profileFf, {
        headless: true,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await ctx1.addInitScript(() => {
        try {
          localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
          localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
        } catch (_) {}
      });
      const p1 = await ctx1.newPage();
      await p1.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await waitForVaultReady(p1, 90000);
      await p1.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 60000 });
      await p1.evaluate(({ KEYS, MARKER }) => {
        const weatherVal = JSON.stringify({ name: "Poloha", lat: 50.2, lon: 14.5, marker: MARKER + "_FF" });
        // Mirror production iuWeatherWriteGpsSelected — setItem only, no await.
        localStorage.setItem(KEYS.weatherMode, "gps");
        localStorage.setItem(KEYS.weatherGps, weatherVal);
      }, { KEYS, MARKER });
      // Destroy ASAP (mobile kill before microtask flush may land).
      await ctx1.close();

      const ctx2 = await chromium.launchPersistentContext(profileFf, {
        headless: true,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const p2 = await ctx2.newPage();
      await p2.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await waitForVaultReady(p2, 90000);
      await p2.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 60000 });
      const ff = await p2.evaluate(async () => {
        return window.iuVault.captureMultiCanaryBootTrace("AFTER_FIRE_FORGET_COLD");
      });
      const ffSurvived = !!(ff.canaries && ff.canaries.weatherGps && ff.canaries.weatherGps.idbPresent && ff.canaries.weatherGps.decryptOk);
      fireForgetLostOnCold = !ffSurvived;
      await ctx2.close();
      try {
        fs.rmSync(profileFf, { recursive: true, force: true });
      } catch (_) {}
    }

    const report = {
      IU_VAULT_MULTI_CANARY_BOOT_DIVERGENCE_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      marker: MARKER,
      fails,
      evidence: {
        fireForgetWeatherSetItemLostOnCold: fireForgetLostOnCold,
      },
      note:
        "Weather GPS/mode keys are vault-protected (MODULE_DEFS). Early boot shim is opaque for weather+prefs+notes while IDB ciphertext is present — shared vault bootstrap divergence class. fireForgetWeatherSetItemLostOnCold=true ⇒ production weather write path (setItem without await/durableSet) is not a reliable SAVE ACK on cold kill.",
    };
    console.log(JSON.stringify(report, null, 2));
    if (fails.length) process.exit(1);
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  } finally {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (_) {}
    if (browser) await browser.close().catch(() => {});
    if (server) await stopGuardProcess(server.proc || null);
  }
}

main();
