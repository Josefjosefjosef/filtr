#!/usr/bin/env node
/**
 * Rychlé odkazy — pevná šířka dlaždic bez ohledu na počet zobrazených tlačítek.
 * Run: npm run iu-quicktools-fixed-width-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-quicktools-fixed-width-guard
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
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8912", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const WIDTH_TOL = parseFloat(process.env.IU_QUICKTOOLS_WIDTH_TOL || "2");

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

async function openMobileToolsPanel(page, gridSel) {
  /* Tools tab toggles closed when already active (history/hash restore after reload). */
  await page.evaluate(() => {
    const tab = document.getElementById("iuMobileGateTabTools");
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (!tab) return;
    if (panel && !panel.hidden) return;
    tab.click();
  });
  await page.waitForTimeout(500);
  await page.waitForSelector(gridSel, { timeout: 30000 });
  await page.evaluate((gridSel) => {
    const grid = document.querySelector(gridSel);
    const section = grid?.closest("section.iu-mmQuickLinks");
    if (section && typeof section.scrollIntoView === "function") {
      section.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, gridSel);
  await page.waitForTimeout(300);
  await page.waitForFunction(({ gridSel }) => {
    const grid = document.querySelector(gridSel);
    const section = grid?.closest("section.iu-mmQuickLinks");
    if (!grid || !section) return false;
    const gw = grid.getBoundingClientRect().width;
    const sw = section.getBoundingClientRect().width;
    return gw > 80 && sw > 80 && Math.abs(gw - sw) < 4;
  }, { gridSel }, { timeout: 15000 }).catch(() => {});
}

const VIEWPORTS = [
  {
    name: "MOBILE",
    width: 390,
    height: 844,
    isMobile: true,
    gridSel: "#iuMobileGatePanelTools .iu-mmQuickGrid",
    openTools: (page) => openMobileToolsPanel(page, "#iuMobileGatePanelTools .iu-mmQuickGrid"),
  },
  {
    name: "TABLET",
    width: 768,
    height: 1024,
    isMobile: true,
    gridSel: "#iuMobileGatePanelTools .iu-mmQuickGrid",
    openTools: (page) => openMobileToolsPanel(page, "#iuMobileGatePanelTools .iu-mmQuickGrid"),
  },
  {
    name: "PC",
    width: 1280,
    height: 900,
    isMobile: false,
    gridSel: "#iuMyInfoUzelToolsHost section.iu-mmQuickLinks:not(.iu-mojeSluzby) .iu-mmQuickGrid",
    openTools: async (page) => {
      await page.evaluate(() => document.getElementById("iuMyInfoUzelOpenBtn")?.click());
      await page.waitForTimeout(1200);
      await page.waitForFunction(() => {
        const grid = document.querySelector(
          "#iuMyInfoUzelToolsHost section.iu-mmQuickLinks:not(.iu-mojeSluzby) .iu-mmQuickGrid"
        );
        if (!grid) return false;
        const st = getComputedStyle(grid);
        const r = grid.getBoundingClientRect();
        return st.display !== "none" && r.width > 80 && r.height > 40;
      }, { timeout: 30000 });
    },
  },
];

function staticGate() {
  const custom = fs.readFileSync(CUSTOM, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "grid_fixed_two_columns",
      pass: /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)\s*!important/.test(custom),
    },
    {
      id: "grid_justify_items_stretch",
      pass: /justify-items:\s*stretch\s*!important/.test(custom),
    },
    {
      id: "tile_width_full",
      pass: /\.iu-mmQuickGrid > \.iuTile[\s\S]*width:\s*100%\s*!important/.test(custom),
    },
    {
      id: "tile_max_width_none",
      pass: /\.iu-mmQuickGrid > \.iuTile[\s\S]*max-width:\s*none\s*!important/.test(custom),
    },
    {
      id: "section_align_items_stretch",
      pass: /section\.iu-mmQuickLinks:not\(\.iu-mojeSluzby\)[\s\S]*align-items:\s*stretch\s*!important/.test(custom),
    },
    {
      id: "grid_align_self_stretch",
      pass: /\.iu-mmQuickGrid[\s\S]*align-self:\s*stretch\s*!important/.test(custom),
    },
    {
      id: "index_cache_bust",
      pass: /custom-buttons-dynamic-bottom-clearance-v1-20260804/.test(index),
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

async function armQuicktoolsSeed(context, visibleIds) {
  await context.addInitScript(({ order, visibleIds }) => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      localStorage.setItem(
        "infouzel_quicktools",
        JSON.stringify({
          version: 2,
          order: order.slice(),
          visible: visibleIds.slice(),
          customButtons: [],
        })
      );
    } catch (_) {}
  }, { order: DEFAULT_ORDER, visibleIds });
}

function visibleTileIds(tiles) {
  return tiles.map((tile) => tile.id).sort();
}

function idsMatch(actualIds, expectedIds) {
  if (actualIds.length !== expectedIds.length) return false;
  const expected = expectedIds.slice().sort();
  return actualIds.every((id, idx) => id === expected[idx]);
}

