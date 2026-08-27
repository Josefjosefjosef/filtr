#!/usr/bin/env node
/**
 * Rychlé odkazy — mobil/tablet viditelnost dlaždic podle nastavení.
 * Run: npm run iu-quicktools-mobile-visibility-guard
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

const CUSTOM = path.join(REPO, "assets", "iu-custom-buttons-overlay.css");
const INDEX = path.join(REPO, "projects", "index.html");
const PORT = parseInt(process.env.IU_GUARD_PORT || "8899", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const GRID = "#iuMobileGatePanelTools .iu-mmQuickGrid";
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
const CUSTOM_ID = "cb_visibility_test";

const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function staticGate() {
  const custom = fs.readFileSync(CUSTOM, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const checks = [
    {
      id: "hidden_tile_display_none_important",
      pass: /\.iu-mmQuickGrid > \.iuTile\[hidden\][\s\S]*display:\s*none !important/.test(custom),
    },
    {
      id: "hidden_tile_mobile_tablet_scope",
      pass: /@media \(max-width: 1024px\)[\s\S]*\.iu-mmQuickGrid > \.iuTile\[hidden\]/.test(custom),
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

async function buildSeedConfig() {
  return {
    version: 2,
    order: DEFAULT_ORDER.slice(0, -1).concat([CUSTOM_ID, "pridat_tlacitko"]),
    visible: DEFAULT_ORDER.slice(0, -1).concat([CUSTOM_ID, "pridat_tlacitko"]),
    customButtons: [
      {
        id: CUSTOM_ID,
        label: "Test Custom",
        url: "https://example.com/test",
        color: "#2563EB",
      },
    ],
  };
}

async function seedDefaultConfig(page) {
  const cfg = await buildSeedConfig();
  await page.evaluate(({ payload }) => {
    if (localStorage.getItem(payload.key) != null) return;
    localStorage.setItem(payload.key, payload.value);
  }, { payload: { key: "infouzel_quicktools", value: JSON.stringify(cfg) } });
}

async function waitForTilePresent(page, tileId) {
  await page.waitForSelector(`${GRID} .iuTile[data-quicktool-id="${tileId}"]`, {
    state: "attached",
    timeout: 15000,
  });
}

async function waitForCustomTile(page) {
  await page.waitForFunction(
    ({ gridSel, tileId }) => {
      const tile = document.querySelector(`${gridSel} .iuTile[data-quicktool-id="${tileId}"]`);
      if (!tile) return false;
      const st = getComputedStyle(tile);
      const r = tile.getBoundingClientRect();
      return !tile.hidden && st.display !== "none" && r.width > 0 && r.height > 0;
    },
    { gridSel: GRID, tileId: CUSTOM_ID },
    { timeout: 20000 }
  );
}

async function waitForVisibilityToggle(page, tileId) {
  const sel = `input[data-iu-quicktools-visible-toggle="${tileId}"]`;
  await page.waitForSelector(sel, { state: "attached", timeout: 20000 });
  await page.waitForFunction(
    (id) => {
      const cb = document.querySelector(`input[data-iu-quicktools-visible-toggle="${id}"]`);
      if (!cb) return false;
      const st = getComputedStyle(cb);
      const r = cb.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
    },
    tileId,
    { timeout: 20000 }
  );
}

async function waitForTileHidden(page, tileId) {
  await page.waitForFunction(
    ({ gridSel, tileId }) => {
      const tile = document.querySelector(`${gridSel} .iuTile[data-quicktool-id="${tileId}"]`);
      if (!tile) return false;
      const st = getComputedStyle(tile);
      const r = tile.getBoundingClientRect();
      return tile.hidden === true && st.display === "none" && (r.width === 0 || r.height === 0);
    },
    { gridSel: GRID, tileId },
    { timeout: 15000 }
  );
}

async function openToolsTab(page) {
  /* Tools tab toggles closed when already active (history/hash restore after reload). */
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
  await page.waitForSelector(GRID, { timeout: 15000 });
}

