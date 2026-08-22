#!/usr/bin/env node
/**
 * L3 PIN full E2E — setup, lock, unlock, wrong PIN, change, disable.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8964", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const PIN_A = "847291";
const PIN_B = "392847";
const PIN_WRONG = "111222";

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

async function main() {
  const fails = [];
  const server = await new Promise((resolve) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("127.0.0.1", PORT, 30000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.iuVault && window.iuVault.getState().unlocked, null, { timeout: 90000 });

    await page.evaluate(async (pin) => {
      await window.iuVault.setupPin(pin, pin);
    }, PIN_A);

    const afterSetup = await page.evaluate(() => window.iuVault.getState());
    if (afterSetup.unlocked) fails.push("pin_setup_should_lock");

    let wrongOk = false;
    try {
      await page.evaluate(async (pin) => {
        await window.iuVault.unlockPin(pin);
      }, PIN_WRONG);
    } catch (_) {
      wrongOk = true;
    }
    if (!wrongOk) fails.push("wrong_pin_should_fail");

    await page.waitForTimeout(1200);

    await page.evaluate(async (pin) => {
      await window.iuVault.unlockPin(pin);
    }, PIN_A);

    const unlocked = await page.evaluate(() => window.iuVault.getState().unlocked);
    if (!unlocked) fails.push("correct_pin_unlock");

    await page.evaluate(async ({ oldP, newP }) => {
      await window.iuVault.changePin(oldP, newP, newP);
    }, { oldP: PIN_A, newP: PIN_B });

    const lockedAfterChange = await page.evaluate(() => !window.iuVault.getState().unlocked);
    if (!lockedAfterChange) fails.push("change_pin_should_lock");

    await page.evaluate(async (pin) => {
      await window.iuVault.unlockPin(pin);
    }, PIN_B);

    await page.evaluate(async (pin) => {
      await window.iuVault.disablePin(pin);
    }, PIN_B);

    const l1 = await page.evaluate(() => window.iuVault.getState().unlocked);
    if (!l1) fails.push("disable_pin_should_unlock_l1");

    const pinRec = await page.evaluate(async () => {
      const meta = await window.iuVault.getMeta();
      return { pinEnabled: meta && meta.pinEnabled, level: meta && meta.securityLevel };
    });
    if (pinRec.pinEnabled) fails.push("pin_disabled_meta");

    const pinPlain = await page.evaluate((pins) => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) || "";
        for (const p of pins) {
          if (v.includes(p)) return k;
        }
      }
      return null;
    }, [PIN_A, PIN_B]);
    if (pinPlain) fails.push(`pin_plaintext:${pinPlain}`);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("IU_VAULT_PIN_E2E=" + JSON.stringify({ fails }));
  if (fails.length) {
    console.error("IU_VAULT_PIN_E2E_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_PIN_E2E_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
