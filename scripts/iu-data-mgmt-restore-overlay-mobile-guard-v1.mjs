#!/usr/bin/env node
/**
 * Správa dat — mobil/tablet overlay obnovy zálohy nad spodní navigací.
 * Run: npm run iu-data-mgmt-restore-overlay-mobile-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const CSS = path.join(REPO, "assets", "iu-info-center.css");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8945", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "MOBILE_SHORT", width: 390, height: 667 },
  { name: "TABLET", width: 768, height: 1024 },
  { name: "TABLET_LANDSCAPE", width: 834, height: 768 },
];

function staticGate() {
  const css = fs.readFileSync(CSS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "confirm_bottom_nav_inset",
      pass: /\.iuDataMgmtConfirm:not\(\[hidden\]\)[\s\S]*bottom:\s*var\(--bottom-nav-height/.test(css),
    },
    {
      id: "confirm_body_scroll",
      pass: /\.iuDataMgmtConfirm__body[\s\S]*overflow-y:\s*auto/.test(css),
    },
    {
      id: "confirm_raise_z_when_open",
      pass: /:has\(\.iuDataMgmtConfirm:not\(\[hidden\]\)\)[\s\S]*z-index:\s*10050/.test(css),
    },
    {
      id: "index_cache_bust",
      pass: /iu-info-center\.css\?v=iu-vault-desktop-shared-session-v3-20260826/.test(index),
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

async function openConfirmOverlay(page) {
  await page.evaluate(() => {
    const notes = [];
    for (let i = 0; i < 40; i += 1) {
      notes.push({
        id: `n${i}`,
        title: `Poznámka ${i + 1}`,
        body: `Obsah ${i + 1}`,
        tags: [],
        createdAt: i,
        updatedAt: i,
      });
    }
    localStorage.setItem("iu.notes.store.v1", JSON.stringify({ schemaVersion: 1, notes }));
  });

  await page.evaluate(() => {
    if (typeof window.iuInfoCenterOpenSection === "function") {
      window.iuInfoCenterOpenSection("data-management");
    }
  });
  await page.waitForTimeout(700);

  const json = await page.evaluate(async () => window.iuUserDataBackupExportJson());

  await page.setInputFiles("#iuDataMgmtImportFile", {
    name: "guard-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(json, "utf8"),
  });
  await page.waitForSelector("#iuDataMgmtImportConfirm:not([hidden])", { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function measureOverlay(page) {
  return page.evaluate(() => {
    function cs(el) {
      if (!el) return null;
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        display: st.display,
        overflowY: st.overflowY,
        bottom: st.bottom,
        maxHeight: st.maxHeight,
        rect: { top: r.top, bottom: r.bottom, height: r.height },
      };
    }
    const nav = document.getElementById("iuMobileBottomNav");
    const confirm = document.getElementById("iuDataMgmtImportConfirm");
    const panel = confirm?.querySelector(".iuDataMgmtConfirm__panel");
    const body = confirm?.querySelector(".iuDataMgmtConfirm__body");
    const applyBtn = document.getElementById("iuDataMgmtImportApplyBtn");
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const navVisible = !!(navRect && navRect.height > 20 && navRect.width > 20);
    const navTop = navVisible ? navRect.top : window.innerHeight;
    const applyRect = applyBtn ? applyBtn.getBoundingClientRect() : null;
    const panelRect = panel ? panel.getBoundingClientRect() : null;
    const gap = applyRect ? navTop - applyRect.bottom : 999;
    const bodyScrollable = body ? getComputedStyle(body).overflowY === "auto" : false;
    let scrollWorks = false;
    if (body && body.scrollHeight > body.clientHeight + 8) {
      const before = body.scrollTop;
      body.scrollTop = body.scrollHeight;
      scrollWorks = body.scrollTop > before + 4;
    } else {
      scrollWorks = true;
    }
    return {
      navVisible,
      navTop,
      gap,
      applyAboveNav: !navVisible || gap >= 8,
      panelAboveNav: !navVisible || (panelRect ? panelRect.bottom <= navTop + 1 : false),
      confirm: cs(confirm),
      panel: cs(panel),
      body: cs(body),
      bodyScrollable,
      scrollWorks,
      applyVisible: !!(applyRect && applyRect.height > 0 && applyRect.width > 0),
    };
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
  await page.waitForFunction(() => typeof window.iuUserDataBackupExportJson === "function", { timeout: 45000 });
  await waitForVaultReady(page);
  await page.waitForTimeout(1500);
  await openConfirmOverlay(page);
  const first = await measureOverlay(page);
  await page.evaluate(() => {
    document.getElementById("iuDataMgmtImportConfirmClose")?.click();
  });
  await page.waitForTimeout(300);
  await openConfirmOverlay(page);
  const reopen = await measureOverlay(page);
  await context.close();
  const pass =
    first.applyAboveNav &&
    first.panelAboveNav &&
    first.applyVisible &&
    first.bodyScrollable &&
    first.scrollWorks &&
    reopen.applyAboveNav &&
    reopen.panelAboveNav;
  return { viewport: vp.name, first, reopen, pass };
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
      const ext = path.extname(fp).toLowerCase();
      const mime =
        ext === ".css" ? "text/css; charset=utf-8" :
        ext === ".js" ? "text/javascript; charset=utf-8" :
        ext === ".html" ? "text/html; charset=utf-8" :
        ext === ".json" ? "application/json; charset=utf-8" :
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

  const pass = results.every((r) => r.pass);
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, viewports: results }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
