#!/usr/bin/env node
/**
 * PIN enable must preserve iu_mailboxes_v1 (MindMenu) across MDK rotate.
 * Repro: SECURITY OFF save mailboxes → setupPin (while MindMenu may race) → unlock → SAME.
 */
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium, firefox, webkit } = require("playwright");

const PIN = "847291";
const KEY = "iu_mailboxes_v1";

async function runEngine(browserType, name, base) {
  const fails = [];
  const ctx = await browserType.launch({ headless: true });
  const context = await ctx.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  const page = await context.newPage();
  try {
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });

    const marker = `IU_PIN_MBOX_${Date.now()}_${name}`;
    const before = await page.evaluate(
      async ({ KEY, marker }) => {
        async function fp(t) {
          const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t || "")));
          return Array.from(new Uint8Array(dig))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 8);
        }
        const payload = JSON.stringify({
          items: [{ label: marker, url: "https://example.com/" + marker, social: null, hidden: false, slot: 1 }],
        });
        await window.iuVault.durableSet(KEY, payload);
        await window.iuVault.flushPendingWrites();
        // Kick MindMenu so a late durableSet can race setupPin (pre-fix Chromium failure mode).
        if (typeof window.__iuEnsureFeedPipeline === "function") {
          void window.__iuEnsureFeedPipeline();
        }
        // Give MindMenu a tick to attempt placeholder writes (must not clobber marker).
        await new Promise((r) => setTimeout(r, 100));
        if (typeof window.iuArticleActionsOpenOverlay === "function") {
          try {
            await window.iuArticleActionsOpenOverlay();
          } catch (_) {}
        }
        await new Promise((r) => setTimeout(r, 200));
        const storage = await import("/assets/iu-vault-storage-v1.js");
        const lock = await import("/assets/iu-vault-lock-v1.js");
        const { readRecord } = await import("/assets/iu-vault-db-v1.js");
        const { decryptString } = await import("/assets/iu-vault-core-v1.js");
        const env = await readRecord(KEY);
        const pt = await decryptString(lock.getMdk(), KEY, env);
        return {
          decryptFp: await fp(pt),
          marker: String(pt).includes(marker),
          pending: storage.getPendingVaultWriteCount(),
        };
      },
      { KEY, marker }
    );
    if (!before.marker) fails.push(`${name}_before_marker_missing`);

    // Do not await MindMenu — setupPin must tolerate in-flight module writes.
    await page.waitForTimeout(30);
    await page.evaluate(async (pin) => {
      await window.iuVault.setupPin(pin, pin);
    }, PIN);

    await page.evaluate(async (pin) => {
      await window.iuVault.unlockPin(pin);
      await window.iuVault.afterUnlock();
      if (window.iuVault.refreshAppLockUi) await window.iuVault.refreshAppLockUi();
    }, PIN);
    await page.waitForFunction(
      () => window.iuVault.getState().unlocked && window.__iuVaultHydrationComplete === true,
      null,
      { timeout: 90000 }
    );

    const after = await page.evaluate(
      async ({ KEY, marker }) => {
        async function fp(t) {
          const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(t || "")));
          return Array.from(new Uint8Array(dig))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 8);
        }
        const storage = await import("/assets/iu-vault-storage-v1.js");
        const lock = await import("/assets/iu-vault-lock-v1.js");
        const { readRecord } = await import("/assets/iu-vault-db-v1.js");
        const { decryptString } = await import("/assets/iu-vault-core-v1.js");
        let mdk = null;
        try {
          mdk = lock.getMdk();
        } catch (_) {}
        const env = await readRecord(KEY);
        let decryptOk = false;
        let decryptFp = null;
        let decryptErr = null;
        let hasMarker = false;
        if (mdk && env && env.ct) {
          try {
            const pt = await decryptString(mdk, KEY, env);
            decryptOk = true;
            decryptFp = await fp(pt);
            hasMarker = String(pt).includes(marker);
          } catch (e) {
            decryptErr = String(e && e.name ? e.name : e).slice(0, 40);
          }
        }
        return {
          idbPresent: !!(env && env.ct),
          decryptOk,
          decryptFp,
          decryptErr,
          hasMarker,
          sync: storage.getProtectedSyncReadState(KEY).status,
          configured: await window.iuVault.getSecurityConfigured(),
        };
      },
      { KEY, marker }
    );

    if (!after.idbPresent) fails.push(`${name}_IDB_ABSENT`);
    if (!after.decryptOk) fails.push(`${name}_DECRYPT_FAIL:${after.decryptErr || ""}`);
    if (after.sync !== "PRESENT") fails.push(`${name}_sync_${after.sync}`);
    if (!after.hasMarker) fails.push(`${name}_marker_missing`);
    if (!(after.configured && after.configured.pinConfigured)) fails.push(`${name}_pin_not_configured`);
    // Marker survival is the contract; social-defaults may enrich JSON (FP may differ).
    return { name, fails, before, after };
  } finally {
    await context.close();
    await ctx.close();
  }
}

async function main() {
  const started = await startGuardStaticServer(pickGuardPort(8980, 200));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const engines = [];
  if (chromium) engines.push(["chromium", chromium, true]);
  if (firefox) engines.push(["firefox", firefox, false]);
  if (webkit) engines.push(["webkit", webkit, false]);
  const results = [];
  const allFails = [];
  const skipped = [];
  try {
    for (const [name, bt, required] of engines) {
      try {
        const r = await runEngine(bt, name, base);
        results.push(r);
        allFails.push(...r.fails);
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (!required && /Executable doesn't exist|browser has been closed|browserType\.launch/i.test(msg)) {
          skipped.push(`${name}:browser_unavailable`);
          continue;
        }
        allFails.push(`${name}_exception:${msg.slice(0, 120)}`);
      }
    }
    if (!results.some((r) => r.name === "chromium") && !skipped.includes("chromium:browser_unavailable")) {
      /* chromium may have failed with fails[] rather than exception */
    }
    if (!results.some((r) => r.name === "chromium")) {
      allFails.push("chromium_required_missing");
    }
  } finally {
    await stopGuardProcess(started.proc);
  }

  const out = { fails: allFails, skipped, results };
  console.log("IU_VAULT_PIN_MAILBOXES_PRESERVE=" + JSON.stringify(out));
  if (allFails.length) {
    console.error("IU_VAULT_PIN_MAILBOXES_PRESERVE_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_PIN_MAILBOXES_PRESERVE_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
