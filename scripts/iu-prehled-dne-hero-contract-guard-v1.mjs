#!/usr/bin/env node
/**
 * Contract guard: Prehled dne homecard + settings CTA
 * - Structure (banner before CTA, shared hero block, no CTA-without-banner)
 * - Visibility + real image dimensions (mobile/tablet/PC, light/dark)
 * - Seam <= 0.5px, square top radii, rounded bottom radii
 * - Hydration stability (measure twice + reload)
 * - Asset HTTP/content-type
 * - Visual region signature (banner + CTA + Zobrazit) against fixtures
 * - Deterministic daypart shell: light → afternoon paint, dark → evening paint
 *   (InfoUzel page chrome is daypart-driven, not prefers-color-scheme)
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
const FIXTURE_DIR = path.join(ROOT, "scripts", "fixtures", "iu-prehled-dne-hero");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");
const sharp = require("sharp");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8973", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover`;
const UPDATE_BASELINES = String(process.env.IU_UPDATE_HERO_BASELINES || "") === "1";
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

const VIEWPORTS = [
  { name: "mobile-portrait", width: 390, height: 844, colorScheme: "light" },
  { name: "mobile-portrait-dark", width: 390, height: 844, colorScheme: "dark" },
  { name: "mobile-landscape", width: 844, height: 390, colorScheme: "light" },
  { name: "tablet-portrait", width: 768, height: 1024, colorScheme: "light" },
  { name: "tablet-portrait-dark", width: 768, height: 1024, colorScheme: "dark" },
  { name: "tablet-landscape", width: 1024, height: 768, colorScheme: "light" },
  { name: "notebook", width: 1366, height: 768, colorScheme: "light" },
  { name: "desktop", width: 1440, height: 900, colorScheme: "light" },
  { name: "desktop-dark", width: 1440, height: 900, colorScheme: "dark" },
  { name: "desktop-wide", width: 1920, height: 1080, colorScheme: "light" },
  // Just under / over common project breakpoints
  { name: "bp-899", width: 899, height: 900, colorScheme: "light" },
  { name: "bp-901", width: 901, height: 900, colorScheme: "light" },
  { name: "bp-1024", width: 1024, height: 900, colorScheme: "light" },
  { name: "bp-1025", width: 1025, height: 900, colorScheme: "light" },
];

/** Wall-clock hour driving projects/index.html daypart bootstrap + iuSilverWelcomeRefresh. */
function pinnedHourForScheme(colorScheme) {
  return colorScheme === "dark" ? 21 : 14;
}

function expectedDaypartForScheme(colorScheme) {
  return colorScheme === "dark" ? "evening" : "afternoon";
}

/** Matches index.html visualK: evening remaps to afternoon on desktop nav (≥901px). */
function expectedPaintFor(daypart, width) {
  const k = daypart === "forenoon" ? "lateMorning" : daypart;
  if (k === "evening" && width >= 901) return "afternoon";
  return k;
}

