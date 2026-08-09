#!/usr/bin/env node
/** Real-feed cutover: Prehled boot then goto iuInfoSystem=off without route stubs. */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_HEAVY_FEED_CUTOVER_PORT || 8128);
const SERVER = path.join(ROOT, "server/projects-static.mjs");

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitUrl(url, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await wait(200);
  }
  throw new Error("server_timeout");
}

const server = spawn(process.execPath, [SERVER], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: "ignore",
});
await waitUrl(`http://127.0.0.1:${PORT}/projects/`, 30000);
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ serviceWorkers: "block" });
const page = await ctx.newPage();
let timeouts = 0;
try {
  await page.goto(`http://127.0.0.1:${PORT}/projects/`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(1500);
  await page.goto(`http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=off`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(500);
} catch (e) {
  if (/Timeout/i.test(String(e && e.message))) timeouts += 1;
  else throw e;
}
const ok = timeouts === 0;
console.log(
  JSON.stringify(
    {
      CUTOVER_REAL_FEED_PASS: ok ? "YES" : "NO",
      CUTOVER_REAL_FEED_TIMEOUTS: timeouts,
      REAL_HEAVY_FEED_TEST_USED_STUB: "NO",
    },
    null,
    2
  )
);
await ctx.close();
await browser.close();
server.kill("SIGTERM");
process.exit(ok ? 0 : 1);
