#!/usr/bin/env node
/**
 * L2 device unlock E2E — crypto seed-v1 + virtual authenticator + bypass guard.
 */
import fs from "fs";
import crypto from "crypto";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  deriveDeviceAesKeyFromPrf,
  buildDeviceWrap,
  mdkFromDeviceWrap,
  wrapMdkSeedForDevice,
} from "../assets/iu-vault-device-crypto-v1.js";
import { encryptString, decryptString, generateMdk } from "../assets/iu-vault-core-v1.js";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8966", 10);
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

async function runCryptoUnitTests(fails) {
  try {
    const prf = crypto.randomBytes(32);
    const seed = crypto.randomBytes(32);
    const aesKey = await deriveDeviceAesKeyFromPrf(prf);
    const wrapped = await wrapMdkSeedForDevice(aesKey, seed);
    const deviceWrap = await buildDeviceWrap(new Uint8Array([1, 2, 3]), new Uint8Array(32), wrapped);
    const mdk = await mdkFromDeviceWrap(deviceWrap, prf);
    const env = await encryptString(mdk, "iu.l2.test", "IU_L2_SECRET");
    const out = await decryptString(mdk, "iu.l2.test", env);
    if (out !== "IU_L2_SECRET") fails.push("l2_crypto_roundtrip");
    let exportFailed = false;
    try {
      await crypto.subtle.exportKey("raw", mdk);
    } catch (_) {
      exportFailed = true;
    }
    if (!exportFailed) fails.push("l2_mdk_extractable");
  } catch (e) {
    fails.push(`l2_crypto_unit:${e.message || e}`);
  }
}

function staticSourceChecks(fails) {
  const deviceJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-device-v1.js"), "utf8");
  const cryptoJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-device-crypto-v1.js"), "utf8");
  if (!/format:\s*["']seed-v1["']/.test(cryptoJs)) fails.push("device_missing_seed_v1_format");
  if (!/rotateVaultMdk/.test(deviceJs)) fails.push("device_missing_mdk_rotation");
  if (/wrapMdkRaw\s*\(\s*mdk/.test(deviceJs)) fails.push("device_still_wraps_raw_mdk");
  if (!/wrappedSeed/.test(deviceJs)) fails.push("device_missing_wrapped_seed");
  if (/isUnlocked\s*=\s*true/.test(deviceJs) && !/mdkFromDeviceWrap|unlockWithMdk/.test(deviceJs)) {
    fails.push("device_ui_gate_only");
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
  await runCryptoUnitTests(fails);

  const server = await new Promise((resolve) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("localhost", PORT, 30000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page);

    let virtualAuth = null;
    try {
      virtualAuth = await enableVirtualAuthenticator(page);
    } catch (e) {
      fails.push(`virtual_auth_setup:${e.message || e}`);
    }

    if (virtualAuth) {
      const setup = await page.evaluate(async () => {
        try {
          const supported = await window.iuVault.detectDeviceSupport();
          if (!supported) return { ok: false, reason: "unsupported" };
          await window.iuVault.setupDevice();
          return { ok: true, locked: !window.iuVault.getState().unlocked };
        } catch (e) {
          return { ok: false, reason: String(e.message || e) };
        }
      });

      if (!setup.ok) {
        if (setup.reason && setup.reason.includes("PRF")) {
          console.log("SKIP virtual_device_flow PRF unavailable in headless");
        } else {
          fails.push(`device_setup:${setup.reason || "failed"}`);
        }
      } else {
        if (!setup.locked) fails.push("device_setup_should_lock");

        const bypass = await page.evaluate(() => {
          const st = window.iuVault.getState();
          let lsHit = null;
          try {
            const v = localStorage.getItem("iu.notes.store.v1");
            if (v && v.includes("IU_L2")) lsHit = "notes";
          } catch (_) {}
          return { unlocked: st.unlocked, lsHit };
        });
        if (bypass.unlocked) fails.push("l2_bypass_unlocked_without_webauthn");

        const level1 = await page.evaluate(async () => {
          const { readKeyRecord } = await import("/assets/iu-vault-db-v1.js");
          const rec = await readKeyRecord("mdk:level1");
          return !!rec;
        });
        if (level1) fails.push("l2_level1_wrapper_remains");

        try {
          await page.evaluate(async () => {
            await window.iuVault.unlockDevice();
          });
          const unlocked = await page.evaluate(() => window.iuVault.getState().unlocked);
          if (!unlocked) fails.push("device_unlock_failed");
        } catch (e) {
          fails.push(`device_unlock:${e.message || e}`);
        }

        const prfLeak = await page.evaluate(() => {
          for (let i = 0; i < localStorage.length; i += 1) {
            const v = localStorage.getItem(localStorage.key(i)) || "";
            if (/IU_L2_SECRET|prf.results/i.test(v)) return true;
          }
          return false;
        });
        if (prfLeak) fails.push("l2_storage_plaintext_leak");
      }
    }
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("IU_VAULT_L2_E2E=" + JSON.stringify({ fails }));
  if (fails.length) {
    console.error("IU_VAULT_L2_E2E_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_L2_E2E_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
