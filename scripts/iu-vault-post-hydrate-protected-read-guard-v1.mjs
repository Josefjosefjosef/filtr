#!/usr/bin/env node
/**
 * POST_HYDRATE_PROTECTED_READ_MATCHES_CANONICAL_MEMORY_GUARD
 * + PRE_HYDRATE_PROTECTED_READ_STAYS_OPAQUE_GUARD
 *
 * Proves the engine-portable Storage.prototype compatibility bridge:
 * - pre-hydrate: consumer localStorage.getItem stays opaque (no plaintext)
 * - post-hydrate: consumer getItem matches canonical memoryCache
 * - no native plaintext LS for protected keys
 * - weather firstVisit stays false when GPS hydrated
 *
 * Runs Chromium + Firefox + WebKit when Playwright browsers are installed.
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
const pw = require("playwright");

const MARKER = `IU_POST_HYDRATE_${Date.now()}`;
const TMP = process.env.TEMP || process.env.TMPDIR || "/tmp";

const KEYS = {
  weatherGps: "iuWeatherGpsSelectedV1",
  weatherMode: "iu_location_mode",
  prefs: "iu.infoEvents.prefs.v1",
  notes: "iu.notes.store.v1",
};

function staticChecks(fails) {
  const storage = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  if (!/Storage\.prototype\.getItem\s*=/.test(storage)) {
    fails.push("static_missing_storage_prototype_getItem_patch");
  }
  if (!/getProtectedSyncReadState/.test(storage)) {
    fails.push("static_missing_sync_read_state_api");
  }
  if (!/NOT_READY/.test(storage)) {
    fails.push("static_missing_not_ready_status");
  }
}

async function runEngine(browserType, engineName, base, fails, evidence) {
  const profile = fs.mkdtempSync(path.join(TMP, `iu-post-hydrate-${engineName}-`));
  try {
    const ctx1 = await browserType.launchPersistentContext(profile, {
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
      timeout: 120000,
    });
    await waitForVaultReady(p1, 120000);
    await p1.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });

    await p1.evaluate(async ({ KEYS, MARKER }) => {
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
    }, { KEYS, MARKER });

    await ctx1.close();

    const ctx2 = await browserType.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const p2 = await ctx2.newPage();
    await p2.goto(`${base}?nosw=1&iuCanaryDiag=1&cold=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await waitForVaultReady(p2, 120000);

    const early = await p2.evaluate(() => window.__iuCanaryEarlyBoot || null);
    if (!early) fails.push(`${engineName}_early_boot_missing`);
    if (early && early.hydrationComplete === true) fails.push(`${engineName}_early_already_hydrated`);
    if (early && early.canaries) {
      for (const name of ["weatherGps", "prefs", "notes"]) {
        const c = early.canaries[name];
        if (!c) {
          fails.push(`${engineName}_early_missing_${name}`);
          continue;
        }
        if (c.shimGetPresent) fails.push(`${engineName}_pre_hydrate_shim_not_opaque_${name}`);
        if (c.nativePlainPresent) fails.push(`${engineName}_pre_hydrate_native_plaintext_${name}`);
        if (!c.idbPresent) fails.push(`${engineName}_pre_hydrate_idb_missing_${name}`);
      }
    }

    await p2.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });

    const after = await p2.evaluate(async (KEYS) => {
      const storage = await import("/assets/iu-vault-storage-v1.js");
      const lock = await import("/assets/iu-vault-lock-v1.js");
      const out = {
        unlocked: !!lock.getVaultState().unlocked,
        hydrationComplete: !!window.__iuVaultHydrationComplete,
        keys: {},
        weatherUi: null,
        protoPatched: String(Storage.prototype.getItem).indexOf("shimGetItem") !== -1
          || !String(Storage.prototype.getItem).includes("[native code]"),
      };
      for (const [name, key] of Object.entries(KEYS)) {
        const mem = storage.getMemoryCachePlaintext(key);
        const viaCall = localStorage.getItem(key);
        const viaProto = Storage.prototype.getItem.call(localStorage, key);
        let nativePlain = null;
        try {
          nativePlain = storage.nativeLocalStorageGet(key);
        } catch (_) {}
        const readState = storage.getProtectedSyncReadState(key);
        out.keys[name] = {
          memPresent: mem != null && String(mem).length > 0,
          viaCallPresent: viaCall != null && String(viaCall).length > 0,
          viaProtoPresent: viaProto != null && String(viaProto).length > 0,
          memMatchesCall: mem != null && viaCall === mem,
          memMatchesProto: mem != null && viaProto === mem,
          nativePlainPresent: nativePlain != null,
          syncReadStatus: readState.status,
        };
      }
      out.weatherUi = await window.iuVault.captureMultiCanaryBootTrace("AFTER_RELOAD_HYDRATED_UI");
      return out;
    }, KEYS);

    evidence[engineName] = {
      protoPatched: after.protoPatched,
      weatherWouldFirstVisit: after.weatherUi && after.weatherUi.weatherUi
        ? after.weatherUi.weatherUi.wouldShowFirstVisitDialog
        : null,
      keys: after.keys,
    };

    if (!after.unlocked) fails.push(`${engineName}_not_unlocked_after_hydrate`);
    for (const name of ["weatherGps", "prefs", "notes"]) {
      const k = after.keys[name];
      if (!k || !k.memPresent) fails.push(`${engineName}_post_hydrate_mem_missing_${name}`);
      if (!k || !k.viaCallPresent) fails.push(`${engineName}_post_hydrate_call_missing_${name}`);
      if (!k || !k.viaProtoPresent) fails.push(`${engineName}_post_hydrate_proto_missing_${name}`);
      if (!k || !k.memMatchesCall) fails.push(`${engineName}_post_hydrate_mem_ne_call_${name}`);
      if (!k || !k.memMatchesProto) fails.push(`${engineName}_post_hydrate_mem_ne_proto_${name}`);
      if (k && k.nativePlainPresent) fails.push(`${engineName}_post_hydrate_native_plaintext_${name}`);
      if (!k || k.syncReadStatus !== "PRESENT") fails.push(`${engineName}_post_hydrate_status_not_present_${name}`);
    }
    if (after.weatherUi && after.weatherUi.weatherUi && after.weatherUi.weatherUi.wouldShowFirstVisitDialog === true) {
      fails.push(`${engineName}_weather_first_visit_true_after_hydrate`);
    }

    await ctx2.close();
  } finally {
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function main() {
  const fails = [];
  const evidence = {};
  const skipped = [];
  staticChecks(fails);

  let server = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(9520, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    const engines = [];
    if (pw.chromium) engines.push(["chromium", pw.chromium, true]);
    if (pw.firefox) engines.push(["firefox", pw.firefox, false]);
    if (pw.webkit) engines.push(["webkit", pw.webkit, false]);

    for (const [name, bt, required] of engines) {
      try {
        await runEngine(bt, name, base, fails, evidence);
      } catch (err) {
        const msg = String(err && err.message ? err.message : err);
        const missingBrowser =
          /Executable doesn't exist/i.test(msg) ||
          /browserType\.launch/i.test(msg) ||
          /Target page, context or browser has been closed/i.test(msg);
        if (!required && missingBrowser) {
          skipped.push(`${name}:browser_unavailable`);
          evidence[name] = { skipped: true, reason: msg.slice(0, 120) };
          continue;
        }
        fails.push(`${name}_engine_error:${msg.slice(0, 160)}`);
      }
    }

    if (!evidence.chromium || evidence.chromium.skipped) {
      fails.push("chromium_required_missing");
    }

    const report = {
      IU_VAULT_POST_HYDRATE_PROTECTED_READ_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      marker: MARKER,
      fails,
      skipped,
      evidence,
      note:
        "Root cause class: localStorage.getItem instance monkey-patch is ignored on Firefox/WebKit; canonical fix patches Storage.prototype scoped to localStorage. Chromium is required in CI; Firefox/WebKit run when Playwright browsers are installed.",
    };
    console.log(JSON.stringify(report, null, 2));
    if (fails.length) process.exit(1);
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  } finally {
    if (server) await stopGuardProcess(server.proc || null);
  }
}

main();
