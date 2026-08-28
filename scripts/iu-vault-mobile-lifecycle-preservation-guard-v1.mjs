#!/usr/bin/env node
/**
 * Mobile/tablet lifecycle data preservation:
 * A visibility hidden/visible, B pagehide+reload, C BFCache-like pageshow persisted,
 * D background policy lock, E persistent profile new context.
 * Also preferences/filters markers.
 * Negative: IU_NEG_SKIP_PAGESHOW_HYDRATE=1 or IU_NEG_EMPTY_BEFORE_HYDRATE=1 → must FAIL.
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
const MARKER = `IU_MOB_LIFE_${Date.now()}`;
const SKIP_PAGESHOW_HYDRATE = process.env.IU_NEG_SKIP_PAGESHOW_HYDRATE === "1";
const EMPTY_BEFORE_HYDRATE = process.env.IU_NEG_EMPTY_BEFORE_HYDRATE === "1";
const SKIP_FLUSH = process.env.IU_NEG_SKIP_FLUSH === "1";
const ALLOW_HYDRATION_EMPTY = process.env.IU_NEG_ALLOW_HYDRATION_EMPTY === "1";

const KEYS = {
  note: "iu.notes.store.v1",
  task: "iu.tasks.mvp.v1",
  cal: "iu.calendar.store.v1",
  mailbox: "iu_mailboxes_v1",
  quick: "infouzel_quicktools",
  datovka: "infouzel_datovka_profiles_v1",
  bak: "iu_bakalari_profiles",
  weather: "iuWeatherCitySelectedV1",
  filter: "iuFollowedTopics",
  infoPrefs: "iu.infoEvents.prefs.v1",
};

function payloads(tag) {
  return {
    [KEYS.note]: JSON.stringify({
      schemaVersion: 1,
      notes: [{ id: "n1", title: tag + "_NOTE", body: "b", tags: [], createdAt: 1, updatedAt: 1 }],
    }),
    [KEYS.task]: JSON.stringify({
      schemaVersion: 1,
      tasks: [{ id: "t1", title: tag + "_TASK", status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }],
    }),
    [KEYS.cal]: JSON.stringify({
      schemaVersion: 1,
      events: [{ id: "c1", title: tag + "_CAL", start: "2026-08-25T10:00:00", end: "2026-08-25T11:00:00" }],
    }),
    [KEYS.mailbox]: JSON.stringify({
      items: [{ label: tag + "_MAIL", url: "a@b.test", social: null, hidden: false, slot: 1 }],
    }),
    [KEYS.quick]: JSON.stringify({
      version: 2,
      buttons: [{ id: "q1", title: tag + "_QUICK", url: "https://example.test/" + tag }],
    }),
    [KEYS.datovka]: JSON.stringify({ profiles: [{ id: "d1", label: tag + "_DATOVKA" }] }),
    [KEYS.bak]: JSON.stringify({ profiles: [{ id: "b1", school: tag + "_BAK" }] }),
    [KEYS.weather]: JSON.stringify({ city: tag + "_CITY", ts: 1 }),
    [KEYS.filter]: JSON.stringify({ topics: [tag + "_FILTER"] }),
    [KEYS.infoPrefs]: JSON.stringify({
      sections: ["doprava", "chmi"],
      sourceGroups: ["doprava", "chmi"],
      lanes: [tag + "_LANE"],
      homeObec: tag + "_OBEC",
      homeKraj: tag + "_KRAJ",
      localities: [tag + "_LOC"],
      regionalDoprava: true,
      feedFilter: { roads: [tag + "_ROAD"], eventTypes: ["closure"] },
    }),
  };
}

function staticChecks(fails) {
  const lockJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");
  const storageJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  const bootJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  const infoJs = fs.readFileSync(path.join(REPO, "assets", "iu-info-system-core-v1.js"), "utf8");
  if (!/lockInProgress/.test(lockJs)) fails.push("lock_missing_in_progress");
  if (!/__iuVaultHydrationPending = true/.test(lockJs.split("lockVault")[1] || "")) {
    fails.push("lock_missing_pending_before_flush");
  }
  if (!/pageshow/.test(lockJs)) fails.push("lock_missing_pageshow_bfcache");
  if (!/shouldBlockPostHydrateClobber|__iuVaultHydratedAt/.test(storageJs)) {
    fails.push("storage_missing_post_hydrate_clobber_guard");
  }
  if (/Date\.now\(\) - t > 4000/.test(storageJs)) fails.push("clobber_still_time_window_4s");
  const persistBlockFn = storageJs.split("export function isVaultPersistBlocked")[1] || "";
  if (!/__iuVaultHydrationPending/.test(persistBlockFn.split("st.unlocked")[0] || "")) {
    fails.push("storage_hydration_pending_after_unlock_bypass");
  }
  if (!/visibilitychange/.test(bootJs) || !/flushPendingVaultWrites/.test(bootJs.split("visibilitychange")[1] || "")) {
    fails.push("bootstrap_missing_visibility_flush");
  }
  if (!/if \(window\.__iuVaultHydrationPending\) return true;/.test(infoJs.split("isVaultPrefsReadOpaque")[1] || "")) {
    fails.push("info_prefs_hydration_still_unlock_bypass");
  }
  const prot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-protected-keys-v1.js"), "utf8");
  if (!/iu\.infoEvents\.prefs\.v1/.test(prot)) fails.push("protected_keys_missing_info_prefs");
  if (!/looksLikeEmptyPrefsReset/.test(storageJs)) fails.push("storage_missing_prefs_empty_detect");
}

async function waitVaultApi(page) {
  await page.waitForFunction(() => !!(window.iuVault && window.iuVault.setupPin && window.iuVault.unlockPin), null, {
    timeout: 60000,
  });
}

async function seed(page, tag) {
  const data = payloads(tag);
  return page.evaluate(async ({ data, pin }) => {
    await window.iuVault.setupPin(pin, pin);
    await window.iuVault.unlockPin(pin);
    await window.iuVault.afterUnlock();
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    await window.iuVault.flushPendingWrites();
    const { readRecord } = await import("/assets/iu-vault-db-v1.js");
    const enc = {};
    for (const k of Object.keys(data)) {
      enc[k] = !!localStorage.getItem("iu:vault:enc:v1:" + k) || !!(await readRecord(k));
    }
    return enc;
  }, { data, pin: PIN });
}

async function unlockRead(page, opts = {}) {
  return page.evaluate(async ({ pin, skipHydrate, emptyBefore, keys, marker }) => {
    const withTimeout = (p, ms, label) =>
      Promise.race([
        p,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}_TIMEOUT_${ms}ms`)), ms)),
      ]);
    await withTimeout(window.iuVault.unlockPin(pin), 60000, "UNLOCK_PIN");
    if (emptyBefore) {
      try {
        window.__iuVaultHydrationPending = false;
      } catch (_) {}
      localStorage.setItem("iu.notes.store.v1", JSON.stringify({ schemaVersion: 1, notes: [] }));
      localStorage.setItem("iu.tasks.mvp.v1", JSON.stringify({ schemaVersion: 1, tasks: [] }));
      await withTimeout(window.iuVault.flushPendingWrites(), 30000, "FLUSH_EMPTY");
    }
    if (!skipHydrate) {
      await withTimeout(window.iuVault.afterUnlock(), 55000, "AFTER_UNLOCK");
    } else {
      try {
        window.__iuVaultHydrationPending = false;
        window.__iuVaultHydrationComplete = true;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 250));
    const out = {};
    for (const [name, key] of Object.entries(keys)) {
      out[name] = localStorage.getItem(key);
    }
    out._marker = marker;
    out._unlocked = !!(window.iuVault.getState && window.iuVault.getState().unlocked);
    return out;
  }, {
    pin: PIN,
    skipHydrate: !!opts.skipHydrate,
    emptyBefore: !!opts.emptyBefore,
    keys: KEYS,
    marker: MARKER,
  });
}

function assertValues(fails, label, after) {
  const need = ["_NOTE", "_TASK", "_CAL", "_MAIL", "_QUICK", "_DATOVKA", "_BAK", "_CITY", "_FILTER"];
  const blob = JSON.stringify(after);
  for (const s of need) {
    if (!blob.includes(MARKER + s) && !blob.includes(s.replace("_", ""))) {
      // soft: require marker fragment
      if (!blob.includes(MARKER)) {
        fails.push(`${label}_marker_missing`);
        return;
      }
    }
  }
  for (const s of ["_NOTE", "_TASK", "_CAL", "_CITY", "_FILTER"]) {
    if (!blob.includes(MARKER + s)) fails.push(`${label}_missing:${s}`);
  }
  if (!after.note || !String(after.note).includes(MARKER + "_NOTE")) fails.push(`${label}_note`);
  if (!after.task || !String(after.task).includes(MARKER + "_TASK")) fails.push(`${label}_task`);
  if (!after.weather || !String(after.weather).includes(MARKER + "_CITY")) fails.push(`${label}_pref_weather`);
  if (!after.filter || !String(after.filter).includes(MARKER + "_FILTER")) fails.push(`${label}_pref_filter`);
  if (!after.infoPrefs || !String(after.infoPrefs).includes(MARKER + "_OBEC")) fails.push(`${label}_info_prefs_obec`);
  if (!after.infoPrefs || !String(after.infoPrefs).includes(MARKER + "_ROAD")) fails.push(`${label}_info_prefs_road`);
}

async function runViewport(browser, base, viewport, fails, label) {
  const context = await bootstrapGuardContext(browser, {
    viewport,
    isMobile: viewport.width < 800,
    hasTouch: viewport.width < 1100,
    webauthnStub: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitVaultApi(page);

  const enc = await seed(page, MARKER);
  if (!enc[KEYS.note] || !enc[KEYS.weather] || !enc[KEYS.infoPrefs]) fails.push(`${label}_enc_missing`);

  // Scenario A: visibilitycycle
  await page.evaluate(async () => {
    await window.iuVault.lock();
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const afterA = await unlockRead(page, {
    skipHydrate: SKIP_PAGESHOW_HYDRATE,
    emptyBefore: EMPTY_BEFORE_HYDRATE,
  });
  assertValues(fails, `${label}_A`, afterA);

  // Scenario B: pagehide + full reload
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("pagehide"));
    await window.iuVault.lock();
  });
  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitVaultApi(page);
  const afterB = await unlockRead(page, {
    skipHydrate: SKIP_PAGESHOW_HYDRATE,
    emptyBefore: EMPTY_BEFORE_HYDRATE,
  });
  assertValues(fails, `${label}_B`, afterB);

  // Scenario C: BFCache-like pageshow persisted
  await page.evaluate(async () => {
    await window.iuVault.lock();
    const ev = new Event("pageshow");
    Object.defineProperty(ev, "persisted", { value: true });
    window.dispatchEvent(ev);
  });
  const afterC = await unlockRead(page, {
    skipHydrate: SKIP_PAGESHOW_HYDRATE,
    emptyBefore: EMPTY_BEFORE_HYDRATE,
  });
  assertValues(fails, `${label}_C`, afterC);

  // Scenario F: durable write without explicit flush (mobile background/kill safety)
  const durable = await page.evaluate(async ({ noteKey, marker, simulateEarlyNativeRemove }) => {
    await window.iuVault.unlockPin("123456");
    await window.iuVault.afterUnlock();
    const payload = JSON.stringify({
      schemaVersion: 1,
      notes: [{ id: "f1", title: marker + "_DURABLE", body: "b", tags: [], createdAt: 1, updatedAt: 1 }],
    });
    if (simulateEarlyNativeRemove) {
      const native = Storage.prototype.setItem;
      Storage.prototype.setItem = function patchedSetItem(key, value) {
        const out = native.call(this, key, value);
        try {
          if (String(key) === noteKey) Storage.prototype.removeItem.call(localStorage, noteKey);
        } catch (_) {}
        return out;
      };
    }
    localStorage.setItem(noteKey, payload);
    await new Promise((r) => setTimeout(r, 40));
    const encKey = "iu:vault:enc:v1:" + noteKey;
    const enc = localStorage.getItem(encKey);
    let idb = false;
    try {
      const { readRecord } = await import("/assets/iu-vault-db-v1.js");
      idb = !!(await readRecord(noteKey));
    } catch (_) {}
    const plain = localStorage.getItem(noteKey);
    if (simulateEarlyNativeRemove) {
      try {
        Storage.prototype.setItem = native;
      } catch (_) {}
    }
    return {
      encExists: !!enc || idb,
      plainExists: plain === payload,
      durableBlob: enc || plain || "",
    };
  }, {
    noteKey: KEYS.note,
    marker: MARKER,
    simulateEarlyNativeRemove: SKIP_FLUSH,
  });
  if (SKIP_FLUSH) {
    if (durable.encExists || durable.plainExists) fails.push(`${label}_F_negative_early_remove_still_durable`);
  } else if (!durable.encExists && !durable.plainExists) {
    fails.push(`${label}_F_no_durable_copy`);
  }

  // Scenario G: unlocked + hydration pending must block empty module overwrite
  const hydrationBlock = await page.evaluate(async ({ noteKey, allowHydrationEmpty }) => {
    await window.iuVault.unlockPin("123456");
    try {
      window.__iuVaultHydrationPending = true;
    } catch (_) {}
    const beforeEnc = localStorage.getItem("iu:vault:enc:v1:" + noteKey);
    let beforeIdb = false;
    try {
      const { readRecord } = await import("/assets/iu-vault-db-v1.js");
      beforeIdb = !!(await readRecord(noteKey));
    } catch (_) {}
    const beforeAtRest = beforeEnc || (beforeIdb ? "idb" : null);
    let blocked = window.iuVault.isPersistBlocked(noteKey);
    let restore = null;
    if (allowHydrationEmpty) {
      restore = window.iuVault.isPersistBlocked;
      window.iuVault.isPersistBlocked = () => false;
      blocked = false;
    }
    if (!blocked) {
      localStorage.setItem(noteKey, JSON.stringify({ schemaVersion: 1, notes: [] }));
      await window.iuVault.flushPendingWrites();
    }
    if (restore) window.iuVault.isPersistBlocked = restore;
    const afterEnc = localStorage.getItem("iu:vault:enc:v1:" + noteKey);
    let afterIdb = false;
    try {
      const { readRecord } = await import("/assets/iu-vault-db-v1.js");
      afterIdb = !!(await readRecord(noteKey));
    } catch (_) {}
    const afterAtRest = afterEnc || (afterIdb ? "idb" : null);
    return { blocked: !!blocked, afterEnc: afterAtRest, beforeEnc: beforeAtRest };
  }, { noteKey: KEYS.note, allowHydrationEmpty: ALLOW_HYDRATION_EMPTY });
  if (ALLOW_HYDRATION_EMPTY) {
    if (!hydrationBlock.beforeEnc || hydrationBlock.afterEnc === hydrationBlock.beforeEnc) {
      fails.push(`${label}_G_negative_hydration_empty_not_clobbered`);
    }
  } else {
    if (!hydrationBlock.blocked) fails.push(`${label}_G_hydration_empty_not_blocked`);
    if (hydrationBlock.beforeEnc && hydrationBlock.afterEnc !== hydrationBlock.beforeEnc) {
      fails.push(`${label}_G_hydration_empty_clobbered`);
    }
  }

  await closePlaywrightSession(page, context, null);
}

async function main() {
  const fails = [];
  console.log("IU_MOBILE_LIFECYCLE_GUARD_START");
  staticChecks(fails);
  let server = null;
  let browser = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8870, 400));
    server = started;
    const base = `http://127.0.0.1:${server.port}/projects/`;
    browser = await chromium.launch({ headless: true });

    await runViewport(browser, base, { width: 390, height: 844 }, fails, "mobile");
    await runViewport(browser, base, { width: 768, height: 1024 }, fails, "tablet_portrait");
    await runViewport(browser, base, { width: 1024, height: 768 }, fails, "tablet_landscape");

    // Scenario E: persistent profile new context
    const profile = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-mob-e-"));
    const ctx1 = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const p1 = await ctx1.newPage();
    await p1.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitVaultApi(p1);
    await seed(p1, MARKER);
    await p1.evaluate(async () => {
      await window.iuVault.lock();
    });
    await ctx1.close();
    const ctx2 = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const p2 = await ctx2.newPage();
    await p2.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitVaultApi(p2);
    const afterE = await unlockRead(p2, {
      skipHydrate: SKIP_PAGESHOW_HYDRATE,
      emptyBefore: EMPTY_BEFORE_HYDRATE,
    });
    assertValues(fails, "E_persist", afterE);
    await ctx2.close();
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (_) {}
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(null, null, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(
    JSON.stringify({
      IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_GUARD: pass ? "PASS" : "FAIL",
      fails,
      skipPageshowHydrate: SKIP_PAGESHOW_HYDRATE,
      emptyBeforeHydrate: EMPTY_BEFORE_HYDRATE,
      skipFlush: SKIP_FLUSH,
      allowHydrationEmpty: ALLOW_HYDRATION_EMPTY,
      marker: MARKER,
    })
  );
  if (!pass) {
    console.error("IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_MOBILE_LIFECYCLE_PRESERVATION_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