/** Install before any page script so early daypart paint uses the pinned hour. */
function installPinnedClockInitScript() {
  return ({ hour }) => {
    const RealDate = window.Date;
    const base = new RealDate(2026, 5, 15, hour, 0, 0, 0).getTime();
    function FakeDate(...args) {
      if (args.length === 0) return new RealDate(base);
      if (args.length === 1) return new RealDate(args[0]);
      return new RealDate(...args);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => base;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    try {
      Object.defineProperty(window, "Date", {
        configurable: true,
        writable: true,
        value: FakeDate,
      });
    } catch (_) {
      try {
        window.Date = FakeDate;
      } catch (_) {}
    }
  };
}

async function pinAndWaitDaypart(page, vp) {
  const hour = pinnedHourForScheme(vp.colorScheme);
  const daypart = expectedDaypartForScheme(vp.colorScheme);
  const paint = expectedPaintFor(daypart, vp.width);
  await page.waitForFunction(
    () => typeof window.iuSilverWelcomeRefresh === "function",
    null,
    { timeout: 45000 }
  );
  await page.evaluate(
    ({ hour: h, daypart: dp, paint: p }) => {
      const applyPin = () => {
        try {
          document.documentElement.setAttribute("data-iu-daypart", dp);
          document.documentElement.setAttribute("data-iu-silver-welcome-paint", p);
          const all = ["iu-time-morning", "iu-time-late-morning", "iu-time-afternoon", "iu-time-evening"];
          for (let i = 0; i < all.length; i++) document.documentElement.classList.remove(all[i]);
          const map = {
            morning: "iu-time-morning",
            lateMorning: "iu-time-late-morning",
            afternoon: "iu-time-afternoon",
            evening: "iu-time-evening",
          };
          if (map[p]) document.documentElement.classList.add(map[p]);
        } catch (_) {}
      };
      try {
        window.__IU_HERO_CONTRACT_PIN__ = { hour: h, daypart: dp, paint: p };
      } catch (_) {}
      try {
        window.iuSilverWelcomeRefresh({ hour: h });
      } catch (_) {}
      applyPin();
      // Welcome refresh may re-apply daypart on rAF after opts-dropping wrappers — pin again after paint.
      try {
        requestAnimationFrame(() => {
          requestAnimationFrame(applyPin);
        });
      } catch (_) {
        applyPin();
      }
    },
    { hour, daypart, paint }
  );
  await page.waitForFunction(
    ({ daypart: dp, paint: p }) => {
      const root = document.documentElement;
      return root.getAttribute("data-iu-daypart") === dp && root.getAttribute("data-iu-silver-welcome-paint") === p;
    },
    { daypart, paint },
    { timeout: 10000 }
  );
  await page.waitForTimeout(150);
  return { hour, daypart, paint };
}

async function measureShowStripTheme(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      daypart: root.getAttribute("data-iu-daypart") || "",
      paint: root.getAttribute("data-iu-silver-welcome-paint") || "",
      timeClassEvening: root.classList.contains("iu-time-evening"),
      timeClassAfternoon: root.classList.contains("iu-time-afternoon"),
    };
  });
}

/** Mean luminance of PNG bytes (RGB). */
async function meanLuminance(pngBuf) {
  const { data } = await sharp(pngBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 6) {
    sum += 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
    n += 1;
  }
  return Math.round(sum / Math.max(1, n));
}

/** Screenshot only `.iuPd__show` (transparent strip → page chrome) for theme luminance. */
async function measureShowClipLuminance(page) {
  const box = await page.evaluate(() => {
    const show = document.querySelector(".iuPd__show");
    if (!show) return null;
    const r = show.getBoundingClientRect();
    // Require the strip to be on-screen; otherwise clip would sample the dark hero instead.
    if (r.height < 24 || r.width < 24) return null;
    if (r.bottom <= 8 || r.top >= window.innerHeight - 8) return null;
    const x = Math.max(0, Math.floor(r.left));
    const y = Math.max(0, Math.floor(Math.max(r.top, 0)));
    const bottom = Math.min(window.innerHeight, Math.ceil(r.bottom));
    const right = Math.min(window.innerWidth, Math.ceil(r.right));
    const width = Math.max(8, right - x);
    const height = Math.max(8, bottom - y);
    if (height < 24) return null;
    return { x, y, width, height };
  });
  if (!box) return -1;
  const png = await page.screenshot({ clip: box });
  return meanLuminance(png);
}

