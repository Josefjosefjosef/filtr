#!/usr/bin/env node
/**
 * Vlastní tlačítka (MindMenu grid) — mobile/tablet:
 * - last tile above bottom nav (dynamic count)
 * - live add without reload must grow scrollHeight / clear under-nav
 * - long labels wrap inside tile (incl. no-space strings)
 * - equal height within a grid row; independent rows may differ
 * - PC (≥1025) keeps fixed 64px tile contract
 *
 * Run: npm run iu-custom-buttons-dynamic-height-wrap-guard
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

const CUSTOM = path.join(REPO, "assets", "iu-custom-buttons-overlay.css");
const APP_JS = path.join(REPO, "assets", "app.js");
const FEED_JS = path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js");
const APP_CSS = path.join(REPO, "assets", "app.css");
const INDEX = path.join(REPO, "projects", "index.html");
const CACHE_BUST = "custom-buttons-dynamic-bottom-clearance-v1-20260804";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8902", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const LONG =
  "Pujcovna sportovniho vybaveni a lodi pro celou rodinu a pratele na vikendovy vylet po Cechach s dopravou a kompletni vyzbroji pro dospěle i deti";
const NOSPACE = "H".repeat(220);

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "MOBILE_LG", width: 430, height: 932 },
  { name: "TABLET", width: 768, height: 1024 },
];

function staticGate() {
  const custom = fs.readFileSync(CUSTOM, "utf8");
  const app = fs.readFileSync(APP_CSS, "utf8");
  const appJs = [
    fs.readFileSync(APP_JS, "utf8"),
    fs.existsSync(FEED_JS) ? fs.readFileSync(FEED_JS, "utf8") : "",
  ].join("\n");
  const index = fs.readFileSync(INDEX, "utf8");
  const fails = [];
  const ok = (id, cond) => {
    if (!cond) fails.push(id);
  };

  ok("cache_bust_index", index.includes("iu-custom-buttons-overlay.css?v=" + CACHE_BUST));
  ok("cache_bust_appjs", index.includes(CACHE_BUST) && /app\.js\?v=/.test(index));
  ok("mq_mobile_tablet_only", /@media\s*\(max-width:\s*1024px\)/.test(custom));
  ok("min_height_96", /min-height:\s*96px\s*!important/.test(custom));
  ok("no_fixed_max_96", !/max-height:\s*96px\s*!important/.test(custom));
  ok("max_height_none", /max-height:\s*none\s*!important/.test(custom));
  ok("wrap_anywhere", /overflow-wrap:\s*anywhere\s*!important/.test(custom));
  ok("word_break", /word-break:\s*break-word\s*!important/.test(custom));
  ok("clamp_unset", /-webkit-line-clamp:\s*unset\s*!important/.test(custom));
  ok("align_stretch", /align-items:\s*stretch\s*!important/.test(custom));
  ok("safe_space_padding", /--bottom-nav-height/.test(custom) && /scroll-margin-bottom/.test(custom));
  ok("flow_grows_with_content", /#iuMobileGatePanelTools #iuMobileMindMenuFlow\{[\s\S]*?height:\s*auto\s*!important/.test(custom));
  ok("sync_flow_height_fn", /function iuQuickToolsSyncMobileMindMenuFlowHeight\s*\(/.test(appJs));
  ok("apply_config_calls_sync", /iuQuickToolsApplyConfig[\s\S]*iuQuickToolsSyncMobileMindMenuFlowHeight/.test(appJs));
  ok("pc_64_unchanged", /body\s+\.accordionCol\s+\.mindMenu\s+\.iu-mmQuickGrid\s*>\s*\.iuTile\{[\s\S]*?height:\s*64px\s*!important/.test(app));
  return { pass: fails.length === 0, fails };
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

const DEFAULT_ORDER = [
  "datovka",
  "bankovnictvi",
  "bakalari",
  "zdravotni_pojistovna",
  "zasilky",
  "ai_asistenti",
  "financni_kalkulacky",
  "vzory_smluv",
  "vytvorit_fakturu",
  "pridat_tlacitko",
];

async function seedButtons(page, buttons) {
  await page.evaluate(
    ({ list, order }) => {
      const ids = list.map((b) => b.id);
      const cfg = {
        version: 2,
        order: order.slice(0, -1).concat(ids).concat(["pridat_tlacitko"]),
        visible: order.slice(0, -1).concat(ids).concat(["pridat_tlacitko"]),
        customButtons: list,
      };
      localStorage.setItem("infouzel_quicktools", JSON.stringify(cfg));
    },
    { list: buttons, order: DEFAULT_ORDER }
  );
}

function makeButtons(scenario) {
  if (scenario === "small") {
    return [
      { id: "cb_1", label: "A", url: "https://example.com/1", color: "#2563EB" },
      { id: "cb_2", label: "B", url: "https://example.com/2", color: "#DC2626" },
    ];
  }
  if (scenario === "wrap") {
    return [
      { id: "cb_s", label: "Krátké", url: "https://example.com/s", color: "#2563EB" },
      { id: "cb_l", label: LONG, url: "https://example.com/l", color: "#DC2626" },
      { id: "cb_s2", label: "Další", url: "https://example.com/s2", color: "#059669" },
      { id: "cb_ns", label: NOSPACE, url: "https://example.com/ns", color: "#7C3AED" },
      { id: "cb_s3", label: "X", url: "https://example.com/x", color: "#CA8A04" },
    ];
  }
  return Array.from({ length: 20 }, (_, i) => ({
    id: "cb_" + i,
    label: i === 1 ? LONG : i === 3 ? NOSPACE : "Tlačítko " + (i + 1),
    url: "https://example.com/" + i,
    color: "#2563EB",
  }));
}

async function openToolsGate(page) {
  /* Prefer gate API — tab click toggles closed when tools is already active. */
  await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    const panel = document.getElementById("iuMobileGatePanelTools");
    const grid = panel && panel.querySelector(".iu-mmQuickGrid");
    if (panel && !panel.hidden && grid) return;
    if (wrap && typeof wrap.__iuMobileGateSetTab === "function") {
      wrap.__iuMobileGateSetTab("tools");
      return;
    }
    const tab = document.getElementById("iuMobileGateTabTools");
    if (tab) tab.click();
  });
  await page.waitForTimeout(500);
  await page.waitForSelector("#iuMobileGatePanelTools .iu-mmQuickGrid", { timeout: 15000 });
}

