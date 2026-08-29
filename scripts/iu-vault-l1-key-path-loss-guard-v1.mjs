#!/usr/bin/env node
/**
 * L1 key-path loss guard:
 * - CryptoKey object lost but durable IDB material remains → recover + data readable
 * - CryptoKey + material both gone, ciphertext remains → fail-closed, no overwrite
 * Full-web lock invariant unchanged (not tested here).
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const MARKER = `IU_KPL_${Date.now()}`;
const NOTE_KEY = "iu.notes.store.v1";
const MATERIAL_ID = "mdk:level1:material";

function staticChecks(fails) {
  const lockJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");
  const diagJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-persistence-diag-v1.js"), "utf8");
  if (!/LEVEL1_MDK_MATERIAL_ID/.test(lockJs)) fails.push("lock_missing_durable_material_id");
  if (!/persistLevel1KeyWithDurableMaterial/.test(lockJs)) fails.push("lock_missing_persist_durable_material");
  if (!/writeKeyRecordsBatch/.test(fs.readFileSync(path.join(REPO, "assets", "iu-vault-db-v1.js"), "utf8"))) {
    fails.push("db_missing_writeKeyRecordsBatch");
  }
  if (!/VAULT_LEVEL1_DURABLE_MATERIAL_READBACK_FAIL/.test(lockJs)) {
    fails.push("lock_missing_material_readback");
  }
  if (!/Never continue CryptoKey-only|backfilledDurableMaterial/.test(lockJs)) {
    fails.push("lock_allows_silent_cryptokey_only");
  }
  if (!/restoreLevel1FromDurableMaterial|idb_durable_material/.test(lockJs)) {
    fails.push("lock_missing_restore_from_durable_material");
  }
  if (/localStorage\.setItem\(\s*LEVEL1_MDK_BACKUP_KEY/.test(lockJs)) {
    fails.push("lock_still_writes_ls_raw_backup");
  }
  if (!/persistenceState/.test(diagJs)) fails.push("diag_missing_persistenceState");
  if (!/durableMaterialPresent/.test(diagJs)) fails.push("diag_missing_durableMaterialPresent");
  if (!/STATE_3_CIPHERTEXT_PRESENT_KEY_PATH_LOST/.test(diagJs)) {
    fails.push("diag_missing_key_path_lost_state");
  }
}

async function acceptConsent(page) {
  try {
    const btn = page.locator("#iuConsentAccept, button:has-text('Souhlasím')").first();
    if (await btn.count()) await btn.click({ timeout: 1500 }).catch(() => {});
  } catch (_) {}
}

async function seedNote(page) {
  await page.evaluate(async ({ key, marker }) => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      notes: [{ id: "n1", title: marker, body: "kpl", tags: [], createdAt: 1, updatedAt: 1 }],
    });
    const { vaultSetItem, flushPendingVaultWrites } = await import("/assets/iu-vault-storage-v1.js");
    await vaultSetItem(key, payload);
    await flushPendingVaultWrites();
  }, { key: NOTE_KEY, marker: MARKER });
}

async function snap(page) {
  return page.evaluate(async ({ key, marker, materialId }) => {
    const { readKeyRecord, readRecord } = await import("/assets/iu-vault-db-v1.js");
    const keyRec = await readKeyRecord("mdk:level1");
    const mat = await readKeyRecord(materialId);
    const note = await readRecord(key);
    let readable = false;
    let readErr = null;
    try {
      const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
      const raw = await vaultGetItem(key);
      readable = !!(raw && String(raw).includes(marker));
    } catch (e) {
      readErr = String(e && e.message ? e.message : e);
    }
    let diag = null;
    try {
      diag = await window.iuVault.getPersistenceDiag({ keys: [key] });
    } catch (_) {}
    return {
      cryptoKeyPresent: !!(keyRec && keyRec.mdk),
      durableMaterialPresent: !!(mat && mat.raw),
      ciphertextBytes: note ? JSON.stringify(note).length : 0,
      readable,
      readErr,
      recovery: !!(window.iuVault.isStorageRecoveryRequired && window.iuVault.isStorageRecoveryRequired()),
      unlocked: !!(window.iuVault.getState && window.iuVault.getState().unlocked),
      persistenceState: diag && diag.forensics ? diag.forensics.persistenceState : null,
      legacyBackup: !!localStorage.getItem("iu:vault:mdk-level1-backup:v1"),
    };
  }, { key: NOTE_KEY, marker: MARKER, materialId: MATERIAL_ID });
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  const profileA = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-kpl-a-"));
  const profileB = fs.mkdtempSync(path.join(require("os").tmpdir(), "iu-kpl-b-"));

  try {
    const started = await startGuardStaticServer(pickGuardPort(9400, 400));
    server = started;
    const base = `http://127.0.0.1:${started.port}/projects/`;

    // A — CryptoKey deleted, durable material kept → recover
    {
      let ctx = await chromium.launchPersistentContext(profileA, {
        headless: true,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      let page = await ctx.newPage();
      await page.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await acceptConsent(page);
      await waitForVaultReady(page, 90000);
      await seedNote(page);
      const before = await snap(page);
      if (!before.readable || !before.durableMaterialPresent) {
        fails.push("A_seed_missing_readable_or_material");
      }
      await page.evaluate(async () => {
        const { writeKeyRecord } = await import("/assets/iu-vault-db-v1.js");
        await writeKeyRecord("mdk:level1", {
          type: "level1",
          mdk: null,
          createdAt: new Date().toISOString(),
          broken: true,
        });
      });
      await ctx.close();

      ctx = await chromium.launchPersistentContext(profileA, {
        headless: true,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      page = await ctx.newPage();
      await page.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await acceptConsent(page);
      await waitForVaultReady(page, 90000);
      const after = await snap(page);
      if (!after.readable) fails.push("A_recover_not_readable");
      if (!after.cryptoKeyPresent) fails.push("A_recover_cryptoKey_not_restored");
      if (after.recovery) fails.push("A_unexpected_recovery");
      if (after.legacyBackup) fails.push("A_legacy_ls_backup_present");
      await ctx.close();
      console.log("A_CRYPTOKEY_LOSS_MATERIAL_RECOVER=" + (fails.some((f) => f.startsWith("A_")) ? "FAIL" : "PASS"));
      console.log(JSON.stringify({ before, after }));
    }

    // B — wipe CryptoKey + material, keep ciphertext → fail-closed, no new empty vault overwrite
    {
      let ctx = await chromium.launchPersistentContext(profileB, {
        headless: true,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      let page = await ctx.newPage();
      await page.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await acceptConsent(page);
      await waitForVaultReady(page, 90000);
      await seedNote(page);
      const before = await snap(page);
      const bytesBefore = before.ciphertextBytes;
      await page.evaluate(async ({ materialId }) => {
        const { deleteKeyRecord, writeKeyRecord } = await import("/assets/iu-vault-db-v1.js");
        await deleteKeyRecord("mdk:level1");
        await deleteKeyRecord(materialId);
        try {
          localStorage.removeItem("iu:vault:mdk-level1-backup:v1");
        } catch (_) {}
        // Ensure no accidental rewrite of note record here
        await writeKeyRecord("mdk:level1", { type: "level1", mdk: null, createdAt: "x" });
        await deleteKeyRecord("mdk:level1");
      }, { materialId: MATERIAL_ID });
      await ctx.close();

      ctx = await chromium.launchPersistentContext(profileB, {
        headless: true,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      page = await ctx.newPage();
      await page.goto(`${base}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForTimeout(2500);
      const after = await snap(page);
      if (after.readable) fails.push("B_should_not_read_without_key");
      if (!after.recovery) fails.push("B_expected_fail_closed_recovery");
      if (after.ciphertextBytes < Math.max(32, bytesBefore - 8)) {
        fails.push("B_ciphertext_clobbered_or_missing");
      }
      if (after.cryptoKeyPresent) fails.push("B_new_cryptoKey_created_over_orphan");
      if (after.persistenceState && after.persistenceState !== "STATE_3_CIPHERTEXT_PRESENT_KEY_PATH_LOST") {
        // Accept also decrypt-failed classification if cryptoKeyPresent false
        if (after.persistenceState !== "STATE_4_CIPHERTEXT_PRESENT_DECRYPT_FAILED") {
          fails.push("B_unexpected_persistenceState:" + after.persistenceState);
        }
      }
      await ctx.close();
      console.log("B_KEY_PATH_LOSS_FAIL_CLOSED=" + (fails.some((f) => f.startsWith("B_")) ? "FAIL" : "PASS"));
      console.log(JSON.stringify({ before, after }));
    }
  } finally {
    if (server && server.proc) await stopGuardProcess(server.proc);
  }

  if (fails.length) {
    console.log("IU_L1_KEY_PATH_LOSS=FAIL");
    console.log(fails.join("\n"));
    process.exit(1);
  }
  console.log("IU_L1_KEY_PATH_LOSS=PASS");
  process.exit(0);
}

main().catch((err) => {
  console.error("IU_L1_KEY_PATH_LOSS=FAIL");
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