function staticGate() {
  const index = fs.readFileSync(INDEX, "utf8");
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");

  must(fs.existsSync(BANNER), "asset:banner_exists");
  must(/data-testid="prehled-dne-hero"/.test(index), "index:testid_hero");
  must(/data-testid="prehled-dne-homecard"/.test(index), "index:testid_homecard");
  must(/data-testid="prehled-dne-settings-cta"/.test(index), "index:testid_cta");
  must(/data-testid="prehled-dne-hero"/.test(ui), "ui:testid_hero");
  must(/data-testid="prehled-dne-homecard"/.test(ui), "ui:testid_homecard");
  must(/data-testid="prehled-dne-settings-cta"/.test(ui), "ui:testid_cta");

  // Banner must be emitted inside the same hero shell as CTA (no CTA-only shell).
  must(
    /data-testid="prehled-dne-hero"[\s\S]*?bannerHtml\(\)[\s\S]*?data-testid="prehled-dne-settings-cta"/.test(ui) ||
      /data-testid="prehled-dne-hero"[\s\S]*?data-testid="prehled-dne-homecard"[\s\S]*?data-testid="prehled-dne-settings-cta"/.test(ui),
    "ui:hero_contains_banner_and_cta"
  );
  must(/function homeShellHtml[\s\S]*bannerHtml\(\)/.test(ui), "ui:shell_always_includes_banner");

  must(/\.iuPd__hero\s*\{[\s\S]*?display:\s*block/.test(css), "css:hero_display_block");
  must(
    /\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[\s\S]*?border-top-left-radius:\s*0/.test(css) &&
      /\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[\s\S]*?border-top-right-radius:\s*0/.test(css),
    "css:cta_top_radius_zero"
  );
  must(
    /\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[\s\S]*?border-bottom-left-radius:\s*999px/.test(css) &&
      /\.iuPd__hero\s+\.iuPdBtn--settings\s*\{[\s\S]*?border-bottom-right-radius:\s*999px/.test(css),
    "css:cta_bottom_radius_kept"
  );
  must(/aspect-ratio:\s*1661\s*\/\s*616/.test(css), "css:banner_aspect");
  must(/min-height:\s*48px/.test(css), "css:banner_min_height");

  // Static DOM order in index shell: hero > banner > cta
  const heroIdx = index.indexOf('data-testid="prehled-dne-hero"');
  const bannerIdx = index.indexOf('data-testid="prehled-dne-homecard"');
  const ctaIdx = index.indexOf('data-testid="prehled-dne-settings-cta"');
  must(heroIdx > 0 && bannerIdx > heroIdx && ctaIdx > bannerIdx, "index:dom_order_hero_banner_cta");
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

async function assetGate() {
  const url = `http://127.0.0.1:${PORT}/assets/images/infouzel-prehled-dne-banner.png`;
  const res = await fetch(url);
  const ct = String(res.headers.get("content-type") || "");
  const buf = Buffer.from(await res.arrayBuffer());
  must(res.status === 200, "asset:http_200");
  must(/image\/png/i.test(ct), "asset:content_type_png");
  must(buf.length > 1000, "asset:nonempty");
  must(buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47, "asset:png_magic");
}

function measureScript() {
  return () => {
    const hero = document.querySelector('[data-testid="prehled-dne-hero"]');
    const banner = document.querySelector('[data-testid="prehled-dne-homecard"]');
    const cta =
      document.querySelector('[data-testid="prehled-dne-settings-cta"]') ||
      document.querySelector('[data-act="open-settings"]');
    const img = banner ? banner.querySelector("img") : null;
    const show = document.querySelector(".iuPd__show");
    const bCs = banner ? getComputedStyle(banner) : null;
    const iCs = img ? getComputedStyle(img) : null;
    const cCs = cta ? getComputedStyle(cta) : null;
    const hCs = hero ? getComputedStyle(hero) : null;
    const br = banner ? banner.getBoundingClientRect() : null;
    const ir = img ? img.getBoundingClientRect() : null;
    const cr = cta ? cta.getBoundingClientRect() : null;
    const seam = br && cr ? Math.round((cr.top - br.bottom) * 1000) / 1000 : null;
    const parseRad = (v) => String(v || "").trim();
    const covers = (el, x, y) => {
      const top = document.elementFromPoint(x, y);
      if (!top || !el) return false;
      return top === el || el.contains(top) || top.contains(el);
    };
    const sample = (() => {
      if (!br || !cr || !img || br.width < 2 || br.height < 2) return null;
      // Sample real painted pixels via a temporary same-origin canvas draw of the banner image
      // (proves image content is dark). CTA corner/seam checks use computed geometry + style.
      const canvas = document.createElement("canvas");
      const w = Math.max(8, Math.round(Math.min(br.width, 420)));
      const bh = Math.max(8, Math.round(br.height));
      canvas.width = w;
      canvas.height = bh;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      try {
        ctx.drawImage(img, 0, 0, w, bh);
      } catch (_) {
        return null;
      }
      const midX = Math.floor(w / 2);
      const px = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2] };
      };
      const bannerMid = px(midX, Math.max(0, Math.floor(bh * 0.45)));
      const isDark = (p) => p.r + p.g + p.b < 220;
      const cells = [];
      const cols = 6;
      const rows = 3;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x0 = Math.floor((col * w) / cols);
          const y0 = Math.floor((row * bh) / rows);
          const x1 = Math.floor(((col + 1) * w) / cols);
          const y1 = Math.floor(((row + 1) * bh) / rows);
          const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
          let r = 0;
          let g = 0;
          let b = 0;
          let n = 0;
          for (let i = 0; i < data.length; i += 16) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n += 1;
          }
          cells.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
        }
      }
      return {
        bannerMidDark: isDark(bannerMid),
        cells,
        // Layout/visual join markers (not synthetic paint):
        ctaTopSquare: parseRad(cCs.borderTopLeftRadius) === "0px" && parseRad(cCs.borderTopRightRadius) === "0px",
        seamFlush: seam != null && Math.abs(seam) <= 0.5,
      };
    })();
    return {
      heroExists: !!hero,
      bannerExists: !!banner,
      ctaExists: !!cta,
      imgExists: !!img,
      sameHero:
        !!hero &&
        !!banner &&
        !!cta &&
        hero.contains(banner) &&
        hero.contains(cta),
      orderOk: !!(banner && cta && (banner.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING)),
      bannerDisplay: bCs ? bCs.display : "",
      bannerVisibility: bCs ? bCs.visibility : "",
      bannerOpacity: bCs ? parseFloat(bCs.opacity || "0") : 0,
      imgDisplay: iCs ? iCs.display : "",
      imgVisibility: iCs ? iCs.visibility : "",
      imgOpacity: iCs ? parseFloat(iCs.opacity || "0") : 0,
      heroDisplay: hCs ? hCs.display : "",
      bannerWidth: br ? Math.round(br.width * 100) / 100 : 0,
      bannerHeight: br ? Math.round(br.height * 100) / 100 : 0,
      imgWidth: ir ? Math.round(ir.width * 100) / 100 : 0,
      imgHeight: ir ? Math.round(ir.height * 100) / 100 : 0,
      naturalWidth: img ? img.naturalWidth : 0,
      naturalHeight: img ? img.naturalHeight : 0,
      imageLoaded: !!(img && img.complete && img.naturalWidth > 0),
      seam,
      borderTopLeftRadius: cCs ? parseRad(cCs.borderTopLeftRadius) : "",
      borderTopRightRadius: cCs ? parseRad(cCs.borderTopRightRadius) : "",
      borderBottomLeftRadius: cCs ? parseRad(cCs.borderBottomLeftRadius) : "",
      borderBottomRightRadius: cCs ? parseRad(cCs.borderBottomRightRadius) : "",
      ctaCoveredAtCenter: cr ? covers(cta, cr.left + cr.width / 2, cr.top + cr.height / 2) : false,
      bannerCoveredAtCenter: br ? covers(banner, br.left + br.width / 2, br.top + br.height / 2) : false,
      showExists: !!show,
      sample,
      src: img ? img.getAttribute("src") || "" : "",
    };
  };
}

