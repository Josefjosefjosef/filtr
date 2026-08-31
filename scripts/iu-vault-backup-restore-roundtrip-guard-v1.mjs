#!/usr/bin/env node
/**
 * Vault-aware backup export → import round-trip (desktop L3).
 * Run: npm run iu-vault-backup-restore-roundtrip-guard
 */
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  bootstrapGuardContext,
  installProtectedStorageSeed,
  waitForVaultReady,
} from "./guards/guard-playwright-bootstrap.mjs";
import { exportBackupJson } from "../assets/iu-user-data-backup-core.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const fs = require("fs");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8981", 10);
const BASE = `http://localhost:${PORT}/projects/`;
const TEST_BACKUP_PASSWORD = "TestBackupPass1!";
const MARKER = `IU_PC_BACKUP_TEST_${Date.now()}`;

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

function staticChecks(fails) {
  const uiJs = fs.readFileSync(path.join(REPO, "assets", "iu-user-data-backup-v1.js"), "utf8");
  const coreJs = fs.readFileSync(path.join(REPO, "assets", "iu-user-data-backup-core.js"), "utf8");
  const bootJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  if (!/applyBackupReplaceModeAsync/.test(coreJs)) fails.push("core_missing_async_apply");
  if (!/encryptBackupPlaintext/.test(coreJs) || !/BACKUP_VERSION = 2/.test(coreJs)) {
    fails.push("core_missing_encrypted_export_v2");
  }
  if (!/promptNewBackupPassword/.test(uiJs)) fails.push("ui_missing_backup_password_prompt");
  if (!/vaultSetItem/.test(uiJs) || !/preloadAllVaultRecords/.test(uiJs)) {
    fails.push("ui_missing_vault_aware_import");
  }
  if (!/VAULT_LOCKED_IMPORT/.test(coreJs)) fails.push("core_missing_locked_import_msg");
  if (!/__iuBackupImportInProgress/.test(bootJs) || !/__iuBackupImportInProgress/.test(uiJs)) {
    fails.push("missing_backup_import_guard_flag");
  }
}

async function seedPersonalData(page, noteSeed, taskSeed, calSeed) {
  await page.evaluate(
    async ({ noteSeed, taskSeed, calSeed }) => {
      localStorage.setItem("iu.notes.store.v1", noteSeed);
      localStorage.setItem("iu.tasks.mvp.v1", taskSeed);
      localStorage.setItem("iu.calendar.store.v1", calSeed);
      if (typeof window.iuVault?.afterUnlock === "function" && window.iuVault.getState().unlocked) {
        await window.iuVault.afterUnlock();
      }
    },
    { noteSeed, taskSeed, calSeed }
  );
  await page.waitForTimeout(500);
}

async function waitForMarkers(page, needle, timeoutMs) {
  await page.waitForFunction(
    (n) => {
      try {
        const notes = localStorage.getItem("iu.notes.store.v1") || "";
        const tasks = localStorage.getItem("iu.tasks.mvp.v1") || "";
        const calendar = localStorage.getItem("iu.calendar.store.v1") || "";
        return notes.includes(n) && tasks.includes(n) && calendar.includes(n);
      } catch (_) {
        return false;
      }
    },
    needle,
    { timeout: timeoutMs }
  );
}

async function readMarkers(page) {
  return page.evaluate(async (needle) => {
    const out = { notes: false, tasks: false, calendar: false, encNotes: false };
    try {
      out.notes = (localStorage.getItem("iu.notes.store.v1") || "").includes(needle);
      out.tasks = (localStorage.getItem("iu.tasks.mvp.v1") || "").includes(needle);
      out.calendar = (localStorage.getItem("iu.calendar.store.v1") || "").includes(needle);
      const lsEnc = !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1");
      let idbEnc = false;
      try {
        const { readRecord } = await import("/assets/iu-vault-db-v1.js");
        const rec = await readRecord("iu.notes.store.v1");
        idbEnc = !!(rec && rec.ct);
      } catch (_) {}
      out.encNotes = lsEnc || idbEnc;
    } catch (_) {}
    return out;
  }, MARKER);
}