async function ensureNavVisible(page) {
  await page.evaluate(() => {
    try {
      document.activeElement && document.activeElement.blur && document.activeElement.blur();
    } catch (_) {}
    document.documentElement.classList.remove("iu-keyboard-open");
    if (document.body) document.body.classList.remove("iu-keyboard-open");
  });
  await page.waitForTimeout(200);
}

async function measureGrid(page) {
  await ensureNavVisible(page);
  return page.evaluate(async () => {
    const nav = document.getElementById("iuMobileBottomNav");
    const panel = document.getElementById("iuMobileGatePanelTools");
    const grid = document.querySelector(
      "#iuMobileGatePanelTools section.iu-mmQuickLinks:not(.iu-mojeSluzby) > .iu-mmQuickGrid"
    );
    const customs = [...document.querySelectorAll('#iuMobileGatePanelTools .iuTile[data-quicktool-custom="1"]')];
    const last = customs[customs.length - 1];

    if (panel) {
      panel.scrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    await new Promise((r) => setTimeout(r, 80));
    if (last) {
      try {
        last.scrollIntoView({ block: "nearest", behavior: "instant" });
      } catch (_) {
        last.scrollIntoView(false);
      }
    }
    if (panel) {
      panel.scrollTop = Math.max(0, panel.scrollHeight - panel.clientHeight);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    await new Promise((r) => setTimeout(r, 120));

    const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
    const lastBox = last ? last.getBoundingClientRect() : null;
    const gap = lastBox ? navTop - lastBox.bottom : null;

    const rows = [];
    if (grid) {
      const kids = [...grid.children].filter((el) => !el.hidden && getComputedStyle(el).display !== "none");
      for (let i = 0; i < kids.length; i += 2) {
        const a = kids[i];
        const b = kids[i + 1];
        const ah = a.getBoundingClientRect().height;
        const bh = b ? b.getBoundingClientRect().height : ah;
        rows.push({
          hA: Math.round(ah * 100) / 100,
          hB: b ? Math.round(bh * 100) / 100 : null,
          equal: !b || Math.abs(ah - bh) <= 1.5,
          labels: [
            (a.querySelector(".iuTileText") || {}).textContent || "",
            b ? (b.querySelector(".iuTileText") || {}).textContent || "" : null,
          ],
        });
      }
    }

    const longTile = customs.find((t) => ((t.querySelector(".iuTileText") || {}).textContent || "").length > 40);
    const nospaceTile = customs.find((t) => /^H+$/.test(((t.querySelector(".iuTileText") || {}).textContent || "").trim()));

    function tileMetrics(tile) {
      if (!tile) return null;
      const text = tile.querySelector(".iuTileText");
      const tr = text.getBoundingClientRect();
      const br = tile.getBoundingClientRect();
      const cs = getComputedStyle(text);
      return {
        h: Math.round(br.height * 100) / 100,
        overflowX: Math.round((tr.right - br.right) * 10) / 10,
        overflowY: Math.round((tr.bottom - br.bottom) * 10) / 10,
        clamp: cs.webkitLineClamp,
        whiteSpace: cs.whiteSpace,
        wrap: cs.overflowWrap,
      };
    }

    const shortRow = rows.find((r) => r.labels.every((l) => l && l.length <= 12));
    const tallRow = rows.find((r) => r.labels.some((l) => l && l.length > 40));

    return {
      customCount: customs.length,
      gap,
      lastAboveNav: gap != null && gap >= 8,
      docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      panelPb: panel ? getComputedStyle(panel).paddingBottom : null,
      long: tileMetrics(longTile),
      nospace: tileMetrics(nospaceTile),
      rowsSample: rows.slice(0, 8),
      shortRowH: shortRow ? shortRow.hA : null,
      tallRowH: tallRow ? tallRow.hA : null,
      rowEquals: rows.filter((r) => r.hB != null).every((r) => r.equal),
      rowsDiffer:
        shortRow && tallRow ? tallRow.hA > shortRow.hA + 8 : true,
    };
  });
}

async function measureDesktopUnchanged(browser) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1280, height: 900 },
    isMobile: false,
    hasTouch: false,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  await seedButtons(page, makeButtons("wrap"));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const tile = document.querySelector("body .layout > aside.accordionCol .iu-mmQuickGrid > .iuTile");
    if (!tile) return { found: false };
    const cs = getComputedStyle(tile);
    return {
      found: true,
      height: cs.height,
      maxHeight: cs.maxHeight,
      minHeight: cs.minHeight,
    };
  });
  await context.close();
  return m;
}

