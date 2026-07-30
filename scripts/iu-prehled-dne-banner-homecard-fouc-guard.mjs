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
  must(/html\.iu-info-system-cutover #iuNewsPreviewCardMount/.test(index), "index:early_css_hides_news_mount");
  must(/html\.iu-info-system-cutover #iuSilverFinanceHomeCard/.test(index), "index:early_css_hides_finance");
  must(/function bannerHtml\(/.test(ui), "ui:bannerHtml");
  must(/bannerHtml\(\)/.test(ui) && /homeShellHtml/.test(ui), "ui:banner_in_shell");
  must(/\.iuPd__bannerImg/.test(css) && /aspect-ratio:\s*1661\s*\/\s*616/.test(css), "css:banner_aspect");
  must(/object-fit:\s*contain/.test(css), "css:banner_contain");
  must(/#iuFeedNewsSplitPostHomeCards/.test(css), "css:cutover_post_homecards");
  must(/2026-07-30-banner-homecard-fouc-v1/.test(sw), "sw:cache_version");
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
        const news = document.querySelector('[data-iu-news-preview-card="1"]');
        const mount = document.getElementById("iuNewsPreviewCardMount");
        const finance = document.getElementById("iuSilverFinanceHomeCard");
        const cs = (el) => (el ? getComputedStyle(el).display : "none");
        return {
          cutover: document.documentElement.classList.contains("iu-info-system-cutover"),
          newsDisplay: cs(news),
          mountDisplay: cs(mount),
          financeDisplay: cs(finance),
          bannerCount: document.querySelectorAll("[data-iu-pd-banner='1']").length,
        };
      });
      if (!early.cutover) pwFails.push(vp.name + ":early_cutover");
      if (early.newsDisplay !== "none") pwFails.push(vp.name + ":news_card_visible_early:" + early.newsDisplay);
      if (early.mountDisplay !== "none") pwFails.push(vp.name + ":news_mount_visible_early:" + early.mountDisplay);
      if (early.financeDisplay !== "none") pwFails.push(vp.name + ":finance_visible_early:" + early.financeDisplay);
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
        const img = banner && banner.querySelector("img");
        const precedes = (a, b) => !!(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        const imgCs = img ? getComputedStyle(img) : null;
        const parcelVisible = !!(
          parcel &&
          parcel.closest("#iuSilverWelcomeStack") &&
          getComputedStyle(parcel).display !== "none" &&
          getComputedStyle(parcel).visibility !== "hidden"
        );
        return {
          bannerCount: document.querySelectorAll("[data-iu-pd-banner='1']").length,
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
          newsDisplay: (() => {
            const el = document.querySelector('[data-iu-news-preview-card="1"]');
            return el ? getComputedStyle(el).display : "none";
          })(),
        };
      });

      if (layout.bannerCount !== 1) pwFails.push(vp.name + ":banner_count:" + layout.bannerCount);
      if (layout.parcelVisible && !layout.parcelBeforeBanner) pwFails.push(vp.name + ":order_parcel_banner");
      if (!layout.infoBeforeBanner) pwFails.push(vp.name + ":order_info_banner");
      if (!layout.bannerBeforeBtn) pwFails.push(vp.name + ":order_banner_btn");
      if (layout.overflowX) pwFails.push(vp.name + ":overflow_x");
      if (layout.imgWidth < 40 || layout.imgHeight < 10) pwFails.push(vp.name + ":img_size");
      if (layout.objectFit !== "contain") pwFails.push(vp.name + ":object_fit");
      if (!/infouzel-prehled-dne-banner\.png/.test(layout.src)) pwFails.push(vp.name + ":img_src");
      if (!/InfoUzel/.test(layout.alt)) pwFails.push(vp.name + ":img_alt");
      if (layout.newsDisplay !== "none") pwFails.push(vp.name + ":news_still_visible");

      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      const afterReload = await page.evaluate(() => {
        const news = document.querySelector('[data-iu-news-preview-card="1"]');
        return {
          cutover: document.documentElement.classList.contains("iu-info-system-cutover"),
          newsDisplay: news ? getComputedStyle(news).display : "none",
          bannerCount: document.querySelectorAll("[data-iu-pd-banner='1']").length,
        };
      });
      if (!afterReload.cutover) pwFails.push(vp.name + ":reload_cutover");
      if (afterReload.newsDisplay !== "none") pwFails.push(vp.name + ":reload_news_flash");
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
