#!/usr/bin/env node
/**
 * Stats chart tooltip visibility contract (iCentrum /statistiky/).
 * Proves adaptive above/below placement + full visibility inside chart shell
 * for high peak / mid / left / right points across ranges + metrics + mobile.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_stats_chart_tooltip_visibility_guard.json");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8911", 10);
const PAGE = `http://127.0.0.1:${PORT}/statistiky/`;
const EPS = 1.5;

const fails = [];
function fail(id) {
  fails.push(id);
}

function readPage() {
  return fs.readFileSync(path.join(ROOT, "projects", "statistiky", "index.html"), "utf8");
}

function staticContract() {
  const src = readPage();
  const smoke = fs.readFileSync(path.join(ROOT, ".github", "workflows", "smoke.yml"), "utf8");
  const pkg = fs.readFileSync(path.join(ROOT, "package.json"), "utf8");
  if (!/stats-chart-tooltip-adaptive-v1-20260904/.test(src)) fail("static_missing_adaptive_marker");
  if (!/function positionTipForSelection/.test(src)) fail("static_missing_positionTip");
  if (!/placeBelow|chart-tip--below/.test(src)) fail("static_missing_below_placement");
  if (/transform:\s*translate\(\s*-50%\s*,\s*calc\(\s*-100%/.test(src)) {
    fail("static_fixed_above_transform_still_present");
  }
  if (!/shellRect\.height\s*-\s*th/.test(src) && !/shellRect\.height - th/.test(src)) {
    if (src.indexOf("shellRect.height") < 0) fail("static_missing_vertical_clamp");
  }
  if (pkg.indexOf("iu-stats-chart-tooltip-visibility-guard") < 0) fail("package_missing_script");
  if (smoke.indexOf("iu-stats-chart-tooltip-visibility-guard") < 0) fail("smoke_missing_guard");
}

function fixtureSeries() {
  const out = [];
  const start = new Date(Date.UTC(2026, 7, 1));
  for (let i = 0; i < 30; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const day = d.toISOString().slice(0, 10);
    let visits = 20 + (i % 7) * 3;
    let page_views = visits;
    if (i === 0) {
      visits = 12;
      page_views = 12;
    }
    if (i === 14) {
      visits = 131;
      page_views = 131;
    }
    if (i === 29) {
      visits = 40;
      page_views = 40;
    }
    out.push({ day: day, visits: visits, page_views: page_views });
  }
  return out;
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/statistiky/", method: "HEAD", timeout: 800 }, (res) => {
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

function tipFullyInsideShell(tip, shell) {
  if (!tip || !shell || tip.hidden) return { ok: false, reason: "missing" };
  const t = tip.getBoundingClientRect();
  const s = shell.getBoundingClientRect();
  const pad = 0.5;
  const issues = [];
  if (t.top < s.top - pad) issues.push("clip_top");
  if (t.bottom > s.bottom + pad) issues.push("clip_bottom");
  if (t.left < s.left - pad) issues.push("clip_left");
  if (t.right > s.right + pad) issues.push("clip_right");
  const text = String(tip.textContent || "");
  if (!/\d+\.\s*\d+\.\s*\d{4}/.test(text) && !/\d+\.\s*\d+\.\s*\d{4}/.test(text)) {
    /* label may be range for week grain; accept either date or Návštěvy */
  }
  if (!/Návštěvy:/.test(text)) issues.push("missing_visits");
  if (!/Zobrazení:/.test(text)) issues.push("missing_views");
  if (/^\s*Zobrazení:/.test(text) && !/Návštěvy:/.test(text)) issues.push("truncated_top");
  return { ok: issues.length === 0, issues: issues, text: text.slice(0, 120), tip: t, shell: s };
}

async function selectIdx(page, idx) {
  await page.evaluate((i) => {
    const circle = document.querySelector('#sChartSvg circle.chart-dot[data-idx="' + i + '"]');
    const svg = document.getElementById("sChartSvg");
    const scroll = document.getElementById("sChartScroll");
    if (!circle || !svg) throw new Error("missing_dot:" + i);
    if (scroll) {
      const cRect = circle.getBoundingClientRect();
      const sRect = scroll.getBoundingClientRect();
      if (cRect.left < sRect.left + 8) {
        scroll.scrollLeft -= sRect.left + 8 - cRect.left;
      } else if (cRect.right > sRect.right - 8) {
        scroll.scrollLeft += cRect.right - (sRect.right - 8);
      }
    }
    const r = circle.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    svg.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        pointerType: "mouse",
        button: 0,
        buttons: 1,
      })
    );
  }, idx);
  await page.waitForTimeout(120);
}