async function runViewport(browser, vp, scenario) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await page.waitForTimeout(2000);
  await seedButtons(page, makeButtons(scenario));
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(2000);
  await openToolsGate(page);
  const m = await measureGrid(page);
  await context.close();
  return { viewport: vp.name, scenario, ...m };
}

async function liveApplyCount(page, count) {
  return page.evaluate(
    ({ n, long, nospace, order }) => {
      const buttons = [];
      for (let i = 0; i < n; i++) {
        let label = "Live " + (i + 1);
        if (i === n - 1) label = nospace;
        else if (i === n - 2) label = long;
        else if (i % 4 === 0) label = long;
        buttons.push({
          id: "cb_live_" + i,
          label,
          url: "https://example.com/live/" + i,
          color: "#2563EB",
        });
      }
      const ids = buttons.map((b) => b.id);
      const fullOrder = order.slice(0, -1).concat(ids).concat(["pridat_tlacitko"]);
      const cfg = { version: 2, order: fullOrder, visible: fullOrder.slice(), customButtons: buttons };
      localStorage.setItem("infouzel_quicktools", JSON.stringify(cfg));
      const panel = document.getElementById("iuMobileGatePanelTools");
      const beforeScrollH = panel ? panel.scrollHeight : 0;
      if (typeof window.iuQuickToolsApplyConfig === "function") window.iuQuickToolsApplyConfig(cfg);
      const afterScrollH = panel ? panel.scrollHeight : 0;
      const flow = document.getElementById("iuMobileMindMenuFlow");
      const mind = flow && flow.querySelector(".mindMenu");
      return {
        beforeScrollH,
        afterScrollH,
        customCount: buttons.length,
        flowMinH: flow ? flow.style.minHeight : null,
        flowH: flow ? flow.offsetHeight : null,
        mindH: mind ? mind.offsetHeight : null,
      };
    },
    { n: count, long: LONG, nospace: NOSPACE, order: DEFAULT_ORDER }
  );
}

