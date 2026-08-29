#!/usr/bin/env node
/**
 * Static + smoke: lifecycle SAVE→RELOAD→REOPEN diagnostic is wired and callable.
 * Run: node scripts/iu-vault-lifecycle-save-reopen-diag-guard-v1.mjs
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

async function main() {
  const fails = [];
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const diag = fs.readFileSync(path.join(REPO, "assets", "iu-vault-persistence-diag-v1.js"), "utf8");
    const boot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
    const overlay = fs.readFileSync(path.join(REPO, "assets", "iu-vault-physical-diag-overlay-v1.js"), "utf8");
    const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
    const sw = fs.readFileSync(path.join(REPO, "sw.js"), "utf8");

    if (!/LIFECYCLE_SAVE_REOPEN_TRACE_V1/.test(diag)) fails.push("diag_missing_tag");
    if (!/export async function captureLifecycleSaveReopenTrace/.test(diag)) fails.push("diag_missing_export");
    if (!/independentReadbackSame/.test(diag)) fails.push("diag_missing_readback");
    if (!/keyRecordPresent/.test(diag)) fails.push("diag_missing_key_path");
    if (!/captureLifecycleSaveReopenTrace/.test(boot)) fails.push("boot_missing_api");
    if (!/iuLifecycleDiag/.test(overlay)) fails.push("overlay_missing_mode");
    if (!/lifeAfterSave|lifeAfterReload|lifeAfterReopen/.test(overlay)) fails.push("overlay_missing_buttons");
    if (!/iu-vault-physical-diag-overlay-v1\.js/.test(index)) fails.push("index_missing_overlay");
    if (!/iu-vault-key-path-atomic-v1-20260829|iu-vault-hydrated-prefs-ui-v1-20260829|iu-vault-lifecycle-diag-v1-20260829/.test(index)) fails.push("index_missing_cache_bust");
    if (!/2026-08-29-iu-vault-key-path-atomic-v1|2026-08-29-iu-vault-hydrated-prefs-ui-v1|2026-08-29-iu-vault-lifecycle-diag-v1/.test(sw)) fails.push("sw_missing_cache_version");
    if (!/2026-08-29-iu-vault-key-path-atomic-v1/.test(sw)) fails.push("sw_missing_key_path_atomic_version");
    if (!/prefsUi/.test(diag)) fails.push("diag_missing_prefsUi");
    if (!/moduleSaveTrace/.test(diag)) fails.push("diag_missing_moduleSaveTrace");
    if (!/durableMaterialUsable/.test(diag)) fails.push("diag_missing_durableMaterialUsable");
    if (!/iuKeyPathDiag/.test(overlay)) fails.push("overlay_missing_keypath_mode");

    const started = await startGuardStaticServer(pickGuardPort(9420, 400));
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    page = await context.newPage();
    await page.goto(
      `http://127.0.0.1:${started.port}/projects/?nosw=1&iuLifecycleDiag=1&cb=${Date.now()}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await waitForVaultReady(page, 60000);
    await page.waitForFunction(
      () =>
        !!(
          window.iuVault &&
          typeof window.iuVault.captureLifecycleSaveReopenTrace === "function" &&
          document.getElementById("iuPersistDiagOverlay")
        ),
      null,
      { timeout: 60000 }
    );

    const MARKER = `IU_LIFE_${Date.now()}`;
    await page.evaluate(async (marker) => {
      const prefs = JSON.stringify({
        sections: ["doprava"],
        sourceGroups: [],
        sourceIds: [],
        lanes: [],
        localities: [],
        homeKraj: "",
        homeOkres: "",
        homeObec: marker,
        localityQuery: marker,
        feedFilter: { roads: [marker], chmi: { orpCodes: [] } },
        unreadOnly: false,
        savedOnly: false,
        favoritesOnly: false,
        searchQuery: marker,
      });
      window.__iuVaultUserWriteDepth = 1;
      try {
        const ret = localStorage.setItem("iu.infoEvents.prefs.v1", prefs);
        if (ret && ret.then) await ret;
      } finally {
        window.__iuVaultUserWriteDepth = 0;
      }
      await window.iuVault.flushPendingWrites();
    }, MARKER);

    const afterSave = await page.evaluate(async () => {
      return window.iuVault.captureLifecycleSaveReopenTrace("AFTER_SAVE");
    });
    if (!afterSave || afterSave.tag !== "LIFECYCLE_SAVE_REOPEN_TRACE_V1") fails.push("runtime_bad_tag");
    if (!(afterSave && afterSave.phase === "AFTER_SAVE")) fails.push("runtime_bad_phase");
    const prefsProbe =
      afterSave && Array.isArray(afterSave.probes)
        ? afterSave.probes.find((p) => p && p.key === "iu.infoEvents.prefs.v1")
        : null;
    if (!(prefsProbe && prefsProbe.idbPresent)) fails.push("runtime_prefs_idb_missing");
    if (!(prefsProbe && prefsProbe.independentReadbackSame === true)) fails.push("runtime_readback_not_same");
    if (!(afterSave && afterSave.origin)) fails.push("runtime_origin_missing");
    if (typeof afterSave.keyRecordPresent !== "boolean") fails.push("runtime_key_record_missing");

    const report = {
      IU_VAULT_LIFECYCLE_SAVE_REOPEN_DIAG_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      fails,
      sample: {
        tag: afterSave && afterSave.tag,
        phase: afterSave && afterSave.phase,
        platform: afterSave && afterSave.platform,
        displayMode: afterSave && afterSave.displayMode,
        prefsIdb: !!(prefsProbe && prefsProbe.idbPresent),
        readback: prefsProbe && prefsProbe.independentReadbackSame,
        firstDiff: afterSave && afterSave.firstDiff,
      },
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
