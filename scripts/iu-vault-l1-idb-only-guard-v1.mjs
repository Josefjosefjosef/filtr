#!/usr/bin/env node
/**
 * L1 IDB-only + fail-closed + #10103 migration guard (A–I automated proofs).
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
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
const { decryptString, importMdkRaw, b64ToBytes, exportMdkRaw, bytesToB64, generateExtractableMdk, encryptString } =
  await import(pathToFileURL(path.join(REPO, "assets/iu-vault-core-v1.js")).href);

const MARKER = `IU_L1_IDB_${Date.now()}`;
const BACKUP_KEY = "iu:vault:mdk-level1-backup:v1";
const ENC_PREFIX = "iu:vault:enc:v1:";
const KEYS = {
  note: "iu.notes.store.v1",
  task: "iu.tasks.mvp.v1",
  cal: "iu.calendar.store.v1",
  parcel: "iu_silver_parcel_watch_v1",
  prefs: "iu.infoEvents.prefs.v1",
};

function payloads(tag) {
  return {
    [KEYS.note]: JSON.stringify({ schemaVersion: 1, notes: [{ id: "n1", title: tag + "_NOTE", body: "b", tags: [], createdAt: 1, updatedAt: 1 }] }),
    [KEYS.task]: JSON.stringify({ schemaVersion: 1, tasks: [{ id: "t1", title: tag + "_TASK", status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }] }),
    [KEYS.cal]: JSON.stringify({ schemaVersion: 1, events: [{ id: "c1", title: tag + "_CAL", start: "2026-08-25T10:00:00", end: "2026-08-25T11:00:00" }] }),
    [KEYS.parcel]: JSON.stringify([{ id: "p1", number: tag + "_PARCEL", addedAt: Date.now() }]),
    [KEYS.prefs]: JSON.stringify({ sections: ["doprava", "chmi"], homeObec: tag + "_OBEC", feedFilter: { roads: [tag + "_ROAD"] } }),
  };
}

function staticChecks(fails) {
  const storageJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  const lockJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");
  if (/nativeSetItem\(encStorageKey/.test(storageJs)) fails.push("storage_still_writes_ls_enc_mirror");
  if (!/VAULT_STORAGE_RECOVERY_REQUIRED/.test(lockJs)) fails.push("missing_fail_closed_constant");
  if (!/migrateL1ToIdbOnly/.test(lockJs)) fails.push("missing_l1_migration_call");
  if (!fs.existsSync(path.join(REPO, "assets", "iu-vault-l1-migrate-v1.js"))) fails.push("missing_l1_migrate_module");
}

async function acceptConsent(page) {
  await page.evaluate(() => {
    localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
    localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
  });
}

async function seedAndFlush(page, tag) {
  return page.evaluate(async ({ data }) => {
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    await window.iuVault.flushPendingWrites();
    return true;
  }, { data: payloads(tag) });
}

async function readModuleMarkers(page, tag) {
  return page.evaluate(async ({ keys, marker }) => {
    const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
    const out = {};
    for (const [name, key] of Object.entries(keys)) {
      let raw = null;
      let err = null;
      try {
        raw = await vaultGetItem(key);
      } catch (e) {
        err = String(e.message || e);
      }
      out[name] = { ok: raw != null && String(raw).includes(marker), err };
    }
    return out;
  }, { keys: KEYS, marker: tag });
}

async function lsSnapshotOnlyDecrypt(page, notesKey, encPrefix, backupKey) {
  const snap = await page.evaluate(({ notesKey, encPrefix, backupKey }) => {
    const enc = localStorage.getItem(encPrefix + notesKey);
    const backup = localStorage.getItem(backupKey);
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
    return { enc, backup, keys };
  }, { notesKey: KEYS.note, encPrefix: ENC_PREFIX, backupKey: BACKUP_KEY });

  let decrypted = false;
  let usedKey = null;
  if (snap.backup && snap.enc) {
    try {
      const mdk = await importMdkRaw(b64ToBytes(snap.backup));
      const env = JSON.parse(snap.enc);
      const pt = await decryptString(mdk, KEYS.note, env);
      decrypted = String(pt).includes(MARKER);
      usedKey = "raw_backup";
    } catch (_) {}
  }
  return {
    decrypted,
    usedKey,
    hasBackup: !!snap.backup,
    hasEncMirror: !!snap.enc,
    lsKeys: snap.keys.filter((k) => k.includes("vault") || k.includes("notes")),
    USED_RUNTIME_MEMORY: false,
    USED_LOCALSTORAGE: true,
    USED_INDEXEDDB: false,
    USED_NETWORK: false,
  };
}

async function waitForVaultBoot(page, expectRecovery = false) {
  await page.waitForFunction(
    (recovery) => {
      try {
        if (!window.iuVault) return false;
        if (recovery) return window.iuVault.isStorageRecoveryRequired() === true;
        return window.iuVault.getState().unlocked === true;
      } catch (_) {
        return false;
      }
    },
    expectRecovery,
    { timeout: 90000 }
  );
}
async function runColdContext(base, profileDir, tag) {
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${base}?nosw=1&cold=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await acceptConsent(page);
  await waitForVaultBoot(page, false);
  const markers = await readModuleMarkers(page, tag);
  const state = await page.evaluate(() => ({
    recovery: window.iuVault.isStorageRecoveryRequired(),
    backup: !!localStorage.getItem("iu:vault:mdk-level1-backup:v1"),
    encMirror: !!localStorage.getItem("iu:vault:enc:v1:" + "iu.notes.store.v1"),
  }));
  await ctx.close();
  return { markers, state };
}

async function main() {
  const results = {};
  const fails = [];
  staticChecks(fails);

  let server = null;
  let browser = null;
  let page = null;
  let context = null;

  try {
    const started = await startGuardStaticServer(pickGuardPort(9190, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    page = await context.newPage();
    await page.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(page, 90000);
    await acceptConsent(page);

    // E — brand new vault allowed
    const freshState = await page.evaluate(() => ({
      recovery: window.iuVault.isStorageRecoveryRequired(),
      unlocked: window.iuVault.getState().unlocked,
    }));
    results.E_brand_new_vault = freshState.recovery === false && freshState.unlocked === true ? "PASS" : "FAIL";

    // A + J — save multi-module, cold persistent context
    const profileA = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-l1-idb-a-"));
    const ctxA1 = await chromium.launchPersistentContext(profileA, {
      headless: true,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const pageA1 = await ctxA1.newPage();
    await pageA1.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(pageA1, 90000);
    await acceptConsent(pageA1);
    await seedAndFlush(pageA1, MARKER);
    await ctxA1.close();

    const cold = await runColdContext(base, profileA, MARKER);
    results.A_persistence = ["note", "task", "cal", "parcel", "prefs"].every((m) => cold.markers[m] && cold.markers[m].ok) ? "PASS" : "FAIL";
    results.J_module_preservation = results.A_persistence;
    if (results.A_persistence !== "PASS") fails.push("A_persistence");
    if (cold.state.backup) fails.push("raw_backup_still_present_after_migration");
    if (cold.state.encMirror) fails.push("ls_enc_mirror_still_present_after_migration");
    results.RAW_MDK_IN_LS = cold.state.backup ? "STILL PRESENT" : "REMOVED";
    results.LS_CIPHERTEXT_MIRROR = cold.state.encMirror ? "STILL PRESENT" : "REMOVED";

    // I — LS-only forensic (after migration in profileA)
    const ctxI = await chromium.launchPersistentContext(profileA, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pageI = await ctxI.newPage();
    await pageI.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const forensic = await lsSnapshotOnlyDecrypt(pageI, KEYS.note, ENC_PREFIX, BACKUP_KEY);
    results.I_ls_only = forensic.decrypted ? "FAIL" : "PASS";
    results.I_attacker = forensic;
    if (forensic.decrypted) fails.push("I_ls_only_decrypt_pass");
    await ctxI.close();

    // B — CryptoKey cold round-trip isolated profile
    const profileB = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-l1-idb-b-"));
    const ctxB1 = await chromium.launchPersistentContext(profileB, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pB1 = await ctxB1.newPage();
    await pB1.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await pB1.evaluate(async ({ marker, key }) => {
      const { generateMdk, encryptString } = await import("/assets/iu-vault-core-v1.js");
      const { writeKeyRecord, writeRecord } = await import("/assets/iu-vault-db-v1.js");
      const mdk = await generateMdk();
      await writeKeyRecord("mdk:level1", { type: "level1", mdk, createdAt: new Date().toISOString() });
      const payload = JSON.stringify({ schemaVersion: 1, notes: [{ id: "b1", title: marker, body: "x", tags: [], createdAt: 1, updatedAt: 1 }] });
      const env = await encryptString(mdk, key, payload);
      await writeRecord(key, env);
    }, { marker: MARKER + "_B", key: KEYS.note });
    await ctxB1.close();
    const ctxB2 = await chromium.launchPersistentContext(profileB, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pB2 = await ctxB2.newPage();
    await pB2.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const roundTrip = await pB2.evaluate(async ({ marker, key }) => {
      const { readKeyRecord, readRecord } = await import("/assets/iu-vault-db-v1.js");
      const { decryptString } = await import("/assets/iu-vault-core-v1.js");
      const rec = await readKeyRecord("mdk:level1");
      const env = await readRecord(key);
      if (!rec || !rec.mdk || !env) return { ok: false, reason: "missing" };
      try {
        const pt = await decryptString(rec.mdk, key, env);
        return { ok: String(pt).includes(marker), usable: rec.mdk instanceof CryptoKey, extractable: !!rec.mdk.extractable };
      } catch (e) {
        return { ok: false, reason: String(e.message || e) };
      }
    }, { marker: MARKER + "_B", key: KEYS.note });
    results.B_cryptokey_roundtrip = roundTrip.ok && roundTrip.usable && roundTrip.extractable === false ? "PASS" : "FAIL";
    if (results.B_cryptokey_roundtrip !== "PASS") fails.push("B_cryptokey_roundtrip");
    await ctxB2.close();

    // C — orphan ciphertext fail-closed
    context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
    page = await context.newPage();
    await page.goto(`${base}?nosw=1&orphan=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await acceptConsent(page);
    await page.evaluate(async ({ key, marker, encPrefix }) => {
      const { generateMdk, encryptString } = await import("/assets/iu-vault-core-v1.js");
      const { writeRecord, deleteKeyRecord } = await import("/assets/iu-vault-db-v1.js");
      const mdk = await generateMdk();
      const payload = JSON.stringify({ schemaVersion: 1, notes: [{ id: "o1", title: marker, body: "x", tags: [], createdAt: 1, updatedAt: 1 }] });
      const env = await encryptString(mdk, key, payload);
      await writeRecord(key, env);
      localStorage.setItem(encPrefix + key, JSON.stringify(env));
      await deleteKeyRecord("mdk:level1");
      localStorage.removeItem("iu:vault:mdk-level1-backup:v1");
    }, { key: KEYS.note, marker: MARKER + "_ORPHAN", encPrefix: ENC_PREFIX });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultBoot(page, true);
    const orphan = await page.evaluate(async ({ key }) => {
      const { readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
      const rec = await readKeyRecord("mdk:level1");
      return {
        recovery: window.iuVault.isStorageRecoveryRequired(),
        newMdkGenerated: !!(rec && rec.mdk),
        unlocked: window.iuVault.getState().unlocked,
      };
    }, { key: KEYS.note });
    results.C_orphan_fail_closed =
      orphan.recovery === true && orphan.unlocked === false ? "PASS" : "FAIL";
    if (results.C_orphan_fail_closed !== "PASS") fails.push("C_orphan_fail_closed");

    // D — unusable key record
    await page.evaluate(async ({ key, marker, encPrefix }) => {
      const { writeKeyRecord, writeRecord } = await import("/assets/iu-vault-db-v1.js");
      const { generateMdk, encryptString } = await import("/assets/iu-vault-core-v1.js");
      const mdk = await generateMdk();
      const payload = JSON.stringify({ schemaVersion: 1, notes: [{ id: "d1", title: marker, body: "x", tags: [], createdAt: 1, updatedAt: 1 }] });
      const env = await encryptString(mdk, key, payload);
      await writeRecord(key, env);
      localStorage.setItem(encPrefix + key, JSON.stringify(env));
      await writeKeyRecord("mdk:level1", { type: "level1", mdk: null, createdAt: "x" });
      localStorage.removeItem("iu:vault:mdk-level1-backup:v1");
    }, { key: KEYS.note + ":d", marker: MARKER + "_BADKEY", encPrefix: ENC_PREFIX });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultBoot(page, true);
    const badKey = await page.evaluate(() => ({
      recovery: window.iuVault.isStorageRecoveryRequired(),
      unlocked: window.iuVault.getState().unlocked,
    }));
    results.D_unusable_key_fail_closed = badKey.recovery === true && badKey.unlocked === false ? "PASS" : "FAIL";
    if (results.D_unusable_key_fail_closed !== "PASS") fails.push("D_unusable_key_fail_closed");

    // G — #10103 scenario B: backup only valid key
    const profileG = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-l1-idb-g-"));
    const ctxG1 = await chromium.launchPersistentContext(profileG, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pG1 = await ctxG1.newPage();
    await pG1.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const mdkExt = await generateExtractableMdk();
    const payloadG = payloads(MARKER + "_G")[KEYS.note];
    const envG = await encryptString(mdkExt, KEYS.note, payloadG);
    const rawG = await exportMdkRaw(mdkExt);
    await pG1.evaluate(async ({ key, env, backupB64, encPrefix }) => {
      const { writeRecord } = await import("/assets/iu-vault-db-v1.js");
      await writeRecord(key, env);
      localStorage.setItem(encPrefix + key, JSON.stringify(env));
      localStorage.setItem("iu:vault:mdk-level1-backup:v1", backupB64);
    }, { key: KEYS.note, env: envG, backupB64: bytesToB64(rawG), encPrefix: ENC_PREFIX });
    await ctxG1.close();
    const ctxG2 = await chromium.launchPersistentContext(profileG, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pG2 = await ctxG2.newPage();
    await pG2.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(pG2, 90000);
    await acceptConsent(pG2);
    const gRead = await readModuleMarkers(pG2, MARKER + "_G");
    const gState = await pG2.evaluate(() => ({
      backup: !!localStorage.getItem("iu:vault:mdk-level1-backup:v1"),
      enc: !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1"),
      recovery: window.iuVault.isStorageRecoveryRequired(),
    }));
    results.G_10103_scenario_B = gRead.note && gRead.note.ok && !gState.recovery && !gState.backup && !gState.enc ? "PASS" : "FAIL";
    if (results.G_10103_scenario_B !== "PASS") fails.push("G_10103_scenario_B");
    await ctxG2.close();

    // F — #10103 scenario A: valid IDB MDK + backup
    const profileF = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-l1-idb-f-"));
    const ctxF1 = await chromium.launchPersistentContext(profileF, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pF1 = await ctxF1.newPage();
    await pF1.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(pF1, 90000);
    await acceptConsent(pF1);
    await seedAndFlush(pF1, MARKER + "_F");
    const backupB64 = await pF1.evaluate(() => localStorage.getItem("iu:vault:mdk-level1-backup:v1"));
    if (!backupB64) {
      const mdk = await generateExtractableMdk();
      const raw = await exportMdkRaw(mdk);
      await pF1.evaluate((b64) => localStorage.setItem("iu:vault:mdk-level1-backup:v1", b64), bytesToB64(raw));
    }
    await ctxF1.close();
    const ctxF2 = await chromium.launchPersistentContext(profileF, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pF2 = await ctxF2.newPage();
    await pF2.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(pF2, 90000);
    const fRead = await readModuleMarkers(pF2, MARKER + "_F");
    const fState = await pF2.evaluate(() => ({
      backup: !!localStorage.getItem("iu:vault:mdk-level1-backup:v1"),
      enc: !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1"),
      recovery: window.iuVault.isStorageRecoveryRequired(),
    }));
    results.F_10103_scenario_A = fRead.note && fRead.note.ok && !fState.recovery ? "PASS" : "FAIL";
    if (fState.backup) results.F_backup_removed = "STILL PRESENT";
    else results.F_backup_removed = "REMOVED";
    if (results.F_10103_scenario_A !== "PASS") fails.push("F_10103_scenario_A");
    await ctxF2.close();

    // H — migration interruption idempotency
    const profileH = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-l1-idb-h-"));
    const ctxH1 = await chromium.launchPersistentContext(profileH, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pH1 = await ctxH1.newPage();
    await pH1.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    const mdkH = await generateExtractableMdk();
    const envH = await encryptString(mdkH, KEYS.note, payloads(MARKER + "_H")[KEYS.note]);
    const rawH = await exportMdkRaw(mdkH);
    await pH1.evaluate(async ({ key, env, backupB64, encPrefix }) => {
      const { writeRecord, writeMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
      await writeRecord(key, env);
      localStorage.setItem(encPrefix + key, JSON.stringify(env));
      localStorage.setItem("iu:vault:mdk-level1-backup:v1", backupB64);
      await writeMigrationCheckpoint("l1-idb-only-v1", {
        phase: "records_reconciled",
        recordsDone: [key],
        resolvedMdk: "legacy_backup",
        updatedAt: new Date().toISOString(),
      });
    }, { key: KEYS.note, env: envH, backupB64: bytesToB64(rawH), encPrefix: ENC_PREFIX });
    await ctxH1.close();
    const ctxH2 = await chromium.launchPersistentContext(profileH, { headless: true, viewport: { width: 390, height: 844 }, isMobile: true });
    const pH2 = await ctxH2.newPage();
    await pH2.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForVaultReady(pH2, 90000);
    const hRead = await readModuleMarkers(pH2, MARKER + "_H");
    results.H_migration_interruption = hRead.note && hRead.note.ok ? "PASS" : "FAIL";
    if (results.H_migration_interruption !== "PASS") fails.push("H_migration_interruption");
    await ctxH2.close();
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
    try {
      fs.rmSync(profileA, { recursive: true, force: true });
    } catch (_) {}
  }

  const pass = fails.length === 0;
  const report = {
    IU_VAULT_L1_IDB_ONLY_GUARD: pass ? "PASS" : "FAIL",
    marker: MARKER,
    results,
    fails,
    IDB_ONLY: results.A_persistence === "PASS" ? "PASS" : "FAIL",
    FAIL_CLOSED: results.C_orphan_fail_closed === "PASS" && results.D_unusable_key_fail_closed === "PASS" ? "PASS" : "FAIL",
  };
  console.log(JSON.stringify(report, null, 2));
  if (!pass) {
    console.error("IU_VAULT_L1_IDB_ONLY_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_L1_IDB_ONLY_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
