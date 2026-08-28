#!/usr/bin/env node
/**
 * Mobile PIN focus must use >=16px font-size (iOS Safari zoom prevention).
 * Security buttons must not be unstyled default browser buttons.
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
const PIN = "012345";

function staticChecks(fails) {
  const css = fs.readFileSync(path.join(REPO, "assets", "iu-info-center.css"), "utf8");
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(REPO, "assets", "iu-vault-ui-v1.js"), "utf8");
  if (!/\.iuVaultLockOverlay__input[\s\S]{0,280}font-size:\s*16px\s*!important/.test(css)
    && !/#iuVaultAppLockScreen[\s\S]{0,400}font-size:\s*16px\s*!important/.test(index)) {
    fails.push("missing_pin_input_16px_important");
  }
  if (!/\.iuVaultSecurity__input\{[\s\S]{0,400}font-size:\s*16px\s*!important/.test(css)) {
    fails.push("missing_pin_setup_input_16px");
  }
  if (/@media \(min-width: 1025px\)[\s\S]{0,180}\.iuVaultLockOverlay__input\{[\s\S]{0,80}font-size:\s*15px/.test(css)) {
    fails.push("desktop_media_overrides_pin_below_16px");
  }
  if (!/id="iuVaultPinInput"[^>]*type="text"/.test(index) && !/<input[^>]*id="iuVaultPinInput"[^>]*type="text"/.test(index)) {
    // tolerate attribute order
    if (!/<input[^>]*type="text"[^>]*id="iuVaultPinInput"/.test(index)
      && !/<input[^>]*id="iuVaultPinInput"[^>]*type="text"/.test(index)) {
      fails.push("pin_input_not_type_text");
    }
  }
  if (/id="iuVaultPinSetupNew"[^>]*type="password"/.test(ui)
    || /type="password"[^>]*id="iuVaultPinSetupNew"/.test(ui)) {
    fails.push("pin_setup_still_type_password");
  }
  if (!/id="iuVaultPinSetupNew"[^>]*type="text"/.test(ui)
    && !/type="text"[^>]*id="iuVaultPinSetupNew"/.test(ui)) {
    fails.push("pin_setup_not_type_text");
  }
  if (!/align-items:\s*flex-start/.test(index) && !/#iuVaultAppLockScreen[\s\S]{0,200}align-items:\s*flex-start/.test(index)) {
    fails.push("lock_screen_still_flex_center");
  }
  if (!/\.iuInfoCenter__btn/.test(css) && !/#iuVaultAppLockScreen[\s\S]{0,800}iuInfoCenter__btn/.test(index)) {
    fails.push("missing_security_btn_styles");
  }
  if (!/iuInfoCenter__btn--primary/.test(index) || !/iuInfoCenter__btn--danger/.test(index)) {
    fails.push("missing_btn_variants_in_lock_screen");
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
    const started = await startGuardStaticServer(pickGuardPort(8860, 400));
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
    await page.goto(`http://127.0.0.1:${server.port}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await waitForVaultReady(page, 60000);
    await page.evaluate(async (pin) => {
      await window.iuVault.setupPin(pin, pin);
    }, PIN);
    await page.goto(`http://127.0.0.1:${server.port}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector("#iuVaultPinInput", { state: "visible", timeout: 60000 });

    const before = await page.evaluate(() => {
      const inp = document.getElementById("iuVaultPinInput");
      const panel = document.querySelector("#iuVaultAppLockScreen .iuVaultLockOverlay__panel");
      const cs = window.getComputedStyle(inp);
      const panelRect = panel ? panel.getBoundingClientRect() : null;
      return {
        fontSize: parseFloat(cs.fontSize),
        scale: window.visualViewport ? window.visualViewport.scale : 1,
        panelH: panelRect ? panelRect.height : 0,
        panelTop: panelRect ? panelRect.top : 0,
      };
    });
    if (!(before.fontSize >= 16)) fails.push(`pin_font_too_small:${before.fontSize}`);

    await page.focus("#iuVaultPinInput");
    await page.waitForTimeout(250);
    const afterFocus = await page.evaluate(() => {
      const inp = document.getElementById("iuVaultPinInput");
      const panel = document.querySelector("#iuVaultAppLockScreen .iuVaultLockOverlay__panel");
      const unlock = document.getElementById("iuVaultUnlockPinBtn");
      const forgot = document.getElementById("iuVaultForgotPinBtn");
      const cs = window.getComputedStyle(inp);
      const unlockCs = unlock ? window.getComputedStyle(unlock) : null;
      const forgotCs = forgot ? window.getComputedStyle(forgot) : null;
      const panelRect = panel ? panel.getBoundingClientRect() : null;
      return {
        fontSize: parseFloat(cs.fontSize),
        scale: window.visualViewport ? window.visualViewport.scale : 1,
        panelH: panelRect ? panelRect.height : 0,
        panelTop: panelRect ? panelRect.top : 0,
        unlockBg: unlockCs ? unlockCs.backgroundColor : "",
        forgotBg: forgotCs ? forgotCs.backgroundColor : "",
        unlockRadius: unlockCs ? unlockCs.borderRadius : "",
      };
    });
    if (!(afterFocus.fontSize >= 16)) fails.push(`pin_font_after_focus_too_small:${afterFocus.fontSize}`);
    if (Math.abs((afterFocus.scale || 1) - (before.scale || 1)) > 0.02) {
      fails.push(`viewport_scale_changed:${before.scale}->${afterFocus.scale}`);
    }
    if (Math.abs(afterFocus.panelH - before.panelH) > 80) {
      fails.push(`panel_height_shift:${before.panelH}->${afterFocus.panelH}`);
    }
    if (!afterFocus.unlockBg || afterFocus.unlockBg === "rgba(0, 0, 0, 0)" || afterFocus.unlockBg === "transparent") {
      fails.push("unlock_btn_unstyled");
    }
    if (!afterFocus.unlockRadius || afterFocus.unlockRadius === "0px") fails.push("unlock_btn_no_radius");
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({ IU_VAULT_PIN_FOCUS_UX_GUARD: pass ? "PASS" : "FAIL", fails }));
  if (!pass) {
    console.error("IU_VAULT_PIN_FOCUS_UX_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_PIN_FOCUS_UX_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
