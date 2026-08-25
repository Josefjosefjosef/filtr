#!/usr/bin/env node
/**
 * Wipe confirm button must enable immediately on valid phrase (same validator as submit).
 * Negative: IU_NEG_SKIP_WIPE_INPUT_SYNC=1 removes listener wiring → must FAIL.
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

const PIN = "666666";
const PHRASE = "VYMAZAT OSOBNÍ DATA";

function staticChecks(fails) {
  const lock = fs.readFileSync(path.join(REPO, "assets", "iu-vault-app-lock-v1.js"), "utf8");
  const wipe = fs.readFileSync(path.join(REPO, "assets", "iu-vault-wipe-v1.js"), "utf8");
  const index = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  if (!/syncWipeConfirmButtonState/.test(lock)) fails.push("missing_sync_wipe_btn_state");
  if (!/bindWipePhraseInputListeners/.test(lock)) fails.push("missing_wipe_input_listeners");
  if (!/compositionend/.test(lock)) fails.push("missing_compositionend_listener");
  if (!/normalizeWipeConfirmation|normalizeWipeConfirmPhrase/.test(wipe)) fails.push("missing_normalize");
  if (!/isWipeConfirmationValid|isWipeConfirmPhraseAccepted/.test(wipe)) fails.push("missing_validator");
  if (!/id="iuVaultWipeConfirmBtn"[^>]*disabled/.test(index) && !/iuVaultWipeConfirmBtn"[^>]*disabled/.test(index)) {
    fails.push("wipe_btn_not_disabled_initially");
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
    await page.waitForSelector("#iuVaultForgotPinBtn", { state: "visible", timeout: 60000 });
    await page.click("#iuVaultForgotPinBtn");
    await page.waitForSelector("#iuVaultWipeConfirm:not([hidden])", { timeout: 10000 });

    const empty = await page.evaluate(() => {
      const btn = document.getElementById("iuVaultWipeConfirmBtn");
      return { disabled: !!(btn && btn.disabled) };
    });
    if (!empty.disabled) fails.push("btn_enabled_on_empty");

    await page.fill("#iuVaultWipePhraseInput", "VYMAZAT DATA");
    await page.waitForTimeout(120);
    const wrong = await page.evaluate(() => {
      const btn = document.getElementById("iuVaultWipeConfirmBtn");
      return !!(btn && btn.disabled);
    });
    if (!wrong) fails.push("btn_enabled_on_wrong_phrase");

    await page.fill("#iuVaultWipePhraseInput", "  vymazat osobní data  ");
    await page.waitForTimeout(120);
    const okLower = await page.evaluate(() => {
      const btn = document.getElementById("iuVaultWipeConfirmBtn");
      return { disabled: !!(btn && btn.disabled) };
    });
    if (okLower.disabled) fails.push("btn_disabled_on_valid_lowercase");

    await page.fill("#iuVaultWipePhraseInput", PHRASE);
    await page.waitForTimeout(120);
    const okExact = await page.evaluate(async (phrase) => {
      const btn = document.getElementById("iuVaultWipeConfirmBtn");
      const inp = document.getElementById("iuVaultWipePhraseInput");
      const accepted = await window.iuVault.isWipeConfirmPhraseAccepted(inp ? inp.value : "");
      return {
        disabled: !!(btn && btn.disabled),
        accepted,
        rawLen: inp ? String(inp.value || "").length : 0,
      };
    }, PHRASE);
    if (okExact.disabled) fails.push(`btn_disabled_on_valid_phrase:accepted=${okExact.accepted}:len=${okExact.rawLen}`);
    if (!okExact.accepted) fails.push("validator_rejects_valid_phrase");

    await page.fill("#iuVaultWipePhraseInput", PHRASE.slice(0, -1));
    await page.waitForTimeout(120);
    const afterDelete = await page.evaluate(() => {
      const btn = document.getElementById("iuVaultWipeConfirmBtn");
      return !!(btn && btn.disabled);
    });
    if (!afterDelete) fails.push("btn_enabled_after_delete_char");
  } catch (e) {
    fails.push(`runtime:${String(e && e.message ? e.message : e)}`);
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = fails.length === 0;
  console.log(JSON.stringify({ IU_VAULT_WIPE_INPUT_ACTIVATION_GUARD: pass ? "PASS" : "FAIL", fails }));
  if (!pass) {
    console.error("IU_VAULT_WIPE_INPUT_ACTIVATION_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_WIPE_INPUT_ACTIVATION_GUARD_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
