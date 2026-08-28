#!/usr/bin/env node
/**
 * Lock → unlock must preserve encrypted personal data (L2 desktop flow).
 * Run: npm run iu-vault-lock-unlock-preserves-data-guard
 */
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  installLocalDataProtectionAccepted,
  installProtectedStorageSeed,
  waitForVaultReady,
} from "./guards/guard-playwright-bootstrap.mjs";
import {
  closePlaywrightSession,
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || String(pickGuardPort(8970, 200)), 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const MARKER = `IU_LOCK_UNLOCK_${Date.now()}`;
const MAILBOX_MARKER = `IU_REAL_PC_PERSIST_${Date.now()}`;

const GUARD_BROWSER_ARGS = ["--disable-features=BackForwardCache"];

async function launchGuardPersistentContext(userDataDir) {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    args: GUARD_BROWSER_ARGS,
    viewport: { width: 1366, height: 768 },
  });
  await installLocalDataProtectionAccepted(context);
  await installBfcacheGuard(context);
  return context;
}

async function restartGuardPersistentContext(userDataDir) {
  const context = await launchGuardPersistentContext(userDataDir);
  return context;
}

const IDB_ENC_KEYS = {
  notes: "iu.notes.store.v1",
  tasks: "iu.tasks.mvp.v1",
  calendar: "iu.calendar.store.v1",
  mailbox: "iu_mailboxes_v1",
};

function logStep(scenario, step, state, detail = "") {
  const suffix = detail ? ` ${detail}` : "";
  console.log(`IU_LOCK_UNLOCK_${scenario}_${step}_${state}${suffix}`);
}

async function runStep(scenario, step, fails, fn, timeoutMs) {
  logStep(scenario, step, "START");
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${step}_TIMEOUT_${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    logStep(scenario, step, "PASS");
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).slice(0, 160);
    fails.push(`${scenario}_${step}:${msg}`);
    logStep(scenario, step, "FAIL", msg);
    throw e;
  }
}

async function ensureDesktopMindMenuOverlay(page, scenario, fails, timeoutMs = 60000) {
  logStep(scenario, "DESKTOP_OVERLAY", "START");
  await page.evaluate(() => {
    document.body.classList.add("iu-desktop-home-grid");
  });
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureFeedPipeline === "function") {
      await window.__iuEnsureFeedPipeline();
    }
  });
  try {
    await page.waitForFunction(
      () => typeof window.iuArticleActionsOpenOverlay === "function",
      null,
      { timeout: timeoutMs }
    );
  } catch (e) {
    fails.push(`${scenario}_overlay_fn_missing`);
    logStep(scenario, "DESKTOP_OVERLAY", "FAIL", String(e.message || e).slice(0, 120));
    return false;
  }
  await page.evaluate(async () => {
    await window.iuArticleActionsOpenOverlay();
  });
  logStep(scenario, "DESKTOP_OVERLAY", "PASS");
  return true;
}

async function readIdbEncPresence(page, keys = IDB_ENC_KEYS) {
  return page.evaluate(async (keyMap) => {
    const { readRecord } = await import("/assets/iu-vault-db-v1.js");
    const out = {};
    for (const [name, storageKey] of Object.entries(keyMap)) {
      out[name] = !!(await readRecord(storageKey));
    }
    return out;
  }, keys);
}

async function enableVirtualAuthenticator(page) {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { client, authenticatorId };
}

