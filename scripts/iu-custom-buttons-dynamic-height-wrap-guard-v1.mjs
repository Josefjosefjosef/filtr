#!/usr/bin/env node
/**
 * Vlastní tlačítka (MindMenu grid) — mobile/tablet:
 * - last tile above bottom nav (dynamic count)
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
const APP_CSS = path.join(REPO, "assets", "app.css");
const INDEX = path.join(REPO, "projects", "index.html");
const CACHE_BUST = "custom-buttons-dynamic-height-wrap-v1-20260803";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8902", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const LONG =
  "Pujcovna sportovniho vybaveni a lodi pro celou rodinu a pratele na vikendovy vylet po Cechach s dopravou a kompletni vyzbroji pro dospěle i deti";
const NOSPACE = "H".repeat(220);

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function staticGate() {
  const custom = fs.readFileSync(CUSTOM, "utf8");
  const app = fs.readFileSync(APP_CSS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const fails = [];
  const ok = (id, cond) => {
    if (!cond) fails.push(id);
  };

  ok("cache_bust_index", index.includes("iu-custom-buttons-overlay.css?v=" + CACHE_BUST));
  ok("mq_mobile_tablet_only", /@media\s*\(max-width:\s*1024px\)/.test(custom));
  ok("min_height_96", /min-height:\s*96px\s*!important/.test(custom));
  ok("no_fixed_max_96", !/max-height:\s*96px\s*!important/.test(custom));
  ok("max_height_none", /max-height:\s*none\s*!important/.test(custom));
  ok("wrap_anywhere", /overflow-wrap:\s*anywhere\s*!important/.test(custom));
  ok("word_break", /word-break:\s*break-word\s*!important/.test(custom));
  ok("clamp_unset", /-webkit-line-clamp:\s*unset\s*!important/.test(custom));
  ok("align_stretch", /align-items:\s*stretch\s*!important/.test(custom));
  ok("safe_space_padding", /--iu-mobile-bottom-nav-safe-space/.test(custom));
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
  /* Tools tab toggles closed when already active (history/hash restore after reload). */
  await page.evaluate(() => {
    const tab = document.getElementById("iuMobileGateTabTools");
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (!tab) return;
    if (panel && !panel.hidden) return;
    tab.click();
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
  for (const vp of VIEWPORTS) {
    results.push(await runViewport(browser, vp, "wrap"));
    results.push(await runViewport(browser, vp, "dense"));
    results.push(await runViewport(browser, vp, "small"));
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