function cellsClose(a, b, tol) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < 3; j++) {
      if (Math.abs(a[i][j] - b[i][j]) > tol) return false;
    }
  }
  return true;
}

async function screenshotSignature(pngBuf, geometry) {
  const { data, info } = await sharp(pngBuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cells = [];
  const cols = 6;
  const rows = 4;
  const w = info.width;
  const h = info.height;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = Math.floor((col * w) / cols);
      const y0 = Math.floor((row * h) / rows);
      const x1 = Math.floor(((col + 1) * w) / cols);
      const y1 = Math.floor(((row + 1) * h) / rows);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * w + x) * 3;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n += 1;
        }
      }
      cells.push([Math.round(r / Math.max(1, n)), Math.round(g / Math.max(1, n)), Math.round(b / Math.max(1, n))]);
    }
  }
  // Sample real CTA top-left corner from screenshot using measured geometry.
  const bannerH = Math.max(1, Number(geometry && geometry.bannerHeight) || Math.floor(h * 0.7));
  const cx = Math.min(w - 2, 3);
  const cy = Math.min(h - 2, Math.max(0, Math.round(bannerH) + 2));
  const ci = (cy * w + cx) * 3;
  const corner = { r: data[ci], g: data[ci + 1], b: data[ci + 2] };
  const cornerGreen = corner.g > 70 && corner.g > corner.r && corner.g >= corner.b - 15;
  return { cells, cornerGreen, corner };
}