function staticChecks(fails) {
  const lockJs = require("fs").readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");
  const bootJs = require("fs").readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  const uiJs = require("fs").readFileSync(path.join(REPO, "assets", "iu-vault-ui-v1.js"), "utf8");
  const indexHtml = require("fs").readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const appJs = require("fs").readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  if (!/clearVaultMemoryCache/.test(lockJs)) fails.push("lock_missing_cache_clear");
  if (!/afterUnlock/.test(bootJs) || !/preloadAllVaultRecords/.test(bootJs)) {
    fails.push("bootstrap_missing_unlock_hydrate");
  }
  if (!/flushPendingVaultWrites[\s\S]{0,200}?migratePlaintextToVault/.test(bootJs)) {
    fails.push("bootstrap_after_unlock_missing_flush_before_migrate");
  }
  if (!/iuVaultAppLockScreen/.test(indexHtml)) fails.push("index_missing_global_lock_screen");
  if (!/initGlobalAppLock/.test(bootJs)) fails.push("bootstrap_missing_global_app_lock");
  if (!/refreshGlobalAppLockUi/.test(bootJs)) fails.push("bootstrap_missing_refresh_app_lock");
  if (!/isVaultPersistBlocked|__iuVaultDeferMindMenuMount|__iuVaultHydrationComplete/.test(bootJs)) {
    fails.push("bootstrap_missing_persist_hydration_guards");
  }
  const storageJs = require("fs").readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8");
  if (!/isVaultPersistBlocked/.test(storageJs)) fails.push("storage_missing_persist_block");
  const pipelineJs = require("fs").readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");
  if (!/__iuVaultDeferMindMenuMount/.test(pipelineJs)) fails.push("pipeline_missing_defer_mount");
  if (!/repairVaultMetaFromKeys|readSecurityConfiguredState/.test(lockJs)) {
    fails.push("lock_missing_meta_repair");
  }
  if (!/mindMenuUnlockMethod|resolveMindMenuUnlockMethod/.test(lockJs)) {
    fails.push("lock_missing_unlock_method");
  }
  if (!/data-iu-vault-ui-version/.test(uiJs) || !/InfoUzel je chráněn|Zabezpečení InfoUzlu/.test(uiJs)) {
    fails.push("ui_missing_global_lock_ux");
  }
  if (!/pickerDraftMethod|iuVaultPinSetupBlock/.test(uiJs)) {
    fails.push("ui_missing_picker_draft");
  }
  if (!/flushPendingVaultWrites/.test(require("fs").readFileSync(path.join(REPO, "assets", "iu-vault-storage-v1.js"), "utf8"))) {
    fails.push("storage_missing_flush_pending");
  }
  if (!/iuVaultHasEncBlob|iuVaultIsPersistBlocked/.test(pipelineJs)) {
    fails.push("pipeline_missing_mailbox_vault_adapter");
  }
  if (!/hasVaultEncBlob/.test(appJs) || !/iu-vault-hydrated/.test(appJs)) {
    fails.push("tasks_missing_vault_hydrate_guard");
  }
  if (!/isPersistBlocked/.test(appJs)) fails.push("tasks_missing_persist_block");
}

async function seedMindMenuMailbox(page, marker) {
  const mailboxSeed = JSON.stringify({
    items: [{ label: marker, url: "https://example.com/" + marker, social: null, hidden: false, slot: 1 }],
  });
  await page.evaluate(
    async ({ mailboxSeed, marker }) => {
      localStorage.setItem("iu_mailboxes_v1", mailboxSeed);
      if (typeof window.iuVault?.flushPendingWrites === "function") {
        await window.iuVault.flushPendingWrites();
      }
      if (typeof window.iuVault?.afterUnlock === "function" && window.iuVault.getState().unlocked) {
        await window.iuVault.afterUnlock();
      }
    },
    { mailboxSeed, marker }
  );
  await page.waitForTimeout(300);
  return mailboxSeed;
}

async function readMailboxMarker(page, marker) {
  return page.evaluate((needle) => {
    try {
      const raw = localStorage.getItem("iu_mailboxes_v1") || "";
      if (raw.includes(needle)) return needle;
    } catch (_) {}
    return null;
  }, marker);
}

async function readSecurityUiState(page) {
  return page.evaluate(async () => {
    const meta = await window.iuVault.getMeta();
    const configured = await window.iuVault.getSecurityConfigured();
    const setupPinBtn = document.getElementById("iuVaultSetupPinBtn");
    const pinActive = document.getElementById("iuVaultPinActiveStatus");
    const devBtn = document.getElementById("iuVaultEnableDeviceBtn");
    const devActive = document.getElementById("iuVaultDeviceActiveStatus");
    return {
      metaPin: !!(meta && meta.pinEnabled),
      metaDev: !!(meta && meta.deviceEnabled),
      configuredPin: !!(configured && configured.pinConfigured),
      configuredDev: !!(configured && configured.deviceConfigured),
      setupPinHidden: setupPinBtn ? setupPinBtn.hidden : null,
      pinActiveVisible: pinActive ? !pinActive.hidden : null,
      devBtnHidden: devBtn ? devBtn.hidden : null,
      devActiveVisible: devActive ? !devActive.hidden : null,
    };
  });
}

