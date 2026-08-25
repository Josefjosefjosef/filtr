#!/usr/bin/env node
/**
 * Device activation WebAuthn ceremony instrumentation.
 * Safari-like path: create(enabled-only) + get(PRF) must NOT add a third verify get.
 *
 * Metadata only: ceremonyIndex | operation | purpose | result
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
const FORCE_VERIFY = process.env.IU_NEG_FORCE_VERIFY_GET === "1";

function staticChecks(fails) {
  const deviceJs = fs.readFileSync(path.join(REPO, "assets", "iu-vault-device-v1.js"), "utf8");
  if (!/recordWebAuthnCeremony/.test(deviceJs)) fails.push("missing_ceremony_recorder");
  if (!/getWebAuthnCeremonyLog/.test(deviceJs)) fails.push("missing_ceremony_log_export");
  if (!/verifySkippedPrfFromGet|prfSource === "create"/.test(deviceJs)) {
    fails.push("missing_skip_redundant_verify_get");
  }
  if (!/clearWebAuthnCeremonyLog/.test(deviceJs)) fails.push("missing_clear_ceremony_log");
}

async function main() {
  const fails = [];
  staticChecks(fails);
  let server = null;
  let browser = null;
  let context = null;
  let page = null;
  try {
    const started = await startGuardStaticServer(pickGuardPort(8895, 400));
    server = started;
    browser = await chromium.launch({ headless: true });
    context = await bootstrapGuardContext(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      webauthnStub: true,
    });
    page = await context.newPage();
    page.setDefaultTimeout(90000);
    const base = `http://127.0.0.1:${server.port}/projects/`;
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await waitForVaultReady(page, 60000);

    const out = await page.evaluate(async (forceVerify) => {
      await window.iuVault.clearWebAuthnCeremonyLog();
      if (window.PublicKeyCredential) {
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
        PublicKeyCredential.getClientCapabilities = async () => ({ "extension:prf": true });
      }
      const origCreate = navigator.credentials.create.bind(navigator.credentials);
      const origGet = navigator.credentials.get.bind(navigator.credentials);
      let getCalls = 0;
      navigator.credentials.create = async () => ({
        type: "public-key",
        rawId: new Uint8Array([1, 2, 3, 4, 5, 6]).buffer,
        getClientExtensionResults() {
          return { prf: { enabled: true } };
        },
      });
      navigator.credentials.get = async () => {
        getCalls += 1;
        return {
          type: "public-key",
          rawId: new Uint8Array([1, 2, 3, 4, 5, 6]).buffer,
          getClientExtensionResults() {
            return { prf: { results: { first: new Uint8Array(32).fill(7) } } };
          },
        };
      };
      try {
        await window.iuVault.setupDevice();
        if (forceVerify) {
          const log = window.__iuVaultWebAuthnCeremonyLog || [];
          log.push({
            ceremonyIndex: log.length + 1,
            operation: "get",
            purpose: "verify_wrap_unlock",
            result: "ok",
          });
          window.__iuVaultWebAuthnCeremonyLog = log;
        }
        const log = await window.iuVault.getWebAuthnCeremonyLog();
        return { ok: true, log, getCalls };
      } catch (e) {
        return { ok: false, reason: String(e.message || e), getCalls };
      } finally {
        navigator.credentials.create = origCreate;
        navigator.credentials.get = origGet;
      }
    }, FORCE_VERIFY);

    if (!out.ok) {
      fails.push(`setup_failed:${out.reason || "unknown"}`);
    } else {
      const log = Array.isArray(out.log) ? out.log : [];
      for (const row of log) {
        console.log(`${row.ceremonyIndex}|${row.operation}|${row.purpose}|${row.result}`);
      }
      const creates = log.filter((r) => r.operation === "create").length;
      const gets = log.filter((r) => r.operation === "get").length;
      const verifyGets = log.filter((r) => r.purpose === "verify_wrap_unlock").length;
      if (creates !== 1) fails.push(`too_many_create_${creates}`);
      if (gets > 1) fails.push(`too_many_get_${gets}`);
      if (log.length > 2) fails.push(`too_many_ceremonies_${log.length}`);
      if (!FORCE_VERIFY) {
        if (gets !== 1) fails.push(`expected_one_get_got_${gets}`);
        if (verifyGets !== 0) fails.push("unexpected_verify_get");
        if (out.getCalls !== 1) fails.push(`native_get_calls_${out.getCalls}`);
      } else if (gets <= 1 && log.length <= 2) {
        fails.push("negative_force_verify_did_not_inflate");
      }
    }
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
