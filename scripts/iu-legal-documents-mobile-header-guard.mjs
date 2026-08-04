#!/usr/bin/env node
/**
 * Vzory smluv a plné moci — mobil/tablet hlavička: hub jednořádková, category+detail dvouřádková.
 * Run: npm run iu-legal-documents-mobile-header-guard
 */
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
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
const CACHE_BUST = "ds-mobile-overlay-nav-flush-v1-20260713-bottom-nav-keyboard-hide-v1-20260802-ds-full-height-v1-20260803-kb-hide-v2-20260803-kb-restore-v3-20260803-bottom-nav-unify-v1-20260804";
const HUB_TITLE = "Vzory smluv a plné moci";

const LONG_DOCS = [
  { id: "kupni-movita", title: "Kupní smlouva – movitá věc", category: "smlouvy" },
  { id: "najem-podnikani", title: "Nájemní smlouva – prostor sloužící podnikání", category: "smlouvy" },
  { id: "plna-moc-zasilka", title: "Plná moc k převzetí zásilky / dokumentu", category: "plne_moci" },
  { id: "predani-obecny", title: "Předávací protokol – obecný", category: "predavaci" },
];

function staticGate() {
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "part9_hub_single_row",
      pass: /iu-legal-overlay-panel--hub[\s\S]*grid-template-areas:\s*"title info close"/.test(unified),
    },
    {
      id: "category_detail_two_row_grid_areas",
      pass: /iu-legal-overlay-panel--category[\s\S]*grid-template-areas:[\s\S]*"back info close"/.test(unified),
    },
    {
      id: "heading_display_contents",
      pass: /iu-legal-overlay-heading,[\s\S]*display: contents !important/.test(unified),
    },
    {
      id: "index_cache_bust",
      pass: new RegExp(`iu-overlay-mobile-tablet-unified-v1\\.css\\?v=${CACHE_BUST}`).test(index),
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

function rectsOverlap(a, b, pad = 2) {
  return !(
    a.right <= b.left + pad ||
    a.left >= b.right - pad ||
    a.bottom <= b.top + pad ||
    a.top >= b.bottom - pad
  );
}

async function bootLegal(page) {
  await page.evaluate(async () => {
    if (typeof window.iuEnsureLegalDocsOverlayBoot === "function") {
      await window.iuEnsureLegalDocsOverlayBoot();
    }
    if (typeof window.iuEnsureOverlayCss === "function") {
      await window.iuEnsureOverlayCss("iu-legal-documents-overlay.css");
    }
    if (typeof window.iuToolPrivacyBoot === "function") {
      window.iuToolPrivacyBoot();
    }
  });
}

async function measureHeader(page) {
  return page.evaluate(() => {
    const header = document.querySelector("#iuLegalDocsPanel .iu-legal-overlay-header");
    const title = document.getElementById("iuLegalDocsTitle");
    const back = document.getElementById("iuLegalDocsBack");
    const close = document.getElementById("iuLegalDocsClose");
    const info = header ? header.querySelector(".iu-tool-privacy-btn") : null;
    if (!header || !title) return null;
    const pick = (el) => {
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const headerStyle = window.getComputedStyle(header);
    const panel = document.getElementById("iuLegalDocsPanel");
    return {
      headerDisplay: headerStyle.display,
      panelMode: panel
        ? panel.classList.contains("iu-legal-overlay-panel--detail")
          ? "detail"
          : panel.classList.contains("iu-legal-overlay-panel--category")
            ? "category"
            : panel.classList.contains("iu-legal-overlay-panel--hub")
              ? "hub"
              : "unknown"
        : "unknown",
      header: pick(header),
      title: pick(title),
      back: pick(back),
      close: pick(close),
      info: pick(info),
      titleText: String(title.textContent || "").trim(),
    };
  });
}

async function openHub(page) {
  await bootLegal(page);
  await page.evaluate(() => {
    if (typeof window.iuLegalDocsOpenSurface === "function") {
      window.iuLegalDocsOpenSurface();
    }
  });
  await page.waitForFunction(
    () => {
      const panel = document.getElementById("iuLegalDocsPanel");
      return panel && !panel.hasAttribute("hidden") && panel.classList.contains("iu-legal-overlay-panel--hub");
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(400);
}

async function openCategory(page, catId) {
  await openHub(page);
  await page.click(`[data-iu-legal-cat="${catId}"]`);
  await page.waitForFunction(
    (id) => {
      const panel = document.getElementById("iuLegalDocsPanel");
      return panel && panel.classList.contains("iu-legal-overlay-panel--category");
    },
    catId,
    { timeout: 30000 },
  );
  await page.waitForTimeout(400);
}

async function openDocument(page, doc) {
  await openCategory(page, doc.category);
  await page.click(`[data-iu-legal-open-doc="${doc.id}"]`);
  await page.waitForFunction(
    (id) => {
      const panel = document.getElementById("iuLegalDocsPanel");
      const title = document.getElementById("iuLegalDocsTitle");
      return (
        panel &&
        panel.classList.contains("iu-legal-overlay-panel--detail") &&
        title &&
        String(title.textContent || "").trim().length > 0
      );
    },
    doc.id,
    { timeout: 30000 },
  );
  await page.waitForTimeout(400);
}

function sameRow(a, b, tolerance = 4) {
  if (!a || !b) return false;
  const aMid = (a.top + a.bottom) / 2;
  const bMid = (b.top + b.bottom) / 2;
  return Math.abs(aMid - bMid) <= tolerance;
}

function validateHubSingleRow(row, viewportLabel) {
  const fails = [];
  if (!row || !row.header || !row.title) {
    fails.push(`${viewportLabel}/hub: header/title missing`);
    return fails;
  }
  if (row.panelMode !== "hub") {
    fails.push(`${viewportLabel}/hub: expected hub mode got ${row.panelMode}`);
  }
  if (row.headerDisplay !== "grid") {
    fails.push(`${viewportLabel}/hub: header display=${row.headerDisplay} expected grid`);
  }
  if (row.titleText !== HUB_TITLE) {
    fails.push(`${viewportLabel}/hub: title mismatch "${row.titleText}"`);
  }
  const info = row.info;
  const close = row.close;
  if (!info || !close) {
    fails.push(`${viewportLabel}/hub: info or close missing`);
    return fails;
  }
  if (!sameRow(row.title, info) || !sameRow(row.title, close) || !sameRow(info, close)) {
    fails.push(`${viewportLabel}/hub: controls not on single row`);
  }
  if (row.title.left > info.left + 2) {
    fails.push(`${viewportLabel}/hub: title must be left of info`);
  }
  if (info.right > close.left + 2) {
    fails.push(`${viewportLabel}/hub: info must be left of close`);
  }
  if (close.right > row.header.right + 2) {
    fails.push(`${viewportLabel}/hub: close exceeds header`);
  }
  const rowBottom = Math.max(row.title.bottom, info.bottom, close.bottom);
  const rowTop = Math.min(row.title.top, info.top, close.top);
  if (row.header.height > (rowBottom - rowTop) * 1.85) {
    fails.push(`${viewportLabel}/hub: header too tall for single row (${row.header.height})`);
  }
  return fails;
}

function validateCategoryDetailTwoRow(row, viewportLabel, expectGrid = true) {
  const fails = [];
  if (!row || !row.header || !row.title) {
    fails.push(`${viewportLabel}: header/title missing`);
    return fails;
  }
  if (expectGrid && row.headerDisplay !== "grid") {
    fails.push(`${viewportLabel} ${row.titleText}: header display=${row.headerDisplay} expected grid`);
  }
  const controls = [row.back, row.info, row.close].filter(Boolean);
  if (!controls.length) {
    fails.push(`${viewportLabel} ${row.titleText}: no control buttons visible`);
  }
  const controlBottom = Math.max(...controls.map((c) => c.bottom));
  if (row.title.top < controlBottom - 2) {
    fails.push(
      `${viewportLabel} ${row.titleText}: title overlaps controls (title.top=${row.title.top}, controls.bottom=${controlBottom})`,
    );
  }
  for (const ctrl of controls) {
    if (rectsOverlap(row.title, ctrl)) {
      fails.push(`${viewportLabel} ${row.titleText}: title overlaps control`);
    }
  }
  const headerWidth = row.header.width;
  if (row.title.width < headerWidth * 0.72) {
    fails.push(`${viewportLabel} ${row.titleText}: title too narrow (${row.title.width}/${headerWidth})`);
  }
  if (row.title.left < row.header.left - 2 || row.title.right > row.header.right + 2) {
    fails.push(`${viewportLabel} ${row.titleText}: title exceeds header width`);
  }
  if (row.title.top <= controlBottom - 2) {
    fails.push(`${viewportLabel} ${row.titleText}: title must be on second row`);
  }
  return fails;
}

async function runViewport(page, viewport, label) {
  await page.setViewportSize(viewport);
  const fails = [];

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await openHub(page);
  const hubRow = await measureHeader(page);
  if (hubRow && hubRow.panelMode !== "hub") {
    fails.push(`${label}/hub: expected hub mode got ${hubRow.panelMode}`);
  }
  fails.push(...validateHubSingleRow(hubRow, label));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await openCategory(page, "smlouvy");
  const catRow = await measureHeader(page);
  if (catRow && catRow.panelMode !== "category") {
    fails.push(`${label}/category: expected category mode got ${catRow.panelMode}`);
  }
  fails.push(...validateCategoryDetailTwoRow(catRow, `${label}/category`));

  for (const doc of LONG_DOCS) {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await openDocument(page, doc);
    const row = await measureHeader(page);
    if (row && row.titleText !== doc.title) {
      fails.push(`${label} ${doc.id}: title mismatch "${row.titleText}"`);
    }
    if (row && row.panelMode !== "detail") {
      fails.push(`${label} ${doc.id}: expected detail mode got ${row.panelMode}`);
    }
    fails.push(...validateCategoryDetailTwoRow(row, `${label}/${doc.id}`));
  }

  return fails;
}

async function runDesktopRegression(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await openHub(page);
  const hubRow = await measureHeader(page);
  const fails = [];
  if (!hubRow) {
    fails.push("desktop/hub: layout missing");
    return fails;
  }
  if (hubRow.headerDisplay === "grid") {
    fails.push(`desktop/hub: header must not use mobile grid (display=${hubRow.headerDisplay})`);
  }
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await openDocument(page, LONG_DOCS[0]);
  const row = await measureHeader(page);
  if (!row) {
    fails.push("desktop/detail: layout missing");
    return fails;
  }
  if (row.headerDisplay === "grid") {
    fails.push(`desktop/detail: header must not use mobile grid (display=${row.headerDisplay})`);
  }
  return fails;
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_LEGAL_DOCUMENTS_MOBILE_HEADER_GUARD_STATIC_FAIL");
    staticResult.fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_LEGAL_DOCUMENTS_MOBILE_HEADER_GUARD_STATIC_PASS");

  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForPort("127.0.0.1", PORT, 30000);

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (_) {}

  const fails = [];
  try {
    fails.push(...(await runViewport(page, { width: 390, height: 844 }, "mobile")));
    fails.push(...(await runViewport(page, { width: 768, height: 1024 }, "tablet")));
    fails.push(...(await runDesktopRegression(page)));
  } catch (err) {
    fails.push(String(err && err.message ? err.message : err));
  }

  await browser.close();
  server.kill("SIGTERM");

  if (fails.length) {
    console.log("IU_LEGAL_DOCUMENTS_MOBILE_HEADER_GUARD_FAIL");
    fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_LEGAL_DOCUMENTS_MOBILE_HEADER_GUARD_PASS");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
