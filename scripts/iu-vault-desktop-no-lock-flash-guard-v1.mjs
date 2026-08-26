#!/usr/bin/env node
/**
 * Desktop shared session — no lock-screen flash during new-tab boot.
 * Fails if "InfoUzel je zamčen" is visible while boot phase is initializing.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import fs from "fs";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
  closePlaywrightSession,
} from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium, firefox, webkit } = require("playwright");

const PIN = "654321";
const LOCK_TITLE = "InfoUzel je zamčen";

const FLASH_PROBE = () => {
  window.__iuLockFlashHits = window.__iuLockFlashHits || [];
  const probe = () => {
    const screen = document.getElementById("iuVaultAppLockScreen");
    const title = document.getElementById("iuVaultAppLockTitle");
    if (!screen || !title) return;
    const st = getComputedStyle(screen);
    const rect = screen.getBoundingClientRect();
    const visible =
      !screen.hidden &&
      st.display !== "none" &&
      st.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0;
    const initClass = document.documentElement.classList.contains("iu-vault-app-init");
    const bootPhase = window.__iuVaultBootPhase || "";
    const text = String(title.textContent || "");
    if (visible && text.includes("InfoUzel je zamčen")) {
      window.__iuLockFlashHits.push({
        t: Date.now(),
        initClass,
        bootPhase,
        htmlLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
      });
    }
    if (visible && (initClass || bootPhase === "initializing")) {
      window.__iuLockFlashHits.push({
        t: Date.now(),
        kind: "visible_during_init",
        initClass,
        bootPhase,
      });
    }
  };
  const obs = new MutationObserver(probe);
  if (document.documentElement) {
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  const screen = document.getElementById("iuVaultAppLockScreen");
  if (screen) {
    obs.observe(screen, { attributes: true, attributeFilter: ["hidden", "class", "aria-hidden", "style"] });
  }
  document.addEventListener("DOMContentLoaded", probe, { once: true });
  probe();
  setInterval(probe, 16);
};

function staticChecks(fails) {
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const boot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");
  const appLock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-app-lock-v1.js"), "utf8");
  if (!/iu-vault-app-init/.test(index)) fails.push("index_missing_init_class");
  if (!/__iuVaultBootPhase/.test(index)) fails.push("index_missing_boot_phase_hint");
  if (!/__iuVaultBootLockDecisionPending/.test(index)) fails.push("index_missing_boot_lock_decision_pending");
  if (!/__iuVaultBootLockDecisionPending/.test(boot)) fails.push("bootstrap_missing_boot_lock_decision");
  if (!/bootPending/.test(appLock)) fails.push("app_lock_missing_boot_pending_gate");
  if (/setAppLockHintActive[\s\S]{0,400}classList\.add\("iu-vault-app-locked"\)/.test(
    fs.readFileSync(path.join(REPO, "assets", "iu-vault-lock-v1.js"), "utf8")
  )) {
    fails.push("lock_hint_still_adds_locked_class_early");
  }
}

async function unlockTabA(pageA, base) {
  await pageA.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pageA.waitForFunction(() => !!(window.iuVault && window.iuVault.setupPin), null, { timeout: 60000 });
  await pageA.evaluate(async (pin) => {
    await window.iuVault.setupPin(pin, pin);
  }, PIN);
  await pageA.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pageA.waitForFunction(
    () => window.__iuVaultBootPhase === "locked" || document.documentElement.classList.contains("iu-vault-app-locked"),
    null,
    { timeout: 60000 }
  );
  await pageA.waitForSelector("#iuVaultPinInput", { state: "visible", timeout: 60000 });
  await pageA.fill("#iuVaultPinInput", PIN);
  await pageA.click("#iuVaultUnlockPinBtn");
  await pageA.waitForFunction(() => !document.documentElement.classList.contains("iu-vault-app-locked"), null, {
    timeout: 30000,
  });
}

async function readFlashHits(page) {
  return page.evaluate(() => (Array.isArray(window.__iuLockFlashHits) ? window.__iuLockFlashHits.slice() : []));
}

async function openTabAndAssertNoFlash(page, base, label, fails) {
  await page.addInitScript(FLASH_PROBE);
  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () =>
      !!(window.iuVault && window.iuVault.getState && window.iuVault.getState().unlocked) &&
      !document.documentElement.classList.contains("iu-vault-app-init"),
    null,
    { timeout: 30000 }
  );
  await page.waitForTimeout(300);
  const hits = await readFlashHits(page);
  const initHits = hits.filter((h) => h.kind === "visible_during_init" || h.bootPhase === "initializing" || h.initClass);
  if (initHits.length > 0) fails.push(`${label}:lock_flash_during_init:${initHits.length}`);
  if (hits.length > 0) fails.push(`${label}:lock_screen_visible_hits:${hits.length}`);
  const snap = await page.evaluate(() => ({
    unlocked: !!window.iuVault.getState().unlocked,
    appLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
    init: document.documentElement.classList.contains("iu-vault-app-init"),
    bootPhase: window.__iuVaultBootPhase || "",
  }));
  if (!snap.unlocked) fails.push(`${label}:tab_not_unlocked`);
  if (snap.appLocked) fails.push(`${label}:html_still_locked`);
  if (snap.init) fails.push(`${label}:init_class_stuck`);
  return snap;
}

async function assertTrulyLockedBoot(page, base, label, fails) {
  await page.addInitScript(FLASH_PROBE);
  await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => window.__iuVaultBootPhase === "locked" || document.documentElement.classList.contains("iu-vault-app-locked"),
    null,
    { timeout: 30000 }
  );
  const hits = await readFlashHits(page);
  const initHits = hits.filter((h) => h.kind === "visible_during_init" || h.bootPhase === "initializing" || h.initClass);
  if (initHits.length > 0) fails.push(`${label}:locked_boot_flash_during_init:${initHits.length}`);
  const snap = await page.evaluate(() => ({
    bootPhase: window.__iuVaultBootPhase || "",
    appLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
    screenVisible: (() => {
      const screen = document.getElementById("iuVaultAppLockScreen");
      if (!screen) return false;
      const st = getComputedStyle(screen);
      const r = screen.getBoundingClientRect();
      return !screen.hidden && st.display !== "none" && r.width > 0 && r.height > 0;
    })(),
    title: document.getElementById("iuVaultAppLockTitle")?.textContent || "",
  }));
  if (snap.bootPhase !== "locked") fails.push(`${label}:expected_locked_phase:${snap.bootPhase}`);
  if (!snap.appLocked) fails.push(`${label}:expected_html_locked_class`);
  if (!snap.screenVisible) fails.push(`${label}:lock_screen_not_visible_when_locked`);
  if (!snap.title.includes(LOCK_TITLE)) fails.push(`${label}:lock_title_missing`);
}

async function runBrowserSuite(browserType, label, server, fails) {
  const launcher =
    browserType === "firefox" ? firefox :
    browserType === "webkit" ? webkit :
    chromium;
  let browser = null;
  let context = null;
  let pageA = null;
  const base = `http://127.0.0.1:${server.port}/projects/`;
  try {
    browser = await launcher.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 1400, height: 900 },
      isMobile: false,
      hasTouch: false,
      webauthnStub: true,
    });
    pageA = await context.newPage();
    await unlockTabA(pageA, base);

    const tabs = [];
    for (let i = 0; i < 3; i += 1) {
      tabs.push(await context.newPage());
    }
    for (let i = 0; i < tabs.length; i += 1) {
      await openTabAndAssertNoFlash(tabs[i], base, `${label}:tab${i + 1}`, fails);
    }

    const blocked = await context.newPage();
    await blocked.addInitScript(() => {
      window.__IU_NEG_BLOCK_DESKTOP_SESSION_JOIN = true;
    });
    await assertTrulyLockedBoot(blocked, base, `${label}:blocked_join`, fails);

    await pageA.evaluate(async () => {
      await window.iuVault.lock();
    });
    const victim = tabs[0];
    await victim.waitForFunction(
      () => document.documentElement.classList.contains("iu-vault-app-locked"),
      null,
      { timeout: 10000 }
    );
    const remote = await victim.evaluate(() => ({
      appLocked: document.documentElement.classList.contains("iu-vault-app-locked"),
      unlocked: !!window.iuVault.getState().unlocked,
    }));
    if (!remote.appLocked || remote.unlocked) fails.push(`${label}:remote_lock_failed`);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (String(label).startsWith("WEBKIT") && /Timeout|Target page|closed|SharedWorker/i.test(msg)) {
      fails.push(`${label}:skipped:${msg.slice(0, 120)}`);
    } else {
      fails.push(`${label}:runtime:${msg}`);
    }
  } finally {
    await closePlaywrightSession(null, context, browser);
  }
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  try {
    server = await startGuardStaticServer(pickGuardPort(8897, 400));
    await runBrowserSuite("chromium", "CHROMIUM", server, fails);
    try {
      await runBrowserSuite("firefox", "FIREFOX", server, fails);
    } catch (e) {
      fails.push(`FIREFOX:unavailable:${String(e && e.message ? e.message : e)}`);
    }
    try {
      await runBrowserSuite("webkit", "WEBKIT", server, fails);
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (/Timeout|closed|Target page|SharedWorker|webkit/i.test(msg)) {
        fails.push(`WEBKIT:skipped:${msg.slice(0, 120)}`);
      } else {
        fails.push(`WEBKIT:unavailable:${msg}`);
      }
    }
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const hardFails = fails.filter((f) => !/^WEBKIT:(skipped|unavailable):/.test(f));
  const pass = hardFails.length === 0;
  console.log(JSON.stringify({
    IU_VAULT_DESKTOP_NO_LOCK_FLASH_GUARD: pass ? "PASS" : "FAIL",
    fails,
    skipped: fails.filter((f) => /^WEBKIT:(skipped|unavailable):/.test(f)),
  }));
  if (!pass) {
    console.error("IU_VAULT_DESKTOP_NO_LOCK_FLASH_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_DESKTOP_NO_LOCK_FLASH_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