async function openInfoCenterPrivacy(page) {
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent("iu:info-center-mounted"));
    const panel = document.getElementById("iuInfoCenterDetailPrivacy");
    if (panel) panel.hidden = false;
  });
  await page.waitForTimeout(300);
}

async function seedPersonalData(page, noteSeed, taskSeed, calSeed) {
  await page.evaluate(
    async ({ noteSeed, taskSeed, calSeed }) => {
      localStorage.setItem("iu.notes.store.v1", noteSeed);
      localStorage.setItem("iu.tasks.mvp.v1", taskSeed);
      localStorage.setItem("iu.calendar.store.v1", calSeed);
      if (typeof window.iuVault?.flushPendingWrites === "function") {
        await window.iuVault.flushPendingWrites();
      }
      if (typeof window.iuVault?.afterUnlock === "function" && window.iuVault.getState().unlocked) {
        await window.iuVault.afterUnlock();
      }
    },
    { noteSeed, taskSeed, calSeed }
  );
  await page.waitForTimeout(300);
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

async function activateProtection(page) {
  const pinSetup = await page.evaluate(async () => {
    try {
      await window.iuVault.setupPin("847291", "847291");
      return { ok: true, locked: !window.iuVault.getState().unlocked, mode: "l3" };
    } catch (e) {
      return { ok: false, reason: String(e.message || e) };
    }
  });
  if (pinSetup.ok) return { mode: "l3", setup: pinSetup };

  try {
    const virtualAuth = await enableVirtualAuthenticator(page);
    const setup = await page.evaluate(async () => {
      try {
        const supported = await window.iuVault.detectDeviceSupport();
        if (!supported) return { ok: false, reason: "unsupported" };
        await window.iuVault.setupDevice();
        return { ok: true, locked: !window.iuVault.getState().unlocked, mode: "l2" };
      } catch (e) {
        return { ok: false, reason: String(e.message || e) };
      }
    });
    if (setup.ok) return { mode: "l2", virtualAuth, setup };
    return { mode: null, reason: setup.reason || pinSetup.reason };
  } catch (e) {
    return { mode: null, reason: pinSetup.reason || String(e.message || e) };
  }
}

async function waitForVaultBootReady(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => {
      const phase = window.__iuVaultBootPhase;
      if (phase === "locked" || phase === "unlocked") return true;
      if (document.documentElement.classList.contains("iu-vault-app-locked")) return true;
      return !document.documentElement.classList.contains("iu-vault-app-init");
    },
    null,
    { timeout: timeoutMs }
  );
}

async function installBfcacheGuard(context) {
  await context.addInitScript(() => {
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) {
        window.location.reload();
      }
    });
  });
}

async function waitForMigrateLockFree(page, timeoutMs = 15000) {
  await page.waitForFunction(async () => {
    if (!navigator.locks || typeof navigator.locks.query !== "function") return true;
    const state = await navigator.locks.query();
    const held = state && Array.isArray(state.held) ? state.held : [];
    return !held.some((lock) => lock && lock.name === "iu-vault-migrate");
  }, null, { timeout: timeoutMs });
}

