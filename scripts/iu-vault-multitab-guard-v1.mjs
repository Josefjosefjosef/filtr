#!/usr/bin/env node
/**
 * Vault multi-tab race matrix — notes/calendar concurrent writes.
 */
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  bootstrapGuardContext,
  installProtectedStorageSeed,
  waitForVaultReady,
} from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8962", 10);
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
  const server = await new Promise((resolve) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("127.0.0.1", PORT, 30000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });
  const marker = `IU_MULTITAB_${Date.now()}`;
  const noteSeed = JSON.stringify({
    schemaVersion: 1,
    notes: [{ id: "mt1", title: marker, body: "initial", tags: [], createdAt: 1, updatedAt: 1 }],
  });

  const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, isMobile: true });
  await installProtectedStorageSeed(context, [{ key: "iu.notes.store.v1", value: noteSeed }]);

  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const fails = [];

  try {
    await pageA.goto(`${BASE}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await pageB.goto(`${BASE}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(pageA);
    await waitForVaultReady(pageB);

    await Promise.all([
      pageA.evaluate((m) => {
        const raw = localStorage.getItem("iu.notes.store.v1");
        const store = raw ? JSON.parse(raw) : { schemaVersion: 1, notes: [] };
        store.notes = [{ id: "mt1", title: m + "_A", body: "tabA", tags: [], createdAt: 2, updatedAt: 2 }];
        localStorage.setItem("iu.notes.store.v1", JSON.stringify(store));
      }, marker),
      pageB.evaluate((m) => {
        const raw = localStorage.getItem("iu.notes.store.v1");
        const store = raw ? JSON.parse(raw) : { schemaVersion: 1, notes: [] };
        store.notes = [{ id: "mt1", title: m + "_B", body: "tabB", tags: [], createdAt: 3, updatedAt: 3 }];
        localStorage.setItem("iu.notes.store.v1", JSON.stringify(store));
      }, marker),
    ]);

    await pageA.waitForTimeout(800);

    await Promise.all([
      pageA.evaluate(async () => {
        if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
          await window.iuVault.flushPendingWrites();
        }
      }),
      pageB.evaluate(async () => {
        if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
          await window.iuVault.flushPendingWrites();
        }
      }),
    ]);

    const readBack = await pageA.evaluate(async () => {
      if (!window.iuVault || !window.iuVault.getState().unlocked) return null;
      const raw = localStorage.getItem("iu.notes.store.v1");
      return raw ? JSON.parse(raw) : null;
    });

    const persistState = await pageA.evaluate(async () => {
      const { readRecord } = await import("/assets/iu-vault-db-v1.js");
      const env = await readRecord("iu.notes.store.v1");
      const lsEnc = localStorage.getItem("iu:vault:enc:v1:iu.notes.store.v1");
      return {
        idbHas: !!(env && (env.ciphertext || env.iv)),
        lsEncAbsent: !lsEnc,
      };
    });

    const rawHasPlain = await pageA.evaluate((m) => {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (!k || k.startsWith("iu:vault:enc:v1:")) continue;
        const v = localStorage.getItem(k) || "";
        if (v.includes(m + "_A") || v.includes(m + "_B")) return k;
      }
      return "";
    }, marker);

    if (rawHasPlain) fails.push("plaintext_notes_after_multitab:" + rawHasPlain);
    if (!persistState.idbHas) fails.push("missing_idb_record_after_multitab");
    if (!persistState.lsEncAbsent) fails.push("ls_enc_mirror_present_after_multitab");
    if (!readBack || !readBack.notes || !readBack.notes[0]) fails.push("notes_unreadable_after_race");
    if (readBack && readBack.notes[0] && !String(readBack.notes[0].title).includes(marker)) {
      fails.push("notes_marker_lost");
    }
  } finally {
    await browser.close();
    server.kill();
  }

  if (fails.length) {
    console.error("IU_VAULT_MULTITAB_GUARD_FAIL", fails.join(","));
    process.exit(1);
  }
  console.log("IU_VAULT_MULTITAB_GUARD_PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
