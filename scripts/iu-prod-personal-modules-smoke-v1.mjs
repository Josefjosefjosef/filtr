#!/usr/bin/env node
/**
 * Production personal modules smoke — synthetic markers on infouzel.cz.
 */
import { chromium } from "playwright";
import crypto from "crypto";
import { isProtectedStorageKey } from "../assets/iu-vault-protected-keys-v1.js";

const PROD = process.env.IU_PROD_URL || "https://infouzel.cz/";
const MARKER = `IU_PROD_SECURITY_TEST_20260822_${crypto.randomBytes(4).toString("hex")}`;
const fails = [];

async function scanProtectedPlaintext(page, marker) {
  return page.evaluate((needle) => {
    const hits = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || k.startsWith("iu:vault:enc:v1:")) continue;
      const v = localStorage.getItem(k) || "";
      if (v.includes(needle)) hits.push(`ls:${k}`);
    }
    return hits;
  }, marker);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  const networkHits = [];
  const consoleHits = [];

  page.on("request", (req) => {
    const u = req.url();
    if (u.includes(MARKER)) networkHits.push(u);
    const post = req.postData() || "";
    if (post.includes(MARKER)) networkHits.push(`body:${req.method()}:${u}`);
  });
  page.on("console", (msg) => {
    const t = msg.text();
    if (t.includes(MARKER)) consoleHits.push(t);
  });

  await page.goto(PROD, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  await page.waitForFunction(() => !!window.iuVault, null, { timeout: 90000 }).catch(() => fails.push({ id: "vault_boot", detail: "missing" }));
  await page.waitForFunction(() => window.iuVault && window.iuVault.getState().unlocked, null, { timeout: 60000 }).catch(() =>
    fails.push({ id: "vault_unlock", detail: "locked" })
  );

  const modules = [
    { key: "iu.notes.store.v1", field: "notes", item: { id: "p1", title: MARKER, body: "note", tags: [], createdAt: 1, updatedAt: 1 } },
    { key: "iu.tasks.mvp.v1", field: "tasks", item: { id: "p1", title: MARKER, status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 } },
  ];

  for (const mod of modules) {
    if (!isProtectedStorageKey(mod.key)) fails.push({ id: `not_protected:${mod.key}`, detail: "guard" });

    await page.evaluate(
      ({ key, field, item }) => {
        const payload = { schemaVersion: 1, [field]: [item] };
        localStorage.setItem(key, JSON.stringify(payload));
      },
      { key: mod.key, field: mod.field, item: mod.item }
    );

    const beforeReload = await page.evaluate((key) => {
      const raw = localStorage.getItem(key) || "";
      return raw.includes("IU_PROD_SECURITY_TEST");
    }, mod.key);
    if (!beforeReload) fails.push({ id: `write:${mod.key}`, detail: "failed" });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.iuVault && window.iuVault.getState().unlocked, null, { timeout: 60000 });

    const read = await page.evaluate((key) => {
      const raw = localStorage.getItem(key) || "";
      return raw.includes("IU_PROD_SECURITY_TEST");
    }, mod.key);
    if (!read) fails.push({ id: `read:${mod.key}`, detail: "missing_after_reload" });

    const enc = await page.evaluate((key) => !!localStorage.getItem(`iu:vault:enc:v1:${key}`), mod.key);
    if (!enc) fails.push({ id: `enc:${mod.key}`, detail: "no_ciphertext_blob" });

    const leaks = await scanProtectedPlaintext(page, MARKER);
    const protectedLeaks = leaks.filter((h) => h.includes(mod.key) && !h.includes("iu:vault:enc"));
    if (protectedLeaks.length) fails.push({ id: `plaintext:${mod.key}`, detail: protectedLeaks.join(",") });

    await page.evaluate((key) => {
      localStorage.removeItem(key);
      localStorage.removeItem(`iu:vault:enc:v1:${key}`);
    }, mod.key);
  }

  if (networkHits.length) fails.push({ id: "network_leak", detail: networkHits.join("|") });
  if (consoleHits.length) fails.push({ id: "console_leak", detail: consoleHits.join("|") });

  const buildProof = await page.evaluate(() => ({
    tt: [...document.querySelectorAll("script[src]")].some((s) => (s.getAttribute("src") || "").includes("iu-trusted-types")),
    vault: [...document.querySelectorAll("script[src]")].some((s) => (s.getAttribute("src") || "").includes("iu-vault-bootstrap")),
    csp: (document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || "",
  }));

  if (!buildProof.tt) fails.push({ id: "prod_tt_asset", detail: "missing" });
  if (!buildProof.vault) fails.push({ id: "prod_vault_asset", detail: "missing" });

  await browser.close();
  console.log("IU_PROD_PERSONAL_MODULES_SMOKE=" + JSON.stringify({ marker: MARKER, fails, buildProof, networkHits, consoleHits }));

  if (fails.length) {
    console.error("IU_PROD_PERSONAL_MODULES_SMOKE_FAIL");
    process.exit(1);
  }
  console.log("IU_PROD_PERSONAL_MODULES_SMOKE_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