async function unlockProtection(page, mode, scenario = "UNLOCK") {
  await waitForMigrateLockFree(page, 15000);
  logStep(scenario, "UNLOCK_REQUEST", "START");
  if (mode === "l2") {
    await page.evaluate(async () => {
      await window.iuVault.unlockDevice();
    });
  } else {
    await page.evaluate(async () => {
      await window.iuVault.unlockPin("847291");
    });
  }
  await page.waitForFunction(() => window.iuVault.getState().unlocked, null, { timeout: 60000 });
  logStep(scenario, "UNLOCK_REQUEST", "PASS");
  logStep(scenario, "HYDRATE", "START");
  await page.evaluate(async () => {
    if (typeof window.iuVault?.flushPendingWrites === "function") {
      await window.iuVault.flushPendingWrites();
    }
    if (typeof window.iuVault?.afterUnlock === "function") {
      await window.iuVault.afterUnlock();
    }
  });
  await page.waitForFunction(
    () => window.__iuVaultHydrationComplete === true,
    null,
    { timeout: 120000 }
  );
  logStep(scenario, "HYDRATE", "PASS");
  logStep(scenario, "MARKERS", "START");
  await waitForMarkers(page, MARKER, 90000);
  logStep(scenario, "MARKERS", "PASS");
}

async function readModuleMarkers(page) {
  return page.evaluate((needle) => {
    const out = { notes: null, tasks: null, calendar: null };
    try {
      const n = localStorage.getItem("iu.notes.store.v1");
      if (n && n.includes(needle)) out.notes = needle;
    } catch (_) {}
    try {
      const t = localStorage.getItem("iu.tasks.mvp.v1");
      if (t && t.includes(needle)) out.tasks = needle;
    } catch (_) {}
    try {
      const c = localStorage.getItem("iu.calendar.store.v1");
      if (c && c.includes(needle)) out.calendar = needle;
    } catch (_) {}
    try {
      const snap = window.iuTasksService && window.iuTasksService.tasksGetSnapshot
        ? window.iuTasksService.tasksGetSnapshot()
        : [];
      if (Array.isArray(snap) && snap.some((x) => String(x.title || "").includes(needle))) out.tasksService = needle;
    } catch (_) {}
    return out;
  }, MARKER);
}

