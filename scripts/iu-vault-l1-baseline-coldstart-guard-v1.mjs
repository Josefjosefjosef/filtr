#!/usr/bin/env node
/**
 * L1 no-security baseline cold-start guard (IDB-only architecture).
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

const MARKER = `IU_L1_BASE_${Date.now()}`;
const KEYS = {
  note: "iu.notes.store.v1",
  task: "iu.tasks.mvp.v1",
  cal: "iu.calendar.store.v1",
  parcel: "iu_silver_parcel_watch_v1",
  prefs: "iu.infoEvents.prefs.v1",
};

function staticChecks(fails) {
  const storageJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  if (/nativeSetItem\(encStorageKey/.test(storageJs)) fails.push("storage_still_writes_ls_enc_mirror");
  if (!fs.existsSync(path.join(REPO, "assets", "iu-vault-l1-migrate-v1.js"))) fails.push("missing_l1_migrate_module");
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

async function readMarkers(page, tag) {
  return page.evaluate(async ({ keys, marker }) => {
    const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
    const out = { unlockMethod: (await window.iuVault.getSecurityConfigured()).unlockMethod, keys: {} };
    for (const [name, key] of Object.entries(keys)) {
      let raw = null;
      let err = null;
      try {
        raw = await vaultGetItem(key);
      } catch (e) {
        err = String(e.message || e);
      }
      out.keys[name] = { vaultHas: raw != null && String(raw).includes(marker), err };
    }
    return out;
  }, { keys: KEYS, marker: tag });
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  const profile = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-l1-base-"));

  try {
    const started = await startGuardStaticServer(pickGuardPort(9160, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    const ctx1 = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page1 = await ctx1.newPage();
    await page1.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page1, 90000);
    await page1.evaluate(() => {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    });
    await page1.evaluate(async ({ data }) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
      await window.iuVault.flushPendingWrites();
    }, { data: payloads(MARKER) });
    await ctx1.close();

    const ctx2 = await chromium.launchPersistentContext(profile, {
      headless: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page2 = await ctx2.newPage();
    await page2.goto(`${base}?nosw=1&cold=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page2, 90000);
    const after = await readMarkers(page2, MARKER);
    if (after.unlockMethod !== "none") fails.push(`unlock_method:${after.unlockMethod}`);
    for (const name of ["note", "task", "cal", "parcel", "prefs"]) {
      const rec = after.keys[name];
      if (!rec || !rec.vaultHas) fails.push(`cold_persist_fail:${name}:${rec && rec.err ? rec.err : "no_marker"}`);
    }
    const lsState = await page2.evaluate(() => ({
      backup: !!localStorage.getItem("iu:vault:mdk-level1-backup:v1"),
      enc: !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1"),
    }));
    if (lsState.backup) fails.push("raw_backup_present");
    if (lsState.enc) fails.push("ls_enc_mirror_present");
    await ctx2.close();
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await stopGuardProcess(server && server.proc ? server.proc : null);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (_) {}
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({ IU_VAULT_L1_BASELINE_COLDSTART_GUARD: pass ? "PASS" : "FAIL", marker: MARKER, fails }));
  if (!pass) {
    console.error("IU_VAULT_L1_BASELINE_COLDSTART_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_L1_BASELINE_COLDSTART_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
