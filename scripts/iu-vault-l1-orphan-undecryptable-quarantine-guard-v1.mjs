#!/usr/bin/env node
/**
 * Physical PC regression: working MDK decrypts main records, but a historical
 * orphan infoEvents.alertState ciphertext (wrong/lost key) previously caused
 * fail_closed ls_migrate_verify_fail and blocked unlock of recoverable data.
 *
 * Topology mirrors physical CONFLICT_FORENSICS_READONLY_V1 evidence:
 * - notes/calendar/tasks decrypt OK under current MDK
 * - alertState IDB==LS ciphertext, both decrypt fail under current MDK
 * - prior fail_closed checkpoint reason=ls_migrate_verify_fail
 * - legacy backup present (does not decrypt the orphan)
 *
 * Expect: quarantine orphan, migration complete, SAME DATA for valid records,
 * no new MDK over orphan, no empty vault, no recovery screen.
 *
 * Run: node scripts/iu-vault-l1-orphan-undecryptable-quarantine-guard-v1.mjs
 */
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
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
const {
  encryptString,
  exportMdkRaw,
  bytesToB64,
  generateExtractableMdk,
} = await import(pathToFileURL(path.join(REPO, "assets/iu-vault-core-v1.js")).href);

const NOTE_KEY = "iu.notes.store.v1";
const CAL_KEY = "iu.calendar.store.v1";
const TASK_KEY = "iu.tasks.mvp.v1";
const ALERT_KEY = "iu.infoEvents.alertState.v1";
const ENC_PREFIX = "iu:vault:enc:v1:";
const ARCHIVE_PREFIX = "iu:vault:enc:conflict-archive:v1:";
const ORPHAN_IDB_PREFIX = "iu.vault.orphan.undecryptable.v1:";
const MIGRATION_ID = "l1-idb-only-v1";
const MARKER = `IU_ORPHAN_Q_${Date.now()}`;

function notePayload(tag) {
  return JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "n1", title: tag, body: "body", tags: [], createdAt: 1, updatedAt: 1 }],
  });
}

function calPayload(tag) {
  return JSON.stringify({
    schemaVersion: 1,
    events: [{ id: "c1", title: tag, start: "2026-08-28T10:00:00.000Z", end: "2026-08-28T11:00:00.000Z" }],
  });
}

function taskPayload(tag) {
  return JSON.stringify({
    schemaVersion: 1,
    tasks: [{ id: "t1", title: tag, done: false, createdAt: 1, updatedAt: 1 }],
  });
}

function alertPayload(tag) {
  return JSON.stringify({ seenIds: [tag], lastEvalAt: "2026-01-01T00:00:00.000Z", pending: [] });
}