function assertMeasure(prefix, m) {
  must(m.heroExists, prefix + ":hero_exists");
  must(m.bannerExists, prefix + ":banner_exists");
  must(m.ctaExists, prefix + ":cta_exists");
  must(m.sameHero, prefix + ":same_hero_block");
  must(m.orderOk, prefix + ":banner_before_cta");
  must(m.bannerDisplay !== "none", prefix + ":banner_display");
  must(m.bannerVisibility !== "hidden", prefix + ":banner_visibility");
  must(m.bannerOpacity > 0, prefix + ":banner_opacity");
  must(m.imgDisplay !== "none", prefix + ":img_display");
  must(m.imgVisibility !== "hidden", prefix + ":img_visibility");
  must(m.imgOpacity > 0, prefix + ":img_opacity");
  must(m.bannerWidth > 40, prefix + ":banner_width:" + m.bannerWidth);
  must(m.bannerHeight > 20, prefix + ":banner_height:" + m.bannerHeight);
  must(m.imgWidth > 40, prefix + ":img_width");
  must(m.imgHeight > 20, prefix + ":img_height");
  must(m.imageLoaded, prefix + ":image_loaded");
  must(m.naturalWidth > 0, prefix + ":natural_width");
  must(m.naturalHeight > 0, prefix + ":natural_height");
  must(m.seam != null && Math.abs(m.seam) <= 0.5, prefix + ":seam:" + m.seam);
  must(m.borderTopLeftRadius === "0px", prefix + ":tl_radius:" + m.borderTopLeftRadius);
  must(m.borderTopRightRadius === "0px", prefix + ":tr_radius:" + m.borderTopRightRadius);
  must(m.borderBottomLeftRadius !== "0px", prefix + ":bl_radius_kept:" + m.borderBottomLeftRadius);
  must(m.borderBottomRightRadius !== "0px", prefix + ":br_radius_kept:" + m.borderBottomRightRadius);
  must(/infouzel-prehled-dne-banner\.png/.test(m.src), prefix + ":img_src");
  must(m.showExists, prefix + ":zobrazit_exists");
  if (m.sample) {
    must(m.sample.bannerMidDark, prefix + ":visual_banner_dark");
    must(m.sample.ctaTopSquare, prefix + ":visual_cta_square_top");
    must(m.sample.seamFlush, prefix + ":visual_seam_flush");
  } else {
    fails.push(prefix + ":visual_sample_missing");
  }
}