async function main() {
  const fails = [];
  staticChecks(fails);

  let serverProc = null;
  let profileDir = null;
  let context = null;
  let page = null;
  let page2 = null;

  const serverInfo = await startGuardStaticServer(PORT);
  serverProc = serverInfo.proc;
  const activePort = serverInfo.port;
  const activeBase = `http://127.0.0.1:${activePort}/projects/`;

  profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-lock-unlock-guard-"));
  context = await launchGuardPersistentContext(profileDir);

  const noteSeed = JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "lu1", title: MARKER, body: "note-body", tags: [], createdAt: 1, updatedAt: 1 }],
  });
  const taskSeed = JSON.stringify({
    schemaVersion: 1,
    tasks: [{ id: "lu1", title: MARKER, status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }],
  });
  const calSeed = JSON.stringify({
    schemaVersion: 1,
    events: [{ id: "lu1", title: MARKER, start: "2026-08-23T10:00:00", end: "2026-08-23T11:00:00" }],
  });

  await installProtectedStorageSeed(context, [
    { key: "iu.notes.store.v1", value: noteSeed },
    { key: "iu.tasks.mvp.v1", value: taskSeed },
    { key: "iu.calendar.store.v1", value: calSeed },
  ]);

  page = await context.newPage();
  page.setDefaultTimeout(180000);

  try {
    console.log("IU_LOCK_UNLOCK_GUARD_START");
    await runStep("MAIN", "BROWSER_LOAD", fails, async () => {
      await page.goto(`${activeBase}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await waitForVaultReady(page);
    }, 130000);
    logStep("MAIN", "VAULT_INIT", "PASS");

    await runStep("MAIN", "WRITE", fails, async () => {
      await seedPersonalData(page, noteSeed, taskSeed, calSeed);
      await seedMindMenuMailbox(page, MAILBOX_MARKER);
    }, 120000);
    logStep("MAIN", "PERSISTENCE", "START");
    const beforeProtect = await readModuleMarkers(page);
    const beforeMailbox = await readMailboxMarker(page, MAILBOX_MARKER);
    if (!beforeProtect.notes || !beforeProtect.tasks) fails.push("seed_not_visible_before_protect");
    if (!beforeMailbox) fails.push("mailbox_seed_not_visible_before_protect");
    const encBeforeProtect = await readIdbEncPresence(page, { mailbox: IDB_ENC_KEYS.mailbox });
    if (!encBeforeProtect.mailbox) fails.push("mailbox_missing_enc_before_protect");
    if (fails.some((f) => f.startsWith("seed_") || f.startsWith("mailbox_seed"))) {
      logStep("MAIN", "PERSISTENCE", "FAIL");
    } else {
      logStep("MAIN", "PERSISTENCE", "PASS");
    }

    const activated = await activateProtection(page);
    if (!activated.mode) {
      fails.push(`protection_setup:${activated.reason || "failed"}`);
    } else {
      if (!activated.setup.locked) fails.push("protection_setup_should_lock");

      await openInfoCenterPrivacy(page);
      await page.evaluate(async () => {
        const section = document.getElementById("iuVaultSecuritySection");
        if (!section) document.dispatchEvent(new CustomEvent("iu:info-center-mounted"));
      });
      await page.waitForTimeout(400);
      const securityUiAfterSetup = await readSecurityUiState(page);
      if (activated.mode === "l3") {
        if (!securityUiAfterSetup.configuredPin) fails.push("pin_not_configured_after_setup");
        if (!securityUiAfterSetup.metaPin) fails.push("pin_meta_not_set_after_setup");
      } else if (activated.mode === "l2") {
        if (!securityUiAfterSetup.configuredDev) fails.push("device_not_configured_after_setup");
        if (!securityUiAfterSetup.metaDev) fails.push("device_meta_not_set_after_setup");
      }

      const encBeforeLock = await readIdbEncPresence(page);
      if (!encBeforeLock.notes || !encBeforeLock.tasks) fails.push("missing_enc_before_lock");
      if (!encBeforeLock.mailbox) fails.push("mailbox_missing_enc_before_lock");

      await runStep("MAIN", "LOCK", fails, async () => {
        await page.evaluate(async () => {
          await window.iuVault.lock();
        });
      }, 60000);

      const lockedState = await page.evaluate(() => {
        const st = window.iuVault.getState();
        let notesPlain = null;
        let tasksPlain = null;
        try {
          notesPlain = localStorage.getItem("iu.notes.store.v1");
          tasksPlain = localStorage.getItem("iu.tasks.mvp.v1");
        } catch (_) {}
        const overlay = document.getElementById("iuVaultAppLockScreen");
        return {
          unlocked: st.unlocked,
          notesPlain,
          tasksPlain,
          globalLockVisible: overlay ? !overlay.hidden : false,
          htmlLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
        };
      });

      if (lockedState.unlocked) fails.push("should_be_locked");
      if (lockedState.notesPlain || lockedState.tasksPlain) fails.push("plaintext_visible_while_locked");
      if (!lockedState.globalLockVisible) fails.push("global_lock_hidden_while_locked");
      if (!lockedState.htmlLocked) fails.push("html_not_locked_while_locked");

      const encWhileLocked = await readIdbEncPresence(page, { notes: IDB_ENC_KEYS.notes, tasks: IDB_ENC_KEYS.tasks });
      if (!encWhileLocked.notes || !encWhileLocked.tasks) fails.push("enc_deleted_on_lock");

      await ensureDesktopMindMenuOverlay(page, "LOCKED", fails, 60000);

      const lockedGateUi = await page.evaluate(async () => {
        const screen = document.getElementById("iuVaultAppLockScreen");
        let getMdkFailed = false;
        try {
          const { getMdk } = await import("/assets/iu-vault-lock-v1.js");
          getMdk();
        } catch (e) {
          getMdkFailed = String(e.message || e).includes("VAULT_LOCKED");
        }
        return {
          globalLockVisible: screen ? !screen.hidden : false,
          htmlLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
          getMdkFailed,
        };
      });
      if (!lockedGateUi.globalLockVisible) fails.push("global_lock_hidden_while_app_used");
      if (!lockedGateUi.getMdkFailed) fails.push("mdk_accessible_while_locked");
      else logStep("MAIN", "LOCKED_ACCESS_DENIED", "PASS");

      await runStep("MAIN", "UNLOCK", fails, async () => {
        await unlockProtection(page, activated.mode, "MAIN");
      }, 180000);

      const afterUnlock = await readModuleMarkers(page);
      const afterUnlockMailbox = await readMailboxMarker(page, MAILBOX_MARKER);
      if (!afterUnlock.notes) fails.push("notes_lost_after_unlock");
      if (!afterUnlock.tasks && !afterUnlock.tasksService) fails.push("tasks_lost_after_unlock");
      if (!afterUnlock.calendar) fails.push("calendar_lost_after_unlock");
      if (!afterUnlockMailbox) fails.push("mailbox_lost_after_unlock");
      else logStep("MAIN", "DATA_PRESERVATION", "PASS");

      await ensureDesktopMindMenuOverlay(page, "UNLOCKED", fails, 60000);

      const gateUi = await page.evaluate(() => {
        const screen = document.getElementById("iuVaultAppLockScreen");
        const host = document.getElementById("iuMyInfoUzelMindMenuHost");
        return {
          globalLockHidden: screen ? screen.hidden : true,
          hostHidden: host ? host.hidden : false,
        };
      });
      if (!gateUi.globalLockHidden) fails.push("global_lock_visible_while_unlocked");
      if (gateUi.hostHidden) fails.push("mindmenu_host_hidden_while_unlocked");

      await runStep("MAIN", "RELOAD", fails, async () => {
        await page.evaluate(async () => {
          if (typeof window.iuVault?.lock === "function") {
            await window.iuVault.lock();
          }
          if (typeof window.iuVault?.flushPendingWrites === "function") {
            await window.iuVault.flushPendingWrites();
          }
        });
        await page.goto(`${activeBase}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 });
        await waitForVaultBootReady(page, 30000);
      }, 130000);

      if (activated.mode === "l2") {
        try {
          await enableVirtualAuthenticator(page);
        } catch (e) {
          fails.push(`virtual_auth_reload:${e.message || e}`);
        }
      }

      const lockedAfterReload = await page.evaluate(() => !window.iuVault.getState().unlocked);
      if (!lockedAfterReload) fails.push("should_be_locked_after_reload");

      const hydrationPending = await page.evaluate(() => ({
        pending: window.__iuVaultHydrationPending === true,
        complete: window.__iuVaultHydrationComplete === true,
      }));
      if (!hydrationPending.pending || hydrationPending.complete) {
        fails.push("hydration_should_be_pending_after_reload_while_locked");
      }

      await runStep("MAIN", "POST_RELOAD_UNLOCK", fails, async () => {
        await unlockProtection(page, activated.mode, "RELOAD");
      }, 180000);

      const afterReload = await readModuleMarkers(page);
      const afterReloadMailbox = await readMailboxMarker(page, MAILBOX_MARKER);
      if (!afterReload.notes) fails.push("notes_lost_after_reload_unlock");
      if (!afterReload.tasks && !afterReload.tasksService) fails.push("tasks_lost_after_reload_unlock");
      if (!afterReload.calendar) fails.push("calendar_lost_after_reload_unlock");
      if (!afterReloadMailbox) fails.push("mailbox_lost_after_reload_unlock");
      else logStep("MAIN", "POST_RELOAD_PRESERVATION", "PASS");

      logStep("MAIN", "CLEANUP", "START");
      if (page && !page.isClosed()) {
        await page.close().catch(() => {});
        page = null;
      }
      logStep("MAIN", "BROWSER_RESTART", "START");
      await closePlaywrightSession(null, context, null, 5000);
      context = await restartGuardPersistentContext(profileDir);
      logStep("MAIN", "BROWSER_RESTART", "PASS");
      page2 = await context.newPage();
      page2.setDefaultTimeout(180000);
      await page2.goto(`${activeBase}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page2.waitForFunction(
        () => !!(window.iuVault && typeof window.iuVault.getState === "function"),
        null,
        { timeout: 120000 }
      );

      if (activated.mode === "l2") {
        try {
          await enableVirtualAuthenticator(page2);
        } catch (e) {
          fails.push(`virtual_auth_reopen:${e.message || e}`);
        }
      }

      const encAfterReopen = await readIdbEncPresence(page2, {
        notes: IDB_ENC_KEYS.notes,
        tasks: IDB_ENC_KEYS.tasks,
        mailbox: IDB_ENC_KEYS.mailbox,
      });
      if (!encAfterReopen.notes || !encAfterReopen.tasks) fails.push("enc_missing_after_browser_reopen");
      if (!encAfterReopen.mailbox) fails.push("mailbox_enc_missing_after_browser_reopen");

      await page2.waitForFunction(
        () => {
          const phase = window.__iuVaultBootPhase;
          if (phase === "locked" || phase === "unlocked") return true;
          if (document.documentElement.classList.contains("iu-vault-app-locked")) return true;
          return !document.documentElement.classList.contains("iu-vault-app-init");
        },
        null,
        { timeout: 30000 }
      );
      logStep("REOPEN", "DESKTOP_OVERLAY", "START");
      await page2.evaluate(() => {
        document.body.classList.add("iu-desktop-home-grid");
      });
      const gateAfterReopen = await page2.evaluate(() => {
        const screen = document.getElementById("iuVaultAppLockScreen");
        const host = document.getElementById("iuMyInfoUzelMindMenuHost");
        return {
          globalLockVisible: screen ? !screen.hidden : false,
          htmlLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
          hostHidden: host ? host.hidden : false,
          mindMenuMounted: !!(host && host.querySelector("#iuMindMenuView, .mindMenu")),
        };
      });
      if (!gateAfterReopen.globalLockVisible) fails.push("global_lock_hidden_after_browser_reopen");
      if (!gateAfterReopen.htmlLocked) fails.push("html_not_locked_after_browser_reopen");
      if (gateAfterReopen.mindMenuMounted && !gateAfterReopen.hostHidden) {
        fails.push("mindmenu_accessible_before_unlock_after_reopen");
      }
      logStep("REOPEN", "DESKTOP_OVERLAY", "PASS");

      await runStep("MAIN", "REOPEN_UNLOCK", fails, async () => {
        await unlockProtection(page2, activated.mode, "REOPEN");
      }, 180000);

      const afterReopen = await readModuleMarkers(page2);
      const afterReopenMailbox = await readMailboxMarker(page2, MAILBOX_MARKER);
      if (!afterReopen.notes) fails.push("notes_lost_after_browser_reopen");
      if (!afterReopen.tasks && !afterReopen.tasksService) fails.push("tasks_lost_after_browser_reopen");
      if (!afterReopen.calendar) fails.push("calendar_lost_after_browser_reopen");
      if (!afterReopenMailbox) fails.push("mailbox_lost_after_browser_reopen");
      logStep("MAIN", "CLEANUP", "PASS");
    }
  } catch (stepErr) {
    if (!fails.length) fails.push(`guard_abort:${String(stepErr.message || stepErr).slice(0, 160)}`);
  } finally {
    logStep("MAIN", "BROWSER_CLOSE", "START");
    try {
      if (page2 && !page2.isClosed()) await page2.close().catch(() => {});
      if (page && !page.isClosed()) await page.close().catch(() => {});
      await closePlaywrightSession(null, context, null, 5000);
    } catch (_) {}
    context = null;
    page = null;
    page2 = null;
    if (profileDir) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch (_) {}
      profileDir = null;
    }
    logStep("MAIN", "BROWSER_CLOSE", "PASS");
    logStep("MAIN", "SERVER_STOP", "START");
    try {
      await stopGuardProcess(serverProc, 4000);
    } catch (_) {}
    serverProc = null;
    logStep("MAIN", "SERVER_STOP", "PASS");
  }

  const report = {
    IU_VAULT_LOCK_UNLOCK_PRESERVES_DATA_GUARD: fails.length ? "FAIL" : "PASS",
    fails,
    marker: MARKER,
    mailboxMarker: MAILBOX_MARKER,
  };
  console.log(JSON.stringify(report));
  if (fails.length) {
    console.error("IU_VAULT_LOCK_UNLOCK_PRESERVES_DATA_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_LOCK_UNLOCK_PRESERVES_DATA_GUARD_PASS");
  console.log("IU_LOCK_UNLOCK_COMPLETE_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
