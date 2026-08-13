#!/usr/bin/env node
/**
 * Regression: InfoUzel day banner placement + legacy HomeCard FOUC (cutover before paint).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const INDEX = path.join(ROOT, "projects", "index.html");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const CSS = path.join(ROOT, "assets", "iu-prehled-dne-v1.css");
const BANNER = path.join(ROOT, "assets", "images", "infouzel-prehled-dne-banner.png");
const SW = path.join(ROOT, "sw.js");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8971", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function staticGate() {
  const index = fs.readFileSync(INDEX, "utf8");
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const sw = fs.readFileSync(SW, "utf8");

  must(fs.existsSync(BANNER), "asset:banner_exists");
  must(/<html[^>]*class="[^"]*iu-info-system-cutover/.test(index), "index:html_cutover_class");
  must(/__iuInfoSystemCutoverEarlyBoot/.test(index), "index:early_cutover_boot");
  must(/infouzel-prehled-dne-banner\.png/.test(index), "index:banner_path");
  must(/data-iu-pd-banner="1"/.test(index), "index:static_banner_shell");
  must(/preload[^>]+infouzel-prehled-dne-banner\.png/.test(index), "index:banner_preload");
  must(!/id="iuNewsPreviewCardMount"/.test(index), "index:no_static_news_mount");
  must(!/data-iu-news-preview-card="1"/.test(index), "index:no_static_news_card");
  must(!/id="iuSilverFinanceHomeCard"/.test(index), "index:no_static_finance_homecard");
  must(!/id="iuFeedNewsSplitPostHomeCards"/.test(index), "index:no_static_post_homecards");
  must(!/id="iuFeedNewsSplit"[^>]*>[\s\S]*AKTUÁLNÍ ČLÁNKY/.test(index), "index:no_static_media_split");
  must(/function bannerHtml\(/.test(ui), "ui:bannerHtml");
  must(/bannerHtml\(\)/.test(ui) && /homeShellHtml/.test(ui), "ui:banner_in_shell");
  must(/iuPd__hero/.test(ui) && /data-iu-pd-hero/.test(ui), "ui:hero_wrapper");
  must(/data-iu-pd-hero/.test(index), "index:hero_wrapper");
  must(/data-testid="prehled-dne-hero"/.test(ui) && /data-testid="prehled-dne-homecard"/.test(ui), "ui:testids");
  must(/\.iuPd__hero\s*\{[\s\S]*?display:\s*block/.test(css), "css:hero_display_block");
  must(/\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[\s\S]*?border-top-left-radius:\s*0/.test(css), "css:cta_top_square");
  must(/\.iuPd__bannerImg/.test(css) && /aspect-ratio:\s*1661\s*\/\s*616/.test(css), "css:banner_aspect");
  must(/object-fit:\s*contain/.test(css), "css:banner_contain");
  must(/2026-08-13-decin-narrowed-lanes-reason-v1|2026-08-13-beroun-multi-street-work-reason-v1|2026-08-13-direction-abbrev-rich-situation-v1|2026-08-13-km-range-roadwork-detail-v1|2026-08-13-municipality-parenthetical-multi-road-v1|2026-08-13-traffic-fact-preservation-v1|2026-08-13-urban-numbered-road-parse-v1|2026-08-13-date-time-value-column-v4|2026-08-12-date-time-right-edge-v3|2026-08-09-heavy-feed-shell-first-v1|2026-08-09-heavy-feed-offmain-v1|2026-08-08-traffic-ui-defer-feed-hydrate-v1|2026-08-06-traffic-overview-rsd-prehled-v1|2026-08-04-root-hub-no-projects-v1|2026-08-01-homecard-cta-square-v1|2026-08-01-homecard-cta-flush-v1|2026-07-31-chmi-smog-onset-split-v1|2026-07-31-chmi-info-events-passthrough-v2|2026-07-31-chmi-validfrom-timeline-v1|2026-07-31-chmi-title-locality-v1|2026-07-31-chmi-multibrowser-console-v1|2026-07-30-chmi-cap-no-segment-dedupe-v1|2026-07-30-chmi-cap-unified-public-click-v1|2026-07-30-chmi-cap-open-ended-public-url-v1|2026-07-30-chmi-cap-temporal-status-v1/.test(sw), "sw:cache_version");
  const appJs = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
  must(/function iuLegacyHomeCardsWanted/.test(appJs), "app:legacy_wanted");
  must(/function iuLegacyHomeCardsEnsureShell/.test(appJs), "app:legacy_ensure_shell");
  must(/if \(!iuLegacyHomeCardsWanted\(\)\) return/.test(appJs), "app:ensure_dom_gated");
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
        if (Date.now() > deadline) reject(new Error("port_timeout"));
        else setTimeout(tryOnce, 100);
      });
      req.end();
    };
    tryOnce();
  });
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        if (urlPath === "/") urlPath = "/projects/index.html";
        if (urlPath === "/projects/" || urlPath === "/projects") urlPath = "/projects/index.html";
        const fp = path.join(ROOT, urlPath.replace(/^\//, "").replace(/\//g, path.sep));
        if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
          res.writeHead(404);
          res.end("missing");
          return;
        }
        const mime = fp.endsWith(".css")
          ? "text/css; charset=utf-8"
          : fp.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : fp.endsWith(".json")
              ? "application/json; charset=utf-8"
              : fp.endsWith(".html")
                ? "text/html; charset=utf-8"
                : fp.endsWith(".png")
                  ? "image/png"
                  : "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function runPlaywright() {
  const server = await startServer();
  await waitForPort("127.0.0.1", PORT, 10000);
  const browser = await chromium.launch({ headless: true });
  const pwFails = [];
  const viewports = [
    { name: "mobile-narrow", width: 360, height: 740 },
    { name: "mobile", width: 390, height: 844 },
    { name: "mobile-large", width: 430, height: 932 },
    { name: "tablet-portrait", width: 768, height: 1024 },
    { name: "tablet-landscape", width: 1024, height: 768 },
    { name: "desktop-narrow", width: 1025, height: 800 },
    { name: "desktop", width: 1280, height: 900 },
    { name: "desktop-wide", width: 1600, height: 900 },
  ];

  try {
    for (const vp of viewports) {
      const context = await bootstrapGuardContext(browser, { viewport: { width: vp.width, height: vp.height } });
      const page = await bootstrapGuardPage(context);

      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });

      const early = await page.evaluate(() => {
        return {
          cutover: document.documentElement.classList.contains("iu-info-system-cutover"),
          newsExists: !!document.querySelector('[data-iu-news-preview-card="1"]'),
          mountExists: !!document.getElementById("iuNewsPreviewCardMount"),
          financeExists: !!document.getElementById("iuSilverFinanceHomeCard"),
          postSplitExists: !!document.getElementById("iuFeedNewsSplitPostHomeCards"),
          mediaSplitExists: !!document.getElementById("iuFeedNewsSplit"),
          bannerCount: document.querySelectorAll("[data-iu-pd-banner='1']").length,
        };
      });
      if (!early.cutover) pwFails.push(vp.name + ":early_cutover");
      if (early.newsExists) pwFails.push(vp.name + ":news_card_in_dom_early");
      if (early.mountExists) pwFails.push(vp.name + ":news_mount_in_dom_early");
      if (early.financeExists) pwFails.push(vp.name + ":finance_in_dom_early");
      if (early.postSplitExists) pwFails.push(vp.name + ":post_split_in_dom_early");
      if (early.mediaSplitExists) pwFails.push(vp.name + ":media_split_in_dom_early");
      if (early.bannerCount !== 1) pwFails.push(vp.name + ":early_banner_count:" + early.bannerCount);

      await page.evaluate(() => {
        try {
          window.__IU_INFO_SYSTEM_CUTOVER__ = true;
        } catch (_) {}
        document.documentElement.classList.add("iu-info-system-cutover");
        document.documentElement.classList.remove("iu-info-system-parallel");
        if (window.IUInfoSystem && typeof window.IUInfoSystem.applyCutoverDom === "function") {
          window.IUInfoSystem.applyCutoverDom();
        }
      });

      await page.waitForFunction(() => !!document.querySelector('[data-act="open-settings"]'), { timeout: 45000 });

      const layout = await page.evaluate(() => {
        const parcel = document.getElementById("iuSilverParcelWatch");
        const info = document.getElementById("iuDesktopInfoPanelMount");
        const banner = document.querySelector("[data-iu-pd-banner='1']");
        const btn = document.querySelector('[data-act="open-settings"]');
        const hero = document.querySelector("[data-iu-pd-hero='1']");
        const img = banner && banner.querySelector("img");
        const precedes = (a, b) => !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const imgCs = img ? getComputedStyle(img) : null;
        const heroCs = hero ? getComputedStyle(hero) : null;
        const btnCs = btn ? getComputedStyle(btn) : null;
        const bannerRect = banner ? banner.getBoundingClientRect() : null;
        const btnRect = btn ? btn.getBoundingClientRect() : null;
        const seamGap =
          bannerRect && btnRect ? Math.round((btnRect.top - bannerRect.bottom) * 100) / 100 : null;
        const parcelVisible = !!(
          parcel &&
          parcel.closest("#iuSilverWelcomeStack") &&
          getComputedStyle(parcel).display !== "none" &&
          getComputedStyle(parcel).visibility !== "hidden"
        );
        return {
          bannerCount: document.querySelectorAll("[data-iu-pd-banner='1']").length,
          heroCount: document.querySelectorAll("[data-iu-pd-hero='1']").length,
          heroDisplay: heroCs ? heroCs.display : "",
          seamGap,
          btnTL: btnCs ? btnCs.borderTopLeftRadius : "",
          btnTR: btnCs ? btnCs.borderTopRightRadius : "",
          parcelVisible,
          parcelBeforeBanner: precedes(parcel, banner),
          infoBeforeBanner: precedes(info, banner),
          bannerBeforeBtn: precedes(banner, btn),
          overflowX,
          imgWidth: img ? img.getBoundingClientRect().width : 0,
          imgHeight: img ? img.getBoundingClientRect().height : 0,
          objectFit: imgCs ? imgCs.objectFit : "",
          src: img ? img.getAttribute("src") || "" : "",
          alt: img ? img.getAttribute("alt") || "" : "",
          newsExists: !!document.querySelector('[data-iu-news-preview-card="1"]'),
          mountExists: !!document.getElementById("iuNewsPreviewCardMount"),
          financeExists: !!document.getElementById("iuSilverFinanceHomeCard"),
        };
      });

      if (layout.bannerCount !== 1) pwFails.push(vp.name + ":banner_count:" + layout.bannerCount);
      if (layout.heroCount !== 1) pwFails.push(vp.name + ":hero_count:" + layout.heroCount);
      if (layout.heroDisplay !== "block") pwFails.push(vp.name + ":hero_display:" + layout.heroDisplay);
      if (layout.seamGap == null || layout.seamGap > 0.5 || layout.seamGap < -0.5) {
        pwFails.push(vp.name + ":banner_btn_seam:" + layout.seamGap);
      }
      if (layout.btnTL !== "0px") pwFails.push(vp.name + ":btn_tl_radius:" + layout.btnTL);
      if (layout.btnTR !== "0px") pwFails.push(vp.name + ":btn_tr_radius:" + layout.btnTR);
      if (layout.parcelVisible && !layout.parcelBeforeBanner) pwFails.push(vp.name + ":order_parcel_banner");
      if (!layout.infoBeforeBanner) pwFails.push(vp.name + ":order_info_banner");
      if (!layout.bannerBeforeBtn) pwFails.push(vp.name + ":order_banner_btn");
      if (layout.overflowX) pwFails.push(vp.name + ":overflow_x");
      if (layout.imgWidth < 40 || layout.imgHeight < 10) pwFails.push(vp.name + ":img_size");
      if (layout.objectFit !== "contain") pwFails.push(vp.name + ":object_fit");
      if (!/infouzel-prehled-dne-banner\.png/.test(layout.src)) pwFails.push(vp.name + ":img_src");
      if (!/InfoUzel/.test(layout.alt)) pwFails.push(vp.name + ":img_alt");
      if (layout.newsExists) pwFails.push(vp.name + ":news_still_in_dom");
      if (layout.mountExists) pwFails.push(vp.name + ":mount_still_in_dom");
      if (layout.financeExists) pwFails.push(vp.name + ":finance_still_in_dom");

      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      const afterReload = await page.evaluate(() => {
        return {
          cutover: document.documentElement.classList.contains("iu-info-system-cutover"),
          newsExists: !!document.querySelector('[data-iu-news-preview-card="1"]'),
          mountExists: !!document.getElementById("iuNewsPreviewCardMount"),
          financeExists: !!document.getElementById("iuSilverFinanceHomeCard"),
          bannerCount: document.querySelectorAll("[data-iu-pd-banner='1']").length,
        };
      });
      if (!afterReload.cutover) pwFails.push(vp.name + ":reload_cutover");
      if (afterReload.newsExists) pwFails.push(vp.name + ":reload_news_in_dom");
      if (afterReload.mountExists) pwFails.push(vp.name + ":reload_mount_in_dom");
      if (afterReload.financeExists) pwFails.push(vp.name + ":reload_finance_in_dom");
      if (afterReload.bannerCount !== 1) pwFails.push(vp.name + ":reload_banner_count");

      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }

  return pwFails;
}

staticGate();
const staticFails = fails.slice();
const pwFails = await runPlaywright();
const all = staticFails.concat(pwFails);
if (all.length) {
  console.error("FAIL iu-prehled-dne-banner-homecard-fouc-guard");
  for (const f of all) console.error(" - " + f);
  process.exit(1);
}
console.log("PASS iu-prehled-dne-banner-homecard-fouc-guard");
