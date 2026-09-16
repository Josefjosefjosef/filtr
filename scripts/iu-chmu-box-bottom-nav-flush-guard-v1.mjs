#!/usr/bin/env node
/**
 * Freeze guard: home Výstrahy ČHMÚ white-box bottom flush to fixed bottom nav
 * (mobile / tablet / PWA). Geometry contract — not screenshot soft-match.
 *
 * At scroll-end for dynamic card counts (1 / 2 / 10) and after live filter
 * toggle without reload:
 *   |box.bottom − nav.top| ≤ GAP_MAX_PX
 *   last card not under nav
 *   natural inner pad (last card → box bottom) preserved (≥ INNER_PAD_MIN)
 *
 * Run: npm run iu-chmu-box-bottom-nav-flush-guard
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

const APP_CSS = path.join(REPO, "assets", "app.css");
const INDEX = path.join(REPO, "projects", "index.html");
const SW = path.join(REPO, "sw.js");
const ALLOW = path.join(REPO, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs");
const REPORT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_chmu_box_bottom_nav_flush_guard.json");
const CACHE_TOKEN = "2026-09-16-chmu-box-nav-flush-v1";
const APP_CSS_BUST = "chmu-box-nav-flush-v1-20260916";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8841", 10);
const GAP_MAX_PX = 2;
const INNER_PAD_MIN = 8;
const OVERLAP_TOL = 1;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

const VIEWPORTS = [
  { id: "mobile", width: 390, height: 844, isMobile: true, pwa: false },
  { id: "tablet", width: 820, height: 1180, isMobile: false, pwa: false },
  { id: "pwa", width: 390, height: 844, isMobile: true, pwa: true },
];

function staticGate() {
  const css = fs.readFileSync(APP_CSS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  const sw = fs.readFileSync(SW, "utf8");
  const allow = fs.readFileSync(ALLOW, "utf8");
  const fails = [];
  const ok = (id, cond) => {
    if (!cond) fails.push(id);
  };

  ok("cache_bust_index_app_css", index.includes(APP_CSS_BUST) && /app\.css\?v=/.test(index));
  ok("sw_cache_token", sw.includes(CACHE_TOKEN));
  ok("allowlist_token", allow.includes(CACHE_TOKEN));
  const gatePadBlock = css.match(
    /body:not\(\.iu-mobileMainVisible\):not\(\.iu-mobileGateOverlayOpen\)\s+#iuMobileGateWrap\s*\{[^}]*\}/
  );
  const gatePadCss = gatePadBlock ? gatePadBlock[0] : "";
  ok("gate_pad_uses_bottom_nav_height", /--bottom-nav-height/.test(gatePadCss));
  ok("gate_pad_not_safe_space_plus40", !/--iu-mobile-bottom-nav-safe-space/.test(gatePadCss));
  ok(
    "silver_slot_mb_zero_home",
    /body:not\(\.iu-mobileMainVisible\):not\(\.iu-mobileGateOverlayOpen\)\s+#iuMobileGateWrap\s+#iuMobileSilverSlot\s+\.silver-slot\s*\{[^}]*margin-bottom:\s*0\s*!important/.test(
      css
    )
  );
  ok(
    "tall_section_pb_zero_home",
    /body:not\(\.iu-mobileMainVisible\):not\(\.iu-mobileGateOverlayOpen\)\s+#iuMobileGateWrap\s+\.iuSilverTallScrollSection\s*\{[^}]*padding-bottom:\s*0\s*!important/.test(
      css
    ) ||
      /body:not\(\.iu-mobileMainVisible\):not\(\.iu-mobileGateOverlayOpen\)\s+\.iuSilverTallScrollSection\s*\{[^}]*padding-bottom:\s*0\s*!important/.test(
        css
      )
  );
  ok("scoped_max_900", /@media\s*\(max-width:\s*900px\)/.test(css));
  return { pass: fails.length === 0, fails };
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((reqIn, res) => {
      try {
        let p = decodeURIComponent(new URL(reqIn.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const fp = path.join(REPO, p.replace(/^\/+/, ""));
        if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404);
          res.end("nf");
          return;
        }
        res.writeHead(200, { "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function ensureChmu(page) {
  await page.evaluate(() => {
    const btn = document.querySelector("[data-iu-pd-quick-switcher='1']");
    if (btn && btn.getAttribute("data-iu-pd-quick-active") !== "chmu") btn.click();
  });
  await page.waitForTimeout(900);
}

async function waitForCards(page, min = 1) {
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.querySelectorAll("#iuPrehledDneRoot .iuPdCard.iuPrehledDne__item").length);
    if (n >= min) return n;
    await page.waitForTimeout(250);
  }
  return 0;
}

async function setCardCount(page, n) {
  await page.evaluate((keep) => {
    const feed = document.querySelector("#iuPrehledDneTimeline") || document.querySelector("#iuPrehledDneRoot .iuPdFeed");
    if (!feed) return;
    let cards = [...feed.querySelectorAll(".iuPdCard.iuPrehledDne__item")];
    if (cards.length === 0) return;
    const proto = cards[0];
    while (cards.length < keep) {
      const clone = proto.cloneNode(true);
      clone.setAttribute("data-iu-flush-guard-clone", "1");
      const title = clone.querySelector(".iuPdCard__title, .iuPrehledDne__cardTitle");
      if (title) title.textContent = "Guard clone " + cards.length;
      feed.appendChild(clone);
      cards = [...feed.querySelectorAll(".iuPdCard.iuPrehledDne__item")];
    }
    cards.forEach((c, i) => {
      if (i >= keep) c.remove();
    });
  }, n);
  await page.waitForTimeout(120);
}

async function measure(page) {
  return page.evaluate(() => {
    window.scrollTo(0, 1e9);
    const nav = document.getElementById("iuMobileBottomNav");
    const root = document.getElementById("iuPrehledDneRoot");
    const box =
      document.querySelector("#iuSilverTallScrollViewport .iuSilverStackChromaFrame, #iuSilverTallScrollViewport .iuSilverTallScrollChromaFrame") ||
      document.querySelector(".iuSilverTallScrollChromaFrame") ||
      root;
    const cards = [...document.querySelectorAll("#iuPrehledDneRoot .iuPdCard.iuPrehledDne__item")];
    const last = cards[cards.length - 1] || null;
    if (!nav || !box || !last) {
      return { ok: false, reason: "missing_nodes", cardCount: cards.length };
    }
    const navR = nav.getBoundingClientRect();
    const boxR = box.getBoundingClientRect();
    const lastR = last.getBoundingClientRect();
    const gapBoxToNav = navR.top - boxR.bottom;
    const innerPad = boxR.bottom - lastR.bottom;
    const underNav = lastR.bottom > navR.top + 1;
    const gate = document.getElementById("iuMobileGateWrap");
    const gatePad = gate ? parseFloat(getComputedStyle(gate).paddingBottom) || 0 : 0;
    const rootCs = getComputedStyle(document.documentElement);
    return {
      ok: true,
      cardCount: cards.length,
      quickActive: document.querySelector("[data-iu-pd-quick-switcher='1']")?.getAttribute("data-iu-pd-quick-active") || null,
      gapBoxToNav: Number(gapBoxToNav.toFixed(2)),
      innerPad: Number(innerPad.toFixed(2)),
      underNav,
      navH: Number(navR.height.toFixed(2)),
      gatePad: Number(gatePad.toFixed(2)),
      bottomNavVar: rootCs.getPropertyValue("--bottom-nav-height").trim(),
      safeSpaceVar: rootCs.getPropertyValue("--iu-mobile-bottom-nav-safe-space").trim(),
    };
  });
}

function verdict(m, tag) {
  const fails = [];
  if (!m || !m.ok) {
    fails.push(tag + ":missing");
    return fails;
  }
  if (Math.abs(m.gapBoxToNav) > GAP_MAX_PX) fails.push(tag + ":gap_" + m.gapBoxToNav);
  if (m.underNav) fails.push(tag + ":under_nav");
  if (!(m.innerPad >= INNER_PAD_MIN)) fails.push(tag + ":inner_pad_" + m.innerPad);
  if (!(m.cardCount > 0)) fails.push(tag + ":no_cards");
  return fails;
}

(async () => {
  const staticResult = staticGate();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  const fails = [...staticResult.fails];

  try {
    for (const vp of VIEWPORTS) {
      const ctxOpts = {
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: true,
        userAgent: vp.isMobile
          ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
          : undefined,
      };
      if (vp.pwa) {
        ctxOpts.userAgent =
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
      }
      const context = await bootstrapGuardContext(browser, ctxOpts);
      if (vp.pwa) {
        await context.addInitScript(() => {
          try {
            Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
          } catch (_) {}
          try {
            const orig = window.matchMedia.bind(window);
            window.matchMedia = (q) => {
              if (String(q).includes("display-mode") && String(q).includes("standalone")) {
                return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } };
              }
              return orig(q);
            };
          } catch (_) {}
        });
      }
      const page = await context.newPage();
      await page.goto("http://127.0.0.1:" + PORT + "/projects/", { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(4000);
      await ensureChmu(page);
      await waitForCards(page, 1);

      for (const n of [1, 2, 10]) {
        await setCardCount(page, n);
        await page.evaluate(() => window.scrollTo(0, 1e9));
        await page.waitForTimeout(200);
        const m = await measure(page);
        const tag = vp.id + "_n" + n;
        const f = verdict(m, tag);
        fails.push(...f);
        results.push({ tag, ...m, fails: f });
      }

      // Live filter toggle without reload: chmu → traffic → chmu, re-measure
      await page.evaluate(() => {
        const btn = document.querySelector("[data-iu-pd-quick-switcher='1']");
        if (btn) btn.click();
      });
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        const btn = document.querySelector("[data-iu-pd-quick-switcher='1']");
        if (btn) btn.click();
      });
      await page.waitForTimeout(1000);
      await ensureChmu(page);
      await waitForCards(page, 1);
      await setCardCount(page, 2);
      await page.evaluate(() => window.scrollTo(0, 1e9));
      await page.waitForTimeout(200);
      const live = await measure(page);
      const liveTag = vp.id + "_live_filter";
      const liveFails = verdict(live, liveTag);
      fails.push(...liveFails);
      results.push({ tag: liveTag, ...live, fails: liveFails });

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const report = {
    gapMaxPx: GAP_MAX_PX,
    innerPadMin: INNER_PAD_MIN,
    static: staticResult,
    results,
    fails,
    pass: fails.length === 0,
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(REPORT);
  console.log("PASS=" + report.pass + " fails=" + JSON.stringify(fails));
  process.exit(report.pass ? 0 : 1);
})().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
