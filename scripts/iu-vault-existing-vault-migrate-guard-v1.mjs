#!/usr/bin/env node
/**
 * Existing L1 vault migration guard + negative proof child + PIN policy checks.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { explainPinRejection } from "../assets/iu-vault-core-v1.js";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
  closePlaywrightSession,
  runGuardChildScript,
} from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORAGE_PATH = path.join(REPO, "assets", "iu-vault-storage-v1.js");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PIN_SERVER_PORT = pickGuardPort(8300, 400);
const GUARD_PIN = "847291";

function staticChecks(fails) {
  const storageJs = fs.readFileSync(STORAGE_PATH, "utf8");
  const deviceJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-device-v1.js"), "utf8");
  const uiJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-ui-v1.js"), "utf8");
  if (!/legacy_plaintext_only/.test(storageJs)) fails.push("rotate_missing_legacy_plaintext_only");
  if (!/recordDeviceDiag|getLastDeviceSetupDiag/.test(deviceJs)) fails.push("device_missing_step_diag");
  if (!/07-rotate-existing-records/.test(deviceJs)) fails.push("device_missing_rotate_step");
  if (!/iuVaultPinSetupHint/.test(uiJs)) fails.push("ui_missing_pin_policy_text");
  if (!/PIN musí mít alespoň 6 číslic/.test(uiJs)) fails.push("ui_missing_pin_min_digits_message");
  if (/Nepoužívejte stejné číslice opakovaně/.test(uiJs)) fails.push("ui_still_has_trivial_pin_warning");
  if (explainPinRejection(GUARD_PIN)) fails.push("pin_ok_rejected");
  if (explainPinRejection("123456")) fails.push("pin_seq_should_accept");
  if (explainPinRejection("654321")) fails.push("pin_desc_seq_should_accept");
  if (explainPinRejection("111111")) fails.push("pin_repeat_should_accept");
  if (explainPinRejection("000000")) fails.push("pin_zeros_should_accept");
  if (!explainPinRejection("12345")) fails.push("pin_short_should_reject");
  if (!explainPinRejection("abc123")) fails.push("pin_nonnumeric_should_reject");
  if (explainPinRejection("593817")) fails.push("pin_valid_rejected");
}

async function runPinPolicyBrowserChecks(page, fails) {
  const pinChecks = await page.evaluate(async () => {
    const out = {
      seqOk: false,
      descOk: false,
      repeatOk: false,
      zerosOk: false,
      shortFail: false,
      nonNumericFail: false,
      mismatch: false,
    };
    if (window.iuVault && window.iuVault.validatePinPolicy) {
      out.seqOk = !window.iuVault.validatePinPolicy("123456");
      out.descOk = !window.iuVault.validatePinPolicy("654321");
      out.repeatOk = !window.iuVault.validatePinPolicy("111111");
      out.zerosOk = !window.iuVault.validatePinPolicy("000000");
      out.shortFail = !!window.iuVault.validatePinPolicy("12345");
      out.nonNumericFail = !!window.iuVault.validatePinPolicy("abc123");
    }
    const { setupPin } = await import("/assets/iu-vault-pin-v1.js");
    try {
      await setupPin("847291", "847292");
    } catch (e) {
      if (String(e.message || e).includes("VAULT_PIN_MISMATCH")) out.mismatch = true;
    }
    return out;
  });
  if (!pinChecks.seqOk) fails.push("pin_seq_not_accepted");
  if (!pinChecks.descOk) fails.push("pin_desc_seq_not_accepted");
  if (!pinChecks.repeatOk) fails.push("pin_repeat_not_accepted");
  if (!pinChecks.zerosOk) fails.push("pin_zeros_not_accepted");
  if (!pinChecks.shortFail) fails.push("pin_short_not_rejected");
  if (!pinChecks.nonNumericFail) fails.push("pin_nonnumeric_not_rejected");
  if (!pinChecks.mismatch) fails.push("pin_mismatch_not_rejected");

  const pinPlain = await page.evaluate(async (pin) => {
    const { nativeLocalStorageGet } = await import("/assets/iu-vault-storage-v1.js");
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = nativeLocalStorageGet(k) || "";
      if (v.includes(pin)) return k;
    }
    return null;
  }, GUARD_PIN);
  if (pinPlain) fails.push(`pin_plaintext_leak:${pinPlain}`);
}

async function main() {
  const fails = [];
  staticChecks(fails);

  const probePort = pickGuardPort();
  const probeScript = path.join(REPO, "scripts", "iu-vault-existing-vault-migrate-probe.mjs");
  const probe = await runGuardChildScript(probeScript, [], {
    cwd: REPO,
    env: { IU_GUARD_PORT: String(probePort) },
    timeoutMs: 90000,
  });
  if (probe.timedOut) {
    fails.push("migration_probe_timeout");
  } else if (probe.status !== 0) {
    fails.push("migration_probe_failed");
  }

  const negativeScript = path.join(REPO, "scripts", "iu-vault-existing-vault-migrate-negative-proof.mjs");
  const negative = await runGuardChildScript(negativeScript, [], {
    cwd: REPO,
    timeoutMs: 120000,
  });
  if (negative.timedOut) {
    fails.push("negative_proof_timeout");
  } else if (negative.status !== 0) {
    fails.push("negative_proof_failed");
  }

  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(PIN_SERVER_PORT);
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 1366, height: 768 },
      isMobile: false,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    await page.goto(`http://127.0.0.1:${server.port}/projects/?nosw=1&cb=${Date.now()}`, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await waitForVaultReady(page, 90000);
    await runPinPolicyBrowserChecks(page, fails);
  } catch (e) {
    fails.push("pin_policy_browser_failed");
    console.error(String(e && e.stack ? e.stack : e));
  } finally {
    await closePlaywrightSession(page, context, browser);
    await stopGuardProcess(server && server.proc ? server.proc : null);
  }

  const report = {
    IU_VAULT_EXISTING_VAULT_MIGRATE_GUARD: fails.length ? "FAIL" : "PASS",
    fails,
  };
  console.log(JSON.stringify(report));
  if (fails.length) {
    console.error("IU_VAULT_EXISTING_VAULT_MIGRATE_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_EXISTING_VAULT_MIGRATE_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