async function main() {
  const fails = [];
  staticChecks(fails);

  const server = await new Promise((resolve) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("localhost", PORT, 30000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1366, height: 768 },
    isMobile: false,
  });

  const noteSeed = JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "br1", title: MARKER, body: "backup-note", tags: [], createdAt: 1, updatedAt: 1 }],
  });
  const taskSeed = JSON.stringify({
    schemaVersion: 1,
    tasks: [{ id: "br1", title: MARKER, status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }],
  });
  const calSeed = JSON.stringify({
    schemaVersion: 1,
    events: [{ id: "br1", title: MARKER, start: "2026-08-23T10:00:00", end: "2026-08-23T11:00:00" }],
  });

  const minimalBackupJson = await exportBackupJson(
    {
      getItem(key) {
        if (key === "iu.notes.store.v1") return noteSeed;
        if (key === "iu.tasks.mvp.v1") return taskSeed;
        if (key === "iu.calendar.store.v1") return calSeed;
        return null;
      },
      setItem() {},
      removeItem() {},
      keys() {
        return ["iu.notes.store.v1", "iu.tasks.mvp.v1", "iu.calendar.store.v1"];
      },
    },
    "guard",
    globalThis.crypto?.subtle,
    TEST_BACKUP_PASSWORD
  );

  await installProtectedStorageSeed(context, [
    { key: "iu.notes.store.v1", value: noteSeed },
    { key: "iu.tasks.mvp.v1", value: taskSeed },
    { key: "iu.calendar.store.v1", value: calSeed },
  ]);

  const page = await context.newPage();

  try {
    await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page);
    await page.waitForFunction(() => typeof window.iuUserDataBackupExportJson === "function", null, { timeout: 60000 });
    await seedPersonalData(page, noteSeed, taskSeed, calSeed);

    const beforeProtect = await readMarkers(page);
    if (!beforeProtect.notes || !beforeProtect.tasks) fails.push("seed_not_visible_before_protect");

    const pinSetup = await page.evaluate(async () => {
      try {
        await window.iuVault.setupPin("847291", "847291");
        return { ok: true, locked: !window.iuVault.getState().unlocked };
      } catch (e) {
        return { ok: false, reason: String(e.message || e) };
      }
    });
    if (!pinSetup.ok) fails.push(`pin_setup:${pinSetup.reason || "failed"}`);
    if (pinSetup.ok && !pinSetup.locked) fails.push("pin_setup_should_lock");

    await page.evaluate(async () => {
      await window.iuVault.unlockPin("847291");
      if (typeof window.iuVault.afterUnlock === "function") {
        await window.iuVault.afterUnlock();
      }
    });
    await page.waitForFunction(() => window.iuVault.getState().unlocked, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await waitForMarkers(page, MARKER, 90000);

    const exportResult = await page.evaluate(
      async ({ marker, password }) => {
        const json = await window.iuUserDataBackupExportJson(password);
        return {
          ok:
            typeof json === "string" &&
            json.includes("infouzel-backup") &&
            json.includes('"encrypted":true') &&
            !json.includes(marker),
        };
      },
      { marker: MARKER, password: TEST_BACKUP_PASSWORD }
    );
    if (!exportResult.ok) fails.push("export_failed");

    const wipeAndImport = await page.evaluate(
      async ({ json, password }) => {
        localStorage.removeItem("iu.notes.store.v1");
        localStorage.removeItem("iu.tasks.mvp.v1");
        localStorage.removeItem("iu.calendar.store.v1");
        await new Promise((r) => setTimeout(r, 500));
        const notesGone = !localStorage.getItem("iu.notes.store.v1");
        const backup = await window.iuUserDataBackupParseAndVerify(json, password);
        await window.iuUserDataBackupApplyReplace(backup);
        if (typeof window.iuVault?.afterUnlock === "function") {
          await window.iuVault.afterUnlock();
        }
        return { notesGone };
      },
      { json: minimalBackupJson, password: TEST_BACKUP_PASSWORD }
    );

    if (!wipeAndImport.notesGone) fails.push("wipe_before_import_failed");

    await waitForMarkers(page, MARKER, 90000);
    const afterImport = await readMarkers(page);
    if (!afterImport.notes || !afterImport.tasks || !afterImport.calendar) fails.push("import_roundtrip_data_missing");
    if (!afterImport.encNotes) fails.push("import_missing_enc_after_restore");

    await page.evaluate(async () => {
      await window.iuVault.lock();
    });
    const lockedMarkers = await readMarkers(page);
    if (lockedMarkers.notes || lockedMarkers.tasks || lockedMarkers.calendar) {
      fails.push("plaintext_visible_after_lock_post_import");
    }

    await page.evaluate(async () => {
      await window.iuVault.unlockPin("847291");
      if (typeof window.iuVault.afterUnlock === "function") {
        await window.iuVault.afterUnlock();
      }
    });
    await page.waitForFunction(() => window.iuVault.getState().unlocked, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    await waitForMarkers(page, MARKER, 90000);
    const afterUnlock = await readMarkers(page);
    if (!afterUnlock.notes || !afterUnlock.tasks || !afterUnlock.calendar) {
      fails.push("data_lost_after_lock_unlock_post_import");
    }

    const lockedImport = await page.evaluate(async (password) => {
      await window.iuVault.lock();
      try {
        const json = await window.iuUserDataBackupExportJson(password);
        return { blocked: false, jsonLen: json.length };
      } catch (e) {
        return { blocked: true, code: String(e.message || e) };
      }
    }, TEST_BACKUP_PASSWORD);
    if (!lockedImport.blocked || !lockedImport.code.includes("VAULT_LOCKED")) {
      fails.push("export_should_fail_when_locked");
    }

    await page.evaluate(async () => {
      await window.iuVault.unlockPin("847291");
      if (typeof window.iuVault.afterUnlock === "function") {
        await window.iuVault.afterUnlock();
      }
    });
    await page.waitForFunction(() => window.iuVault.getState().unlocked, null, { timeout: 60000 });

    const invalidImport = await page.evaluate(
      async ({ json, password }) => {
        if (typeof window.iuVault?.flushPendingWrites === "function") {
          await window.iuVault.flushPendingWrites();
        }
        const beforeNotes = localStorage.getItem("iu.notes.store.v1");
        const beforeLsEnc = localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1");
        let beforeIdbEnc = false;
        let beforeIdbCt = null;
        try {
          const { readRecord } = await import("/assets/iu-vault-db-v1.js");
          const rec = await readRecord("iu.notes.store.v1");
          beforeIdbEnc = !!(rec && rec.ct);
          beforeIdbCt = rec && rec.ct ? String(rec.ct) : null;
        } catch (_) {}
        const parsed = JSON.parse(json);
        const ct = String((parsed.cipher && parsed.cipher.ct) || "");
        parsed.cipher.ct = ct.slice(0, Math.max(0, ct.length - 8)) + "XXXXXXXX";
        const tampered = JSON.stringify(parsed);
        try {
          await window.iuUserDataBackupParseAndVerify(tampered, password);
          return { failed: false };
        } catch (e) {
          const afterNotes = localStorage.getItem("iu.notes.store.v1");
          const afterLsEnc = localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1");
          let afterIdbEnc = false;
          let afterIdbCt = null;
          try {
            const { readRecord } = await import("/assets/iu-vault-db-v1.js");
            const rec = await readRecord("iu.notes.store.v1");
            afterIdbEnc = !!(rec && rec.ct);
            afterIdbCt = rec && rec.ct ? String(rec.ct) : null;
          } catch (_) {}
          const hadEnc = !!(beforeLsEnc || beforeIdbEnc);
          const stillHasEnc = !!(afterLsEnc || afterIdbEnc);
          const encUnchanged = beforeLsEnc === afterLsEnc && beforeIdbCt === afterIdbCt;
          return {
            failed: true,
            preserved: beforeNotes === afterNotes && hadEnc && stillHasEnc && encUnchanged,
            code: String(e.message || e),
          };
        }
      },
      { json: minimalBackupJson, password: TEST_BACKUP_PASSWORD }
    );

    if (!invalidImport.failed) {
      fails.push("tampered_import_should_fail");
    } else if (!invalidImport.preserved) {
      fails.push("tampered_import_should_preserve_original");
    }
  } finally {
    try {
      await browser.close();
    } catch (_) {
      /* ignore */
    }
    try {
      if (server && typeof server.kill === "function") server.kill();
    } catch (_) {
      /* ignore */
    }
  }

  const report = { IU_VAULT_BACKUP_RESTORE_ROUNDTRIP_GUARD: fails.length ? "FAIL" : "PASS", fails, marker: MARKER };
  console.log(JSON.stringify(report));
  if (fails.length) {
    console.error("IU_VAULT_BACKUP_RESTORE_ROUNDTRIP_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_BACKUP_RESTORE_ROUNDTRIP_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
