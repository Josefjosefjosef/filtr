#!/usr/bin/env node
/**
 * Safe persistence diagnostics API guard — metadata only, no record contents.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
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
const fs = require("fs");

const PIN = "123456";
const FORBIDDEN = /("notes"\s*:|"tasks"\s*:|"body"\s*:|"title"\s*:|"homeObec"\s*:|123456|mdk|wrapping|credential|plaintext)/i;

function staticChecks(fails) {
  const diagJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-persistence-diag-v1.js"), "utf8");
  const bootJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  const storageJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  const infoJs = fs.readFileSync(path.join(REPO, "assets", "iu-info-system-core-v1.js"), "utf8");
  if (!/getPersistenceDiag/.test(diagJs)) fails.push("diag_missing_getPersistenceDiag");
  if (!/getPersistenceTimeline/.test(diagJs)) fails.push("diag_missing_getPersistenceTimeline");
  if (!/recordVaultPersistenceEvent/.test(diagJs)) fails.push("diag_missing_record_event");
  if (!/07-write-transaction-complete/.test(storageJs)) fails.push("storage_missing_write_complete_diag");
  if (!/getPersistenceDiag/.test(bootJs)) fails.push("bootstrap_missing_getPersistenceDiag_api");
  if (!/initVaultPersistenceDiag/.test(bootJs)) fails.push("bootstrap_missing_init_diag");
  if (!/prefsDiag/.test(infoJs)) fails.push("info_missing_prefs_diag");
  if (/localStorage\.getItem\(.*\).*records/.test(diagJs)) fails.push("diag_possible_plaintext_leak");
}

function assertSafePayload(fails, label, obj) {
  const blob = JSON.stringify(obj);
  if (FORBIDDEN.test(blob)) fails.push(`${label}_forbidden_content`);
  if (!obj || typeof obj !== "object") {
    fails.push(`${label}_not_object`);
    return;
  }
  if (!Array.isArray(obj.records)) fails.push(`${label}_missing_records`);
  if (!obj.platform) fails.push(`${label}_missing_platform`);
  if (!obj.vaultState || typeof obj.vaultState.unlocked !== "boolean") fails.push(`${label}_missing_vaultState`);
  if (!obj.forensics || typeof obj.forensics !== "object") fails.push(`${label}_missing_forensics`);
  if (obj.forensics && !obj.forensics.persistenceState) fails.push(`${label}_missing_persistenceState`);
  for (const rec of obj.records || []) {
    if ("value" in rec || "plaintext" in rec || "body" in rec) fails.push(`${label}_record_value_leak`);
  }
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8890, 400));
    server = started;
    const base = `http://127.0.0.1:${server.port}/projects/`;
    browser = await chromium.launch({ headless: true });
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      webauthnStub: true,
    });
    const page = await context.newPage();
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVaultReady(page);

    const runtime = await page.evaluate(async ({ pin }) => {
      if (!window.iuVault || typeof window.iuVault.getPersistenceDiag !== "function") {
        return { ok: false, reason: "missing_api" };
      }
      await window.iuVault.setupPin(pin, pin);
      await window.iuVault.unlockPin(pin);
      await window.iuVault.afterUnlock();
      localStorage.setItem(
        "iu.notes.store.v1",
        JSON.stringify({
          schemaVersion: 1,
          notes: [{ id: "d1", title: "DIAG_NOTE_SECRET", body: "secret", tags: [], createdAt: 1, updatedAt: 1 }],
        })
      );
      localStorage.setItem(
        "iu.infoEvents.prefs.v1",
        JSON.stringify({
          sections: ["doprava", "chmi"],
          homeObec: "DIAG_OBEC_SECRET",
          feedFilter: { roads: ["DIAG_ROAD_SECRET"] },
        })
      );
      await window.iuVault.flushPendingWrites();
      window.iuVault.recordPersistenceEvent("21-ui-render", { source: "guard" });
      const diag = await window.iuVault.getPersistenceDiag();
      const timeline = window.iuVault.getPersistenceTimeline(20);
      return { ok: true, diag, timeline };
    }, { pin: PIN });

    if (!runtime.ok) fails.push(`runtime_${runtime.reason || "fail"}`);
    else {
      assertSafePayload(fails, "diag", runtime.diag);
      if (FORBIDDEN.test(JSON.stringify(runtime.timeline || []))) fails.push("timeline_forbidden_content");
      const noteRec = (runtime.diag.records || []).find((r) => r.storageKey === "iu.notes.store.v1");
      const prefRec = (runtime.diag.records || []).find((r) => r.storageKey === "iu.infoEvents.prefs.v1");
      if (!noteRec || !noteRec.persisted) fails.push("diag_note_not_persisted");
      if (!prefRec || !prefRec.persisted) fails.push("diag_prefs_not_persisted");
      if (!Array.isArray(runtime.timeline) || runtime.timeline.length < 3) fails.push("timeline_too_short");
      const steps = new Set((runtime.timeline || []).map((e) => e.step));
      if (!steps.has("08-write-confirmed") && !steps.has("07-write-transaction-complete")) {
        fails.push("timeline_missing_write_steps");
      }
    }
    await closePlaywrightSession(page, context, browser);
    browser = null;
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(null, null, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({ IU_VAULT_PERSISTENCE_DIAG_GUARD: pass ? "PASS" : "FAIL", fails }));
  if (!pass) {
    console.error("IU_VAULT_PERSISTENCE_DIAG_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_PERSISTENCE_DIAG_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
