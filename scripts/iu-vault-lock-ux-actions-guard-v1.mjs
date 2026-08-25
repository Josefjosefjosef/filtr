#!/usr/bin/env node
/**
 * Lock UX guards (post #10064 physical regressions):
 * - L3/L2 exactly one primary unlock action (CSS must honor [hidden])
 * - PWA unlock button clickable after visibilitychange
 * - Wrong PIN keeps input editable; second attempt succeeds without reload
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
const WRONG = "000000";

function staticChecks(fails) {
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(REPO, "assets", "iu-info-center.css"), "utf8");
  const appLock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-app-lock-v1.js"), "utf8");
  const ui = fs.readFileSync(path.join(REPO, "assets", "iu-vault-ui-v1.js"), "utf8");
  const boot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-bootstrap-v1.js"), "utf8");

  if (!/#iuVaultAppLockScreen \.iuInfoCenter__btn\[hidden\]/.test(index)
    || !/display:\s*none\s*!important/.test(index)) {
    fails.push("critical_css_missing_btn_hidden_override");
  }
  if (!/#iuVaultAppLockScreen \.iuInfoCenter__btn\[hidden\]/.test(css)
    && !/\.iuVaultLockOverlay__panel \.iuInfoCenter__btn\[hidden\]/.test(css)) {
    fails.push("info_center_css_missing_btn_hidden_override");
  }
  if (!/resetAppLockUnlockControls/.test(appLock)) fails.push("missing_reset_unlock_controls");
  if (!/ensurePinInputEditable/.test(appLock)) fails.push("missing_ensure_pin_editable");
  if (!/visibilitychange/.test(appLock)) fails.push("missing_visibility_reenable");
  if (!/applyUnlockActionVisibility/.test(appLock)) fails.push("missing_action_visibility_helper");
  if (/setDeviceSetupBusy[\s\S]{0,220}iuVaultUnlockDeviceBtn/.test(ui)) {
    fails.push("device_setup_busy_still_disables_lock_unlock_btn");
  }
  if (!/__iuVaultHydrationPending = false/.test(boot)) {
    fails.push("bootstrap_missing_clear_hydration_on_unlock_fail");
  }
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8890, 400));
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    const base = `http://127.0.0.1:${server.port}/projects/`;
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVaultReady(page, 60000);
    await page.evaluate(async (pin) => {
      await window.iuVault.setupPin(pin, pin);
    }, PIN);

    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#iuVaultUnlockPinBtn", { state: "visible", timeout: 60000 });
    await page.waitForSelector("#iuVaultPinInput", { state: "visible", timeout: 30000 });

    const actionVis = await page.evaluate(() => {
      const pinBtn = document.getElementById("iuVaultUnlockPinBtn");
      const devBtn = document.getElementById("iuVaultUnlockDeviceBtn");
      const cs = (el) => (el ? getComputedStyle(el).display : "missing");
      return {
        pinDisplay: cs(pinBtn),
        devDisplay: cs(devBtn),
        primaryVisibleCount: [pinBtn, devBtn].filter((b) => b && !b.hidden && getComputedStyle(b).display !== "none").length,
      };
    });
    if (actionVis.primaryVisibleCount !== 1) fails.push(`l3_primary_count_${actionVis.primaryVisibleCount}`);
    if (actionVis.devDisplay !== "none") fails.push("l3_device_btn_still_visible");
    if (actionVis.pinDisplay === "none") fails.push("l3_pin_btn_not_visible");

    await page.evaluate(() => {
      const btn = document.getElementById("iuVaultUnlockPinBtn");
      if (btn) btn.disabled = true;
      window.__iuVaultUnlockPinInFlight = true;
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const afterVis = await page.evaluate(() => {
      const btn = document.getElementById("iuVaultUnlockPinBtn");
      return {
        disabled: !!(btn && btn.disabled),
        inFlight: !!window.__iuVaultUnlockPinInFlight,
      };
    });
    if (afterVis.disabled) fails.push("pwa_visibility_did_not_reenable_unlock");
    if (afterVis.inFlight) fails.push("pwa_visibility_did_not_clear_inflight");

    const clickable = await page.evaluate(() => {
      const btn = document.getElementById("iuVaultUnlockPinBtn");
      if (!btn) return { ok: false, reason: "missing" };
      const r = btn.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const topEl = document.elementFromPoint(x, y);
      return {
        ok: true,
        disabled: !!btn.disabled,
        pointerEvents: getComputedStyle(btn).pointerEvents,
        hitSelf: !!(topEl && (topEl === btn || btn.contains(topEl))),
        topTag: topEl ? topEl.id || topEl.tagName : "none",
      };
    });
    if (!clickable.ok) fails.push("unlock_btn_missing_for_hit_test");
    if (clickable.disabled) fails.push("unlock_btn_disabled_before_click");
    if (clickable.pointerEvents === "none") fails.push("unlock_btn_pointer_events_none");
    if (!clickable.hitSelf) fails.push(`unlock_btn_obscured_by_${clickable.topTag}`);

    await page.fill("#iuVaultPinInput", WRONG);
    await page.click("#iuVaultUnlockPinBtn");
    await page.waitForFunction(() => {
      const err = document.getElementById("iuVaultLockErr");
      const btn = document.getElementById("iuVaultUnlockPinBtn");
      const hasErr = !!(err && /Neplatný PIN|Příliš mnoho/i.test(err.textContent || ""));
      const settled = !window.__iuVaultUnlockPinInFlight && !!(btn && !btn.disabled);
      return hasErr && settled;
    }, null, { timeout: 60000 });

    if (process.env.IU_NEG_STUCK_PIN_PENDING === "1") {
      await page.evaluate(() => {
        window.__iuVaultUnlockPinInFlight = true;
        const inp = document.getElementById("iuVaultPinInput");
        if (inp) {
          inp.disabled = true;
          inp.readOnly = true;
        }
        const btn = document.getElementById("iuVaultUnlockPinBtn");
        if (btn) btn.disabled = true;
      });
    }

    const afterWrong = await page.evaluate(() => {
      const inp = document.getElementById("iuVaultPinInput");
      const btn = document.getElementById("iuVaultUnlockPinBtn");
      return {
        inputDisabled: !!(inp && inp.disabled),
        inputReadOnly: !!(inp && inp.readOnly),
        btnDisabled: !!(btn && btn.disabled),
        hydrationPending: !!window.__iuVaultHydrationPending,
        inFlight: !!window.__iuVaultUnlockPinInFlight,
      };
    });
    if (afterWrong.inputDisabled || afterWrong.inputReadOnly) fails.push("wrong_pin_input_not_editable");
    if (afterWrong.btnDisabled) fails.push("wrong_pin_submit_stuck_disabled");
    if (afterWrong.hydrationPending) fails.push("wrong_pin_left_hydration_pending");
    if (afterWrong.inFlight) fails.push("wrong_pin_left_inflight");

    const urlBefore = page.url();
    await page.waitForTimeout(2500);
    await page.fill("#iuVaultPinInput", PIN);
    await page.click("#iuVaultUnlockPinBtn");
    await page.waitForFunction(() => !document.documentElement.classList.contains("iu-vault-app-locked"), null, {
      timeout: 60000,
    });
    if (page.url() !== urlBefore) fails.push("unlock_caused_reload");
    const unlocked = await page.evaluate(() => !!(window.iuVault && window.iuVault.getState().unlocked));
    if (!unlocked) fails.push("second_pin_attempt_failed");

    await page.evaluate(async () => {
      await window.iuVault.lock();
    });
    await page.waitForSelector("#iuVaultPinInput", { state: "visible", timeout: 30000 });
    for (let i = 0; i < 2; i += 1) {
      await page.fill("#iuVaultPinInput", WRONG);
      await page.click("#iuVaultUnlockPinBtn");
      await page.waitForFunction(() => !window.__iuVaultUnlockPinInFlight, null, { timeout: 60000 });
      const editable = await page.evaluate(() => {
        const inp = document.getElementById("iuVaultPinInput");
        return !!(inp && !inp.disabled && !inp.readOnly);
      });
      if (!editable) {
        fails.push(`multi_wrong_pin_input_dead_at_${i}`);
        break;
      }
    }
    await page.waitForTimeout(3500);
    await page.fill("#iuVaultPinInput", PIN);
    await page.click("#iuVaultUnlockPinBtn");
    await page.waitForFunction(() => !document.documentElement.classList.contains("iu-vault-app-locked"), null, {
      timeout: 90000,
    });
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc);
  }

  if (fails.length) {
    console.log("FAIL");
    for (const f of fails) console.log(f);
    process.exit(1);
  }
  console.log("PASS");
  process.exit(0);
}

main().catch((e) => {
  console.log("FAIL");
  console.log(String(e && e.message ? e.message : e));
  process.exit(1);
});
