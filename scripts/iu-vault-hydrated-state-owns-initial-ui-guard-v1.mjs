#!/usr/bin/env node
/**
 * HYDRATED_STATE_OWNS_INITIAL_UI_GUARD
 *
 * Physical Safari post-#10122 class:
 * durable prefs IDB/MEM match, but UI must consume hydrated prefs after pageshow.
 *
 * Invariant: after hydrate + pageshow, live UI prefs struct-match vault memory
 * even if _prefsMem was poisoned with defaults.
 *
 * Run: node scripts/iu-vault-hydrated-state-owns-initial-ui-guard-v1.mjs
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
const MARKER = `IU_OWN_UI_${Date.now()}`;

function staticChecks(fails) {
  const core = fs.readFileSync(path.join(REPO, "assets", "iu-info-system-core-v1.js"), "utf8");
  if (!/__iuVaultHydrationComplete === true/.test(core)) {
    fails.push("getPrefs_missing_hydration_authoritative_resync");
  }
  if (!/addEventListener\("pageshow", clearPrefsMemCache\)/.test(core)) {
    fails.push("missing_pageshow_clearPrefsMemCache");
  }
  if (!/hydration_incomplete/.test(core)) {
    fails.push("missing_no_pin_before_hydrate");
  }
  const prehled = fs.readFileSync(path.join(REPO, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
  if (!/function restoreFeedQuickViewFromSession/.test(prehled)) {
    fails.push("missing_restoreFeedQuickViewFromSession");
  }
  if (!/function persistFeedQuickViewToSession/.test(prehled)) {
    fails.push("missing_persistFeedQuickViewToSession");
  }
  const diag = fs.readFileSync(path.join(REPO, "assets", "iu-vault-persistence-diag-v1.js"), "utf8");
  if (!/memStructFp/.test(diag)) {
    fails.push("diag_missing_memStructFp_apples_to_apples");
  }
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
        typeof window.__iuPrehledPrefsDiag.reapply === "function"
      ),
    null,
    { timeout: 90000 }
  );

  const seeded = await page.evaluate(
    async ({ payload }) => {
      const mod = await import(
        "/assets/iu-info-system-core-v1.js?v=evening-theme-settings-v1-20260818-perf-loop-iter001-parallel-boot-v1-20260819-perf-loop-iter003-core-dedupe-v1-20260820-chmi-asset-waterfall-v1-20260822"
      );
      const setPrefs = mod.setPrefs || (mod.default && mod.default.setPrefs);
      const awaitPrefsDurable =
        mod.awaitPrefsDurable || (mod.default && mod.default.awaitPrefsDurable);
      if (typeof setPrefs !== "function") return { ok: false, reason: "no_setPrefs" };
      setPrefs(payload);
      if (awaitPrefsDurable) await awaitPrefsDurable();
      else if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
        await window.iuVault.flushPendingWrites();
      }
      window.__iuPrehledPrefsDiag.reapply();
      const live = window.__iuPrehledPrefsDiag.getLivePrefs();
      return {
        ok: !!(live && String(live.searchQuery || "").includes(payload.searchQuery)),
      };
    },
    { payload: prefsPayload(MARKER) }
  );
  if (!seeded.ok) fails.push(`${viewportLabel}_seed_failed`);

  // Simulate post-hydrate default pin + pageshow (Safari physical class).
  const afterPageshow = await page.evaluate(async (marker) => {
    const mod = await import(
      "/assets/iu-info-system-core-v1.js?v=evening-theme-settings-v1-20260818-perf-loop-iter001-parallel-boot-v1-20260819-perf-loop-iter003-core-dedupe-v1-20260820-chmi-asset-waterfall-v1-20260822"
    );
    const getPrefs = mod.getPrefs || (mod.default && mod.default.getPrefs);
    // Poison UI snapshot to defaults (physical race class).
    if (window.__iuPrehledPrefsDiag && typeof window.__iuPrehledPrefsDiag.poisonDefaults === "function") {
      window.__iuPrehledPrefsDiag.poisonDefaults();
    }
    window.dispatchEvent(new Event("pageshow"));
    // Allow pageshow listeners (clearPrefsMemCache + reapply) to run.
    await new Promise((r) => setTimeout(r, 50));
    if (window.__iuPrehledPrefsDiag && typeof window.__iuPrehledPrefsDiag.reapply === "function") {
      window.__iuPrehledPrefsDiag.reapply();
    }
    const live = window.__iuPrehledPrefsDiag.getLivePrefs();
    const stateP = window.__iuPrehledPrefsDiag.getStatePrefs();
    const fromGet = typeof getPrefs === "function" ? getPrefs() : null;
    let memRaw = null;
    try {
      memRaw = localStorage.getItem("iu.infoEvents.prefs.v1");
    } catch (_) {}
    let memHas = false;
    try {
      const o = memRaw ? JSON.parse(memRaw) : null;
      memHas = !!(o && String(o.searchQuery || "").includes(marker));
    } catch (_) {}
    return {
      liveHas: !!(live && String(live.searchQuery || "").includes(marker)),
      stateHas: !!(stateP && String(stateP.searchQuery || "").includes(marker)),
      getHas: !!(fromGet && String(fromGet.searchQuery || "").includes(marker)),
      memHas,
    };
  }, MARKER);

  if (!afterPageshow.memHas) fails.push(`${viewportLabel}_mem_missing_marker`);
  if (!afterPageshow.getHas) fails.push(`${viewportLabel}_getPrefs_missing_marker_after_pageshow`);
  if (!afterPageshow.liveHas) fails.push(`${viewportLabel}_live_missing_marker_after_pageshow`);
  if (!afterPageshow.stateHas) fails.push(`${viewportLabel}_state_missing_marker_after_pageshow`);

  // Reload: durable → hydrate → UI must still own marker (not silent default).
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForVaultReady(page, 90000);
  await page.waitForFunction(
    () => window.__iuVaultHydrationComplete === true && window.__iuPrehledPrefsDiag,
    null,
    { timeout: 90000 }
  );
  const afterReload = await page.evaluate((marker) => {
    if (window.__iuPrehledPrefsDiag && typeof window.__iuPrehledPrefsDiag.reapply === "function") {
      window.__iuPrehledPrefsDiag.reapply();
    }
    const live = window.__iuPrehledPrefsDiag.getLivePrefs();
    const stateP = window.__iuPrehledPrefsDiag.getStatePrefs();
    let memRaw = null;
    try {
      memRaw = localStorage.getItem("iu.infoEvents.prefs.v1");
    } catch (_) {}
    let memHas = false;
    try {
      const o = memRaw ? JSON.parse(memRaw) : null;
      memHas = !!(o && String(o.searchQuery || "").includes(marker));
    } catch (_) {}
    return {
      liveHas: !!(live && String(live.searchQuery || "").includes(marker)),
      stateHas: !!(stateP && String(stateP.searchQuery || "").includes(marker)),
      memHas,
      reason: window.__iuPrehledPrefsAppliedReason || null,
    };
  }, MARKER);

  if (!afterReload.memHas) fails.push(`${viewportLabel}_reload_mem_missing`);
  if (!afterReload.liveHas) fails.push(`${viewportLabel}_reload_live_missing`);
  if (!afterReload.stateHas) fails.push(`${viewportLabel}_reload_state_missing`);
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(9440, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;
    browser = await chromium.launch({ headless: true });

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
        guard: "HYDRATED_STATE_OWNS_INITIAL_UI_GUARD",
        marker: MARKER,
        viewports: ["mobile", "desktop"],
        prefsKey: PREFS_KEY,
      },
      null,
      2
    )
  );
}

main();