async function waitBoot(page) {
  await page.waitForFunction(
    () => window.iuVault && typeof window.iuVault.getState === "function",
    null,
    { timeout: 90000 }
  );
  try {
    await waitForVaultReady(page, 90000);
  } catch (err) {
    const diag = await page.evaluate(async () => {
      let cp = null;
      try {
        const { readMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
        cp = await readMigrationCheckpoint("l1-idb-only-v1");
      } catch (_) {}
      return {
        state: window.iuVault && window.iuVault.getState ? window.iuVault.getState() : null,
        recovery: window.iuVault && window.iuVault.isStorageRecoveryRequired
          ? window.iuVault.isStorageRecoveryRequired()
          : null,
        cp,
      };
    });
    throw new Error(String(err && err.message ? err.message : err) + " DIAG=" + JSON.stringify(diag));
  }
}

async function seedPhysicalTopology(base, profile, { envNote, envCal, envTask, envAlert, backupB64, failClosed }) {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  await page.goto(`${base}?nosw=1&seed=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(
    async ({
      noteKey,
      calKey,
      taskKey,
      alertKey,
      envNote,
      envCal,
      envTask,
      envAlert,
      backupB64,
      encPrefix,
      migrationId,
      failClosed,
    }) => {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      const { writeKeyRecord, writeRecord, writeMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
      const { importMdkRaw, b64ToBytes } = await import("/assets/iu-vault-core-v1.js");
      const imported = await importMdkRaw(b64ToBytes(backupB64));
      await writeKeyRecord("mdk:level1", {
        type: "level1",
        mdk: imported,
        createdAt: new Date().toISOString(),
      });
      await writeRecord(noteKey, envNote);
      await writeRecord(calKey, envCal);
      await writeRecord(taskKey, envTask);
      // Simulate prior write-before-verify: identical undecryptable envelope in IDB + LS
      await writeRecord(alertKey, envAlert);
      localStorage.setItem(encPrefix + noteKey, JSON.stringify(envNote));
      localStorage.setItem(encPrefix + calKey, JSON.stringify(envCal));
      localStorage.setItem(encPrefix + taskKey, JSON.stringify(envTask));
      localStorage.setItem(encPrefix + alertKey, JSON.stringify(envAlert));
      localStorage.setItem("iu:vault:mdk-level1-backup:v1", backupB64);
      if (failClosed) {
        await writeMigrationCheckpoint(migrationId, {
          phase: "fail_closed",
          reason: "ls_migrate_verify_fail",
          key: alertKey,
          recordsDone: [noteKey, calKey, taskKey],
          recordsDoneCount: 3,
          resolvedMdk: null,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await writeMigrationCheckpoint(migrationId, { phase: "start", recordsDone: [] });
      }
    },
    {
      noteKey: NOTE_KEY,
      calKey: CAL_KEY,
      taskKey: TASK_KEY,
      alertKey: ALERT_KEY,
      envNote,
      envCal,
      envTask,
      envAlert,
      backupB64,
      encPrefix: ENC_PREFIX,
      migrationId: MIGRATION_ID,
      failClosed: !!failClosed,
    }
  );
  await ctx.close();
}

async function bootProof(base, profile, plains) {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  await page.goto(`${base}?nosw=1&boot=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitBoot(page);
  const proof = await page.evaluate(
    async ({ noteKey, calKey, taskKey, alertKey, encPrefix, archivePrefix, orphanPrefix, plains, migrationId }) => {
      const { readKeyRecord, readRecord, readMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
      const { decryptString } = await import("/assets/iu-vault-core-v1.js");
      const cp = await readMigrationCheckpoint(migrationId);
      const keyRec = await readKeyRecord("mdk:level1");
      async function dec(key) {
        const env = await readRecord(key);
        if (!keyRec || !keyRec.mdk || !env) return null;
        try {
          return await decryptString(keyRec.mdk, key, env);
        } catch (_) {
          return null;
        }
      }
      const notePt = await dec(noteKey);
      const calPt = await dec(calKey);
      const taskPt = await dec(taskKey);
      const alertActive = await readRecord(alertKey);
      const orphanArch = await readRecord(orphanPrefix + alertKey);
      const lsAlert = localStorage.getItem(encPrefix + alertKey);
      const lsArchive = localStorage.getItem(archivePrefix + alertKey);
      const screen = document.getElementById("iuVaultStorageRecoveryScreen");
      return {
        recovery: !!(window.iuVault.isStorageRecoveryRequired && window.iuVault.isStorageRecoveryRequired()),
        unlocked: !!(window.iuVault.getState && window.iuVault.getState().unlocked),
        migrationComplete: !!(cp && cp.phase === "complete"),
        failClosed: !!(cp && cp.phase === "fail_closed"),
        failReason: cp && cp.reason ? cp.reason : null,
        noteSame: notePt === plains.note,
        calSame: calPt === plains.cal,
        taskSame: taskPt === plains.task,
        alertActiveGone: !alertActive,
        alertLsGone: !lsAlert,
        orphanArchivePresent: !!(orphanArch && orphanArch.kind === "undecryptable_orphan"),
        lsArchivePresent: !!lsArchive,
        keyUsable: !!(keyRec && keyRec.mdk && keyRec.mdk instanceof CryptoKey),
        screenHidden: !screen || screen.hidden === true,
      };
    },
    {
      noteKey: NOTE_KEY,
      calKey: CAL_KEY,
      taskKey: TASK_KEY,
      alertKey: ALERT_KEY,
      encPrefix: ENC_PREFIX,
      archivePrefix: ARCHIVE_PREFIX,
      orphanPrefix: ORPHAN_IDB_PREFIX,
      plains,
      migrationId: MIGRATION_ID,
    }
  );
  await ctx.close();
  return proof;
}

async function main() {
  const fails = [];
  let server = null;
  const profiles = [];
  try {
    const migrateJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-l1-migrate-v1.js"), "utf8");
    if (!/orphan_undecryptable_quarantined/.test(migrateJs)) fails.push("static_missing_orphan_quarantine");
    if (!/iu\.vault\.orphan\.undecryptable\.v1:/.test(migrateJs)) fails.push("static_missing_orphan_archive_key");
    if (!/ls_migrate_verify_fail/.test(migrateJs) || !/RETRIABLE_FAIL_CLOSED/.test(migrateJs)) {
      fails.push("static_missing_retriable_ls_migrate");
    }
    if (!/Verify BEFORE write/.test(migrateJs)) fails.push("static_missing_verify_before_write");

    const started = await startGuardStaticServer(pickGuardPort(9310, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    const workingMdk = await generateExtractableMdk();
    const orphanMdk = await generateExtractableMdk();
    const plainNote = notePayload(MARKER + "_NOTE");
    const plainCal = calPayload(MARKER + "_CAL");
    const plainTask = taskPayload(MARKER + "_TASK");
    const plainAlert = alertPayload(MARKER + "_ALERT");
    const envNote = await encryptString(workingMdk, NOTE_KEY, plainNote);
    const envCal = await encryptString(workingMdk, CAL_KEY, plainCal);
    const envTask = await encryptString(workingMdk, TASK_KEY, plainTask);
    const envAlert = await encryptString(orphanMdk, ALERT_KEY, plainAlert);
    const backupB64 = bytesToB64(await exportMdkRaw(workingMdk));
    const plains = { note: plainNote, cal: plainCal, task: plainTask };

    const pFresh = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-orphan-fresh-"));
    profiles.push(pFresh);
    await seedPhysicalTopology(base, pFresh, {
      envNote,
      envCal,
      envTask,
      envAlert,
      backupB64,
      failClosed: false,
    });
    const fresh = await bootProof(base, pFresh, plains);
    const freshPass =
      fresh.recovery === false &&
      fresh.unlocked === true &&
      fresh.migrationComplete === true &&
      fresh.failClosed === false &&
      fresh.noteSame &&
      fresh.calSame &&
      fresh.taskSame &&
      fresh.alertActiveGone &&
      fresh.alertLsGone &&
      fresh.orphanArchivePresent &&
      fresh.lsArchivePresent &&
      fresh.keyUsable &&
      fresh.screenHidden;
    if (!freshPass) fails.push("FRESH_PHYSICAL_TOPOLOGY");

    const pRetry = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-orphan-retry-"));
    profiles.push(pRetry);
    await seedPhysicalTopology(base, pRetry, {
      envNote,
      envCal,
      envTask,
      envAlert,
      backupB64,
      failClosed: true,
    });
    const retry = await bootProof(base, pRetry, plains);
    const retryPass =
      retry.recovery === false &&
      retry.unlocked === true &&
      retry.migrationComplete === true &&
      retry.failClosed === false &&
      retry.noteSame &&
      retry.calSame &&
      retry.taskSame &&
      retry.alertActiveGone &&
      retry.orphanArchivePresent &&
      retry.keyUsable;
    if (!retryPass) fails.push("PRIOR_LS_MIGRATE_VERIFY_FAIL_RETRY");

    // Negative: pure orphan vault (no working MDK) must still fail-closed
    const pOrphan = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-orphan-pure-"));
    profiles.push(pOrphan);
    const onlyOrphan = await generateExtractableMdk();
    const envOnly = await encryptString(onlyOrphan, NOTE_KEY, plainNote);
    const ctxO = await chromium.launchPersistentContext(pOrphan, {
      headless: true,
      viewport: { width: 1280, height: 800 },
    });
    const pageO = await ctxO.newPage();
    await pageO.goto(`${base}?nosw=1&seed=orphan`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await pageO.evaluate(
      async ({ key, env, encPrefix, migrationId }) => {
        localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
        localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
        const { writeRecord, writeMigrationCheckpoint, deleteKeyRecord } = await import("/assets/iu-vault-db-v1.js");
        await deleteKeyRecord("mdk:level1").catch(() => {});
        await writeRecord(key, env);
        localStorage.setItem(encPrefix + key, JSON.stringify(env));
        localStorage.removeItem("iu:vault:mdk-level1-backup:v1");
        await writeMigrationCheckpoint(migrationId, { phase: "start", recordsDone: [] });
      },
      { key: NOTE_KEY, env: envOnly, encPrefix: ENC_PREFIX, migrationId: MIGRATION_ID }
    );
    await ctxO.close();
    const ctxO2 = await chromium.launchPersistentContext(pOrphan, {
      headless: true,
      viewport: { width: 1280, height: 800 },
    });
    const pageO2 = await ctxO2.newPage();
    await pageO2.goto(`${base}?nosw=1&boot=orphan`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await pageO2.waitForFunction(
      () =>
        !!(
          window.iuVault &&
          window.iuVault.isStorageRecoveryRequired &&
          window.iuVault.isStorageRecoveryRequired() === true
        ),
      null,
      { timeout: 90000 }
    );
    const pure = await pageO2.evaluate(async ({ migrationId }) => {
      const { readMigrationCheckpoint, readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
      const cp = await readMigrationCheckpoint(migrationId);
      const rec = await readKeyRecord("mdk:level1");
      return {
        recovery: !!(window.iuVault.isStorageRecoveryRequired && window.iuVault.isStorageRecoveryRequired()),
        unlocked: !!(window.iuVault.getState && window.iuVault.getState().unlocked),
        failClosed: !!(cp && cp.phase === "fail_closed"),
        newMdk: !!(rec && rec.mdk),
      };
    }, { migrationId: MIGRATION_ID });
    await ctxO2.close();
    const purePass = pure.recovery === true && pure.unlocked === false && pure.failClosed === true && pure.newMdk === false;
    if (!purePass) fails.push("PURE_ORPHAN_STILL_FAIL_CLOSED");

    const report = {
      IU_VAULT_L1_ORPHAN_UNDECRYPTABLE_QUARANTINE_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      marker: MARKER,
      fails,
      fresh,
      retry,
      pure,
      FRESH_PHYSICAL_TOPOLOGY: freshPass ? "PASS" : "FAIL",
      PRIOR_LS_MIGRATE_VERIFY_FAIL_RETRY: retryPass ? "PASS" : "FAIL",
      PURE_ORPHAN_STILL_FAIL_CLOSED: purePass ? "PASS" : "FAIL",
    };
    console.log(JSON.stringify(report, null, 2));
    if (fails.length) process.exit(1);
  } catch (err) {
    console.error(String(err && err.stack ? err.stack : err));
    process.exit(1);
  } finally {
    for (const p of profiles) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch (_) {}
    }
    if (server) await stopGuardProcess(server.proc || null);
  }
}

main();
