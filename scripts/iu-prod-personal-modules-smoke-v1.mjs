#!/usr/bin/env node
/**
 * Production personal modules smoke — synthetic markers on infouzel.cz.
 * Covers all sensitive MODULE_DEFS keys + storage/network/log forensics.
 */
import { chromium } from "playwright";
import crypto from "crypto";
import { isProtectedStorageKey } from "../assets/iu-vault-protected-keys-v1.js";

const PROD = process.env.IU_PROD_URL || "https://infouzel.cz/";
const MARKER = `IU_PROD_SECURITY_TEST_20260822_${crypto.randomBytes(4).toString("hex")}`;
const fails = [];

function buildModules(marker) {
  return [
    { key: "iu.notes.store.v1", payload: { schemaVersion: 1, notes: [{ id: "p1", title: marker, body: "note", tags: [], createdAt: 1, updatedAt: 1 }] } },
    { key: "iu.tasks.mvp.v1", payload: { schemaVersion: 1, tasks: [{ id: "p1", title: marker, status: "todo", priority: "medium", createdAt: 1, updatedAt: 1 }] } },
    { key: "iu.calendar.store.v1", payload: { schemaVersion: 1, events: [{ id: "p1", title: marker, start: "2026-08-22T10:00:00", end: "2026-08-22T11:00:00" }] } },
    { key: "iu_invoice_form_state_v1", payload: { v: 1, buyerName: marker, items: [] } },
    { key: "iu_invoice_recipients_v1", payload: { v: 1, recipients: [{ id: "p1", name: marker }] } },
    { key: "iu_invoice_suppliers_v1", payload: { v: 1, suppliers: [{ id: "p1", name: marker }] } },
    { key: "infouzel_datovka_profiles_v1", payload: { v: 1, profiles: [{ id: "p1", label: marker, username: "test" }] } },
    { key: "iu_bakalari_profiles", payload: [{ id: "p1", name: marker, url: "https://example.test/bakalari" }] },
    { key: "iu_health_insurance_v2", payload: { v: 2, providers: [{ id: "p1", name: marker }] } },
    { key: "iu_silver_parcel_watch_v1", payload: { v: 1, items: [{ id: "p1", tracking: marker }] } },
    { key: "iuShoppingLastListV1", payload: { v: 1, items: [marker] } },
    { key: "infouzel_quicktools", payload: { schemaVersion: 2, buttons: [{ id: "p1", label: marker, url: "https://example.test" }] } },
    { key: "iu_user_address", payload: { street: marker, city: "Test" } },
    { key: "iu_user_address_explicit.v1", payload: { street: marker, city: "Test" } },
    { key: "iuSilver.salutationPreference.v1", payload: { mode: marker } },
    { key: "iu_notes_v1_security_test", payload: { text: marker, updatedAt: 1 } },
    { key: "iu:translator:notes", payload: { notes: [{ id: "p1", text: marker }] } },
    { key: "iuUserBanks", payload: [{ id: "p1", name: marker }] },
    { key: "iu_mailboxes_v1", payload: { v: 1, mailboxes: [{ id: "p1", email: `${marker}@example.test` }] } },
    { key: "iuShoppingDeliveryAddressV1", payload: { street: marker } },
  ];
}

