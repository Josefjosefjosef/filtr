#!/usr/bin/env node
/**
 * Global app lock guard — L2/L3 locks entire InfoUzel, overlay removal bypass fails closed.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8986", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

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
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const boot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  const appLock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-app-lock-v1.js"), "utf8");
  const ui = fs.readFileSync(path.join(REPO, "assets", "iu-vault-ui-v1.js"), "utf8");
  const lock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8");

  if (!/id="iuVaultAppLockScreen"/.test(index)) fails.push("index_missing_app_lock_screen");
  if (!/iu:vault:app-lock-active:v1/.test(index)) fails.push("index_missing_sync_hint");
  if (!/iu-vault-app-locked/.test(index)) fails.push("index_missing_lock_css");
  if (!/initGlobalAppLock/.test(boot)) fails.push("bootstrap_missing_global_lock");
  if (!/isAppLocked/.test(boot)) fails.push("bootstrap_missing_isAppLocked");
  if (!/refreshGlobalAppLockUi/.test(appLock)) fails.push("app_lock_missing_refresh");
  if (!/Odemknout InfoUzel/.test(index)) fails.push("index_missing_unlock_label");
  if (/MindMenu je zamčen/.test(ui) && !/MindMenu-only gate retired/.test(ui)) {
    fails.push("ui_still_mindmenu_primary_lock_copy");
  }
  if (!/APP_LOCK_HINT_KEY/.test(lock)) fails.push("lock_missing_hint_key");
  if (!/BroadcastChannel/.test(lock)) fails.push("lock_missing_multitab_broadcast");
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
    waitForPort("127.0.0.1", PORT, 60000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 }, isMobile: false });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page);

    const l1 = await page.evaluate(() => ({
      lockedClass: document.documentElement.classList.contains("iu-vault-app-locked"),
      screenHidden: document.getElementById("iuVaultAppLockScreen")?.hidden !== false,
      unlocked: window.iuVault.getState().unlocked,
    }));
    if (l1.lockedClass || !l1.screenHidden || !l1.unlocked) fails.push("l1_should_not_show_global_lock");

    const bypass = await page.evaluate(async () => {
      if (window.PublicKeyCredential) {
        PublicKeyCredential.getClientCapabilities = async () => ({ "extension:prf": true });
      }
      const origCreate = navigator.credentials.create.bind(navigator.credentials);
      const origGet = navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.create = async () => ({
        type: "public-key",
        rawId: new Uint8Array([5, 6, 7, 8]).buffer,
        getClientExtensionResults() {
          return { prf: { enabled: true } };
        },
      });
      navigator.credentials.get = async () => ({
        type: "public-key",
        rawId: new Uint8Array([5, 6, 7, 8]).buffer,
        getClientExtensionResults() {
          return { prf: { enabled: true, results: { first: new Uint8Array(32).fill(3) } } };
        },
      });
      try {
        await window.iuVault.setupDevice();
      } catch (_) {
        return { setupOk: false };
      } finally {
        navigator.credentials.create = origCreate;
        navigator.credentials.get = origGet;
      }
      const lockedAfterSetup = !window.iuVault.getState().unlocked;
      const screen = document.getElementById("iuVaultAppLockScreen");
      if (screen) {
        screen.remove();
      }
      document.documentElement.classList.remove("iu-vault-app-locked");
      let vaultReadFailed = false;
      try {
        localStorage.setItem("iu.notes.store.v1", '{"schemaVersion":1,"notes":[]}');
      } catch (_) {}
      try {
        await window.iuVault.flushPendingWrites();
      } catch (_) {}
      try {
        const raw = localStorage.getItem("iu.notes.store.v1");
        if (raw && raw.includes("schemaVersion")) vaultReadFailed = false;
      } catch (_) {}
      let getMdkFailed = false;
      try {
        const { getMdk } = await import("/assets/iu-vault-lock-v1.js");
        getMdk();
      } catch (e) {
        getMdkFailed = String(e.message || e).includes("VAULT_LOCKED");
      }
      return {
        setupOk: true,
        lockedAfterSetup,
        getMdkFailed,
        htmlLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
      };
    });

    if (!bypass.setupOk) fails.push("device_setup_for_bypass");
    else {
      if (!bypass.lockedAfterSetup) fails.push("l2_should_lock_after_setup");
      if (!bypass.getMdkFailed) fails.push("overlay_removal_bypass_getMdk");
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("IU_VAULT_GLOBAL_APP_LOCK=" + JSON.stringify({ fails }));
  if (fails.length) {
    console.error("IU_VAULT_GLOBAL_APP_LOCK_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_GLOBAL_APP_LOCK_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
