#!/usr/bin/env node
/**
 * Guard: mobile/tablet tasks filter height stability + compact row ≤1024px; PC unchanged.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const APP_JS = path.join(ROOT, "assets", "app.js");
const TASKS_CSS = path.join(ROOT, "assets", "iu-tasks-premium.css");
const INDEX = path.join(ROOT, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8924", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const MOBILE_TABLET_MAX_BTN_H = 24;
const MOBILE_TABLET_MAX_ROW_H = 36;
const PC_MIN_BTN_H = 26;

const STATIC_CHECKS = [
  {
    id: "js_form_root_detail",
    file: APP_JS,
    pattern: /function renderFormView\(\)[\s\S]*?const root = document\.getElementById\("iuTasksDetail"\)/,
  },
  {
    id: "js_form_not_main_mobile",
    file: APP_JS,
    pattern: /function renderFormView\(\)\{[\s\S]{0,1200}getElementById\("iuTasksMain"\)/,
    invert: true,
  },
  {
    id: "js_save_resets_mobile_mode",
    file: APP_JS,
    pattern: /function saveForm\(\)[\s\S]*?setTasksMobileMode\("list"\)/,
  },
  {
    id: "css_list_ul_scoped",
    file: TASKS_CSS,
    pattern: /#iuTasksList\.iu-tasksOverlay__list[\s\S]*?display:grid/,
  },
  {
    id: "css_aside_flex_preserved",
    file: TASKS_CSS,
    pattern: /#iuTasksOverlay\.iu-tasksPremiumScope \.iu-tasksOverlay__list\{[\s\S]*?display:flex;flex-direction:column/,
  },
  {
    id: "css_filter_compact_max1024",
    file: TASKS_CSS,
    pattern: /@media \(max-width:1024px\)[\s\S]*?#iuTasksFilters[\s\S]*?align-items:center[\s\S]*?height:20px/,
  },
  {
    id: "index_tasks_css_cache_bust",
    file: INDEX,
    pattern: /iu-tasks-premium\.css\?v=tasks-mobile-filter-height-stable-v1-20260708/,
  },
];

function runStaticGate() {
  const checks = STATIC_CHECKS.map((item) => {
    const src = fs.readFileSync(item.file, "utf8");
    const hit = item.pattern.test(src);
    const pass = item.invert ? !hit : hit;
    return { id: item.id, pass };
  });
  const pass = checks.every((c) => c.pass);
  return { pass, failed: checks.filter((c) => !c.pass).map((c) => c.id) };
}

function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host: "127.0.0.1", port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
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

async function measureFilters(page) {
  await page.goto(`${BASE}?section=media`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => typeof window.iuTasksService !== "undefined" && typeof window.iuTasksService.openOverlay === "function",
    null,
    { timeout: 45000 }
  );
  await page.evaluate(() => window.iuTasksService.openOverlay());
  await page.waitForSelector("#iuTasksFilters .iu-tasksOverlay__filter", { timeout: 15000 });

  const snapshots = [];
  for (const label of ["Vše", "Dnes", "Hotové"]) {
    await page.click(`#iuTasksFilters .iu-tasksOverlay__filter:text("${label}")`);
    await page.waitForTimeout(120);
    const snap = await page.evaluate(() => {
      const aside = document.querySelector("aside.iu-tasksOverlay__list");
      const row = document.getElementById("iuTasksFilters");
      const filters = Array.from(document.querySelectorAll("#iuTasksFilters .iu-tasksOverlay__filter"));
      return {
        asideDisplay: aside ? getComputedStyle(aside).display : "",
        rowH: row ? Math.round(row.getBoundingClientRect().height) : null,
        filters: filters.map((btn) => ({
          text: btn.textContent.trim(),
          h: Math.round(btn.getBoundingClientRect().height),
          active: btn.classList.contains("is-active"),
        })),
      };
    });
    snapshots.push({ label, ...snap });
  }
  return snapshots;
}

function evaluateViewportSnapshots(vpName, snapshots) {
  const fails = [];
  const first = snapshots[0];
  if (!first) {
    fails.push("no_snapshots");
    return { pass: false, fails };
  }

  if (vpName === "PC") {
    if (first.asideDisplay !== "flex") fails.push("pc_aside_not_flex");
    for (const snap of snapshots) {
      const heights = snap.filters.map((f) => f.h);
      const uniq = [...new Set(heights)];
      if (uniq.length !== 1) fails.push("pc_filter_height_mismatch");
      if (heights.some((h) => h < PC_MIN_BTN_H)) fails.push("pc_filter_too_short");
      if (snap.rowH && snap.rowH > 52) fails.push("pc_row_too_tall");
    }
  } else {
    if (first.asideDisplay !== "flex") fails.push(`${vpName}_aside_not_flex`);
    for (const snap of snapshots) {
      const heights = snap.filters.map((f) => f.h);
      const uniq = [...new Set(heights)];
      if (uniq.length !== 1) fails.push(`${vpName}_filter_height_mismatch`);
      if (heights.some((h) => h > MOBILE_TABLET_MAX_BTN_H)) fails.push(`${vpName}_filter_too_tall`);
      if (snap.rowH && snap.rowH > MOBILE_TABLET_MAX_ROW_H) fails.push(`${vpName}_row_too_tall`);
    }
  }

  return { pass: fails.length === 0, fails, snapshots };
}

async function runPlaywrightGate() {
  const server = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });

  try {
    await waitForPort(PORT);
    const browser = await chromium.launch({ headless: true });
    const viewports = [
      { name: "MOBILE", width: 390, height: 844 },
      { name: "TABLET", width: 820, height: 1180 },
      { name: "PC", width: 1280, height: 900 },
    ];
    const results = [];

    for (const vp of viewports) {
      const context = await bootstrapGuardContext(browser, { viewport: { width: vp.width, height: vp.height } });
      const page = await bootstrapGuardPage(context);
      const snapshots = await measureFilters(page);
      const verdict = evaluateViewportSnapshots(vp.name, snapshots);
      results.push({ viewport: vp.name, ...verdict });
      await context.close();
    }

    await browser.close();
    const pass = results.every((r) => r.pass);
    return { pass, results };
  } finally {
    server.kill("SIGTERM");
  }
}

async function main() {
  const staticResult = runStaticGate();
  if (!staticResult.pass) {
    process.stdout.write(JSON.stringify({ pass: false, phase: "static", ...staticResult }) + "\n");
    process.exitCode = 1;
    return;
  }

  const pwResult = await runPlaywrightGate();
  const pass = pwResult.pass;
  process.stdout.write(JSON.stringify({ pass, phase: "all", static: staticResult, playwright: pwResult }) + "\n");
  if (!pass) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exitCode = 1;
});
