#!/usr/bin/env node
/**
 * Regression: legacy IDB≠LS same-MDK conflict must open with IDB authority
 * (not recovery screen), archive LS, and retry prior fail_closed conflict_idb_ls.
 * Run: node scripts/iu-vault-conflict-idb-ls-compat-guard-v1.mjs
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
const { encryptString, exportMdkRaw, bytesToB64, generateExtractableMdk } =
  await import(pathToFileURL(path.join(REPO, "assets/iu-vault-core-v1.js")).href);

const NOTE_KEY = "iu.notes.store.v1";
const ENC_PREFIX = "iu:vault:enc:v1:";
const ARCHIVE_PREFIX = "iu:vault:enc:conflict-archive:v1:";
const ARCHIVE_IDB_PREFIX = "iu.vault.conflict.archive.v1:";
const MIGRATION_ID = "l1-idb-only-v1";
const MARKER = `IU_CONFLICT_COMPAT_${Date.now()}`;

function notePayload(tag) {
  return JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "n1", title: tag, body: "body", tags: [], createdAt: 1, updatedAt: 1 }],
  });
}

async function waitBoot(page) {
  await page.waitForFunction(
    () => window.iuVault && typeof window.iuVault.getState === "function",
    null,
    { timeout: 90000 }
  );
  await waitForVaultReady(page, 90000);
}

async function seed(base, profile, { envA, envB, backupB64, failClosed }) {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${base}?nosw=1&seed=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate(
    async ({ key, envA, envB, backupB64, encPrefix, migrationId, failClosed }) => {
      const { writeKeyRecord, writeRecord, writeMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
      const { importMdkRaw, b64ToBytes } = await import("/assets/iu-vault-core-v1.js");
      const imported = await importMdkRaw(b64ToBytes(backupB64));
      await writeKeyRecord("mdk:level1", { type: "level1", mdk: imported, createdAt: new Date().toISOString() });
      await writeRecord(key, envA);
      localStorage.setItem(encPrefix + key, JSON.stringify(envB));
      localStorage.setItem("iu:vault:mdk-level1-backup:v1", backupB64);
      if (failClosed) {
        await writeMigrationCheckpoint(migrationId, {
          phase: "fail_closed",
          reason: "conflict_idb_ls",
          key,
          recordsDone: [],
          updatedAt: new Date().toISOString(),
        });
      } else {
        await writeMigrationCheckpoint(migrationId, { phase: "start", recordsDone: [] });
      }
    },
    {
      key: NOTE_KEY,
      envA,
      envB,
      backupB64,
      encPrefix: ENC_PREFIX,
      migrationId: MIGRATION_ID,
      failClosed: !!failClosed,
    }
  );
  await ctx.close();
}

async function bootProof(base, profile, plainA, plainB) {
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${base}?nosw=1&boot=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitBoot(page);
  const proof = await page.evaluate(
    async ({ key, encPrefix, archiveIdbPrefix, plainA, plainB, migrationId }) => {
      const { readKeyRecord, readRecord, readMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
      const { decryptString } = await import("/assets/iu-vault-core-v1.js");
      const cp = await readMigrationCheckpoint(migrationId);
      const keyRec = await readKeyRecord("mdk:level1");
      const idbEnv = await readRecord(key);
      const lsRaw = localStorage.getItem(encPrefix + key);
      const archiveIdbKey = archiveIdbPrefix + key;
      const archiveIdbEnv = await readRecord(archiveIdbKey);
      let idbPt = null;
      let archiveIdbPt = null;
      if (keyRec && keyRec.mdk && idbEnv) {
        try {
          idbPt = await decryptString(keyRec.mdk, key, idbEnv);
        } catch (_) {}
      }
      if (keyRec && keyRec.mdk && archiveIdbEnv) {
        try {
          archiveIdbPt = await decryptString(keyRec.mdk, archiveIdbKey, archiveIdbEnv);
        } catch (_) {}
      }
      const screen = document.getElementById("iuVaultStorageRecoveryScreen");
      return {
        recovery: !!(window.iuVault.isStorageRecoveryRequired && window.iuVault.isStorageRecoveryRequired()),
        unlocked: !!(window.iuVault.getState && window.iuVault.getState().unlocked),
        migrationComplete: !!(cp && cp.phase === "complete"),
        failClosed: !!(cp && cp.phase === "fail_closed"),
        idbIsA: idbPt === plainA,
        archiveIsB: archiveIdbPt === plainB,
        activeLsGone: !lsRaw,
        idbArchivePresent: !!archiveIdbEnv,
        screenHidden: !screen || screen.hidden === true,
      };
    },
    {
      key: NOTE_KEY,
      encPrefix: ENC_PREFIX,
      archiveIdbPrefix: ARCHIVE_IDB_PREFIX,
      plainA,
      plainB,
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
    const storageJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
    if (!/idb_preferred_divergent_ls/.test(migrateJs)) fails.push("static_missing_idb_preferred");
    if (!/conflict-archive:v1/.test(migrateJs)) fails.push("static_missing_conflict_archive");
    if (!/RETRIABLE_FAIL_CLOSED/.test(migrateJs)) fails.push("static_missing_retriable");
    if (/if \(await isL1IdbMigrationComplete\(\)\)/.test(storageJs)) {
      fails.push("storage_still_gates_ls_enc_remove_on_migration");
    }

    const started = await startGuardStaticServer(pickGuardPort(9300, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    const mdk = await generateExtractableMdk();
    const plainA = notePayload(MARKER + "_IDB");
    const plainB = notePayload(MARKER + "_LS");
    const envA = await encryptString(mdk, NOTE_KEY, plainA);
    const envB = await encryptString(mdk, NOTE_KEY, plainB);
    const backupB64 = bytesToB64(await exportMdkRaw(mdk));

    const p1 = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-conf-fresh-"));
    profiles.push(p1);
    await seed(base, p1, { envA, envB, backupB64, failClosed: false });
    const fresh = await bootProof(base, p1, plainA, plainB);
    const freshPass =
      fresh.recovery === false &&
      fresh.unlocked === true &&
      fresh.migrationComplete === true &&
      fresh.failClosed === false &&
      fresh.idbIsA &&
      fresh.activeLsGone &&
      fresh.idbArchivePresent &&
      fresh.archiveIsB &&
      fresh.screenHidden;
    if (!freshPass) fails.push("FRESH_DIVERGENT_UPGRADE");

    const p2 = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-conf-retry-"));
    profiles.push(p2);
    await seed(base, p2, { envA, envB, backupB64, failClosed: true });
    const retry = await bootProof(base, p2, plainA, plainB);
    const retryPass =
      retry.recovery === false &&
      retry.unlocked === true &&
      retry.migrationComplete === true &&
      retry.failClosed === false &&
      retry.idbIsA &&
      retry.activeLsGone &&
      retry.idbArchivePresent &&
      retry.archiveIsB;
    if (!retryPass) fails.push("PRIOR_FAIL_CLOSED_RETRY");

    const report = {
      IU_VAULT_CONFLICT_IDB_LS_COMPAT_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      marker: MARKER,
      fails,
      fresh,
      retry,
      FRESH_DIVERGENT_UPGRADE: freshPass ? "PASS" : "FAIL",
      PRIOR_FAIL_CLOSED_RETRY: retryPass ? "PASS" : "FAIL",
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
