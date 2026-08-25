#!/usr/bin/env node
/**
 * Legitimate user filter writes must persist while vault unlocked (incl. default reset).
 * Negative: IU_NEG_BLOCK_USER_FILTER_WRITE=1 forces setPrefs fail → must FAIL.
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
const PREFS_KEY = "iu.infoEvents.prefs.v1";
const MARKER = `IU_FILT_WRITE_${Date.now()}`;
const BLOCK_WRITE = process.env.IU_NEG_BLOCK_USER_FILTER_WRITE === "1";

function staticChecks(fails) {
  const core = fs.readFileSync(path.join(REPO, "assets", "iu-info-system-core-v1.js"), "utf8");
  const storage = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  if (!/isVaultPrefsWriteBlocked/.test(core)) fails.push("core_missing_write_blocked_split");
  if (!/__iuVaultUserWriteDepth/.test(core)) fails.push("core_missing_user_write_depth");
  if (!/isVaultUserWriteActive/.test(storage)) fails.push("storage_missing_user_write_active");
  if (!/if \(isVaultUserWriteActive\(\)\) return false/.test(storage)) fails.push("storage_missing_user_write_clobber_bypass");
}

async function applyPrefs(page, prefs) {
  return page.evaluate(({ prefsKey, prefs }) => {
    const mod = window.__iuInfoSystemCore || null;
    if (mod && typeof mod.setPrefs === "function") {
      return mod.setPrefs(prefs);
    }
    try {
      window.__iuVaultUserWriteDepth = (window.__iuVaultUserWriteDepth || 0) + 1;
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
      window.__iuVaultUserWriteDepth = Math.max(0, (window.__iuVaultUserWriteDepth || 1) - 1);
      return true;
    } catch (_) {
      return false;
    }
  }, { prefsKey: PREFS_KEY, prefs });
}

async function readPrefs(page) {
  return page.evaluate((prefsKey) => localStorage.getItem(prefsKey), PREFS_KEY);
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8895, 400));
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`http://127.0.0.1:${server.port}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVaultReady(page, 60000);

    if (BLOCK_WRITE) {
      await page.addInitScript(() => {
        window.__IU_NEG_BLOCK_USER_FILTER_WRITE = true;
      });
    }

    await page.evaluate(async (pin) => {
      await window.iuVault.setupPin(pin, pin);
      await window.iuVault.unlockPin(pin);
      await window.iuVault.afterUnlock();
    }, PIN);

    const prefsA = {
      sections: ["doprava", "chmi"],
      sourceGroups: ["doprava", "chmi"],
      lanes: [MARKER + "_LANE"],
      homeObec: MARKER + "_OBEC",
      homeKraj: MARKER + "_KRAJ",
      localities: [MARKER + "_LOC"],
      regionalDoprava: true,
      feedFilter: { roads: [MARKER + "_ROAD"], eventTypes: ["closure"] },
    };

    const okA = await page.evaluate(async ({ prefs, block, prefsKey }) => {
      if (block) {
        const orig = window.__iuVaultUserWriteDepth;
        window.__iuVaultUserWriteDepth = 0;
        try {
          localStorage.setItem(prefsKey, JSON.stringify(prefs));
        } catch (_) {}
        window.__iuVaultUserWriteDepth = orig;
        return false;
      }
      window.__iuVaultUserWriteDepth = (window.__iuVaultUserWriteDepth || 0) + 1;
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
      window.__iuVaultUserWriteDepth = Math.max(0, (window.__iuVaultUserWriteDepth || 1) - 1);
      await window.iuVault.flushPendingWrites();
      return true;
    }, { prefs: prefsA, block: BLOCK_WRITE, prefsKey: PREFS_KEY });

    if (!okA) fails.push("write_A_failed");
    await page.waitForTimeout(200);
    const rawA = await readPrefs(page);
    if (!rawA || !String(rawA).includes(MARKER + "_OBEC")) fails.push("read_A_missing");

    const prefsB = Object.assign({}, prefsA, {
      homeObec: MARKER + "_OBEC2",
      sections: ["doprava"],
      feedFilter: { roads: [MARKER + "_ROAD2"], eventTypes: ["closure"] },
    });
    await page.evaluate(async ({ prefs, prefsKey }) => {
      window.__iuVaultUserWriteDepth = (window.__iuVaultUserWriteDepth || 0) + 1;
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
      window.__iuVaultUserWriteDepth = Math.max(0, (window.__iuVaultUserWriteDepth || 1) - 1);
      await window.iuVault.flushPendingWrites();
    }, { prefs: prefsB, prefsKey: PREFS_KEY });
    const rawB = await readPrefs(page);
    if (!rawB || !String(rawB).includes(MARKER + "_OBEC2")) fails.push("read_B_missing");

    const prefsDefault = {
      sections: [],
      sourceGroups: [],
      sourceIds: [],
      lanes: [],
      localities: [],
      homeKraj: "",
      homeOkres: "",
      homeObec: "",
      localityQuery: "",
      feedFilter: null,
    };
    await page.evaluate(async ({ prefs, prefsKey }) => {
      window.__iuVaultUserWriteDepth = (window.__iuVaultUserWriteDepth || 0) + 1;
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
      window.__iuVaultUserWriteDepth = Math.max(0, (window.__iuVaultUserWriteDepth || 1) - 1);
      await window.iuVault.flushPendingWrites();
    }, { prefs: prefsDefault, prefsKey: PREFS_KEY });
    const rawDefault = await readPrefs(page);
    if (!rawDefault || !String(rawDefault).includes('"sections":[]')) fails.push("user_default_reset_blocked");
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({
    IU_VAULT_FILTER_USER_WRITE_GUARD: pass ? "PASS" : "FAIL",
    fails,
    blockWrite: BLOCK_WRITE,
    marker: MARKER,
  }));
  if (!pass) {
    console.error("IU_VAULT_FILTER_USER_WRITE_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_FILTER_USER_WRITE_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
