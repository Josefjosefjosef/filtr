#!/usr/bin/env node
/**
 * L1 no-security baseline cold-start guard.
 * Proves: without PIN, multi-module writes survive process restart,
 * and MDK survives simulated IDB key-store loss via localStorage backup.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import fs from "fs";
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

const MARKER = `IU_L1_BASE_${Date.now()}`;
const KEYS = {
  note: "iu.notes.store.v1",
  task: "iu.tasks.mvp.v1",
  cal: "iu.calendar.store.v1",
  parcel: "iu_silver_parcel_watch_v1",
  prefs: "iu.infoEvents.prefs.v1",
};

function staticChecks(fails) {
  const lockJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");
  if (!/LEVEL1_MDK_BACKUP_KEY/.test(lockJs)) fails.push("missing_level1_mdk_backup_key");
  if (!/restoreLevel1MdkFromBackup/.test(lockJs)) fails.push("missing_restore_from_backup");
  if (!/VAULT_MDK_ORPHAN_CIPHER/.test(lockJs)) fails.push("missing_orphan_cipher_guard");
}

function payloads(tag) {
  return {
    [KEYS.note]: JSON.stringify({ schemaVersion: 1, notes: [{ id: "n1", title: tag + "_NOTE", body: "b", tags: [], createdAt: 1, updatedAt: 1 }] }),
    [KEYS.task]: JSON.stringify({ schemaVersion: 1, tasks: [{ id: "t1", title: tag + "_TASK", status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }] }),
    [KEYS.cal]: JSON.stringify({ schemaVersion: 1, events: [{ id: "c1", title: tag + "_CAL", start: "2026-08-25T10:00:00", end: "2026-08-25T11:00:00" }] }),
    [KEYS.parcel]: JSON.stringify([{ id: "p1", number: tag + "_PARCEL", addedAt: Date.now() }]),
    [KEYS.prefs]: JSON.stringify({ sections: ["doprava", "chmi"], homeObec: tag + "_OBEC", feedFilter: { roads: [tag + "_ROAD"] } }),
  };
}

async function seedL1(page, tag) {
  return page.evaluate(async ({ data, marker }) => {
    const sec = await window.iuVault.getSecurityConfigured();
    if (sec.unlockMethod !== "none") return { ok: false, reason: "security_not_none:" + sec.unlockMethod };
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    await window.iuVault.flushPendingWrites();
    const backup = localStorage.getItem("iu:vault:mdk-level1-backup:v1");
    const out = { backup: !!backup };
    for (const k of Object.keys(data)) {
      out[k] = !!localStorage.getItem("iu:vault:enc:v1:" + k);
    }
    out.marker = marker;
    return { ok: true, out };
  }, { data: payloads(tag), marker: tag });
}

async function readMarkers(page, tag) {
  return page.evaluate(async ({ keys, marker }) => {
    const sec = await window.iuVault.getSecurityConfigured();
    const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
    const out = { unlockMethod: sec.unlockMethod, keys: {} };
    for (const [name, key] of Object.entries(keys)) {
      let raw = null;
      let err = null;
      try { raw = await vaultGetItem(key); } catch (e) { err = String(e.message || e); }
      const shim = localStorage.getItem(key);
      out.keys[name] = {
        vaultHas: raw != null && String(raw).includes(marker),
        shimHas: shim != null && String(shim).includes(marker),
        err,
      };
    }
    return out;
  }, { keys: KEYS, marker: tag });
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let page = null;
  let context = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(9160, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page = await context.newPage();
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page, 90000);
    await page.evaluate(() => {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    });
    const seed = await seedL1(page, MARKER);
    if (!seed.ok) fails.push(`seed:${seed.reason}`);
    else if (!seed.out.backup) fails.push("level1_mdk_backup_missing_after_save");

    await page.evaluate(async () => {
      const { deleteKeyRecord } = await import("/assets/iu-vault-db-v1.js");
      await deleteKeyRecord("mdk:level1");
    });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page, 90000);
    const after = await readMarkers(page, MARKER);
    if (after.unlockMethod !== "none") fails.push(`unlock_method:${after.unlockMethod}`);
    for (const name of ["note", "task", "cal", "parcel"]) {
      const rec = after.keys[name];
      if (!rec || !rec.vaultHas) fails.push(`mdk_restore_fail:${name}:${rec && rec.err ? rec.err : "no_marker"}`);
    }
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({ IU_VAULT_L1_BASELINE_COLDSTART_GUARD: pass ? "PASS" : "FAIL", marker: MARKER, fails }));
  if (!pass) {
    console.error("IU_VAULT_L1_BASELINE_COLDSTART_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_L1_BASELINE_COLDSTART_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
