#!/usr/bin/env node
/**
 * Post-unlock data preservation: save → L3 → lock → new context → unlock → exact values.
 * Negative proof mode: IU_NEG_SKIP_HYDRATE=1 skips afterUnlock preload → must FAIL.
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
const MARKER = `IU_POST_UNLOCK_${Date.now()}`;
const SKIP_HYDRATE = process.env.IU_NEG_SKIP_HYDRATE === "1";
const FORCE_EMPTY_WRITE = process.env.IU_NEG_FORCE_EMPTY_WRITE === "1";

function staticChecks(fails) {
  const storageJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  const lockJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");
  const bootJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  if (!/__iuVaultHydrationPending/.test(storageJs)) fails.push("storage_missing_hydration_pending_block");
  if (!/isVaultPersistBlocked\(key\)\) return;/.test(storageJs) && !/if \(isVaultPersistBlocked\(key\)\) return;/.test(storageJs)) {
    fails.push("shim_missing_persist_block_noop");
  }
  if (!/__iuVaultHydrationPending = true/.test(lockJs)) fails.push("lock_missing_hydration_pending");
  if (!/__iuVaultHydrationPending = true/.test(bootJs)) fails.push("bootstrap_missing_unlock_pending");
}

async function seedAndProtect(page) {
  return page.evaluate(async ({ marker, pin }) => {
    const note = JSON.stringify({
      schemaVersion: 1,
      notes: [{ id: "n1", title: marker + "_NOTE", body: "body", tags: [], createdAt: 1, updatedAt: 1 }],
    });
    const task = JSON.stringify({
      schemaVersion: 1,
      tasks: [{ id: "t1", title: marker + "_TASK", status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }],
    });
    const cal = JSON.stringify({
      schemaVersion: 1,
      events: [{ id: "c1", title: marker + "_CAL", start: "2026-08-25T10:00:00", end: "2026-08-25T11:00:00" }],
    });
    const banks = JSON.stringify({ items: [{ label: marker + "_BANK", slot: 1 }] });
    const bak = JSON.stringify({ profiles: [{ id: "b1", school: marker + "_BAK" }] });
    const quick = JSON.stringify({ version: 2, buttons: [{ id: "q1", title: marker + "_QUICK", url: "https://example.test/" + marker }] });
    const invoice = JSON.stringify({ draft: { title: marker + "_INV", total: 100 } });
    const datovka = JSON.stringify({ profiles: [{ id: "d1", label: marker + "_DATOVKA" }] });
    const mailbox = JSON.stringify({
      schemaVersion: 1,
      items: [{ id: "m1", label: marker + "_MAIL", type: "email" }],
    });

    localStorage.setItem("iu.notes.store.v1", note);
    localStorage.setItem("iu.tasks.mvp.v1", task);
    localStorage.setItem("iu.calendar.store.v1", cal);
    localStorage.setItem("iu_moje_sluzby_banks_state_v1", banks);
    localStorage.setItem("iu_bakalari_profiles", bak);
    localStorage.setItem("infouzel_quicktools", quick);
    localStorage.setItem("iu_invoice_form_state_v1", invoice);
    localStorage.setItem("infouzel_datovka_profiles_v1", datovka);
    await window.iuVault.flushPendingWrites();

    await window.iuVault.setupPin(pin, pin);
    // Re-open session and write mailbox after hydrate so feed pipeline cannot clobber during setup.
    await window.iuVault.unlockPin(pin);
    await window.iuVault.afterUnlock();
    localStorage.setItem("iu_mailboxes_v1", mailbox);
    await window.iuVault.flushPendingWrites();
    await window.iuVault.lock();

    const enc = (k) => !!localStorage.getItem("iu:vault:enc:v1:" + k);
    return {
      before: { note, task, cal, mailbox, banks, bak, quick, invoice, datovka },
      enc: {
        note: enc("iu.notes.store.v1"),
        task: enc("iu.tasks.mvp.v1"),
        cal: enc("iu.calendar.store.v1"),
        mailbox: enc("iu_mailboxes_v1"),
        banks: enc("iu_moje_sluzby_banks_state_v1"),
        bak: enc("iu_bakalari_profiles"),
        quick: enc("infouzel_quicktools"),
        invoice: enc("iu_invoice_form_state_v1"),
        datovka: enc("infouzel_datovka_profiles_v1"),
      },
    };
  }, { marker: MARKER, pin: PIN });
}

async function unlockAndRead(page, options = {}) {
  const skipHydrate = !!options.skipHydrate;
  const forceEmptyWrite = !!options.forceEmptyWrite;
  return page.evaluate(async ({ pin, skipHydrate, forceEmptyWrite }) => {
    await window.iuVault.unlockPin(pin);
    if (forceEmptyWrite) {
      try {
        window.__iuVaultHydrationPending = false;
      } catch (_) {}
      const emptyNote = JSON.stringify({ schemaVersion: 1, notes: [] });
      const emptyTask = JSON.stringify({ schemaVersion: 1, tasks: [] });
      const emptyCal = JSON.stringify({ schemaVersion: 1, events: [] });
      localStorage.setItem("iu.notes.store.v1", emptyNote);
      localStorage.setItem("iu.tasks.mvp.v1", emptyTask);
      localStorage.setItem("iu.calendar.store.v1", emptyCal);
      await window.iuVault.flushPendingWrites();
    }
    if (!skipHydrate) {
      await window.iuVault.afterUnlock();
    } else {
      try {
        window.__iuVaultHydrationPending = false;
        window.__iuVaultHydrationComplete = true;
      } catch (_) {}
    }
    const waitHydrated = new Promise((resolve) => {
      if (window.__iuVaultHydrationComplete) return resolve();
      window.addEventListener("iu-vault-hydrated", () => resolve(), { once: true });
      setTimeout(resolve, 5000);
    });
    await waitHydrated;
    await new Promise((r) => setTimeout(r, 200));

    const read = async (key) => {
      try {
        const { vaultGetItem } = await import("/assets/iu-vault-storage-v1.js");
        return await vaultGetItem(key);
      } catch (_) {
        return localStorage.getItem(key);
      }
    };
    return {
      note: await read("iu.notes.store.v1"),
      task: await read("iu.tasks.mvp.v1"),
      cal: await read("iu.calendar.store.v1"),
      mailbox: await read("iu_mailboxes_v1"),
      banks: await read("iu_moje_sluzby_banks_state_v1"),
      bak: await read("iu_bakalari_profiles"),
      quick: await read("infouzel_quicktools"),
      invoice: await read("iu_invoice_form_state_v1"),
      datovka: await read("infouzel_datovka_profiles_v1"),
      hydrationComplete: !!window.__iuVaultHydrationComplete,
      unlocked: !!(window.iuVault.getState && window.iuVault.getState().unlocked),
    };
  }, { pin: PIN, skipHydrate, forceEmptyWrite });
}

function eqJson(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch (_) {
    return false;
  }
}

async function main() {
  const fails = [];
  staticChecks(fails);

  let server = null;
  let browser = null;
  let contextA = null;
  let pageA = null;
  let before = null;

  try {
    const started = await startGuardStaticServer(pickGuardPort(8800, 400));
    server = started;
    const base = `http://127.0.0.1:${server.port}/projects/`;
    browser = await chromium.launch({ headless: true });

    contextA = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      webauthnStub: true,
    });
    pageA = await contextA.newPage();
    pageA.setDefaultTimeout(60000);
    await pageA.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVaultReady(pageA, 60000);

    const seeded = await seedAndProtect(pageA);
    before = seeded.before;
    if (!seeded.enc.note || !seeded.enc.task || !seeded.enc.cal) fails.push("enc_missing_after_setup");
    if (!seeded.enc.mailbox && !seeded.enc.banks) fails.push("enc_personal_modules_missing");

    // setupPin already locks; ensure lock screen + pending hydrate for reopen
    await pageA.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });

    const locked = await pageA.evaluate(() => {
      return document.documentElement.classList.contains("iu-vault-app-locked")
        || !!(document.getElementById("iuVaultAppLockScreen") && !document.getElementById("iuVaultAppLockScreen").hidden);
    });
    if (!locked) fails.push("app_not_locked_on_reopen");

    await pageA.waitForFunction(() => !!(window.iuVault && window.iuVault.unlockPin && window.iuVault.getState), null, { timeout: 60000 });
    const after = await unlockAndRead(pageA, {
      skipHydrate: SKIP_HYDRATE,
      forceEmptyWrite: FORCE_EMPTY_WRITE,
    });

    const checks = [
      ["note", before.note, after.note],
      ["task", before.task, after.task],
      ["cal", before.cal, after.cal],
      ["banks", before.banks, after.banks],
      ["bak", before.bak, after.bak],
      ["invoice", before.invoice, after.invoice],
      ["datovka", before.datovka, after.datovka],
    ];
    for (const [name, expected, actual] of checks) {
      if (!eqJson(expected, actual)) fails.push(`value_mismatch:${name}`);
    }
    // Mailbox / quicktools may normalize schema on hydrate; require non-empty survival + marker when present.
    if (!after.mailbox) fails.push("mailbox_empty");
    if (!after.quick) fails.push("quick_empty");
    if (after.mailbox && !String(after.mailbox).includes(MARKER + "_MAIL") && !String(after.mailbox).includes("items")) {
      fails.push("mailbox_unexpected_shape");
    }
    if (after.quick && !String(after.quick).includes(MARKER + "_QUICK")) fails.push("quick_marker_missing");
    // Ciphertext must still exist for mailbox after reopen unlock (not wiped).
    const encAfter = await pageA.evaluate(() => !!localStorage.getItem("iu:vault:enc:v1:iu_mailboxes_v1"));
    if (!encAfter) fails.push("mailbox_enc_deleted");
    if (!after.unlocked) fails.push("not_unlocked");
    if (!SKIP_HYDRATE && !after.hydrationComplete) fails.push("hydration_incomplete");
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(pageA, contextA, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  const report = {
    IU_VAULT_POST_UNLOCK_PRESERVATION_GUARD: pass ? "PASS" : "FAIL",
    fails,
    skipHydrate: SKIP_HYDRATE,
    marker: MARKER,
  };
  console.log(JSON.stringify(report));
  if (!pass) {
    console.error("IU_VAULT_POST_UNLOCK_PRESERVATION_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_POST_UNLOCK_PRESERVATION_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
