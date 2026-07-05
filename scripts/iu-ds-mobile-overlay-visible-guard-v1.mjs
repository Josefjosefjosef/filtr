#!/usr/bin/env node
/**
 * Datová schránka — mobil/tablet overlay visible above backdrop (MindMenu gate path).
 * Run: npm run iu-ds-mobile-overlay-visible-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const UNIFIED = path.join(REPO, "assets", "iu-overlay-mobile-tablet-unified-v1.css");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8897", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function staticGate() {
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const dsBlock = unified.match(
    /body\.iu-modal-open\.iu-ds-overlay-open #iuDsPanel\.iu-ds-panel\.iuSectionDS\[data-open="1"\]:not\(\[hidden\]\)\s*\{[\s\S]*?\}/
  );
  const block = dsBlock ? dsBlock[0] : "";
  const checks = [
    {
      id: "ds_panel_fixed_top",
      pass: /position:\s*fixed !important/.test(block) && /top:\s*0 !important/.test(block),
    },
    {
      id: "ds_panel_no_inset_auto_reset",
      pass: block.length > 0 && !/inset:\s*auto !important/.test(block),
    },
    {
      id: "ds_panel_z_above_backdrop",
      pass: /z-index:\s*10040 !important/.test(block),
    },
    {
      id: "index_cache_bust",
      pass: /iu-overlay-mobile-tablet-unified-v1\.css\?v=datovka-mobile-overlay-v1-20260705/.test(index),
    },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

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

async function openDatovkaViaGate(page) {
  await page.evaluate(() => {
    const gateTab = document.getElementById("iuMobileGateTabTools");
    if (gateTab) gateTab.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="datovka"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(800);
}

async function measureOpen(page) {
  return page.evaluate(() => {
    function cs(el) {
      if (!el) return null;
      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        hidden: el.hidden,
        dataOpen: el.dataset ? el.dataset.open : null,
        display: st.display,
        visibility: st.visibility,
        position: st.position,
        top: st.top,
        zIndex: st.zIndex,
        rect: { w: r.width, h: r.height, top: r.top, left: r.left },
      };
    }
    const panel = cs(document.getElementById("iuDsPanel"));
    const overlay = cs(document.getElementById("iuDsOverlay"));
    const panelInViewport =
      panel &&
      !panel.hidden &&
      panel.dataOpen === "1" &&
      panel.display !== "none" &&
      panel.visibility !== "hidden" &&
      panel.rect.h > 40 &&
      panel.rect.top >= -2 &&
      panel.rect.top < 120;
    const panelAboveOverlay =
      panelInViewport &&
      overlay &&
      Number(panel.zIndex) >= Number(overlay.zIndex);
    return { panel, overlay, panelInViewport, panelAboveOverlay };
  });
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await page.waitForTimeout(2000);

  await openDatovkaViaGate(page);
  const first = await measureOpen(page);

  await page.evaluate(() => {
    const b = document.querySelector("#iuDsPanel .iu-ds-close");
    if (b) b.click();
  });
  await page.waitForTimeout(400);

  await openDatovkaViaGate(page);
  const reopen = await measureOpen(page);

  await context.close();
  return {
    viewport: vp.name,
    first_open_in_viewport: first.panelInViewport,
    first_open_above_backdrop: first.panelAboveOverlay,
    reopen_in_viewport: reopen.panelInViewport,
    reopen_above_backdrop: reopen.panelAboveOverlay,
    first,
    reopen,
  };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log(JSON.stringify({ result: "FAIL", phase: "static", ...staticResult }, null, 2));
    process.exit(1);
  }

  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(REPO, p.replace(/^\/+/, ""));
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const mime =
        fp.endsWith(".css") ? "text/css; charset=utf-8" :
        fp.endsWith(".js") ? "text/javascript; charset=utf-8" :
        fp.endsWith(".html") ? "text/html; charset=utf-8" :
        "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(fs.readFileSync(fp));
    } catch (_) {
      res.writeHead(500);
      res.end("err");
    }
  });

  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  await waitForPort("127.0.0.1", PORT, 10000);

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const vp of VIEWPORTS) {
    results.push(await runViewport(browser, vp));
  }
  await browser.close();
  server.close();

  const pass = results.every(
    (r) =>
      r.first_open_in_viewport &&
      r.first_open_above_backdrop &&
      r.reopen_in_viewport &&
      r.reopen_above_backdrop
  );

  console.log(
    JSON.stringify(
      {
        result: pass ? "PASS" : "FAIL",
        static: staticResult,
        viewports: results,
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