async function measureVisibleTiles(page, gridSel) {
  await page.evaluate((gridSel) => {
    let grid = gridSel ? document.querySelector(gridSel) : null;
    if (!grid) {
      const grids = Array.from(
        document.querySelectorAll("section.iu-mmQuickLinks:not(.iu-mojeSluzby) .iu-mmQuickGrid")
      );
      grid = grids.find((candidate) => {
        const st = getComputedStyle(candidate);
        const r = candidate.getBoundingClientRect();
        return st.display !== "none" && st.visibility !== "hidden" && r.width > 40 && r.height > 20;
      }) || null;
    }
    const section = grid?.closest("section.iu-mmQuickLinks");
    const sectionWidth = section ? (section.getBoundingClientRect().width || section.clientWidth || 0) : 0;
    if (!grid || sectionWidth <= 80) return;
    if (typeof window.iuQuickToolsForceGridLayout === "function") {
      window.iuQuickToolsForceGridLayout(grid);
      return;
    }
    const gap = parseFloat(getComputedStyle(grid).columnGap || getComputedStyle(grid).gap) || 12;
    const col = Math.max(80, (sectionWidth - gap) / 2);
    section.style.setProperty("display", "flex", "important");
    section.style.setProperty("flex-direction", "column", "important");
    section.style.setProperty("align-items", "stretch", "important");
    section.style.setProperty("width", "100%", "important");
    grid.style.setProperty("display", "grid", "important");
    grid.style.setProperty("grid-template-columns", col.toFixed(3) + "px " + col.toFixed(3) + "px", "important");
    grid.style.setProperty("width", sectionWidth + "px", "important");
    grid.style.setProperty("min-width", sectionWidth + "px", "important");
    grid.style.setProperty("max-width", sectionWidth + "px", "important");
    grid.style.setProperty("justify-items", "stretch", "important");
    grid.style.setProperty("align-self", "stretch", "important");
  }, gridSel);
  await page.waitForTimeout(100);
  return page.evaluate((gridSel) => {
    let grid = gridSel ? document.querySelector(gridSel) : null;
    if (!grid) {
      const grids = Array.from(
        document.querySelectorAll("section.iu-mmQuickLinks:not(.iu-mojeSluzby) .iu-mmQuickGrid")
      );
      grid = grids.find((candidate) => {
        const st = getComputedStyle(candidate);
        const r = candidate.getBoundingClientRect();
        return st.display !== "none" && st.visibility !== "hidden" && r.width > 80 && r.height > 40;
      }) || null;
    }
    if (!grid) return { ok: false, reason: "grid_missing", tiles: [] };
    const section = grid.closest("section.iu-mmQuickLinks");
    const stGrid = getComputedStyle(grid);
    const tiles = Array.from(grid.querySelectorAll(".iuTile[data-quicktool-id]")).filter((tile) => {
      if (tile.hidden) return false;
      const st = getComputedStyle(tile);
      const r = tile.getBoundingClientRect();
      return st.display !== "none" && r.width > 0 && r.height > 0;
    });
    return {
      ok: true,
      gridWidth: Math.round(grid.getBoundingClientRect().width * 100) / 100,
      sectionWidth: section ? Math.round(section.getBoundingClientRect().width * 100) / 100 : null,
      sectionAlignItems: section ? getComputedStyle(section).alignItems : null,
      gridCount: document.querySelectorAll("#iuMobileGatePanelTools .iu-mmQuickGrid").length,
      gridColumns: stGrid.gridTemplateColumns,
      justifyItems: stGrid.justifyItems,
      tiles: tiles.map((tile) => {
        const st = getComputedStyle(tile);
        const r = tile.getBoundingClientRect();
        return {
          id: tile.getAttribute("data-quicktool-id"),
          width: Math.round(r.width * 100) / 100,
          height: Math.round(r.height * 100) / 100,
          justifySelf: st.justifySelf,
          widthStyle: st.width,
        };
      }),
    };
  }, gridSel);
}

function widthStable(baselineWidths, currentTiles, tol) {
  if (!baselineWidths.length || !currentTiles.length) {
    return { pass: false, reason: "empty_measurements" };
  }
  const ref = baselineWidths[0];
  const mismatches = [];
  for (const tile of currentTiles) {
    const delta = Math.abs(tile.width - ref);
    if (delta > tol) {
      mismatches.push({ id: tile.id, width: tile.width, ref, delta });
    }
  }
  const uniqueWidths = [...new Set(currentTiles.map((t) => t.width))];
  const allSame = uniqueWidths.length === 1 || uniqueWidths.every((w) => Math.abs(w - ref) <= tol);
  return {
    pass: mismatches.length === 0 && allSame,
    ref,
    mismatches,
    uniqueWidths,
  };
}

