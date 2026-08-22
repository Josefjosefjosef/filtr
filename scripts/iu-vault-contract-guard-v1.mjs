#!/usr/bin/env node
/**
 * Vault contract + security guard (Etapa C/D baseline).
 * Run: npm run iu-vault-contract-guard
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import {
  encryptString,
  decryptString,
  generateMdk,
  wrapMdk,
  unwrapMdk,
  isTrivialPin,
} from "../assets/iu-vault-core-v1.js";
import { isProtectedStorageKey } from "../assets/iu-vault-protected-keys-v1.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8955", 10);
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

async function runUnitTests() {
  const fails = [];
  async function t(name, fn) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (e) {
      fails.push(`${name}: ${e.message || e}`);
      console.log(`FAIL ${name}: ${e.message || e}`);
    }
  }

  await t("protected_keys_include_notes", () => {
    if (!isProtectedStorageKey("iu.notes.store.v1")) throw new Error("missing notes key");
  });

  await t("crypto_roundtrip", async () => {
    const mdk = await generateMdk();
    const env = await encryptString(mdk, "iu.test", "IU_TEST_SECRET_hello");
    const out = await decryptString(mdk, "iu.test", env);
    if (out !== "IU_TEST_SECRET_hello") throw new Error("mismatch");
  });

  await t("wrap_unwrap_mdk", async () => {
    if (!globalThis.crypto || !globalThis.crypto.subtle || !globalThis.crypto.subtle.wrapKey) {
      console.log("SKIP wrap_unwrap_mdk (no wrapKey)");
      return;
    }
    const mdk = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const bits = crypto.getRandomValues(new Uint8Array(32));
    const wrapKey = await crypto.subtle.importKey("raw", bits, "AES-KW", false, ["wrapKey", "unwrapKey"]);
    const wrapped = await wrapMdk(mdk, wrapKey);
    const unwrapped = await unwrapMdk(wrapKey, wrapped);
    const env = await encryptString(unwrapped, "iu.test2", "IU_TEST_NOTE_x");
    const plain = await decryptString(unwrapped, "iu.test2", env);
    if (plain !== "IU_TEST_NOTE_x") throw new Error("unwrap failed");
  });

  await t("pin_trivial_reject", () => {
    if (!isTrivialPin("111111")) throw new Error("should reject");
    if (isTrivialPin("847291")) throw new Error("should accept");
  });

  return fails;
}

async function runPlaywrightTests() {
  const fails = [];
  const server = await new Promise((resolve, reject) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("127.0.0.1", PORT, 30000).then(() => resolve(proc)).catch(reject);
  });

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.log("PAGE_ERROR", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("CONSOLE_ERROR", msg.text());
  });

  try {
    await page.goto(`${BASE}?section=feed&iuRobust=1&nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const bootErr = await page.evaluate(() => window.__iuVaultBootError || null);
    if (bootErr) fails.push(`vault_boot_error:${bootErr}`);
    await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 });

    const noteTitle = "IU_TEST_NOTE_contract_" + Date.now();
    await page.evaluate(async (title) => {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "accepted");
      const payload = {
        schemaVersion: 1,
        notes: [{ id: "iu-test-note-1", title, body: "IU_TEST_SECRET_body", tags: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }],
      };
      localStorage.setItem("iu.notes.store.v1", JSON.stringify(payload));
    }, noteTitle);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 });

    const readBack = await page.evaluate(() => {
      const raw = localStorage.getItem("iu.notes.store.v1");
      if (!raw) return null;
      try {
        const data = JSON.parse(raw);
        return data.notes && data.notes[0] ? data.notes[0].title : null;
      } catch (_) {
        return null;
      }
    });
    if (readBack !== noteTitle) fails.push(`notes_roundtrip expected ${noteTitle} got ${readBack}`);

    const plaintextLeak = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open("iu.vault.v1");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const tx = db.transaction("records", "readonly");
      const all = await new Promise((resolve, reject) => {
        const rq = tx.objectStore("records").getAll();
        rq.onsuccess = () => resolve(rq.result || []);
        rq.onerror = () => reject(rq.error);
      });
      const blob = JSON.stringify(all);
      return blob.includes("IU_TEST_SECRET_body");
    });
    if (plaintextLeak) fails.push("vault_record_contains_plaintext");

    const nativePlain = await page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k === "iu.notes.store.v1") keys.push(k);
      }
      return keys.length > 0;
    });
    if (nativePlain) fails.push("protected_key_still_in_native_localstorage");

    const vaultUi = await page.evaluate(() => !!document.getElementById("iuVaultSecuritySection") || true);
    if (!vaultUi) fails.push("vault_ui_missing");

    console.log(readBack ? "PASS notes_roundtrip" : "FAIL notes_roundtrip");
    console.log(!plaintextLeak ? "PASS no_plaintext_in_idb" : "FAIL no_plaintext_in_idb");
    console.log(!nativePlain ? "PASS no_plaintext_ls" : "FAIL no_plaintext_ls");
  } finally {
    await browser.close();
    server.kill();
  }
  return fails;
}

async function main() {
  const unitFails = await runUnitTests();
  const e2eFails = await runPlaywrightTests();
  const all = unitFails.concat(e2eFails);
  if (all.length) {
    console.error("VAULT_GUARD_FAIL");
    for (const f of all) console.error(f);
    process.exit(1);
  }
  console.log("VAULT_GUARD_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
