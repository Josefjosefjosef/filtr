#!/usr/bin/env node
/**
 * PC browser compat — MindMenu button + Tasks filter height (desktop only).
 * Run: npm run iu-pc-browser-compat-guard
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const TASKS_CSS = path.join(REPO, "assets", "iu-tasks-premium.css");
const HOME_CSS = path.join(REPO, "assets", "iu-desktop-home-premium.css");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8931", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

function staticGate() {
  const tasks = fs.readFileSync(TASKS_CSS, "utf8");
  const home = fs.readFileSync(HOME_CSS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    { id: "tasks_aside_flex", pass: /aside\.iu-tasksOverlay__list[\s\S]*display:flex;flex-direction:column/.test(tasks) },
    { id: "tasks_ul_grid", pass: /ul\.iu-tasksOverlay__list[\s\S]*display:grid/.test(tasks) },
    { id: "tasks_pc_filter_stable", pass: /@media \(min-width:1025px\)[\s\S]*\.iu-tasksOverlay__filter\.is-active[\s\S]*height:auto!important/.test(tasks) },
    { id: "mindmenu_label_minwidth0", pass: /\.iuMyInfoUzelOpenBtn__label[\s\S]*min-width: 0;/.test(home) },
    { id: "mindmenu_icons_noshrink", pass: /\.iuMyInfoUzelOpenBtn__icons[\s\S]*flex-shrink: 0;/.test(home) },
    { id: "tasks_cache_bust", pass: /iu-tasks-premium\.css\?v=date-time-value-column-v4-20260813/.test(index) },
    { id: "home_cache_bust", pass: /iu-desktop-home-premium\.css\?v=pc-svatek-label-pill-gap-4px-20260713/.test(index) },
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

async function runPlaywright() {
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
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });

  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((d) => {
    document.body.classList.add("iu-desktop-home-grid", "iu-home");
    localStorage.setItem(
      "iu.tasks.mvp.v1",
      JSON.stringify({
        schemaVersion: 1,
        tasks: [
          { id: "t1", title: "Today", status: "todo", priority: "medium", dueAt: d, note: "", createdAt: 1, updatedAt: 1 },
          { id: "t2", title: "Future", status: "todo", priority: "low", dueAt: "2099-12-31", note: "", createdAt: 1, updatedAt: 1 },
          { id: "t3", title: "Done", status: "done", priority: "low", dueAt: d, note: "", createdAt: 1, updatedAt: 1 },
        ],
      })
    );
  }, today);

  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2000);

  const mindMenu = await page.evaluate(() => {
    if (typeof window.iuArticleActionsEnsureDesktopButton === "function") {
      window.iuArticleActionsEnsureDesktopButton();
    }
    const btn = document.getElementById("iuMyInfoUzelOpenBtn");
    if (!btn) return { ok: false, reason: "no_btn" };
    const br = btn.getBoundingClientRect();
    const icons = btn.querySelector(".iuMyInfoUzelOpenBtn__icons");
    const ir = icons ? icons.getBoundingClientRect() : null;
    const clipped = ir ? ir.right > br.right + 1 : true;
    const label = btn.querySelector(".iuMyInfoUzelOpenBtn__label");
    return {
      ok: !clipped && br.width > 120 && br.height >= 34 && br.height <= 44,
      clipped,
      btnW: Math.round(br.width),
      btnH: Math.round(br.height),
      iconsRight: ir ? Math.round(ir.right) : null,
      btnRight: Math.round(br.right),
      labelMinWidth: label ? getComputedStyle(label).minWidth : null,
    };
  });

  await page.waitForFunction(
    () => window.iuTasksService && typeof window.iuTasksService.openOverlay === "function",
    null,
    { timeout: 30000 }
  );
  await page.evaluate(() => window.iuTasksService.openOverlay());
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuTasksOverlay");
    return ov && !ov.hidden;
  }, null, { timeout: 15000 });
  await page.waitForTimeout(400);

  const filterCases = {};
  const heights = [];
  for (const key of ["all", "today", "done", "today", "all"]) {
    await page.evaluate((k) => {
      document.querySelector('[data-iu-tasks-filter="' + k + '"]')?.click();
    }, key);
    await page.waitForTimeout(280);
    filterCases[key] = await page.evaluate(() => {
      const aside = document.querySelector("aside.iu-tasksOverlay__list");
      const btns = [...document.querySelectorAll(".iu-tasksOverlay__filter")].map((b) =>
        Math.round(b.getBoundingClientRect().height)
      );
      const bar = document.getElementById("iuTasksFilters");
      return {
        btns,
        bar: bar ? Math.round(bar.getBoundingClientRect().height) : null,
        asideDisplay: aside ? getComputedStyle(aside).display : null,
        allEqual: btns.length === 3 && btns[0] === btns[1] && btns[1] === btns[2],
      };
    });
    if (filterCases[key].btns && filterCases[key].btns[0]) heights.push(filterCases[key].btns[0]);
  }

  const baseline = heights[0] || 0;
  const filterStable =
    filterCases.today &&
    filterCases.today.asideDisplay === "flex" &&
    filterCases.today.allEqual &&
    filterCases.today.btns.every((h) => Math.abs(h - baseline) <= 1) &&
    filterCases.today.btns[0] >= 28 &&
    filterCases.today.btns[0] <= 40;

  await context.close();
  await browser.close();
  server.close();

  return {
    pass: !!(mindMenu.ok && filterStable),
    mindMenu,
    filterCases,
    filterStable,
  };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_PC_BROWSER_COMPAT_GUARD_FAIL");
    console.log(JSON.stringify({ phase: "static", ...staticResult }, null, 2));
    process.exit(1);
  }

  const pw = await runPlaywright();
  const pass = !!pw.pass;
  console.log("IU_PC_BROWSER_COMPAT_GUARD_" + (pass ? "PASS" : "FAIL"));
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, playwright: pw }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
