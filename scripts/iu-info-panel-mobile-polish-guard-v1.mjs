#!/usr/bin/env node
/**
 * Informační lišta — mobil/tablet polish guard (disclaimer, sources, scroll hint, card states).
 * Run: npm run iu-info-panel-mobile-polish-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  mergeInfoPanelItemForGuard,
  IU_INFO_PANEL_CATALOG,
} from "../assets/iu-desktop-info-panel-data.js";
import { getExpectedLatestCnbPublicationDate } from "../assets/iu-cnb-exchange-utils.js";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8894", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const VIEWPORTS = [
  { name: "MOBILE", width: 390, height: 844 },
  { name: "TABLET", width: 768, height: 1024 },
];

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const panelJs = read("assets/iu-desktop-info-panel.js");
  const panelData = read("assets/iu-desktop-info-panel-data.js");
  const mobileCss = read("assets/iu-mobile-info-panel.css");
  const desktopCss = read("assets/iu-desktop-info-panel.css");
  const indexHtml = read("projects/index.html");
  const buildScript = read("scripts/build_info_panel_snapshot.mjs");

  const checks = [
    {
      id: "panel_no_main_disclaimer",
      pass: panelJs.includes("buildPanelHtml") && !panelJs.includes("iuDesktopInfoPanel__legal"),
    },
    {
      id: "detail_keeps_disclaimer",
      pass: panelJs.includes("iuDesktopInfoPanelDetail__note") && panelJs.includes("IU_INFO_PANEL_DISCLAIMER"),
    },
    {
      id: "bucket_freshness_anchor",
      pass: panelData.includes("bucketFetchedAt") && panelData.includes("resolveSnapshotFetchAnchor"),
    },
    {
      id: "snapshot_exports_bucket_fetched_at",
      pass: buildScript.includes("snapshot.bucketFetchedAt"),
    },
    {
      id: "mobile_sources_css",
      pass: mobileCss.includes("iuDesktopInfoPanel__sources") && mobileCss.includes("iuDesktopInfoPanel__sourcesLabel"),
    },
    {
      id: "mobile_scroll_hint_css",
      pass: mobileCss.includes("iuDesktopInfoPanel__scrollHint"),
    },
    {
      id: "desktop_no_legal_css",
      pass: !desktopCss.includes("iuDesktopInfoPanel__legal"),
    },
    {
      id: "cache_bust",
      pass:
        indexHtml.includes("remove-environment-info-panel-v1-20260901") ||
        indexHtml.includes("rychly-prehled-horizontal-persist-v1-20260803") ||
        indexHtml.includes("info-panel-mpsv-audit-v1-20260716") ||
        indexHtml.includes("info-panel-cnb-rates-v1-20260715") ||
        indexHtml.includes("info-panel-freshness-period-v1-20260709"),
    },
    {
      id: "catalog_no_environment",
      pass: !/id:\s*"environment"/.test(read("assets/iu-desktop-info-panel-catalog.js")),
    },
    {
      id: "user_content_no_environment",
      pass: !/environment:\s*\{/.test(read("assets/iu-info-panel-user-content.js")),
    },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, fails, checks };
}

function unitGate() {
  const bitcoin = IU_INFO_PANEL_CATALOG.find((i) => i.id === "bitcoin");
  const gold = IU_INFO_PANEL_CATALOG.find((i) => i.id === "gold");
  const eur = IU_INFO_PANEL_CATALOG.find((i) => i.id === "eur_czk");
  const fails = [];

  const freshCoinMeta = {
    generatedAt: "2020-01-01T00:00:00.000Z",
    bucketFetchedAt: { coingecko: new Date().toISOString() },
    errors: [],
  };
  const liveBtc = mergeInfoPanelItemForGuard(
    bitcoin,
    {
      isLive: true,
      legalStatus: "verified_requires_attribution",
      value: 2500000,
      unit: "Kč",
      secondaryValue: "beze změny",
      trendDirection: "flat",
      updatedAt: freshCoinMeta.bucketFetchedAt.coingecko,
    },
    freshCoinMeta
  );
  if (liveBtc.state !== "live") fails.push("bitcoin_bucket_freshness");

  const staleCoinMeta = {
    generatedAt: new Date().toISOString(),
    bucketFetchedAt: { coingecko: "2020-01-01T00:00:00.000Z" },
    errors: [],
  };
  const staleGold = mergeInfoPanelItemForGuard(
    gold,
    {
      isLive: true,
      legalStatus: "verified_requires_attribution",
      value: 80000,
      unit: "Kč",
      secondaryValue: "beze změny",
      trendDirection: "flat",
      updatedAt: staleCoinMeta.bucketFetchedAt.coingecko,
    },
    staleCoinMeta
  );
  if (staleGold.state !== "live") fails.push("gold_bucket_shows_last_value");

  const expectedCnb = getExpectedLatestCnbPublicationDate();
  const expectedCnbLabel =
    String(expectedCnb.getDate()).padStart(2, "0") +
    "." +
    String(expectedCnb.getMonth() + 1).padStart(2, "0") +
    "." +
    String(expectedCnb.getFullYear());
  const freshEur = mergeInfoPanelItemForGuard(
    eur,
    {
      isLive: true,
      legalStatus: "verified_requires_attribution",
      value: 25.1,
      unit: "Kč",
      secondaryValue: "beze změny",
      trendDirection: "flat",
      updatedAt: expectedCnbLabel,
    },
    { generatedAt: new Date().toISOString(), bucketFetchedAt: { cnb: new Date().toISOString() }, errors: [] }
  );
  if (freshEur.state !== "live") fails.push("eur_bucket_freshness");

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

async function waitForMobilePanel(page) {
  await page.waitForFunction(
    () =>
      !!document.getElementById("iuMobileInfoPanel") &&
      document.getElementById("iuMobileInfoPanelMount")?.getAttribute("data-iu-info-panel-ready") === "1" &&
      document.querySelectorAll("#iuMobileInfoPanel .iuDesktopInfoPanel__segment").length > 10,
    { timeout: 45000 }
  );
  await page.waitForTimeout(400);
}

async function measureViewport(page, vpName) {
  return page.evaluate((name) => {
    const panel = document.getElementById("iuMobileInfoPanel");
    const sources = panel ? panel.querySelector(".iuDesktopInfoPanel__sources") : null;
    const legal = panel ? panel.querySelector(".iuDesktopInfoPanel__legal") : null;
    const hint = panel ? panel.querySelector("[data-iu-info-panel-scroll-hint]") : null;
    const scroll = panel ? panel.querySelector(".iuDesktopInfoPanel__scroll") : null;
    const btc = panel ? panel.querySelector('[data-iu-info-panel-id="bitcoin"]') : null;
    const gold = panel ? panel.querySelector('[data-iu-info-panel-id="gold"]') : null;
    const environment = panel ? panel.querySelector('[data-iu-info-panel-id="environment"]') : null;
    const environmentText = panel ? (panel.textContent || "").includes("Investice na ochranu") : false;

    const sourcesRect = sources ? sources.getBoundingClientRect() : null;
    const panelRect = panel ? panel.getBoundingClientRect() : null;
    const sourcesVisible =
      !!sources &&
      sources.textContent.includes("Zdroje dat:") &&
      sourcesRect &&
      panelRect &&
      sourcesRect.height > 8 &&
      sourcesRect.bottom <= panelRect.bottom + 1;

    const scrollable = scroll ? scroll.scrollWidth > scroll.clientWidth + 2 : false;
    const hintVisible = !!hint && !hint.classList.contains("iuDesktopInfoPanel__scrollHint--hidden");

    return {
      viewport: name,
      panelVisible: !!panel && panel.offsetParent !== null,
      noMainDisclaimer: !legal,
      sourcesVisible,
      sourcesText: sources ? sources.textContent.trim().slice(0, 120) : "",
      scrollHintPresent: !!hint,
      scrollHintVisible: scrollable ? hintVisible : true,
      scrollable,
      bitcoinState: btc ? btc.getAttribute("data-iu-info-panel-state") : null,
      goldState: gold ? gold.getAttribute("data-iu-info-panel-state") : null,
      cardsNotLoading:
        btc &&
        gold &&
        btc.getAttribute("data-iu-info-panel-state") !== "loading" &&
        gold.getAttribute("data-iu-info-panel-state") !== "loading",
      noEnvironmentSegment: !environment && !environmentText,
    };
  }, vpName);
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE + "?section=media&iuInfoSystem=off", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 30000 });
  await waitForMobilePanel(page);
  const metrics = await measureViewport(page, vp.name);
  await context.close();

  const pass =
    metrics.panelVisible &&
    metrics.noMainDisclaimer &&
    metrics.sourcesVisible &&
    metrics.scrollHintPresent &&
    metrics.scrollHintVisible &&
    metrics.cardsNotLoading &&
    metrics.noEnvironmentSegment;

  return { ...metrics, pass };
}

async function main() {
  const staticResult = staticGate();
  const unitResult = unitGate();
  if (!staticResult.pass || !unitResult.pass) {
    console.log(
      JSON.stringify(
        { result: "FAIL", phase: "static", static: staticResult, unit: unitResult },
        null,
        2
      )
    );
    process.exit(1);
  }

  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });

  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const results = [];
    for (const vp of VIEWPORTS) {
      results.push(await runViewport(browser, vp));
    }
    await browser.close();

    const pass = results.every((r) => r.pass);
    console.log(
      JSON.stringify({ result: pass ? "PASS" : "FAIL", static: staticResult, unit: unitResult, viewports: results }, null, 2)
    );
    process.exit(pass ? 0 : 1);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
