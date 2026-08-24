#!/usr/bin/env node
/**
 * DEVICE PRF activation flow guard — reproduces create(enabled-only) + get(results) path.
 * Run: npm run iu-vault-device-prf-flow-guard
 */
import fs from "fs";
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
import { mapDeviceSetupError } from "../assets/iu-vault-device-v1.js";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8984", 10);
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
  const deviceJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-device-v1.js"), "utf8");
  const uiJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-ui-v1.js"), "utf8");
  const appLockJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-app-lock-v1.js"), "utf8");
  if (!/extensions:\s*\{\s*prf:\s*\{\s*\}\s*\}/.test(deviceJs)) fails.push("create_missing_prf_enable_only");
  if (!/evaluatePrfViaGet/.test(deviceJs)) fails.push("missing_evaluatePrfViaGet");
  if (!/DEVICE_PRF_RESULT_MISSING/.test(deviceJs)) fails.push("missing_phase_prf_result_missing");
  if (!/mdk:device:pending/.test(deviceJs)) fails.push("missing_pending_device_state");
  if (!/verifyDeviceWrapUnlock/.test(deviceJs)) fails.push("missing_verify_unlock");
  if (!/wrappedSeed|format:\s*["']seed-v1["']/.test(deviceJs)) fails.push("missing_seed_v1_wrap");
  if (!/DEVICE_[A-Z0-9_]+/.test(uiJs)) fails.push("ui_missing_phase_codes");
  if (!/initGlobalAppLock/.test(appLockJs)) fails.push("missing_global_app_lock_module");
}

function unitMapTests(fails) {
  const mapped = mapDeviceSetupError(new Error("DEVICE_PRF_RESULT_MISSING"));
  if (String(mapped.message) !== "DEVICE_PRF_RESULT_MISSING") fails.push("map_phase_code");
  const dom = mapDeviceSetupError({ name: "SecurityError", message: "denied" });
  if (!String(dom.message).includes("DEVICE_CREATE_FAILED")) fails.push("map_dom_to_phase");
}

async function resetGuardVaultContext(context) {
  const scratch = await context.newPage();
  await scratch.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await scratch.evaluate(async () => {
    try {
      localStorage.removeItem("iu:vault:app-lock-active:v1");
      document.documentElement.classList.remove("iu-vault-app-locked");
    } catch (_) {}
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith("iu:vault:")) keys.push(k);
      }
      for (const k of keys) {
        try {
          localStorage.removeItem(k);
        } catch (_) {}
      }
    } catch (_) {}
    try {
      const { listRecordKeys, deleteRecord, wipeVaultDatabase } = await import("/assets/iu-vault-db-v1.js");
      const recKeys = await listRecordKeys();
      for (const k of recKeys) {
        try {
          await deleteRecord(k);
        } catch (_) {}
      }
      await wipeVaultDatabase();
    } catch (_) {}
  });
  await scratch.close();
}

