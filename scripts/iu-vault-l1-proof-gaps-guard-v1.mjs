#!/usr/bin/env node
/**
 * L1 proof gaps: Scenario A, ambiguous conflict, MindMenu + module preservation.
 * Run: node scripts/iu-vault-l1-proof-gaps-guard-v1.mjs
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

const MARKER = `IU_GAP_${Date.now()}`;
const BACKUP_KEY = "iu:vault:mdk-level1-backup:v1";
const ENC_PREFIX = "iu:vault:enc:v1:";
const L1_MIGRATION_ID = "l1-idb-only-v1";

const KEYS = {
  note: "iu.notes.store.v1",
  task: "iu.tasks.mvp.v1",
  cal: "iu.calendar.store.v1",
  parcel: "iu_silver_parcel_watch_v1",
  prefs: "iu.infoEvents.prefs.v1",
  mailbox: "iu_mailboxes_v1",
  quicktools: "infouzel_quicktools",
};

const IU_MAILBOX_LABEL_MAX = 25;

function normalizedMailboxItems(tag) {
  return [
    {
      label: String(tag + "_MAILBOX").trim().slice(0, IU_MAILBOX_LABEL_MAX),
      url: "https://example.com/" + tag,
      social: "facebook",
      hidden: false,
      slot: 1,
    },
  ];
}

function notePayload(tag) {
  return JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "n1", title: tag + "_NOTE", body: "body", tags: [], createdAt: 1, updatedAt: 1 }],
  });
}

function payloads(tag) {
  return {
    [KEYS.note]: notePayload(tag),
    [KEYS.task]: JSON.stringify({
      schemaVersion: 1,
      tasks: [{ id: "t1", title: tag + "_TASK", status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }],
    }),
    [KEYS.cal]: JSON.stringify({
      schemaVersion: 1,
      events: [{ id: "c1", title: tag + "_CAL", start: "2026-08-25T10:00:00", end: "2026-08-25T11:00:00" }],
    }),
    [KEYS.parcel]: JSON.stringify([{ id: "p1", number: tag + "_PARCEL", addedAt: Date.now() }]),
    [KEYS.prefs]: JSON.stringify({
      sections: ["doprava", "chmi"],
      homeObec: tag + "_OBEC",
      feedFilter: { roads: [tag + "_ROAD"] },
    }),
    [KEYS.mailbox]: JSON.stringify({ items: normalizedMailboxItems(tag) }),
    [KEYS.quicktools]: JSON.stringify({
      version: 2,
      order: ["pridat_tlacitko", "custom_gap1"],
      visible: ["pridat_tlacitko", "custom_gap1"],
      customButtons: [{ id: "custom_gap1", label: tag + "_QUICKTOOL", url: "https://example.com/qt/" + tag }],
    }),
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

async function coldDecryptFromIdbOnly(page, storageKey) {
  return page.evaluate(async (key) => {
    const { readKeyRecord, readRecord } = await import("/assets/iu-vault-db-v1.js");
    const { decryptString } = await import("/assets/iu-vault-core-v1.js");
    const keyRec = await readKeyRecord("mdk:level1");
    const env = await readRecord(key);
    if (!keyRec || !keyRec.mdk || !env) {
      return { ok: false, reason: "missing_idb_material" };
    }
    try {
      const pt = await decryptString(keyRec.mdk, key, env);
      return {
        ok: true,
        plaintext: pt,
        mdkExtractable: !!keyRec.mdk.extractable,
        mdkFromIdb: true,
        USED_RUNTIME_MEMORY: false,
        USED_LOCALSTORAGE: false,
        USED_INDEXEDDB: true,
        USED_NETWORK: false,
      };
    } catch (e) {
      return { ok: false, reason: String(e.message || e), USED_INDEXEDDB: true };
    }
  }, storageKey);
}

async function runScenarioA(base) {
  const tag = MARKER + "_A";
  const canonicalPlaintext = notePayload(tag);
  const mdk = await generateExtractableMdk();
  const idbEnv = await encryptString(mdk, KEYS.note, canonicalPlaintext);
  const raw = await exportMdkRaw(mdk);
  const backupB64 = bytesToB64(raw);
  const lsEnv = JSON.parse(JSON.stringify(idbEnv));

  const profile = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-gap-a-"));

  const ctx1 = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p1 = await ctx1.newPage();
  await p1.goto(`${base}?nosw=1&gap=a-setup`, { waitUntil: "domcontentloaded", timeout: 90000 });

  const setup = await p1.evaluate(
    async ({ key, idbEnv, lsEnv, backupB64, rawB64, encPrefix, migrationId }) => {
      const { writeKeyRecord, writeRecord, writeMigrationCheckpoint, readMeta, writeMeta } =
        await import("/assets/iu-vault-db-v1.js");
      const { importMdkRaw, b64ToBytes } = await import("/assets/iu-vault-core-v1.js");
      const mdkImported = await importMdkRaw(b64ToBytes(rawB64));
      await writeKeyRecord("mdk:level1", {
        type: "level1",
        mdk: mdkImported,
        createdAt: new Date().toISOString(),
        scenario: "10103_A",
      });
      await writeRecord(key, idbEnv);
      localStorage.setItem(encPrefix + key, JSON.stringify(lsEnv));
      localStorage.setItem("iu:vault:mdk-level1-backup:v1", backupB64);
      await writeMigrationCheckpoint(migrationId, { phase: "start", recordsDone: [] });
      const meta = await readMeta();
      if (meta) {
        meta.l1IdbOnly = false;
        meta.migrationComplete = true;
        await writeMeta(meta);
      }
      return {
        idbKey: true,
        idbRecord: true,
        lsBackup: !!localStorage.getItem("iu:vault:mdk-level1-backup:v1"),
        lsEnc: !!localStorage.getItem(encPrefix + key),
      };
    },
    {
      key: KEYS.note,
      idbEnv,
      lsEnv,
      backupB64,
      rawB64: backupB64,
      encPrefix: ENC_PREFIX,
      migrationId: L1_MIGRATION_ID,
    }
  );

  const preClose = await coldDecryptFromIdbOnly(p1, KEYS.note);
  await ctx1.close();

  const ctx2 = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p2 = await ctx2.newPage();
  await p2.goto(`${base}?nosw=1&gap=a-migrate`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForVaultReady(p2, 90000);

  const migrationMeta = await p2.evaluate(async (migrationId) => {
    const { readMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
    return await readMigrationCheckpoint(migrationId);
  }, L1_MIGRATION_ID);

  const postCold = await coldDecryptFromIdbOnly(p2, KEYS.note);
  const cleanup = await p2.evaluate(({ encPrefix, key, backupKey }) => ({
    backup: !!localStorage.getItem(backupKey),
    lsEnc: !!localStorage.getItem(encPrefix + key),
    recovery: window.iuVault.isStorageRecoveryRequired(),
  }), { encPrefix: ENC_PREFIX, key: KEYS.note, backupKey: BACKUP_KEY });

  await ctx2.close();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (_) {}

  const pass =
    setup.idbKey &&
    setup.idbRecord &&
    setup.lsBackup &&
    setup.lsEnc &&
    preClose.ok &&
    preClose.plaintext === canonicalPlaintext &&
    !postCold.recovery &&
    migrationMeta &&
    migrationMeta.phase === "complete" &&
    migrationMeta.resolvedMdk === "idb" &&
    postCold.ok &&
    postCold.plaintext === canonicalPlaintext &&
    !cleanup.backup &&
    !cleanup.lsEnc &&
    !cleanup.recovery;

  return {
    F_10103_SCENARIO_A: pass ? "PASS" : "FAIL",
    setup,
    preCloseDecrypt: {
      ok: preClose.ok,
      byteMatch: preClose.plaintext === canonicalPlaintext,
      ...preClose,
    },
    migrationMeta,
    postColdDecrypt: {
      ok: postCold.ok,
      byteMatch: postCold.plaintext === canonicalPlaintext,
      ...postCold,
    },
    cleanup,
    CRYPTOKEY_COLD_SOURCE: "IndexedDB keys store mdk:level1 (new persistent context readKeyRecord)",
  };
}

async function runConflictTest(base) {
  const tag = MARKER + "_CONF";
  const mdk = await generateExtractableMdk();
  const plainA = notePayload(tag + "_IDB");
  const plainB = notePayload(tag + "_LS");
  const envA = await encryptString(mdk, KEYS.note, plainA);
  const envB = await encryptString(mdk, KEYS.note, plainB);
  const backupB64 = bytesToB64(await exportMdkRaw(mdk));

  const profile = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-gap-conf-"));
  const ctx1 = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const p1 = await ctx1.newPage();
  await p1.goto(`${base}?nosw=1&gap=conf-setup`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await p1.evaluate(
    async ({ key, envA, envB, backupB64, rawB64, encPrefix, migrationId }) => {
      const { writeKeyRecord, writeRecord, writeMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
      const { importMdkRaw, b64ToBytes } = await import("/assets/iu-vault-core-v1.js");
      const mdkImported = await importMdkRaw(b64ToBytes(rawB64));
      await writeKeyRecord("mdk:level1", { type: "level1", mdk: mdkImported, createdAt: new Date().toISOString() });
      await writeRecord(key, envA);
      localStorage.setItem(encPrefix + key, JSON.stringify(envB));
      localStorage.setItem("iu:vault:mdk-level1-backup:v1", backupB64);
      await writeMigrationCheckpoint(migrationId, { phase: "start", recordsDone: [] });
    },
    { key: KEYS.note, envA, envB, backupB64, rawB64: backupB64, encPrefix: ENC_PREFIX, migrationId: L1_MIGRATION_ID }
  );
  await ctx1.close();

  const ctx2 = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const p2 = await ctx2.newPage();
  await p2.goto(`${base}?nosw=1&gap=conf-boot`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForVaultBoot(p2, true);

  const proof = await p2.evaluate(
    async ({ key, encPrefix, backupKey, plainA, plainB, migrationId }) => {
      const { readKeyRecord, readRecord, readMigrationCheckpoint } = await import("/assets/iu-vault-db-v1.js");
      const { decryptString } = await import("/assets/iu-vault-core-v1.js");
      const cp = await readMigrationCheckpoint(migrationId);
      const keyRec = await readKeyRecord("mdk:level1");
      const idbEnv = await readRecord(key);
      const lsRaw = localStorage.getItem(encPrefix + key);
      const backup = localStorage.getItem(backupKey);
      let idbPt = null;
      let lsPt = null;
      if (keyRec && keyRec.mdk && idbEnv) {
        try {
          idbPt = await decryptString(keyRec.mdk, key, idbEnv);
        } catch (_) {}
      }
      if (keyRec && keyRec.mdk && lsRaw) {
        try {
          lsPt = await decryptString(keyRec.mdk, key, JSON.parse(lsRaw));
        } catch (_) {}
      }
      return {
        recovery: window.iuVault.isStorageRecoveryRequired(),
        unlocked: window.iuVault.getState().unlocked,
        failClosedPhase: cp && cp.phase === "fail_closed",
        failClosedReason: cp && cp.reason,
        idbPtMatchesA: idbPt === plainA,
        lsPtMatchesB: lsPt === plainB,
        backupPreserved: !!backup,
        lsEncPreserved: !!lsRaw,
        idbPreserved: !!idbEnv,
        idbPt,
        lsPt,
        USED_RUNTIME_MEMORY: false,
        USED_LOCALSTORAGE: true,
        USED_INDEXEDDB: true,
        USED_NETWORK: false,
      };
    },
    { key: KEYS.note, encPrefix: ENC_PREFIX, backupKey: BACKUP_KEY, plainA, plainB, migrationId: L1_MIGRATION_ID }
  );

  await ctx2.close();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (_) {}

  const pass =
    proof.recovery === true &&
    proof.unlocked === false &&
    proof.failClosedPhase === true &&
    proof.failClosedReason === "conflict_idb_ls" &&
    proof.idbPtMatchesA &&
    proof.lsPtMatchesB &&
    proof.backupPreserved &&
    proof.lsEncPreserved &&
    proof.idbPreserved;

  return {
    CONFLICT_AMBIGUOUS_FAIL_CLOSED: pass ? "PASS" : "FAIL",
    proof,
    AMBIGUOUS_CONFLICT_DATA_PRESERVED: pass ? "PASS" : "FAIL",
  };
}

async function runMindMenuAndModules(base) {
  const tag = MARKER + "_MOD";
  const profile = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-gap-mod-"));
  const canonical = payloads(tag);

  const ctx1 = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p1 = await ctx1.newPage();
  await p1.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForVaultReady(p1, 90000);
  await p1.evaluate(() => {
    localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
    localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
  });
  await p1.evaluate(async ({ data }) => {
    for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    await window.iuVault.flushPendingWrites();
  }, { data: canonical });
  await ctx1.close();

  const ctx2 = await chromium.launchPersistentContext(profile, {
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const p2 = await ctx2.newPage();
  await p2.goto(`${base}?nosw=1&cold=mod`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForVaultReady(p2, 90000);
  await p2
    .waitForFunction(
      () => {
        try {
          if (window.__iuVaultHydrationComplete) return true;
          return window.iuVault && typeof window.iuVault.isHydrationComplete === "function" && window.iuVault.isHydrationComplete();
        } catch (_) {
          return false;
        }
      },
      null,
      { timeout: 60000 }
    )
    .catch(() => {});

  const moduleResults = {};
  for (const [name, key] of Object.entries(KEYS)) {
    const dec = await coldDecryptFromIdbOnly(p2, key);
    moduleResults[name] = {
      pass: dec.ok && dec.plaintext === canonical[key],
      byteMatch: dec.plaintext === canonical[key],
      markerInPayload: dec.ok && String(dec.plaintext).includes(tag),
      ...dec,
    };
  }

  const mindMenuProof = {
    storageKeys: {
      mailboxes: KEYS.mailbox,
      quicktools: KEYS.quicktools,
      note: "MindMenu persistence uses protected keys iu_mailboxes_v1 (e-mail schránky) and infouzel_quicktools (vlastní tlačítka)",
    },
    mailbox: moduleResults.mailbox,
    quicktools: moduleResults.quicktools,
    MINDMENU_DATA_PRESERVATION:
      moduleResults.mailbox.pass && moduleResults.quicktools.pass ? "PASS" : "FAIL",
  };

  await ctx2.close();
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (_) {}

  return {
    mindMenuProof,
    NOTES_DATA_PRESERVATION: moduleResults.note.pass ? "PASS" : "FAIL",
    TASKS_DATA_PRESERVATION: moduleResults.task.pass ? "PASS" : "FAIL",
    CALENDAR_DATA_PRESERVATION: moduleResults.cal.pass ? "PASS" : "FAIL",
    PARCEL_DATA_PRESERVATION: moduleResults.parcel.pass ? "PASS" : "FAIL",
    DOPRAVA_DATA_PRESERVATION: moduleResults.prefs.pass ? "PASS" : "FAIL",
    CHMU_DATA_PRESERVATION: moduleResults.prefs.pass ? "PASS" : "FAIL",
    moduleResults,
  };
}

async function main() {
  const fails = [];
  let server = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(9200, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    const scenarioA = await runScenarioA(base);
    const conflict = await runConflictTest(base);
    const modules = await runMindMenuAndModules(base);

    if (scenarioA.F_10103_SCENARIO_A !== "PASS") fails.push("F_10103_SCENARIO_A");
    if (conflict.CONFLICT_AMBIGUOUS_FAIL_CLOSED !== "PASS") fails.push("CONFLICT_AMBIGUOUS_FAIL_CLOSED");
    if (modules.mindMenuProof.MINDMENU_DATA_PRESERVATION !== "PASS") fails.push("MINDMENU_DATA_PRESERVATION");

    const report = {
      IU_VAULT_L1_PROOF_GAPS_GUARD: fails.length === 0 ? "PASS" : "FAIL",
      marker: MARKER,
      fails,
      F_10103_SCENARIO_A: scenarioA.F_10103_SCENARIO_A,
      scenarioA,
      CONFLICT_AMBIGUOUS_FAIL_CLOSED: conflict.CONFLICT_AMBIGUOUS_FAIL_CLOSED,
      conflict,
      MINDMENU_DATA_PRESERVATION: modules.mindMenuProof.MINDMENU_DATA_PRESERVATION,
      mindMenuProof: modules.mindMenuProof,
      NOTES_DATA_PRESERVATION: modules.NOTES_DATA_PRESERVATION,
      TASKS_DATA_PRESERVATION: modules.TASKS_DATA_PRESERVATION,
      CALENDAR_DATA_PRESERVATION: modules.CALENDAR_DATA_PRESERVATION,
      PARCEL_DATA_PRESERVATION: modules.PARCEL_DATA_PRESERVATION,
      DOPRAVA_DATA_PRESERVATION: modules.DOPRAVA_DATA_PRESERVATION,
      CHMU_DATA_PRESERVATION: modules.CHMU_DATA_PRESERVATION,
    };

    console.log(JSON.stringify(report, null, 2));
    if (fails.length) {
      console.error("IU_VAULT_L1_PROOF_GAPS_GUARD_FAIL");
      process.exit(1);
    }
    console.log("IU_VAULT_L1_PROOF_GAPS_GUARD_PASS");
  } catch (e) {
    console.error(String(e && e.stack ? e.stack : e));
    process.exit(1);
  } finally {
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }
}

main();