async function assertTip(page, label) {
  const probe = await page.evaluate(() => {
    const tip = document.getElementById("sChartTip");
    const shell = document.getElementById("sChartShell");
    if (!tip || !shell || tip.hidden) return { ok: false, reason: "hidden" };
    const t = tip.getBoundingClientRect();
    const s = shell.getBoundingClientRect();
    const pad = 1.25;
    const issues = [];
    if (t.top < s.top - pad) issues.push("clip_top");
    if (t.bottom > s.bottom + pad) issues.push("clip_bottom");
    if (t.left < s.left - pad) issues.push("clip_left");
    if (t.right > s.right + pad) issues.push("clip_right");
    const text = String(tip.textContent || "");
    if (!/Návštěvy:/.test(text)) issues.push("missing_visits");
    if (!/Zobrazení:/.test(text)) issues.push("missing_views");
    const strong = tip.querySelector("strong");
    if (!strong || !String(strong.textContent || "").trim()) issues.push("missing_date");
    return {
      ok: issues.length === 0,
      issues: issues,
      text: text.replace(/\s+/g, " ").trim().slice(0, 160),
      below: tip.classList.contains("chart-tip--below"),
      bodyOverflow: document.body.scrollWidth > window.innerWidth + 1,
    };
  });
  if (!probe.ok) fail(label + ":" + (probe.issues || [probe.reason]).join(","));
  if (probe.bodyOverflow) fail(label + ":page_overflow_x");
  return probe;
}

async function highestIdx(page) {
  return page.evaluate(() => {
    const dots = Array.from(document.querySelectorAll("#sChartSvg circle.chart-dot"));
    let best = -1;
    let bestY = Infinity;
    dots.forEach((c) => {
      const y = Number(c.getAttribute("cy") || 9999);
      const idx = Number(c.getAttribute("data-idx") || -1);
      if (y < bestY) {
        bestY = y;
        best = idx;
      }
    });
    return best;
  });
}

async function runViewport(browser, width, height, name) {
  const context = await browser.newContext({
    viewport: { width: width, height: height },
    deviceScaleFactor: width <= 430 ? 2 : 1,
    isMobile: width <= 430,
    hasTouch: width <= 900,
  });
  const page = await context.newPage();
  const series = fixtureSeries();
  await page.route("**/v1/public/stats**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        today: { visits: 40, page_views: 40 },
        yesterday: { visits: 35, page_views: 35 },
        month: { visits: 900, page_views: 900 },
        devices: { mobile: 10, desktop: 5, tablet: 2, other: 0 },
        sections: [],
        private_tools_month: 3,
        series: series,
        series_from: series[0].day,
        historyStart: series[0].day,
      }),
    });
  });
  await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#sChartSvg circle.chart-dot", { timeout: 20000 });
  await page.waitForTimeout(200);

  const count = await page.locator("#sChartSvg circle.chart-dot").count();
  if (count < 5) fail(name + ":too_few_dots");

  /* Scenario mid */
  await selectIdx(page, Math.floor(count / 2));
  await assertTip(page, name + ":mid");

  /* Scenario high peak */
  const hi = await highestIdx(page);
  if (hi < 0) fail(name + ":no_high_idx");
  await selectIdx(page, hi);
  const highProbe = await assertTip(page, name + ":high");
  if (highProbe && highProbe.ok === false) {
    /* already failed */
  }

  /* Left / right edges */
  await selectIdx(page, 0);
  await assertTip(page, name + ":left");
  await selectIdx(page, count - 1);
  await assertTip(page, name + ":right");

  /* Metric Zobrazení */
  await page.click('#sMetricSeg button[data-metric="page_views"]');
  await page.waitForTimeout(120);
  await selectIdx(page, await highestIdx(page));
  await assertTip(page, name + ":metric_views_high");

  /* Ranges */
  for (const range of ["14", "30", "90", "all"]) {
    await page.click('#sRangeSeg button[data-range="' + range + '"]');
    await page.waitForTimeout(150);
    const n = await page.locator("#sChartSvg circle.chart-dot").count();
    if (n < 1) {
      fail(name + ":range_" + range + "_empty");
      continue;
    }
    await selectIdx(page, await highestIdx(page));
    await assertTip(page, name + ":range_" + range + "_high");
  }

  await context.close();
}

async function main() {
  staticContract();
  if (fails.length) {
    console.error("[iu-stats-chart-tooltip-visibility-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(ROOT, "server", "projects-static.mjs")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverErr = "";
  server.stderr.on("data", (d) => {
    serverErr += String(d);
  });
  try {
    await waitForPort("127.0.0.1", PORT, 20000);
  } catch (e) {
    try {
      server.kill();
    } catch (_) {}
    console.error("[iu-stats-chart-tooltip-visibility-guard] FAIL");
    console.error(" - runtime_server_not_up:" + String(e && e.message || e));
    if (serverErr) console.error(serverErr.slice(0, 300));
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, 390, 844, "MOBILE");
    await runViewport(browser, 768, 1024, "TABLET");
    await runViewport(browser, 1280, 800, "DESKTOP");
  } finally {
    try {
      await browser.close();
    } catch (_) {}
    try {
      server.kill();
    } catch (_) {}
  }

  const report = {
    ok: fails.length === 0,
    fails: fails,
    REAL_DEVICE_TEST: "NOT_TESTED",
  };
  try {
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
  } catch (_) {}

  if (fails.length) {
    console.error("[iu-stats-chart-tooltip-visibility-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-stats-chart-tooltip-visibility-guard] PASS");
  console.log("REAL_DEVICE_TEST: NOT_TESTED");
}

main().catch((err) => {
  console.error("[iu-stats-chart-tooltip-visibility-guard] FAIL");
  console.error(String(err && err.stack || err));
  process.exit(1);
});
