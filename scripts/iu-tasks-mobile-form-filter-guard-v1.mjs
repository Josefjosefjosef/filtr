#!/usr/bin/env node
/**
 * Guard: mobile/tablet tasks form in detail panel + filter height/gap ≤1024px only.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const APP_JS = path.join(ROOT, "assets", "app.js");
const TASKS_CSS = path.join(ROOT, "assets", "iu-tasks-premium.css");
const INDEX = path.join(ROOT, "projects", "index.html");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8942", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CACHE_BUST = "date-time-value-column-v4-20260813";

const CHECKS = [
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
    id: "css_filter_touch_max1024",
    file: TASKS_CSS,
    pattern:
      /@media \(max-width:1024px\)[\s\S]*?\.iu-tasksOverlay__filter,\s*\n\s*#iuTasksOverlay\.iu-tasksPremiumScope \.iu-tasksOverlay__filter\.is-active[\s\S]*?min-height:36px[\s\S]*?height:auto[\s\S]*?max-height:none/,
  },
  {
    id: "css_filter_row_max1024",
    file: TASKS_CSS,
    pattern: /@media \(max-width:1024px\)[\s\S]*?\.iu-tasksOverlay__filters[\s\S]*?padding:8px 14px[\s\S]*?height:fit-content/,
  },
  {
    id: "css_mobile_scroll_padding_max1024",
    file: TASKS_CSS,
    pattern:
      /@media \(max-width:1024px\)[\s\S]*?\.iu-tasksOverlay__listScroll[\s\S]*?padding-top:8px/,
  },
  {
    id: "css_mobile_toolbar_max1024",
    file: TASKS_CSS,
    pattern:
      /@media \(max-width:1024px\)[\s\S]*?\.iu-tasksOverlay__listToolbar[\s\S]*?min-height:0/,
  },
  {
    id: "index_tasks_css_cache_bust",
    file: INDEX,
    pattern: new RegExp("iu-tasks-premium\\.css\\?v=" + CACHE_BUST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  },
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

function staticGate() {
  const checks = CHECKS.map((item) => {
    const src = fs.readFileSync(item.file, "utf8");
    const hit = item.pattern.test(src);
    const pass = item.invert ? !hit : hit;
    return { id: item.id, pass };
  });
  const pass = checks.every((c) => c.pass);
  return { pass, failed: checks.filter((c) => !c.pass).map((c) => c.id), checks };
}

async function measureViewport(browser, viewport) {
  const context = await bootstrapGuardContext(browser, { viewport });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });

  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((d) => {
    localStorage.setItem(
      "iu.tasks.mvp.v1",
      JSON.stringify({
        schemaVersion: 1,
        tasks: [
          { id: "t1", title: "Today", status: "todo", priority: "medium", dueAt: d, note: "", createdAt: 1, updatedAt: 1 },
          { id: "t2", title: "Done", status: "done", priority: "low", dueAt: d, note: "", createdAt: 1, updatedAt: 1 },
        ],
      })
    );
  }, today);
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);

  await page.waitForFunction(
    () => window.iuTasksService && typeof window.iuTasksService.openOverlay === "function",
    null,
    { timeout: 30000 }
  );
  await page.evaluate(() => window.iuTasksService.openOverlay());
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuTasksOverlay");
    return ov && !ov.hidden && document.getElementById("iuTasksSearch");
  }, null, { timeout: 15000 });
  await page.waitForTimeout(300);

  const cases = {};
  for (const key of ["all", "today", "done"]) {
    await page.evaluate((k) => {
      document.querySelector('[data-iu-tasks-filter="' + k + '"]')?.click();
    }, key);
    await page.waitForTimeout(220);
    cases[key] = await page.evaluate(() => {
      const filters = document.getElementById("iuTasksFilters");
      const search = document.getElementById("iuTasksSearch");
      const btns = [...document.querySelectorAll(".iu-tasksOverlay__filter")].map((b) =>
        Math.round(b.getBoundingClientRect().height)
      );
      const fr = filters?.getBoundingClientRect();
      const sr = search?.getBoundingClientRect();
      const gap = fr && sr ? Math.round(sr.top - fr.bottom) : null;
      return {
        btns,
        gapFiltersToSearch: gap,
        allEqual: btns.length === 3 && btns[0] === btns[1] && btns[1] === btns[2],
      };
    });
  }

  await context.close();
  return cases;
}

async function runPlaywright() {
  const server = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const fp = path.join(ROOT, p.replace(/^\/+/, ""));
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
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
  const mobile = await measureViewport(browser, { width: 390, height: 844 });
  const tablet = await measureViewport(browser, { width: 834, height: 1194 });

  await browser.close();
  server.close();

  function viewportPass(cases) {
    const sample = cases.today || cases.all;
    if (!sample) return false;
    const h = sample.btns[0] || 0;
    return (
      sample.allEqual &&
      h >= 32 &&
      h <= 44 &&
      sample.gapFiltersToSearch >= 4 &&
      sample.gapFiltersToSearch <= 16
    );
  }

  const pass = viewportPass(mobile) && viewportPass(tablet);
  return { pass, mobile, tablet };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log("IU_TASKS_MOBILE_FORM_FILTER_GUARD_FAIL");
    console.log(JSON.stringify({ phase: "static", ...staticResult }, null, 2));
    process.exit(1);
  }

  const pw = await runPlaywright();
  const pass = !!pw.pass;
  console.log("IU_TASKS_MOBILE_FORM_FILTER_GUARD_" + (pass ? "PASS" : "FAIL"));
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, playwright: pw }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