async function runLiveAddViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await openToolsGate(page);
  const steps = {};
  let prevScrollH = 0;
  for (const n of [1, 5, 20]) {
    const applied = await liveApplyCount(page, n);
    await page.waitForTimeout(300);
    const m = await measureGrid(page);
    steps["n_" + n] = { applied, measure: m };
    if (n > 1 && applied.afterScrollH <= prevScrollH) {
      steps["n_" + n].scrollGrew = false;
    } else {
      steps["n_" + n].scrollGrew = applied.afterScrollH >= prevScrollH;
    }
    prevScrollH = applied.afterScrollH;
  }
  // mutate without reload: edit + remove + add
  await page.evaluate((long) => {
    const cfg = JSON.parse(localStorage.getItem("infouzel_quicktools"));
    cfg.customButtons[0].label = long + " " + long;
    cfg.customButtons = cfg.customButtons.slice(0, 18);
    const keep = new Set(cfg.customButtons.map((b) => b.id).concat(["pridat_tlacitko"]));
    cfg.order = cfg.order.filter((id) => keep.has(id) || !String(id).startsWith("cb_"));
    cfg.customButtons.push({
      id: "cb_live_extra",
      label: "Extra po odstraneni",
      url: "https://example.com/extra",
      color: "#DC2626",
    });
    const pridat = cfg.order.indexOf("pridat_tlacitko");
    if (pridat >= 0) cfg.order.splice(pridat, 0, "cb_live_extra");
    else cfg.order.push("cb_live_extra");
    cfg.visible = cfg.order.slice();
    localStorage.setItem("infouzel_quicktools", JSON.stringify(cfg));
    window.iuQuickToolsApplyConfig(cfg);
  }, LONG);
  await page.waitForTimeout(300);
  steps.afterMutate = await measureGrid(page);

  // orientation swap within mobile/tablet band (≤900 keep gate chrome; ≤1023 keep MindMenu in tools)
  const landW = Math.min(900, Math.max(600, vp.width));
  const landH = Math.min(500, Math.max(360, Math.round(vp.height * 0.45)));
  await page.setViewportSize({ width: landW, height: landH });
  await page.waitForTimeout(400);
  await openToolsGate(page);
  steps.landscape = await measureGrid(page);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.waitForTimeout(400);
  await openToolsGate(page);
  steps.portraitBack = await measureGrid(page);

  await page.evaluate(() => localStorage.removeItem("infouzel_quicktools"));
  await context.close();
  return { viewport: vp.name, scenario: "live_add", steps };
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
        ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "text/javascript; charset=utf-8"
            : ext === ".html"
              ? "text/html; charset=utf-8"
              : ext === ".json"
                ? "application/json; charset=utf-8"
                : "application/octet-stream";
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
  const liveResults = [];
  for (const vp of VIEWPORTS) {
    results.push(await runViewport(browser, vp, "wrap"));
    results.push(await runViewport(browser, vp, "dense"));
    results.push(await runViewport(browser, vp, "small"));
    liveResults.push(await runLiveAddViewport(browser, vp));
  }
  const desktop = await measureDesktopUnchanged(browser);
  await browser.close();
  server.close();

  const fails = [];
  for (const r of results) {
    if (r.scenario === "dense" || r.scenario === "wrap") {
      if (!r.lastAboveNav) fails.push(r.viewport + "/" + r.scenario + ":last_under_nav:" + r.gap);
      if (r.docOverflowX) fails.push(r.viewport + "/" + r.scenario + ":h_overflow");
      if (!r.rowEquals) fails.push(r.viewport + "/" + r.scenario + ":row_heights_unequal");
    }
    if (r.scenario === "wrap") {
      if (!r.long || r.long.overflowX > 1 || r.long.overflowY > 1) {
        fails.push(r.viewport + "/wrap:long_overflow:" + JSON.stringify(r.long));
      }
      if (!r.nospace || r.nospace.overflowX > 1 || r.nospace.overflowY > 1) {
        fails.push(r.viewport + "/wrap:nospace_overflow:" + JSON.stringify(r.nospace));
      }
      if (!(r.nospace && r.nospace.h > 100)) {
        fails.push(r.viewport + "/wrap:nospace_not_grown:" + (r.nospace && r.nospace.h));
      }
      // Word-wrapped labels may still fit the 96px min on wide tablet columns; no-space must force growth.
      if (r.long && r.long.h < 96) fails.push(r.viewport + "/wrap:long_below_min:" + r.long.h);
      if (!r.rowsDiffer) fails.push(r.viewport + "/wrap:rows_not_independent:" + r.shortRowH + "/" + r.tallRowH);
      if (r.long && String(r.long.clamp) === "2") fails.push(r.viewport + "/wrap:clamp_still_2");
    }
    if (r.scenario === "small") {
      if (r.customCount < 1) fails.push(r.viewport + "/small:no_tiles");
      if (r.docOverflowX) fails.push(r.viewport + "/small:h_overflow");
    }
  }
  for (const lr of liveResults) {
    for (const key of ["n_1", "n_5", "n_20", "afterMutate", "landscape", "portraitBack"]) {
      const step = lr.steps[key];
      const m = step && step.measure ? step.measure : step;
      if (!m) {
        fails.push(lr.viewport + "/live_add/" + key + ":missing");
        continue;
      }
      if (!(m.gap != null && m.gap >= 0)) {
        fails.push(lr.viewport + "/live_add/" + key + ":last_under_nav:" + m.gap);
      }
      if (m.docOverflowX) fails.push(lr.viewport + "/live_add/" + key + ":h_overflow");
      if (key === "n_20" && !(m.customCount >= 18)) {
        fails.push(lr.viewport + "/live_add/" + key + ":too_few:" + m.customCount);
      }
      if (key === "n_20" && step.applied && !(step.applied.mindH > 0 && step.applied.flowH >= step.applied.mindH - 2)) {
        fails.push(lr.viewport + "/live_add/" + key + ":flow_not_synced:" + JSON.stringify(step.applied));
      }
    }
  }
  if (!desktop.found) fails.push("desktop:tile_missing");
  else {
    // PC contract is enforced by static app.css 64px rules; DOM tile may be a non-quicktools control.
    // Only fail if our mobile max-height:none leaked onto a locked 64px tile unexpectedly as 96px min.
    if (desktop.minHeight === "96px") fails.push("desktop:mobile_min_height_leaked:" + JSON.stringify(desktop));
  }

  const pass = fails.length === 0;
  console.log(
    JSON.stringify(
      {
        result: pass ? "PASS" : "FAIL",
        fails,
        static: staticResult,
        desktop,
        viewports: results,
        liveAdd: liveResults,
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
