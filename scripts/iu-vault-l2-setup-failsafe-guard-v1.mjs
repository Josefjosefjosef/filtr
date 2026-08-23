#!/usr/bin/env node
/**
 * L2 device setup fail-safe — atomic activation, timeout/cancel, L1 preservation.
 * Run: npm run iu-vault-l2-setup-failsafe-guard
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { mapDeviceSetupError } from "../assets/iu-vault-device-v1.js";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8982", 10);
const BASE = `http://localhost:${PORT}/projects/`;

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

function staticSourceChecks(fails) {
  const deviceJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-device-v1.js"), "utf8");
  const uiJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-ui-v1.js"), "utf8");

  const setupFn = deviceJs.slice(deviceJs.indexOf("export async function setupDeviceUnlock"));
  const rotateIdx = setupFn.indexOf("await rotateVaultMdk");
  const createIdx = setupFn.indexOf("await createCredentialWithPrf");
  if (rotateIdx < 0 || createIdx < 0 || rotateIdx < createIdx) {
    fails.push("device_setup_not_atomic_rotate_after_webauthn");
  }
  if (!/webAuthnWatchdogMs/.test(deviceJs) || !/withWebAuthnWatchdog/.test(deviceJs)) {
    fails.push("device_missing_webauthn_timeout");
  }
  if (!/residentKey:\s*["']discouraged["']/.test(deviceJs)) {
    fails.push("device_resident_key_not_discouraged");
  }
  if (!/rollbackMdkRotation/.test(deviceJs)) {
    fails.push("device_missing_mdk_rollback");
  }
  if (!/VAULT_DEVICE_CANCELLED/.test(deviceJs) || !/VAULT_DEVICE_TIMEOUT/.test(deviceJs)) {
    fails.push("device_missing_cancel_timeout_codes");
  }
  if (!/setDeviceSetupBusy/.test(uiJs) || !/deviceSetupUserMessage/.test(uiJs)) {
    fails.push("ui_missing_device_setup_busy_state");
  }
}

function unitErrorMappingTests(fails) {
  try {
    const cancelled = mapDeviceSetupError({ name: "NotAllowedError", message: "denied" });
    if (!String(cancelled.message).includes("VAULT_DEVICE_CANCELLED")) {
      fails.push("map_cancel_failed");
    }
    const timeout = mapDeviceSetupError({ name: "AbortError", message: "aborted" });
    if (!String(timeout.message).includes("VAULT_DEVICE_TIMEOUT")) {
      fails.push("map_timeout_failed");
    }
  } catch (e) {
    fails.push(`map_unit:${e.message || e}`);
  }
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

async function main() {
  const fails = [];
  staticSourceChecks(fails);
  unitErrorMappingTests(fails);

  const server = await new Promise((resolve) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("localhost", PORT, 60000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 }, isMobile: false });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page);

    const cancelResult = await page.evaluate(async () => {
      const originalCreate = navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.create = async () => {
        const err = new DOMException("User cancelled", "NotAllowedError");
        throw err;
      };
      try {
        await window.iuVault.setupDevice();
        return { ok: false, reason: "setup_should_have_failed" };
      } catch (e) {
        const msg = String(e.message || e);
        const { readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
        const meta = await window.iuVault.getMeta();
        const level1 = await readKeyRecord("mdk:level1");
        const device = await readKeyRecord("mdk:device");
        return {
          ok: msg.includes("VAULT_DEVICE_CANCELLED"),
          level1: !!level1,
          device: !!device,
          deviceEnabled: !!(meta && meta.deviceEnabled),
          unlocked: window.iuVault.getState().unlocked,
        };
      } finally {
        navigator.credentials.create = originalCreate;
      }
    });

    if (!cancelResult.ok) fails.push("cancel_not_mapped");
    if (!cancelResult.level1) fails.push("cancel_l1_lost");
    if (cancelResult.device || cancelResult.deviceEnabled) fails.push("cancel_partial_l2");

    const timeoutResult = await page.evaluate(async () => {
      const originalCreate = navigator.credentials.create.bind(navigator.credentials);
      navigator.credentials.create = () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new DOMException("Timed out", "AbortError")), 50);
        });
      try {
        await window.iuVault.setupDevice();
        return { ok: false, reason: "timeout_should_have_failed" };
      } catch (e) {
        const msg = String(e.message || e);
        const { readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
        const meta = await window.iuVault.getMeta();
        const level1 = await readKeyRecord("mdk:level1");
        const device = await readKeyRecord("mdk:device");
        return {
          ok: msg.includes("VAULT_DEVICE_TIMEOUT"),
          level1: !!level1,
          device: !!device,
          deviceEnabled: !!(meta && meta.deviceEnabled),
        };
      } finally {
        navigator.credentials.create = originalCreate;
      }
    });

    if (!timeoutResult.ok) fails.push("timeout_failsafe");
    if (!timeoutResult.level1) fails.push("timeout_l1_lost");
    if (timeoutResult.device || timeoutResult.deviceEnabled) fails.push("timeout_partial_l2");

    let virtualAuth = null;
    try {
      virtualAuth = await enableVirtualAuthenticator(page);
    } catch (e) {
      fails.push(`virtual_auth_setup:${e.message || e}`);
    }

    if (virtualAuth) {
      const setup = await page.evaluate(async () => {
        try {
          await window.iuVault.setupDevice();
          const meta = await window.iuVault.getMeta();
          const { readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
          const level1 = await readKeyRecord("mdk:level1");
          const device = await readKeyRecord("mdk:device");
          return {
            ok: true,
            locked: !window.iuVault.getState().unlocked,
            deviceEnabled: !!(meta && meta.deviceEnabled),
            level1: !!level1,
            device: !!device,
          };
        } catch (e) {
          return { ok: false, reason: String(e.message || e) };
        }
      });

      if (!setup.ok) {
        if (setup.reason && setup.reason.includes("PRF")) {
          console.log("SKIP virtual_success_flow PRF unavailable in headless");
        } else {
          fails.push(`device_success:${setup.reason || "failed"}`);
        }
      } else {
        if (!setup.locked) fails.push("success_should_lock");
        if (!setup.deviceEnabled || !setup.device) fails.push("success_missing_device_wrap");
        if (setup.level1) fails.push("success_level1_remains");
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("IU_VAULT_L2_SETUP_FAILSAFE=" + JSON.stringify({ fails }));
  if (fails.length) {
    console.error("IU_VAULT_L2_SETUP_FAILSAFE_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_L2_SETUP_FAILSAFE_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
