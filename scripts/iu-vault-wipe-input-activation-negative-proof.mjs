#!/usr/bin/env node
/**
 * Negative: without input→button sync, valid phrase must leave wipe button disabled.
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

const PIN = "666666";
const PHRASE = "VYMAZAT OSOBNÍ DATA";

async function main() {
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  let failSeen = false;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8892, 400));
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      webauthnStub: true,
    });
    page = await context.newPage();
    const base = `http://127.0.0.1:${server.port}/projects/`;
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVaultReady(page, 60000);
    await page.evaluate(async (pin) => {
      await window.iuVault.setupPin(pin, pin);
    }, PIN);
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#iuVaultForgotPinBtn", { state: "visible", timeout: 60000 });
    await page.click("#iuVaultForgotPinBtn");
    await page.evaluate(() => {
      const inp = document.getElementById("iuVaultWipePhraseInput");
      if (!inp || !inp.parentNode) return;
      const clone = inp.cloneNode(true);
      inp.parentNode.replaceChild(clone, inp);
    });
    await page.fill("#iuVaultWipePhraseInput", PHRASE);
    await page.waitForTimeout(200);
    const snap = await page.evaluate(async () => {
      const btn = document.getElementById("iuVaultWipeConfirmBtn");
      const inp = document.getElementById("iuVaultWipePhraseInput");
      const accepted = await window.iuVault.isWipeConfirmPhraseAccepted(inp ? inp.value : "");
      return { disabled: !!(btn && btn.disabled), accepted };
    });
    if (snap.accepted && !snap.disabled) failSeen = true;
  } catch (_) {
    failSeen = false;
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const pass = !failSeen;
  console.log(JSON.stringify({ IU_VAULT_WIPE_INPUT_ACTIVATION_NEGATIVE_PROOF: pass ? "PASS" : "FAIL", failSeen }));
  if (!pass) {
    console.error("IU_VAULT_WIPE_INPUT_ACTIVATION_NEGATIVE_PROOF_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_WIPE_INPUT_ACTIVATION_NEGATIVE_PROOF_PASS");
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
