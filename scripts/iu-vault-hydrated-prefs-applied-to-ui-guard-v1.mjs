#!/usr/bin/env node
/**
 * HYDRATED_PREFS_APPLIED_TO_UI_GUARD
 *
 * Durable prefs may hydrate into vault memory while Prehled freezes state.prefs
 * once at boot. Invariant: after iu-vault-hydrated, UI state.prefs must match
 * live getPrefs() (poisoned defaults must be overwritten).
 *
 * Run: node scripts/iu-vault-hydrated-prefs-applied-to-ui-guard-v1.mjs
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

const PREFS_KEY = "iu.infoEvents.prefs.v1";
const MARKER = `IU_PREFS_UI_${Date.now()}`;

function staticChecks(fails) {
  const prehled = fs.readFileSync(path.join(REPO, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
  if (!/function reapplyPrefsFromStore/.test(prehled)) fails.push("missing_reapplyPrefsFromStore");
  if (!/function bindPrefsHydrationListeners/.test(prehled)) fails.push("missing_bindPrefsHydrationListeners");
  if (!/bindPrefsHydrationListeners\(\)/.test(prehled)) fails.push("boot_missing_bind_call");
  if (!/iu-vault-hydrated/.test(prehled)) fails.push("missing_iu_vault_hydrated_listener");
  if (!/iu\.infoEvents\.prefs\.v1/.test(prehled)) fails.push("missing_prefs_key_listener");
  // Bare timeout must not finish while hydration still pending.
  if (/setTimeout\(finish,\s*45000\)/.test(prehled)) fails.push("bare_hydration_timeout_finish");
  if (!/__iuPrehledPrefsDiag/.test(prehled)) fails.push("missing_prefs_diag_hook");
  if (!/poisonDefaults/.test(prehled)) fails.push("missing_poisonDefaults");
}

function prefsPayload(tag) {
  return {
    sections: ["doprava", "chmi"],
    sourceGroups: ["doprava"],
    sourceIds: [],
    lanes: [tag + "_LANE"],
    localities: [],
    homeKraj: tag + "_KRAJ",
    homeOkres: "",
    homeObec: tag + "_OBEC",
    localityQuery: "",
    feedFilter: { roads: [tag + "_ROAD"], chmi: { orpCodes: ["4242"] } },
    unreadOnly: false,
    savedOnly: false,
    favoritesOnly: false,
    searchQuery: tag,
  };
}

async function runViewport(page, base, viewportLabel, fails) {
  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await waitForVaultReady(page, 90000);
  await page.waitForFunction(
    () =>
      !!(
        window.__iuVaultHydrationComplete === true &&
        window.__iuPrehledPrefsDiag &&
        typeof window.__iuPrehledPrefsDiag.poisonDefaults === "function"
      ),
    null,
    { timeout: 90000 }
  );

  const seeded = await page.evaluate(
    async ({ prefsKey, payload }) => {
      const mod = await import(
        "/assets/iu-info-system-core-v1.js?v=evening-theme-settings-v1-20260818-perf-loop-iter001-parallel-boot-v1-20260819-perf-loop-iter003-core-dedupe-v1-20260820-chmi-asset-waterfall-v1-20260822"
      );
      const setPrefs = mod.setPrefs || (mod.default && mod.default.setPrefs);
      const awaitPrefsDurable = mod.awaitPrefsDurable || (mod.default && mod.default.awaitPrefsDurable);
      if (typeof setPrefs !== "function") return { liveHasMarker: false, reason: "no_setPrefs" };
      const ok = setPrefs(payload);
      if (awaitPrefsDurable) await awaitPrefsDurable();
      else if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
        await window.iuVault.flushPendingWrites();
      }
      // Sync Prehled state with live prefs before poison test.
      if (window.__iuPrehledPrefsDiag && typeof window.__iuPrehledPrefsDiag.reapply === "function") {
        window.__iuPrehledPrefsDiag.reapply();
      }
      const live = window.__iuPrehledPrefsDiag.getLivePrefs();
      return {
        setOk: ok !== false,
        liveHasMarker: !!(live && String(live.searchQuery || "").includes(payload.searchQuery)),
        prefsKey,
      };
    },
    { prefsKey: PREFS_KEY, payload: prefsPayload(MARKER) }
  );
  if (!seeded.liveHasMarker) fails.push(`${viewportLabel}_seed_live_missing_marker`);

  await page.evaluate(() => {
    window.__iuPrehledPrefsDiag.poisonDefaults();
  });
  const poisoned = await page.evaluate(() => {
    const sp = window.__iuPrehledPrefsDiag.getStatePrefs();
    return {
      poisoned: !!(sp && String(sp.searchQuery || "") === "__IU_PREFS_UI_POISON__"),
      searchQuery: sp ? String(sp.searchQuery || "") : null,
    };
  });
  if (!poisoned.poisoned) {
    fails.push(`${viewportLabel}_poison_failed`);
  }

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("iu-vault-hydrated", { detail: { source: "guard" } }));
  });
  await page.waitForFunction(
    (marker) => {
      try {
        const sp = window.__iuPrehledPrefsDiag && window.__iuPrehledPrefsDiag.getStatePrefs();
        return !!(sp && String(sp.searchQuery || "").includes(marker));
      } catch (_) {
        return false;
      }
    },
    MARKER,
    { timeout: 15000 }
  );

  const after = await page.evaluate((marker) => {
    const sp = window.__iuPrehledPrefsDiag.getStatePrefs();
    const live = window.__iuPrehledPrefsDiag.getLivePrefs();
    return {
      stateHas: !!(sp && String(sp.searchQuery || "").includes(marker)),
      liveHas: !!(live && String(live.searchQuery || "").includes(marker)),
      reason: window.__iuPrehledPrefsAppliedReason || null,
      appliedAt: window.__iuPrehledPrefsAppliedAt || null,
    };
  }, MARKER);

  if (!after.stateHas) fails.push(`${viewportLabel}_state_missing_marker_after_hydrate`);
  if (!after.liveHas) fails.push(`${viewportLabel}_live_missing_marker_after_hydrate`);
  if (!after.reason) fails.push(`${viewportLabel}_missing_applied_reason`);
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(9430, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;
    browser = await chromium.launch({ headless: true });

    // Mobile viewport (iOS-class failure surface)
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(90000);
    await runViewport(page, base, "mobile", fails);
    await closePlaywrightSession(page, context, null);
    context = null;
    page = null;

    // Desktop PC regression surface
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 1280, height: 800 },
      isMobile: false,
      hasTouch: false,
    });
    page = await context.newPage();
    page.setDefaultTimeout(90000);
    await runViewport(page, base, "desktop", fails);
  } catch (err) {
    fails.push("runtime_error:" + String((err && err.message) || err).slice(0, 200));
  } finally {
    await closePlaywrightSession(page, context, browser);
    if (server) await stopGuardProcess(server.proc || null);
  }

  if (fails.length) {
    console.log(JSON.stringify({ ok: false, fails }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        guard: "HYDRATED_PREFS_APPLIED_TO_UI_GUARD",
        marker: MARKER,
        viewports: ["mobile", "desktop"],
      },
      null,
      2
    )
  );
}

main();