async function openSettings(page) {
  await page.evaluate(() => document.querySelector("[data-iu-quicktools-settings]")?.click());
  await page.waitForFunction(
    (customId) => {
      const panel = document.getElementById("iuQuickToolsSettingsPanel");
      if (!panel || panel.hidden) return false;
      const bakalari = panel.querySelector('input[data-iu-quicktools-visible-toggle="bakalari"]');
      const custom = panel.querySelector(`input[data-iu-quicktools-visible-toggle="${customId}"]`);
      if (!bakalari || !custom) return false;
      const visible = (el) => {
        const st = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden";
      };
      return visible(bakalari) && visible(custom);
    },
    CUSTOM_ID,
    { timeout: 20000 }
  );
}

async function closeSettings(page) {
  await page.evaluate(() => document.querySelector(".iu-quicktools-settings-close")?.click());
  await page.waitForFunction(() => {
    const panel = document.getElementById("iuQuickToolsSettingsPanel");
    return panel && panel.hidden;
  }, null, { timeout: 10000 });
}

async function setVisibility(page, tileId, visible) {
  await waitForVisibilityToggle(page, tileId);
  await page.evaluate(({ tileId, visible }) => {
    const cb = document.querySelector(`input[data-iu-quicktools-visible-toggle="${tileId}"]`);
    if (!cb) return;
    if (cb.checked !== visible) {
      cb.checked = visible;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, { tileId, visible });
  if (!visible) {
    await waitForTileHidden(page, tileId);
  } else {
    await page.waitForFunction(
      ({ gridSel, tileId }) => {
        const tile = document.querySelector(`${gridSel} .iuTile[data-quicktool-id="${tileId}"]`);
        if (!tile) return false;
        const st = getComputedStyle(tile);
        const r = tile.getBoundingClientRect();
        return !tile.hidden && st.display !== "none" && r.width > 0 && r.height > 0;
      },
      { gridSel: GRID, tileId },
      { timeout: 15000 }
    );
  }
}

async function measureTile(page, tileId) {
  return page.evaluate(({ gridSel, tileId }) => {
    const grid = document.querySelector(gridSel);
    const tile = grid?.querySelector(`.iuTile[data-quicktool-id="${tileId}"]`);
    if (!tile) return { present: false, tileId };
    const st = getComputedStyle(tile);
    const r = tile.getBoundingClientRect();
    return {
      present: true,
      tileId,
      hidden: tile.hidden,
      display: st.display,
      ariaHidden: tile.getAttribute("aria-hidden"),
      visibleInLayout: r.width > 0 && r.height > 0 && st.display !== "none" && st.visibility !== "hidden",
    };
  }, { gridSel: GRID, tileId });
}

async function readStoredVisible(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("infouzel_quicktools");
      if (!raw) return null;
      const cfg = JSON.parse(raw);
      return Array.isArray(cfg.visible) ? cfg.visible.slice() : null;
    } catch (_) {
      return null;
    }
  });
}

async function waitForStoredVisibleExcludes(page, tileIds) {
  await page.waitForFunction(
    (ids) => {
      try {
        const raw = localStorage.getItem("infouzel_quicktools");
        if (!raw) return false;
        const cfg = JSON.parse(raw);
        if (!Array.isArray(cfg.visible)) return false;
        return ids.every((id) => cfg.visible.indexOf(id) === -1);
      } catch (_) {
        return false;
      }
    },
    tileIds,
    { timeout: 20000 }
  );
}