async function scanAllStorage(page, marker) {
  return page.evaluate(async (needle) => {
    const hits = [];
    const scanText = (store, label) => {
      for (let i = 0; i < store.length; i += 1) {
        const k = store.key(i);
        if (!k || k.startsWith("iu:vault:enc:v1:")) continue;
        const v = store.getItem(k) || "";
        if (v.includes(needle)) hits.push(`${label}:${k}`);
      }
    };
    scanText(localStorage, "ls");
    try {
      scanText(sessionStorage, "ss");
    } catch (_) {}

    try {
      const dbs = await indexedDB.databases();
      for (const dbInfo of dbs) {
        const name = dbInfo.name;
        if (!name) continue;
        await new Promise((resolve) => {
          const req = indexedDB.open(name);
          req.onsuccess = () => {
            const db = req.result;
            const stores = Array.from(db.objectStoreNames);
            let pending = stores.length;
            if (!pending) {
              db.close();
              resolve();
              return;
            }
            for (const storeName of stores) {
              const tx = db.transaction(storeName, "readonly");
              const store = tx.objectStore(storeName);
              const getAll = store.getAll();
              getAll.onsuccess = () => {
                const rows = getAll.result || [];
                for (const row of rows) {
                  const blob = JSON.stringify(row);
                  if (blob.includes(needle) && !blob.includes(`enc:${needle}`)) {
                    hits.push(`idb:${name}/${storeName}`);
                  }
                }
                pending -= 1;
                if (pending <= 0) {
                  db.close();
                  resolve();
                }
              };
              getAll.onerror = () => {
                pending -= 1;
                if (pending <= 0) {
                  db.close();
                  resolve();
                }
              };
            }
          };
          req.onerror = () => resolve();
        });
      }
    } catch (_) {}

    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        for (const ck of keys) {
          const cache = await caches.open(ck);
          const reqs = await cache.keys();
          for (const r of reqs) {
            const u = r.url || "";
            if (u.includes(needle)) hits.push(`cache:url:${ck}`);
            try {
              const res = await cache.match(r);
              if (res) {
                const t = await res.text();
                if (t.includes(needle)) hits.push(`cache:body:${ck}:${u.slice(0, 80)}`);
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {}

    const dom = document.documentElement && document.documentElement.innerHTML;
    if (dom && dom.includes(needle)) hits.push("dom:html");

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

  const modules = buildModules(MARKER);

  for (const mod of modules) {
    if (!isProtectedStorageKey(mod.key)) fails.push({ id: `not_protected:${mod.key}`, detail: "guard" });

    await page.evaluate(
      ({ key, payload }) => {
        localStorage.setItem(key, JSON.stringify(payload));
      },
      { key: mod.key, payload: mod.payload }
    );

    const beforeReload = await page.evaluate(
      ({ key, marker }) => (localStorage.getItem(key) || "").includes(marker),
      { key: mod.key, marker: MARKER }
    );
    if (!beforeReload) fails.push({ id: `write:${mod.key}`, detail: "failed" });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.iuVault && window.iuVault.getState().unlocked, null, { timeout: 60000 });

    const enc = await page.evaluate((key) => !!localStorage.getItem(`iu:vault:enc:v1:${key}`), mod.key);
    if (!enc) fails.push({ id: `enc:${mod.key}`, detail: "no_ciphertext_blob" });

    const rawKeyPresent = await page.evaluate((key) => {
      for (let i = 0; i < localStorage.length; i += 1) {
        if (localStorage.key(i) === key) return true;
      }
      return false;
    }, mod.key);
    if (rawKeyPresent) fails.push({ id: `plaintext_ls_key:${mod.key}`, detail: "raw_key_still_present" });

    const leaks = await scanAllStorage(page, MARKER);
    if (leaks.length) fails.push({ id: `forensics:${mod.key}`, detail: leaks.join(",") });

    await page.evaluate((key) => {
      localStorage.removeItem(key);
      localStorage.removeItem(`iu:vault:enc:v1:${key}`);
    }, mod.key);
  }

  if (networkHits.length) fails.push({ id: "network_leak", detail: networkHits.join("|") });
  if (consoleHits.length) fails.push({ id: "console_leak", detail: consoleHits.join("|") });

  const buildProof = await page.evaluate(() => {
    const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return {
      tt: [...document.querySelectorAll("script[src]")].some((s) => (s.getAttribute("src") || "").includes("iu-trusted-types")),
      vault: [...document.querySelectorAll("script[src]")].some((s) => (s.getAttribute("src") || "").includes("iu-vault-bootstrap")),
      csp: (cspMeta && cspMeta.content) || "",
      ttEnforce: /require-trusted-types-for\s+'script'/.test((cspMeta && cspMeta.content) || ""),
    };
  });

  if (!buildProof.tt) fails.push({ id: "prod_tt_asset", detail: "missing" });
  if (!buildProof.vault) fails.push({ id: "prod_vault_asset", detail: "missing" });
  if (!buildProof.ttEnforce) fails.push({ id: "prod_tt_enforce", detail: "missing_require_trusted_types" });

  const ttBlock = await page.evaluate(() => {
    try {
      const el = document.createElement("div");
      el.innerHTML = "<script>window.__iu_tt_probe=1</script>";
      return { blocked: false, probe: !!window.__iu_tt_probe };
    } catch (e) {
      return { blocked: true, err: String(e.message || e) };
    }
  });
  if (!ttBlock.blocked || ttBlock.probe) fails.push({ id: "prod_tt_sink_block", detail: JSON.stringify(ttBlock) });

  await browser.close();
  console.log(
    "IU_PROD_PERSONAL_MODULES_SMOKE=" +
      JSON.stringify({ marker: MARKER, moduleCount: modules.length, fails, buildProof, networkHits, consoleHits, ttBlock })
  );

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