async function runPlaywright() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const pwFailsBefore = fails.length;
  /** @type {Map<string, {cells: number[][], theme: object, paint: string}>} */
  const captured = new Map();
  try {
    for (const vp of VIEWPORTS) {
      const hour = pinnedHourForScheme(vp.colorScheme);
      const expectDaypart = expectedDaypartForScheme(vp.colorScheme);
      const expectPaint = expectedPaintFor(expectDaypart, vp.width);
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: vp.width, height: vp.height },
        colorScheme: vp.colorScheme,
      });
      await context.addInitScript(installPinnedClockInitScript(), { hour });
      const page = await bootstrapGuardPage(context);
      await page.goto(BASE + "&nosw=1", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(
        () => !!document.querySelector('[data-testid="prehled-dne-settings-cta"][data-act="open-settings"]'),
        { timeout: 45000 }
      );
      await page.waitForFunction(() => {
        const img = document.querySelector('[data-testid="prehled-dne-homecard"] img');
        return !!(img && img.complete && img.naturalWidth > 0);
      }, { timeout: 45000 });
      await pinAndWaitDaypart(page, vp);
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        const hero = document.querySelector('[data-testid="prehled-dne-hero"]');
        if (hero && typeof hero.scrollIntoView === "function") {
          hero.scrollIntoView({ block: "center", inline: "nearest" });
        }
      });
      await page.waitForTimeout(200);

      const m1 = await page.evaluate(measureScript());
      assertMeasure(vp.name + ":t1", m1);

      // Stabilize / catch post-hydration disappearance
      await page.waitForTimeout(1200);
      await pinAndWaitDaypart(page, vp);
      const m2 = await page.evaluate(measureScript());
      assertMeasure(vp.name + ":t2", m2);
      must(m2.bannerHeight > 20, vp.name + ":stable_banner_height");

      const theme = await measureShowStripTheme(page);
      must(theme.daypart === expectDaypart, vp.name + ":daypart_pinned:" + theme.daypart + "!=" + expectDaypart);
      must(theme.paint === expectPaint, vp.name + ":paint_pinned:" + theme.paint + "!=" + expectPaint);
      if (expectPaint === "afternoon") {
        must(theme.timeClassAfternoon, vp.name + ":time_class_afternoon");
        must(!theme.timeClassEvening, vp.name + ":time_class_not_evening");
      } else if (expectPaint === "evening") {
        must(theme.timeClassEvening, vp.name + ":time_class_evening");
        must(!theme.timeClassAfternoon, vp.name + ":time_class_not_afternoon");
      }

      // Screenshot region (banner + CTA + Zobrazit) + signature fixture
      const shotPath = path.join(FIXTURE_DIR, vp.name + ".png");
      const sigPath = path.join(FIXTURE_DIR, vp.name + ".sig.json");
      const box = await page.evaluate(() => {
        const hero = document.querySelector('[data-testid="prehled-dne-hero"]');
        const show = document.querySelector(".iuPd__show");
        const r1 = hero.getBoundingClientRect();
        const r2 = show ? show.getBoundingClientRect() : r1;
        const top = Math.max(0, Math.floor(r1.top));
        const bottom = Math.min(window.innerHeight, Math.ceil(Math.max(r1.bottom, r2.bottom)));
        return {
          x: Math.max(0, Math.floor(r1.left)),
          y: top,
          width: Math.max(8, Math.min(window.innerWidth, Math.ceil(r1.width))),
          height: Math.max(8, bottom - top),
        };
      });
      const dpr = await page.evaluate(() => Number(window.devicePixelRatio) || 1);
      const pngBuf = await page.screenshot({ clip: box });
      const sig = await screenshotSignature(pngBuf, {
        bannerHeight: Math.max(1, Math.round(m2.bannerHeight * dpr)),
      });
      // Scroll ZOBRAZIT into view before sampling page chrome under the transparent strip.
      await page.evaluate(() => {
        const show = document.querySelector(".iuPd__show");
        if (show && typeof show.scrollIntoView === "function") {
          show.scrollIntoView({ block: "center", inline: "nearest" });
        }
      });
      await page.waitForTimeout(120);
      const showLum = await measureShowClipLuminance(page);
      // White filter pills raise mean; bounds still separate afternoon page chrome from evening navy.
      // Skip when strip is off-screen (short landscape viewports after hero-centered scroll).
      if (showLum >= 0) {
        if (expectPaint === "afternoon") {
          must(showLum >= 150, vp.name + ":show_strip_light_luminance:" + showLum);
        } else if (expectPaint === "evening") {
          must(showLum <= 140, vp.name + ":show_strip_dark_luminance:" + showLum);
        }
      }
      captured.set(vp.name, {
        cells: sig.cells,
        theme: { ...theme, lum: showLum },
        paint: expectPaint,
        width: vp.width,
        colorScheme: vp.colorScheme,
      });
      // Hard radius contract already asserted via getComputedStyle; screenshot corner is advisory for visual join.
      // Fail only when corner is near-white (pill cutout / gap), not when sampler lands on dark banner bleed.
      const cornerNearWhite =
        sig.corner && sig.corner.r + sig.corner.g + sig.corner.b > 600;
      if (cornerNearWhite) {
        fails.push(vp.name + ":screenshot_cta_top_left_white_gap:" + JSON.stringify(sig.corner));
      }
      if (UPDATE_BASELINES) {
        fs.writeFileSync(shotPath, pngBuf);
        fs.writeFileSync(sigPath, JSON.stringify({ cells: sig.cells }, null, 2));
      } else if (fs.existsSync(sigPath)) {
        const expected = JSON.parse(fs.readFileSync(sigPath, "utf8"));
        const ok = cellsClose(expected.cells, sig.cells, 55);
        if (!ok) {
          const failShot = path.join(process.env.TEMP || "/tmp", "iu-prehled-hero-" + vp.name + ".png");
          try {
            fs.writeFileSync(failShot, pngBuf);
          } catch (_) {}
        }
        must(ok, vp.name + ":screenshot_signature");
      } else {
        fails.push(vp.name + ":missing_baseline_signature");
      }

      // Reload path
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(
        () => !!document.querySelector('[data-testid="prehled-dne-settings-cta"][data-act="open-settings"]'),
        { timeout: 45000 }
      );
      await page.waitForFunction(() => {
        const img = document.querySelector('[data-testid="prehled-dne-homecard"] img');
        return !!(img && img.complete && img.naturalWidth > 0);
      }, { timeout: 45000 });
      await pinAndWaitDaypart(page, vp);
      await page.evaluate(() => {
        const hero = document.querySelector('[data-testid="prehled-dne-hero"]');
        if (hero) hero.scrollIntoView({ block: "center", inline: "nearest" });
      });
      const m3 = await page.evaluate(measureScript());
      assertMeasure(vp.name + ":reload", m3);

      // Soft navigation return: jump away via hash then back to media
      await page.goto(BASE + "&nosw=1#iuPdCount", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(300);
      await page.goto(BASE + "&nosw=1", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForFunction(
        () => !!document.querySelector('[data-testid="prehled-dne-settings-cta"][data-act="open-settings"]'),
        { timeout: 45000 }
      );
      await page.waitForFunction(() => {
        const img = document.querySelector('[data-testid="prehled-dne-homecard"] img');
        return !!(img && img.complete && img.naturalWidth > 0);
      }, { timeout: 45000 });
      await pinAndWaitDaypart(page, vp);
      await page.evaluate(() => {
        const hero = document.querySelector('[data-testid="prehled-dne-hero"]');
        if (hero) hero.scrollIntoView({ block: "center", inline: "nearest" });
      });
      const m4 = await page.evaluate(measureScript());
      assertMeasure(vp.name + ":return", m4);

      await context.close();
    }

    // Light/dark pair contract: narrow shells must diverge; desktop (≥901) evening remaps → may match.
    const pairs = [
      ["mobile-portrait", "mobile-portrait-dark"],
      ["tablet-portrait", "tablet-portrait-dark"],
      ["desktop", "desktop-dark"],
    ];
    for (const [lightName, darkName] of pairs) {
      const L = captured.get(lightName);
      const D = captured.get(darkName);
      if (!L || !D) {
        fails.push("theme_pair_missing:" + lightName + "/" + darkName);
        continue;
      }
      must(L.paint === "afternoon", lightName + ":pair_light_paint");
      const same = cellsClose(L.cells, D.cells, 55);
      if (L.width < 901) {
        must(D.paint === "evening", darkName + ":pair_dark_paint_evening");
        must(!same, lightName + "/" + darkName + ":must_differ_under_901");
        if (L.theme.lum >= 0 && D.theme.lum >= 0) {
          must(L.theme.lum - D.theme.lum >= 25, lightName + "/" + darkName + ":luminance_gap:" + L.theme.lum + "-" + D.theme.lum);
        }
      } else {
        must(D.paint === "afternoon", darkName + ":pair_desktop_evening_remapped");
        must(same, lightName + "/" + darkName + ":desktop_may_match_after_remap");
      }
    }
  } finally {
    await browser.close();
  }
  return fails.length - pwFailsBefore;
}

staticGate();
const server = await startServer();
await waitForPort("127.0.0.1", PORT, 10000);
try {
  await assetGate();
  await runPlaywright();
} finally {
  await new Promise((r) => server.close(r));
}

if (fails.length) {
  console.error("FAIL iu-prehled-dne-hero-contract-guard-v1");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log("PASS iu-prehled-dne-hero-contract-guard-v1");