async function countVisibleTiles(page) {
  return page.evaluate((gridSel) => {
    const grid = document.querySelector(gridSel);
    if (!grid) return { total: 0, visible: 0 };
    const tiles = Array.from(grid.querySelectorAll(".iuTile[data-quicktool-id]"));
    let visible = 0;
    for (const tile of tiles) {
      const st = getComputedStyle(tile);
      const r = tile.getBoundingClientRect();
      if (!tile.hidden && st.display !== "none" && r.width > 0 && r.height > 0) visible += 1;
    }
    return { total: tiles.length, visible };
  }, GRID);
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await waitForVaultReady(page, 60000);
  await seedDefaultConfig(page);
  await page.reload({ waitUntil: "load" });
  await waitForVaultReady(page, 60000);
  await page.waitForFunction(() => {
    try {
      if (window.iuVault && typeof window.iuVault.isHydrationComplete === "function") {
        return window.iuVault.isHydrationComplete();
      }
    } catch (_) {}
    return true;
  }, null, { timeout: 60000 }).catch(() => {});

  await openToolsTab(page);
  await waitForCustomTile(page);
  const beforeHide = await measureTile(page, "bakalari");
  await openSettings(page);
  await waitForVisibilityToggle(page, "bakalari");
  await waitForVisibilityToggle(page, "datovka");
  await waitForVisibilityToggle(page, CUSTOM_ID);
  await setVisibility(page, "bakalari", false);
  await setVisibility(page, "datovka", false);
  await closeSettings(page);

  const hiddenBakalari = await measureTile(page, "bakalari");
  const hiddenDatovka = await measureTile(page, "datovka");
  const storedAfterHide = await readStoredVisible(page);
  const countsAfterHide = await countVisibleTiles(page);

  await openSettings(page);
  await setVisibility(page, CUSTOM_ID, false);
  await closeSettings(page);
  const hiddenCustom = await measureTile(page, CUSTOM_ID);
  await waitForStoredVisibleExcludes(page, ["bakalari", "datovka", CUSTOM_ID]);

  await page.evaluate(async () => {
    try {
      if (window.iuVault && window.iuVault.flushPendingWrites) {
        await window.iuVault.flushPendingWrites();
      }
    } catch (_) {}
  });

  await page.reload({ waitUntil: "load" });
  await waitForVaultReady(page, 60000);
  await page.waitForFunction(() => {
    try {
      if (window.iuVault && typeof window.iuVault.isHydrationComplete === "function") {
        return window.iuVault.isHydrationComplete();
      }
    } catch (_) {}
    return true;
  }, null, { timeout: 60000 }).catch(() => {});
  await openToolsTab(page);
  await waitForTilePresent(page, "bakalari");
  await waitForTileHidden(page, "bakalari");
  await waitForTilePresent(page, CUSTOM_ID);
  await waitForTileHidden(page, CUSTOM_ID);
  const persistedBakalari = await measureTile(page, "bakalari");
  const persistedCustom = await measureTile(page, CUSTOM_ID);

  await openSettings(page);
  await setVisibility(page, "bakalari", true);
  await closeSettings(page);
  await page.waitForFunction(
    ({ gridSel, tileId }) => {
      const tile = document.querySelector(`${gridSel} .iuTile[data-quicktool-id="${tileId}"]`);
      if (!tile) return false;
      const st = getComputedStyle(tile);
      const r = tile.getBoundingClientRect();
      return !tile.hidden && st.display !== "none" && r.width > 0 && r.height > 0;
    },
    { gridSel: GRID, tileId: "bakalari" },
    { timeout: 15000 }
  );
  const restoredBakalari = await measureTile(page, "bakalari");

  await context.close();

  const pass =
    beforeHide.present &&
    beforeHide.visibleInLayout &&
    hiddenBakalari.present &&
    !hiddenBakalari.visibleInLayout &&
    hiddenBakalari.display === "none" &&
    hiddenDatovka.present &&
    !hiddenDatovka.visibleInLayout &&
    hiddenCustom.present &&
    !hiddenCustom.visibleInLayout &&
    Array.isArray(storedAfterHide) &&
    !storedAfterHide.includes("bakalari") &&
    !storedAfterHide.includes("datovka") &&
    countsAfterHide.visible >= 7 &&
    persistedBakalari.present &&
    !persistedBakalari.visibleInLayout &&
    persistedCustom.present &&
    !persistedCustom.visibleInLayout &&
    restoredBakalari.present &&
    restoredBakalari.visibleInLayout;

  return {
    viewport: vp.name,
    beforeHide,
    hiddenBakalari,
    hiddenDatovka,
    hiddenCustom,
    storedAfterHide,
    countsAfterHide,
    persistedBakalari,
    persistedCustom,
    restoredBakalari,
    pass,
  };
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
    let result = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      result = await runViewport(browser, vp);
      if (result.pass) break;
    }
    results.push(result);
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
