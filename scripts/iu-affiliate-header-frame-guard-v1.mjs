#!/usr/bin/env node
/**
 * Freeze guard: Affiliate category header frame
 * Colored border wraps category title + description (#iuAffiliateIntro).
 * Disclosure is plain text below (no border/box), then partner cards.
 *
 * Run: npm run iu-affiliate-header-frame-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";
import { swHasAllowedCacheVersion } from "./guards/iu-sw-cache-version-allowlist.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const DISCLOSURE =
  "Tato sekce obsahuje reklamní a partnerské odkazy na externí služby a obchody.";
const CACHE_TOKEN = "2026-09-18-affiliate-header-frame-v1";
const APP_CSS_BUST = "affiliate-header-frame-v1-20260918";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8961", 10);
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu_affiliate_header_frame_guard.json"
);

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, hasTouch: true },
  { name: "tablet", width: 768, height: 1024, hasTouch: true },
  { name: "desktop", width: 1280, height: 900, hasTouch: false },
  { name: "pwa", width: 390, height: 844, hasTouch: true, pwa: true },
];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function readCatalogCategoryIds() {
  const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const marker = catalog.indexOf("var IU_AFFILIATE_CATALOG");
  const slice = marker >= 0 ? catalog.slice(marker) : catalog;
  const ids = [];
  const re = /id:\s*"(aff-[^"]+)"/g;
  let m;
  while ((m = re.exec(slice))) ids.push(m[1]);
  return ids;
}

function readCatalogSnapshot() {
  const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const titles = {};
  const descs = {};
  const itemCounts = {};
  const blockRe =
    /id:\s*"(aff-[^"]+)"[\s\S]*?title:\s*"([^"]*)"[\s\S]*?description:\s*"([^"]*)"[\s\S]*?items:\s*\[([\s\S]*?)\]/g;
  let m;
  while ((m = blockRe.exec(catalog))) {
    const id = m[1];
    titles[id] = m[2];
    descs[id] = m[3];
    const itemSlice = m[4];
    const n = (itemSlice.match(/affItem\(/g) || []).length;
    itemCounts[id] = n;
  }
  return {
    titles,
    descs,
    itemCounts,
    disclosure: catalog.includes(DISCLOSURE),
    placeholderFactory: catalog.includes('url: "#affiliate-placeholder-" + slug'),
    readyGate: catalog.includes("affiliateUrlReady === true"),
  };
}

function auditStatic(catIds) {
  const css = fs.readFileSync(path.join(ROOT, "assets", "app.css"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const allow = fs.readFileSync(
    path.join(ROOT, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs"),
    "utf8"
  );
  const snap = readCatalogSnapshot();

  ok("catalog:disclosure_text", snap.disclosure);
  ok("catalog:placeholder_factory", snap.placeholderFactory);
  ok("catalog:ready_gate", snap.readyGate);
  ok("catalog:cat_count_gt0", catIds.length >= 20, "n=" + catIds.length);
  ok("catalog:titles_parsed", Object.keys(snap.titles).length === catIds.length);

  ok("index:intro_wrap", /id="iuAffiliateIntro"/.test(index));
  ok(
    "index:title_inside_intro",
    /id="iuAffiliateIntro"[\s\S]*?id="iuAffiliateTitle"[\s\S]*?<\/div>[\s\S]*?id="iuAffiliateDisclosure"/.test(
      index
    )
  );
  ok(
    "index:subtitle_inside_intro",
    /id="iuAffiliateIntro"[\s\S]*?id="iuAffiliateSubtitle"[\s\S]*?<\/div>[\s\S]*?id="iuAffiliateDisclosure"/.test(
      index
    )
  );
  ok(
    "index:disclosure_after_intro",
    /id="iuAffiliateIntro"[\s\S]*?<\/div>\s*<div class="iuAffiliateDisclosure" id="iuAffiliateDisclosure"/.test(
      index
    )
  );
  ok(
    "index:grid_after_disclosure",
    /id="iuAffiliateDisclosure"[\s\S]*?id="iuAffiliateGrid"/.test(index)
  );
  ok("index:cache_bust", index.includes(APP_CSS_BUST) && /app\.css\?v=/.test(index));
  ok("css:marker", css.includes("affiliate-header-frame-v1-20260918"));
  ok("css:intro_border", /#iuAffiliateView\s+\.iuAffiliateIntro\{[\s\S]{0,400}?border:\s*1px solid/.test(css));
  ok(
    "css:disclosure_no_border",
    /#iuAffiliateView\s+\.iuAffiliateDisclosure\{[\s\S]{0,280}?border:\s*0/.test(css)
  );
  ok(
    "css:disclosure_transparent_bg",
    /#iuAffiliateView\s+\.iuAffiliateDisclosure\{[\s\S]{0,320}?background:\s*transparent/.test(css)
  );
  ok("sw_cache_allowed", swHasAllowedCacheVersion(sw));
  ok("allowlist_token", allow.includes(CACHE_TOKEN));
  ok("sw_token_present", sw.includes(CACHE_TOKEN));
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
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function dismissConsent(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted:v1", "1");
      localStorage.setItem("iu:terms:accepted-version:v1", "2026-09-08-v1");
      localStorage.setItem("iu:terms:accepted-at:v1", new Date().toISOString());
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
    const b = document.getElementById("iuConsentAllowStats");
    if (b) b.click();
    const layer = document.getElementById("iuConsentLayer");
    if (layer) layer.remove();
  });
}

async function openAff(page, baseUrl, section) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=${section}&nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await dismissConsent(page);
  await page
    .waitForFunction(() => typeof window.iuAffiliateApplySection === "function", null, { timeout: 90000 })
    .catch(() => null);
  await page.evaluate((sec) => {
    try {
      if (typeof window.iuAffiliateApplySection === "function") window.iuAffiliateApplySection(sec);
      if (typeof window.iuApplySectionFromURL === "function") window.iuApplySectionFromURL();
    } catch (_) {}
  }, section);
  await page.waitForSelector("#iuAffiliateView", { state: "attached", timeout: 90000 });
  await page.evaluate(() => {
    const v = document.getElementById("iuAffiliateView");
    if (v) {
      v.hidden = false;
      try {
        v.removeAttribute("hidden");
      } catch (_) {}
    }
  });
  await page.waitForFunction(
    () => {
      const title = document.getElementById("iuAffiliateTitle");
      const grid = document.getElementById("iuAffiliateGrid");
      return !!(title && title.textContent && grid);
    },
    null,
    { timeout: 90000 }
  );
  const expectChips = (catalogSnap.itemCounts && catalogSnap.itemCounts[section] > 0) || false;
  if (expectChips) {
    await page.waitForSelector("#iuAffiliateGrid .iuAffiliateChip", { state: "attached", timeout: 90000 });
  }
}

const catIds = readCatalogCategoryIds();
const catalogSnap = readCatalogSnapshot();
auditStatic(catIds);
if (fails.length) {
  const out = { IU_AFFILIATE_HEADER_FRAME_GUARD: "FAIL", phase: "static", fails };
  fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}

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
      fp.endsWith(".css")
        ? "text/css; charset=utf-8"
        : fp.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : fp.endsWith(".html")
            ? "text/html; charset=utf-8"
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
const runtimeSamples = [];
try {
  for (const vp of VIEWPORTS) {
    for (const section of catIds) {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.hasTouch,
      });
      if (vp.pwa) {
        await context.addInitScript(() => {
          try {
            Object.defineProperty(navigator, "standalone", { get: () => true });
          } catch (_) {}
          try {
            const mq = window.matchMedia;
            window.matchMedia = (q) => {
              if (String(q).includes("display-mode: standalone")) {
                return {
                  matches: true,
                  media: q,
                  onchange: null,
                  addListener() {},
                  removeListener() {},
                  addEventListener() {},
                  removeEventListener() {},
                  dispatchEvent() {
                    return false;
                  },
                };
              }
              return mq.call(window, q);
            };
          } catch (_) {}
        });
      }
      const page = await bootstrapGuardPage(context);
      await openAff(page, `http://127.0.0.1:${PORT}/projects/`, section);

      const snap = await page.evaluate((args) => {
        const disclosureExpected = args.disclosure;
        const view = document.getElementById("iuAffiliateView");
        const intro = document.getElementById("iuAffiliateIntro");
        const disc = document.getElementById("iuAffiliateDisclosure");
        const title = document.getElementById("iuAffiliateTitle");
        const sub = document.getElementById("iuAffiliateSubtitle");
        const grid = document.getElementById("iuAffiliateGrid");

        const titleInIntro = !!(intro && title && intro.contains(title));
        const subInIntro = !!(intro && sub && intro.contains(sub));
        const discOutsideIntro = !!(disc && intro && !intro.contains(disc));

        const children = view
          ? Array.from(view.children).map((el) => el.id || el.className || el.tagName)
          : [];
        const orderOk =
          children.indexOf("iuAffiliateIntro") >= 0 &&
          children.indexOf("iuAffiliateDisclosure") === children.indexOf("iuAffiliateIntro") + 1 &&
          children.indexOf("iuAffiliateGrid") > children.indexOf("iuAffiliateDisclosure");

        const introCs = intro ? getComputedStyle(intro) : null;
        const discCs = disc ? getComputedStyle(disc) : null;
        const introBorder =
          introCs &&
          parseFloat(introCs.borderTopWidth || "0") > 0 &&
          introCs.borderTopStyle !== "none" &&
          introCs.borderTopColor !== "rgba(0, 0, 0, 0)" &&
          introCs.borderTopColor !== "transparent";
        const discBorderGone =
          discCs &&
          (parseFloat(discCs.borderTopWidth || "0") === 0 || discCs.borderTopStyle === "none") &&
          (discCs.backgroundColor === "rgba(0, 0, 0, 0)" ||
            discCs.backgroundColor === "transparent" ||
            /^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(discCs.backgroundColor || ""));

        const chips = [...document.querySelectorAll("#iuAffiliateGrid .iuAffiliateChip")].map((a) => ({
          href: a.getAttribute("href") || "",
          ready: a.getAttribute("data-aff-ready") || "",
        }));

        return {
          title: (title ? title.textContent : "").replace(/\s+/g, " ").trim(),
          subtitle: (sub ? sub.textContent : "").replace(/\s+/g, " ").trim(),
          disclosure: (disc ? disc.textContent : "").replace(/\s+/g, " ").trim(),
          titleInIntro,
          subInIntro,
          discOutsideIntro,
          orderOk,
          introBorder: !!introBorder,
          discBorderGone: !!discBorderGone,
          overflow: view ? view.scrollWidth > view.clientWidth + 1 : false,
          chipHrefs: chips.map((c) => c.href),
          chipReady: chips.map((c) => c.ready),
          chipCount: chips.length,
          accent: view ? getComputedStyle(view).getPropertyValue("--iuSectionAccent").trim() : "",
          disclosureOk: (disc ? disc.textContent : "").includes(disclosureExpected),
          gridPresent: !!grid,
        };
      }, { disclosure: DISCLOSURE });

      const tag = vp.name + ":" + section;
      ok(tag + ":title_in_intro", snap.titleInIntro);
      ok(tag + ":sub_in_intro", snap.subInIntro);
      ok(tag + ":disc_outside", snap.discOutsideIntro);
      ok(tag + ":order", snap.orderOk);
      ok(tag + ":intro_border", snap.introBorder);
      ok(tag + ":disc_plain", snap.discBorderGone);
      ok(tag + ":disclosure_text", snap.disclosureOk, snap.disclosure);
      ok(tag + ":no_h_overflow", !snap.overflow);
      ok(tag + ":accent_set", !!snap.accent, snap.accent);
      ok(tag + ":grid", snap.gridPresent && (catalogSnap.itemCounts[section] === 0 ? snap.chipCount === 0 : snap.chipCount >= 1), "chips=" + snap.chipCount);

      const expectedTitle = catalogSnap.titles[section];
      const expectedDesc = catalogSnap.descs[section];
      const expectedCount = catalogSnap.itemCounts[section];
      if (expectedTitle) ok(tag + ":title_text", snap.title === expectedTitle, snap.title);
      if (expectedDesc) ok(tag + ":desc_text", snap.subtitle === expectedDesc, snap.subtitle);
      if (typeof expectedCount === "number") {
        ok(tag + ":chip_count", snap.chipCount === expectedCount, "got=" + snap.chipCount + " exp=" + expectedCount);
      }
      const hrefsPlaceholder =
        snap.chipHrefs.length === 0 ||
        snap.chipHrefs.every((h) => h === "#" || /^#affiliate-placeholder-/.test(h) || /^https:\/\//.test(h));
      ok(tag + ":hrefs_shape", hrefsPlaceholder, snap.chipHrefs.join("|"));
      const noHttpsLeak =
        snap.chipHrefs.length === 0 ||
        snap.chipReady.every((r) => r === "0") ||
        snap.chipHrefs.every((h, i) => (snap.chipReady[i] === "1" ? /^https:\/\//.test(h) : h === "#" || /^#affiliate-placeholder-/.test(h)));
      ok(tag + ":hrefs_ready_gate", noHttpsLeak);

      if (vp.name === "mobile" || section === catIds[0] || section === catIds[Math.floor(catIds.length / 2)]) {
        runtimeSamples.push({
          vp: vp.name,
          section,
          title: snap.title,
          introBorder: snap.introBorder,
          discPlain: snap.discBorderGone,
          orderOk: snap.orderOk,
        });
      }

      await context.close();
    }
  }
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
const out = {
  IU_AFFILIATE_HEADER_FRAME_GUARD: pass ? "PASS" : "FAIL",
  categories: catIds.length,
  viewports: VIEWPORTS.map((v) => v.name),
  samples: runtimeSamples,
  fails,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
