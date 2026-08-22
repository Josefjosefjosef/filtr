#!/usr/bin/env node
/**
 * Fail if protected MODULE_DEFS keys appear as plaintext in localStorage after vault boot.
 * Run: npm run iu-vault-plaintext-guard
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import { isProtectedStorageKey } from "../assets/iu-vault-protected-keys-v1.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const http = require("http");
const { spawn } = require("child_process");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8956", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

function waitForPort() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 30000;
    const tick = () => {
      const req = http.request({ host: "127.0.0.1", port: PORT, path: "/projects/", method: "HEAD" }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server timeout"));
        else setTimeout(tick, 120);
      });
      req.end();
    };
    tick();
  });
}

async function main() {
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForPort();

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`${BASE}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 });

  await page.evaluate(() => {
    localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
    localStorage.setItem("iu:tool-local-storage-consent:v1", "accepted");
    localStorage.setItem("iu.notes.store.v1", JSON.stringify({
      schemaVersion: 1,
      notes: [{ id: "t1", title: "IU_TEST_NOTE_plaintext_guard", body: "IU_TEST_SECRET_guard", tags: [] }],
    }));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 });

  const leaks = await page.evaluate(() => {
    const found = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      const val = localStorage.getItem(k) || "";
      if (val.includes("IU_TEST_SECRET_guard")) found.push(k);
    }
    return found;
  });

  await browser.close();
  server.kill();

  if (leaks.length) {
    console.error("PLAINTEXT_GUARD_FAIL", leaks.join(","));
    process.exit(1);
  }
  console.log("PLAINTEXT_GUARD_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
