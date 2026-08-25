#!/usr/bin/env node
/**
 * Doprava/ČHMÚ prefs must survive L3 lock → background → unlock.
 * Negative: IU_NEG_FORCE_EMPTY_PREFS=1 writes default prefs before hydrate → must FAIL.
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
const MARKER = `IU_FILT_${Date.now()}`;
const FORCE_EMPTY = process.env.IU_NEG_FORCE_EMPTY_PREFS === "1";
const PREFS_KEY = "iu.infoEvents.prefs.v1";

function staticChecks(fails) {
  const prot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-protected-keys-v1.js"), "utf8");
  if (!prot.includes(PREFS_KEY)) fails.push("prefs_not_protected");
  const storage = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  if (!/looksLikeEmptyPrefsReset/.test(storage)) fails.push("missing_prefs_clobber_detect");
  if (!/isVaultUserWriteActive/.test(storage)) fails.push("missing_user_write_active");
}

async function waitVaultApi(page) {
  await page.waitForFunction(() => !!(window.iuVault && window.iuVault.setupPin && window.iuVault.unlockPin), null, {
    timeout: 60000,
  });
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8880, 400));
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
    await waitVaultApi(page);

    const seeded = await page.evaluate(async ({ pin, marker, prefsKey }) => {
      const prefs = {
        sections: ["doprava", "chmi"],
        sourceGroups: ["doprava", "chmi"],
        lanes: [marker + "_LANE"],
        homeObec: marker + "_OBEC",
        homeKraj: marker + "_KRAJ",
        localities: [marker + "_LOC"],
        regionalDoprava: true,
        feedFilter: { roads: [marker + "_ROAD"], eventTypes: ["closure"] },
      };
      await window.iuVault.setupPin(pin, pin);
      await window.iuVault.unlockPin(pin);
      await window.iuVault.afterUnlock();
      localStorage.setItem(prefsKey, JSON.stringify(prefs));
      await window.iuVault.flushPendingWrites();
      const enc = !!localStorage.getItem("iu:vault:enc:v1:" + prefsKey);
      await window.iuVault.lock();
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pagehide"));
      return { enc };
    }, { pin: PIN, marker: MARKER, prefsKey: PREFS_KEY });

    if (!seeded.enc) fails.push("prefs_enc_missing");

    await page.goto(`http://127.0.0.1:${server.port}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitVaultApi(page);

    const after = await page.evaluate(async ({ pin, prefsKey, forceEmpty }) => {
      await window.iuVault.unlockPin(pin);
      if (forceEmpty) {
        try {
          window.__iuVaultHydrationPending = false;
        } catch (_) {}
        localStorage.setItem(
          prefsKey,
          JSON.stringify({
            sections: [],
            sourceGroups: [],
            lanes: [],
            homeObec: "",
            homeKraj: "",
            localities: [],
            feedFilter: null,
          })
        );
        await window.iuVault.flushPendingWrites();
      }
      await window.iuVault.afterUnlock();
      await new Promise((r) => setTimeout(r, 300));
      // Simulate late empty write after hydrate (mobile module init).
      localStorage.setItem(
        prefsKey,
        JSON.stringify({
          sections: [],
          sourceGroups: [],
          lanes: [],
          homeObec: "",
          homeKraj: "",
          localities: [],
          feedFilter: null,
        })
      );
      await window.iuVault.flushPendingWrites();
      return localStorage.getItem(prefsKey);
    }, { pin: PIN, prefsKey: PREFS_KEY, forceEmpty: FORCE_EMPTY });

    if (!after || !String(after).includes(MARKER + "_OBEC")) fails.push("prefs_obec_lost");
    if (!after || !String(after).includes(MARKER + "_ROAD")) fails.push("prefs_road_lost");
    if (!after || !String(after).includes("doprava")) fails.push("prefs_doprava_lost");
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({
    IU_VAULT_FILTERS_PREFS_PRESERVATION_GUARD: pass ? "PASS" : "FAIL",
    fails,
    forceEmpty: FORCE_EMPTY,
    marker: MARKER,
  }));
  if (!pass) {
    console.error("IU_VAULT_FILTERS_PREFS_PRESERVATION_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_FILTERS_PREFS_PRESERVATION_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