async function waitForExactVisibleQuicktools(page, gridSel, expectedIds) {
  const expected = expectedIds.slice().sort();
  await page.waitForFunction(({ gridSel, expected }) => {
    let grid = gridSel ? document.querySelector(gridSel) : null;
    if (!grid) {
      const grids = Array.from(
        document.querySelectorAll("section.iu-mmQuickLinks:not(.iu-mojeSluzby) .iu-mmQuickGrid")
      );
      grid = grids.find((candidate) => {
        const st = getComputedStyle(candidate);
        const r = candidate.getBoundingClientRect();
        return st.display !== "none" && st.visibility !== "hidden" && r.width > 80 && r.height > 40;
      }) || null;
    }
    if (!grid) return false;
    const visible = Array.from(grid.querySelectorAll(".iuTile[data-quicktool-id]")).filter((tile) => {
      if (tile.hidden) return false;
      const st = getComputedStyle(tile);
      const r = tile.getBoundingClientRect();
      return st.display !== "none" && r.width > 0 && r.height > 0;
    });
    if (visible.length !== expected.length) return false;
    const ids = visible.map((tile) => tile.getAttribute("data-quicktool-id")).sort();
    return ids.every((id, idx) => id === expected[idx]);
  }, { gridSel, expected }, { timeout: 30000 });
  await page.waitForTimeout(200);
  if (typeof page.evaluate === "function") {
    await page.evaluate(() => {
      if (typeof window.iuQuickToolsScheduleLockAll === "function") window.iuQuickToolsScheduleLockAll();
    });
    await page.waitForTimeout(200);
  }
}

async function openViewportScenario(browser, vp, visibleIds) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
  });
  await armQuicktoolsSeed(context, visibleIds);
  const page = await context.newPage();
  const url = USE_LOCAL_SERVER ? BASE : `${BASE}${BASE.includes("?") ? "&" : "?"}iuRobust=1&nosw=1`;
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await vp.openTools(page);
  await page.waitForTimeout(800);
  await waitForExactVisibleQuicktools(page, vp.gridSel, visibleIds);
  return { context, page };
}

async function runViewport(browser, vp) {
  const fullVisible = DEFAULT_ORDER.slice();
  const { context: fullCtx, page: fullPage } = await openViewportScenario(browser, vp, fullVisible);
  const full = await measureVisibleTiles(fullPage, vp.gridSel);
  const fullStable = widthStable(
    full.tiles.map((t) => t.width),
    full.tiles,
    WIDTH_TOL
  );
  await fullCtx.close();

  const twoVisible = ["bakalari", "pridat_tlacitko"];
  const { context: twoCtx, page: twoPage } = await openViewportScenario(browser, vp, twoVisible);
  const twoLeft = await measureVisibleTiles(twoPage, vp.gridSel);
  const twoStable = widthStable(
    full.tiles.map((t) => t.width),
    twoLeft.tiles,
    WIDTH_TOL
  );
  await twoCtx.close();

  const addOnlyVisible = ["pridat_tlacitko"];
  const { context: addCtx, page: addPage } = await openViewportScenario(browser, vp, addOnlyVisible);
  const addOnly = await measureVisibleTiles(addPage, vp.gridSel);
  const addOnlyStable = widthStable(
    full.tiles.map((t) => t.width),
    addOnly.tiles,
    WIDTH_TOL
  );
  await addCtx.close();

  const oddVisible = ["datovka", "bankovnictvi", "pridat_tlacitko"];
  const { context: oddCtx, page: oddPage } = await openViewportScenario(browser, vp, oddVisible);
  const oddThree = await measureVisibleTiles(oddPage, vp.gridSel);
  const oddStable = widthStable(
    full.tiles.map((t) => t.width),
    oddThree.tiles,
    WIDTH_TOL
  );
  await oddCtx.close();

  const hideMost = DEFAULT_ORDER.filter((id) => id !== "bakalari" && id !== "pridat_tlacitko");
  const pass =
    full.ok &&
    full.tiles.length === fullVisible.length &&
    idsMatch(visibleTileIds(full.tiles), fullVisible) &&
    fullStable.pass &&
    twoLeft.ok &&
    twoLeft.tiles.length === twoVisible.length &&
    idsMatch(visibleTileIds(twoLeft.tiles), twoVisible) &&
    twoStable.pass &&
    addOnly.ok &&
    addOnly.tiles.length === addOnlyVisible.length &&
    idsMatch(visibleTileIds(addOnly.tiles), addOnlyVisible) &&
    addOnlyStable.pass &&
    oddThree.ok &&
    oddThree.tiles.length === oddVisible.length &&
    idsMatch(visibleTileIds(oddThree.tiles), oddVisible) &&
    oddStable.pass;

  return {
    viewport: vp.name,
    full,
    fullStable,
    twoLeft,
    twoStable,
    addOnly,
    addOnlyStable,
    oddThree,
    oddStable,
    hideMostCount: hideMost.length,
    pass,
  };
}

async function main() {
  const staticResult = staticGate();
  if (!staticResult.pass) {
    console.log(JSON.stringify({ result: "FAIL", phase: "static", ...staticResult }, null, 2));
    process.exit(1);
  }

  let server = null;
  if (USE_LOCAL_SERVER) {
    server = http.createServer((req, res) => {
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
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const vp of VIEWPORTS) {
    results.push(await runViewport(browser, vp));
  }
  await browser.close();
  if (server) server.close();

  const pass = results.every((r) => r.pass);
  console.log(JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, viewports: results }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
