#!/usr/bin/env node
/**
 * Lock → unlock must preserve encrypted personal data (L2 desktop flow).
 * Run: npm run iu-vault-lock-unlock-preserves-data-guard
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8970", 10);
const BASE = `http://localhost:${PORT}/projects/`;
const MARKER = `IU_LOCK_UNLOCK_${Date.now()}`;
const MAILBOX_MARKER = `IU_REAL_PC_PERSIST_${Date.now()}`;

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
      if (typeof window.iuVault?.afterUnlock === "function" && window.iuVault.getState().unlocked) {
        await window.iuVault.afterUnlock();
      }
      if (typeof window.iuVault?.flushPendingWrites === "function") {
        await window.iuVault.flushPendingWrites();
      }
    },
    { mailboxSeed, marker }
  );
  await page.waitForTimeout(500);
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

async function unlockProtection(page, mode) {
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
  await page.evaluate(async () => {
    if (typeof window.iuVault.afterUnlock === "function") {
      await window.iuVault.afterUnlock();
    }
  });
  await page.waitForTimeout(500);
  await waitForMarkers(page, MARKER, 90000);
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

  const page = await context.newPage();

  try {
    await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page);
    await seedPersonalData(page, noteSeed, taskSeed, calSeed);
    await seedMindMenuMailbox(page, MAILBOX_MARKER);

    const beforeProtect = await readModuleMarkers(page);
    const beforeMailbox = await readMailboxMarker(page, MAILBOX_MARKER);
    if (!beforeProtect.notes || !beforeProtect.tasks) fails.push("seed_not_visible_before_protect");
    if (!beforeMailbox) fails.push("mailbox_seed_not_visible_before_protect");

    const encBeforeProtect = await page.evaluate(() => ({
      mailbox: !!localStorage.getItem("iu:vault:enc:v1:iu_mailboxes_v1"),
    }));
    if (!encBeforeProtect.mailbox) fails.push("mailbox_missing_enc_before_protect");

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

      const encBeforeLock = await page.evaluate(() => ({
        notes: !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1"),
        tasks: !!localStorage.getItem("iu:vault:enc:v1:iu.tasks.mvp.v1"),
        calendar: !!localStorage.getItem("iu:vault:enc:v1:iu.calendar.store.v1"),
        mailbox: !!localStorage.getItem("iu:vault:enc:v1:iu_mailboxes_v1"),
      }));
      if (!encBeforeLock.notes || !encBeforeLock.tasks) fails.push("missing_enc_before_lock");
      if (!encBeforeLock.mailbox) fails.push("mailbox_missing_enc_before_lock");

      await page.evaluate(async () => {
        await window.iuVault.lock();
      });

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

      const encWhileLocked = await page.evaluate(() => ({
        notes: !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1"),
        tasks: !!localStorage.getItem("iu:vault:enc:v1:iu.tasks.mvp.v1"),
      }));
      if (!encWhileLocked.notes || !encWhileLocked.tasks) fails.push("enc_deleted_on_lock");

      await page.evaluate(() => {
        document.body.classList.add("iu-desktop-home-grid");
      });
      await page.waitForFunction(
        () => typeof window.iuArticleActionsOpenOverlay === "function",
        null,
        { timeout: 180000 }
      );
      await page.evaluate(async () => {
        await window.iuArticleActionsOpenOverlay();
      });

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

      await unlockProtection(page, activated.mode);

      const afterUnlock = await readModuleMarkers(page);
      const afterUnlockMailbox = await readMailboxMarker(page, MAILBOX_MARKER);
      if (!afterUnlock.notes) fails.push("notes_lost_after_unlock");
      if (!afterUnlock.tasks && !afterUnlock.tasksService) fails.push("tasks_lost_after_unlock");
      if (!afterUnlock.calendar) fails.push("calendar_lost_after_unlock");
      if (!afterUnlockMailbox) fails.push("mailbox_lost_after_unlock");

      await page.evaluate(() => {
        document.body.classList.add("iu-desktop-home-grid");
      });
      await page.waitForFunction(
        () => typeof window.iuArticleActionsOpenOverlay === "function",
        null,
        { timeout: 180000 }
      );
      await page.evaluate(async () => {
        await window.iuArticleActionsOpenOverlay();
      });

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

      await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 });

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

      await unlockProtection(page, activated.mode);

      const afterReload = await readModuleMarkers(page);
      const afterReloadMailbox = await readMailboxMarker(page, MAILBOX_MARKER);
      if (!afterReload.notes) fails.push("notes_lost_after_reload_unlock");
      if (!afterReload.tasks && !afterReload.tasksService) fails.push("tasks_lost_after_reload_unlock");
      if (!afterReload.calendar) fails.push("calendar_lost_after_reload_unlock");
      if (!afterReloadMailbox) fails.push("mailbox_lost_after_reload_unlock");

      await page.close();
      const page2 = await context.newPage();
      await page2.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
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

      const encAfterReopen = await page2.evaluate(() => ({
        notes: !!localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1"),
        tasks: !!localStorage.getItem("iu:vault:enc:v1:iu.tasks.mvp.v1"),
        mailbox: !!localStorage.getItem("iu:vault:enc:v1:iu_mailboxes_v1"),
      }));
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
      await page2.evaluate(() => {
        document.body.classList.add("iu-desktop-home-grid");
      });
      await page2.waitForFunction(
        () => typeof window.iuArticleActionsOpenOverlay === "function",
        null,
        { timeout: 180000 }
      );
      await page2.evaluate(async () => {
        await window.iuArticleActionsOpenOverlay();
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

      await unlockProtection(page2, activated.mode);

      const afterReopen = await readModuleMarkers(page2);
      const afterReopenMailbox = await readMailboxMarker(page2, MAILBOX_MARKER);
      if (!afterReopen.notes) fails.push("notes_lost_after_browser_reopen");
      if (!afterReopen.tasks && !afterReopen.tasksService) fails.push("tasks_lost_after_browser_reopen");
      if (!afterReopen.calendar) fails.push("calendar_lost_after_browser_reopen");
      if (!afterReopenMailbox) fails.push("mailbox_lost_after_browser_reopen");
    }
  } finally {
    await browser.close();
    server.kill();
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
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
