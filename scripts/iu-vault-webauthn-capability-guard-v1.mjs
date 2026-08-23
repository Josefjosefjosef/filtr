#!/usr/bin/env node
/**
 * WebAuthn/PRF capability guard — virtual authenticator when available.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8963", 10);
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

async function main() {
  const fails = [];
  const deviceJs = path.join(REPO, "assets", "iu-vault-device-v1.js");
  const src = require("fs").readFileSync(deviceJs, "utf8");
  if (!/prf/i.test(src)) fails.push("device_module_missing_prf");
  if (!/seed-v1|wrappedSeed/.test(src)) fails.push("device_missing_seed_wrap");
  if (/wrapMdkRaw\s*\(\s*mdk/.test(src)) fails.push("device_raw_mdk_wrap");

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
    await page.goto(`${BASE}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page);

    const cap = await page.evaluate(async () => {
      const vault = window.iuVault;
      if (!vault || typeof vault.detectDeviceSupport !== "function") {
        return { ok: false, reason: "no_detectDeviceSupport" };
      }
      const supported = await vault.detectDeviceSupport();
      return { ok: true, supported: !!supported };
    });

    if (!cap.ok) fails.push(cap.reason || "capability_check_failed");

    const vaultUi = fs.readFileSync(path.join(REPO, "assets", "iu-vault-ui-v1.js"), "utf8");
    if (!/iuVaultEnableDeviceBtn/.test(vaultUi)) fails.push("vault_ui_missing_device_btn");
    if (!/iuVaultDeviceUnsupported/.test(vaultUi)) fails.push("vault_ui_missing_unsupported");
  } finally {
    await browser.close();
    server.kill();
  }

  if (fails.length) {
    console.error("IU_VAULT_WEBAUTHN_CAPABILITY_GUARD_FAIL", fails.join(","));
    process.exit(1);
  }
  console.log("IU_VAULT_WEBAUTHN_CAPABILITY_GUARD_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
