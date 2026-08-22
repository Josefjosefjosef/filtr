#!/usr/bin/env node
/**
 * Security UI visual smoke — multi viewport, key shells + TT bootstrap present.
 */
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8965", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const VIEWPORTS = [
  { id: "iphone", width: 390, height: 844, isMobile: true },
  { id: "android", width: 412, height: 915, isMobile: true },
  { id: "tablet_p", width: 768, height: 1024, isMobile: true },
  { id: "desktop", width: 1280, height: 800, isMobile: false },
];

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
  const server = await new Promise((resolve) => {
    const proc = require("child_process").spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    waitForPort("127.0.0.1", PORT, 30000).then(() => resolve(proc));
  });

  const browser = await chromium.launch({ headless: true });

  for (const vp of VIEWPORTS) {
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));

    await page.goto(`${BASE}?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => !!window.iuVault, null, { timeout: 60000 }).catch(() => fails.push(`${vp.id}:vault_missing`));

    const shell = await page.evaluate(() => ({
      body: !!document.body,
      prehled: !!(document.querySelector("#iuPrehledDneRoot, [data-iu-prehled-dne-root]")),
      nav: !!(document.querySelector("[data-iu-bottom-nav], .iu-bottom-nav, #iuBottomNav")),
      tt: !!(window.trustedTypes && window.__iuTrustedTypesReady),
    }));

    if (!shell.body || !shell.prehled) fails.push(`${vp.id}:shell_missing`);
    if (!shell.tt) fails.push(`${vp.id}:tt_bootstrap_missing`);
    if (pageErrors.length) fails.push(`${vp.id}:pageerror=${pageErrors[0]}`);

    await context.close();
  }

  await browser.close();
  server.kill();

  console.log("IU_SECURITY_VISUAL_GUARD=" + JSON.stringify({ viewports: VIEWPORTS.length, fails }));
  if (fails.length) {
    console.error("IU_SECURITY_VISUAL_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_SECURITY_VISUAL_GUARD_PASS");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
