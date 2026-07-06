#!/usr/bin/env node
/**
 * Finanční kalkulačky — mobil/tablet hlavička: hub jednořádková, detail dvouřádková.
 * Run: npm run iu-financial-calc-mobile-header-guard
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
const PORT = parseInt(process.env.IU_GUARD_PORT || "8896", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CACHE_BUST = "moje-sluzby-mobile-keyboard-add-btn-v1-20260706";
const HUB_TITLE = "Finanční kalkulačky";

const LONG_CALCS = [
  { id: "budget", title: "Rozpočet domácnosti" },
  { id: "discount", title: "Sleva / změna ceny" },
  { id: "affordability", title: "Bonita / schvalitelnost" },
  { id: "investment-growth", title: "Složené úročení / investiční růst" },
];

function staticGate() {
  const unified = fs.readFileSync(UNIFIED, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "part8_hub_single_row",
      pass: /iu-financial-overlay-panel--hub[\s\S]*grid-template-areas:\s*"title info close"/.test(unified),
    },
    {
      id: "detail_two_row_grid_areas",
      pass: /iu-financial-overlay-panel--detail[\s\S]*grid-template-areas:[\s\S]*"back info close"/.test(unified),
    },
    {
      id: "heading_display_contents",
      pass: /iu-financial-overlay-heading,[\s\S]*display: contents !important/.test(unified),
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

function sameRow(a, b, tolerance = 4) {
  if (!a || !b) return false;
  const aMid = (a.top + a.bottom) / 2;
  const bMid = (b.top + b.bottom) / 2;
  return Math.abs(aMid - bMid) <= tolerance;
}

async function bootFinancial(page) {
  await page.evaluate(async () => {
    if (typeof window.iuEnsureFinancialCalcOverlayBoot === "function") {
      await window.iuEnsureFinancialCalcOverlayBoot();
    }
    if (typeof window.iuEnsureOverlayCss === "function") {
      await window.iuEnsureOverlayCss("iu-financial-overlay.css");
    }
    if (typeof window.iuToolPrivacyBoot === "function") {
      window.iuToolPrivacyBoot();
    }
  });
}

async function measureHeader(page) {
  return page.evaluate(() => {
    const header = document.querySelector("#iuFinancialCalcPanel .iu-financial-overlay-header");
    const title = document.getElementById("iuFinancialCalcTitle");
    const back = document.getElementById("iuFinancialCalcBack");
    const close = document.getElementById("iuFinancialCalcClose");
    const info = header ? header.querySelector(".iu-tool-privacy-btn") : null;
    const panel = document.getElementById("iuFinancialCalcPanel");
    if (!header || !title) return null;
    const pick = (el) => {
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return null;
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const headerStyle = window.getComputedStyle(header);
    return {
      headerDisplay: headerStyle.display,
      panelMode: panel
        ? panel.classList.contains("iu-financial-overlay-panel--detail")
          ? "detail"
          : panel.classList.contains("iu-financial-overlay-panel--hub")
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
  await bootFinancial(page);
  await page.evaluate(() => {
    if (typeof window.iuFinancialCalcOpenSurface === "function") {
      window.iuFinancialCalcOpenSurface();
    }
  });
  await page.waitForFunction(
    () => {
      const panel = document.getElementById("iuFinancialCalcPanel");
      return panel && !panel.hasAttribute("hidden") && panel.classList.contains("iu-financial-overlay-panel--hub");
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(400);
}

async function openCalculator(page, calcId) {
  await bootFinancial(page);
  await page.evaluate((id) => {
    if (typeof window.iuFinancialCalcOpenSurface === "function") {
      window.iuFinancialCalcOpenSurface({ calculatorId: id });
    }
  }, calcId);
  await page.waitForFunction(
    () => {
      const panel = document.getElementById("iuFinancialCalcPanel");
      return panel && !panel.hasAttribute("hidden") && panel.classList.contains("iu-financial-overlay-panel--detail");
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(400);
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

function validateDetailTwoRow(row, viewportLabel) {
  const fails = [];
  if (!row || !row.header || !row.title) {
    fails.push(`${viewportLabel}: header/title missing`);
    return fails;
  }
  if (row.panelMode !== "detail") {
    fails.push(`${viewportLabel}: expected detail mode got ${row.panelMode}`);
  }
  if (row.headerDisplay !== "grid") {
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
  fails.push(...validateHubSingleRow(await measureHeader(page), label));

  for (const calc of LONG_CALCS) {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
    await openCalculator(page, calc.id);
    const row = await measureHeader(page);
    if (row && row.titleText !== calc.title) {
      fails.push(`${label} ${calc.id}: title mismatch "${row.titleText}"`);
    }
    fails.push(...validateDetailTwoRow(row, `${label}/${calc.id}`));
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
  await openCalculator(page, "budget");
  const detailRow = await measureHeader(page);
  if (!detailRow) {
    fails.push("desktop/detail: layout missing");
    return fails;
  }
  if (detailRow.headerDisplay === "grid") {
    fails.push(`desktop/detail: header must not use mobile grid (display=${detailRow.headerDisplay})`);
  }
  return fails;
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_FINANCIAL_CALC_MOBILE_HEADER_GUARD_STATIC_FAIL");
    staticResult.fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_FINANCIAL_CALC_MOBILE_HEADER_GUARD_STATIC_PASS");

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
    console.log("IU_FINANCIAL_CALC_MOBILE_HEADER_GUARD_FAIL");
    fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("IU_FINANCIAL_CALC_MOBILE_HEADER_GUARD_PASS");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