async function runMockFlowTests(context, fails) {
  const scenarios = [
    {
      id: "enabled_then_get_success",
      createPrf: { enabled: true },
      getPrf: { results: { first: new Uint8Array(32).fill(7) } },
      expectOk: true,
    },
    {
      id: "create_results_direct",
      createPrf: { enabled: true, results: { first: new Uint8Array(32).fill(9) } },
      getPrf: null,
      expectOk: true,
    },
    {
      id: "enabled_only_get_missing",
      createPrf: { enabled: true },
      getPrf: { enabled: true },
      expectOk: false,
      expectPhase: "DEVICE_PRF_RESULT_INVALID",
    },
    {
      id: "prf_not_enabled",
      createPrf: { enabled: false },
      getPrf: null,
      expectOk: false,
      expectPhase: "DEVICE_PRF_NOT_ENABLED",
    },
    {
      id: "get_cancelled",
      createPrf: { enabled: true },
      getError: "NotAllowedError",
      expectOk: false,
      expectPhase: "VAULT_DEVICE_CANCELLED",
    },
  ];

  for (const scenario of scenarios) {
    await resetGuardVaultContext(context);
    const page = await context.newPage();
    await page.goto(`${BASE}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page);
    const out = await page.evaluate(async (cfg) => {
      if (window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
        PublicKeyCredential.getClientCapabilities = async () => ({ "extension:prf": true });
      }
      const prfBytesFromCfg = (part) => {
        if (!part || !part.results || part.results.first == null) return part;
        return { ...part, results: { first: new Uint8Array(part.results.first) } };
      };
      const createPrf = prfBytesFromCfg(cfg.createPrf);
      const getPrf = cfg.getPrf ? prfBytesFromCfg(cfg.getPrf) : null;
      const origCreate = navigator.credentials.create.bind(navigator.credentials);
      const origGet = navigator.credentials.get.bind(navigator.credentials);
      navigator.credentials.create = async () => ({
        type: "public-key",
        rawId: new Uint8Array([1, 2, 3, 4]).buffer,
        getClientExtensionResults() {
          return { prf: createPrf };
        },
      });
      navigator.credentials.get = async () => {
        if (cfg.getError === "NotAllowedError") {
          throw new DOMException("denied", "NotAllowedError");
        }
        const fallbackPrf = getPrf || { enabled: true, results: { first: new Uint8Array(32).fill(7) } };
        const prfForGet =
          createPrf && createPrf.results && createPrf.results.first
            ? createPrf
            : fallbackPrf;
        return {
          type: "public-key",
          rawId: new Uint8Array([1, 2, 3, 4]).buffer,
          getClientExtensionResults() {
            return { prf: prfForGet };
          },
        };
      };
      try {
        const mod = await import("/assets/iu-vault-device-v1.js?v=iu-vault-l2-device-persist-v1-20260824");
        await mod.setupDeviceUnlock();
        return { ok: true, locked: !window.iuVault.getState().unlocked };
      } catch (e) {
        return { ok: false, reason: String(e.message || e) };
      } finally {
        navigator.credentials.create = origCreate;
        navigator.credentials.get = origGet;
      }
    }, {
      ...scenario,
      createPrf: scenario.createPrf
        ? {
            ...scenario.createPrf,
            results: scenario.createPrf.results
              ? { first: Array.from(scenario.createPrf.results.first || []) }
              : undefined,
          }
        : null,
      getPrf: scenario.getPrf
        ? {
            ...scenario.getPrf,
            results: scenario.getPrf.results
              ? { first: Array.from(scenario.getPrf.results.first || []) }
              : undefined,
          }
        : null,
    });

    if (scenario.expectOk) {
      if (!out.ok) fails.push(`${scenario.id}:${out.reason || "setup_failed"}`);
      else if (!out.locked) fails.push(`${scenario.id}:should_lock`);
    } else {
      if (out.ok) fails.push(`${scenario.id}:should_fail`);
      else if (scenario.expectPhase && !String(out.reason).includes(scenario.expectPhase)) {
        fails.push(`${scenario.id}:expected_${scenario.expectPhase}_got_${out.reason}`);
      }
    }
    await page.close();
  }
}

async function cryptoRoundtrip(fails) {
  try {
    const prf = new Uint8Array(32).fill(11);
    const seed = new Uint8Array(32).fill(22);
    const aesKey = await deriveDeviceAesKeyFromPrf(prf);
    const wrapped = await wrapMdkSeedForDevice(aesKey, seed);
    const wrap = await buildDeviceWrap(new Uint8Array([9, 8, 7]), new Uint8Array(32), wrapped);
    const mdk = await mdkFromDeviceWrap(wrap, prf);
    if (!mdk) fails.push("crypto_roundtrip");
  } catch (e) {
    fails.push(`crypto_roundtrip:${e.message || e}`);
  }
}

async function main() {
  const fails = [];
  staticChecks(fails);
  unitMapTests(fails);
  await cryptoRoundtrip(fails);

  const server = await new Promise((resolve) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("127.0.0.1", PORT, 60000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1366, height: 768 }, isMobile: false });

  try {
    await runMockFlowTests(context, fails);
  } finally {
    await browser.close();
    server.kill();
  }

  console.log("IU_VAULT_DEVICE_PRF_FLOW=" + JSON.stringify({ fails }));
  if (fails.length) {
    console.error("IU_VAULT_DEVICE_PRF_FLOW_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_DEVICE_PRF_FLOW_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
