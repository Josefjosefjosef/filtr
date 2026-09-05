#!/usr/bin/env node
/**
 * Guard: ČHMÚ map + timeline dot must be Počasí blue (#0EA5E9) on first paint —
 * without waiting for taxonomy shell or any user interaction (anti purple→blue flash).
 *
 * Root cause (2026-09): CHMI-first lane paint ran before taxonomy; sectionColor()
 * fell back to brand purple #5B6CFF. Shell merge did not re-paint → purple stuck
 * until section/filter interaction.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  installSmokeHeavyDataRouteStubs,
} from "./smoke-heavy-data-stubs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const uiPath = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const cssPath = path.join(ROOT, "assets", "iu-prehled-dne-v1.css");
const ui = fs.readFileSync(uiPath, "utf8");
const css = fs.readFileSync(cssPath, "utf8");

ok(
  "has_section_color_fallback",
  /SECTION_COLOR_FALLBACK\s*=\s*Object\.freeze\(/.test(ui),
  "missing fallback map"
);
ok(
  "pocasi_fallback_sky_blue",
  /pocasi:\s*"#0EA5E9"/.test(ui),
  "pocasi must be #0EA5E9"
);
ok(
  "card_accent_helper",
  /function cardAccentColor\(ev\)/.test(ui),
  "cardAccentColor"
);
ok(
  "render_uses_card_accent",
  /safeCssColor\(cardAccentColor\(ev\)\)/.test(ui),
  "renderItem must use cardAccentColor"
);
ok(
  "no_early_paint_purple_only",
  !/function sectionColor\(sectionId\)\s*\{[^}]*return \(sec && sec\.color\) \|\| "#5B6CFF"/.test(ui),
  "old taxonomy-only purple fallback still present"
);
ok(
  "cap_uses_pocasi_when_missing_section",
  /capV2[\s\S]{0,160}sectionColor\(ev\.sectionId \|\| "pocasi"\)/.test(ui) ||
    /isChmiFeedEvent\(ev\)[\s\S]{0,160}sectionColor\(ev\.sectionId \|\| "pocasi"\)/.test(ui),
  "CHMI must default sectionId to pocasi"
);
ok(
  "css_chmu_quick_accent_blue",
  /\.iuPrehledDne\[data-iu-pd-quick-view="chmu"\][\s\S]{0,120}--iu-pd-accent:\s*#0ea5e9/i.test(css),
  "chmu quick-view CSS accent"
);
ok(
  "sets_quick_view_attr",
  /setAttribute\("data-iu-pd-quick-view"/.test(ui),
  "data-iu-pd-quick-view"
);

const POCASI_BLUE = { r: 14, g: 165, b: 233 }; // #0EA5E9
const PURPLE = { r: 91, g: 108, b: 255 }; // #5B6CFF

function parseRgb(s) {
  const m = String(s || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3] };
}

function dist(a, b) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function isBlueNotPurple(rgb) {
  if (!rgb) return false;
  return dist(rgb, POCASI_BLUE) <= 48 && dist(rgb, PURPLE) >= 80;
}

function contentType(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".webp")) return "image/webp";
  if (p.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function startStatic() {
  const root = ROOT;
  const server = http.createServer((req, res) => {
    try {
      let u = decodeURIComponent((req.url || "/").split("?")[0]);
      if (u === "/") u = "/projects/index.html";
      const fp = path.join(root, u.replace(/^\//, "").replace(/\//g, path.sep));
      if (!fp.startsWith(root) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(fp), "Cache-Control": "no-store" });
      fs.createReadStream(fp).pipe(res);
    } catch {
      res.writeHead(500);
      res.end("err");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  return { server, origin: "http://127.0.0.1:" + port };
}

async function runtimeColdLoad() {
  const { server, origin } = await startStatic();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    await installSmokeHeavyDataRouteStubs(page);
    // Delay taxonomy so first paint cannot rely on shell colors.
    await page.route("**/taxonomy.json**", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await page.goto(origin + "/projects/index.html", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    // Do NOT click ČHMÚ — default feedQuickView is already chmu.
    await page.waitForSelector(
      ".iuPrehledDne__item[style*='--iu-pd-dot'], .iuPdCard[style*='--iu-pd-dot']",
      { timeout: 45000 }
    );
    // Sample before taxonomy delay ends (still within first-paint window).
    const sample = await page.evaluate(() => {
      const card =
        document.querySelector(".iuPrehledDne__item[style*='--iu-pd-dot']") ||
        document.querySelector(".iuPdCard[style*='--iu-pd-dot']");
      if (!card) return null;
      const dot = card.querySelector(".iuPrehledDne__dot");
      const map = card.querySelector(".iuPrehledDne__czMap, .iuPdCard__czMap");
      const csDot = dot ? getComputedStyle(dot) : null;
      const csMap = map ? getComputedStyle(map) : null;
      const root = document.querySelector(".iuPrehledDne") || document.querySelector("[data-iu-pd-root]");
      return {
        inline: card.getAttribute("style") || "",
        dotBg: csDot ? csDot.backgroundColor : "",
        mapColor: csMap ? csMap.color : "",
        quickAttr: root ? root.getAttribute("data-iu-pd-quick-view") : null,
        feedReady: root ? root.getAttribute("data-iu-pd-feed-ready") : null,
      };
    });
    ok("runtime_card_present", !!sample, "no card");
    if (sample) {
      ok(
        "runtime_inline_not_purple",
        !/#5[Bb]6[Cc][Ff]{2}/i.test(sample.inline) && /#0[Ee][Aa]5[Ee]9/i.test(sample.inline),
        sample.inline
      );
      const dotRgb = parseRgb(sample.dotBg);
      ok("runtime_dot_blue", isBlueNotPurple(dotRgb), String(sample.dotBg));
      if (sample.mapColor && sample.mapColor !== "rgba(0, 0, 0, 0)") {
        const mapRgb = parseRgb(sample.mapColor);
        ok("runtime_map_blue", isBlueNotPurple(mapRgb), String(sample.mapColor));
      }
      ok(
        "runtime_quick_attr_chmu",
        sample.quickAttr === "chmu" || sample.quickAttr == null,
        String(sample.quickAttr)
      );
    }
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
}

await runtimeColdLoad().catch((e) => {
  fails.push("runtime_exception:" + (e && e.message ? e.message : String(e)));
});

const report = {
  CHMI_FIRST_PAINT_ACCENT_BLUE: fails.length ? "FAIL" : "PASS",
  failCount: fails.length,
  fails,
  REAL_IOS: "NOT_TESTED",
};
console.log(JSON.stringify(report));
if (fails.length) {
  console.error("IU_CHMI_FIRST_PAINT_ACCENT_BLUE_GUARD=FAIL");
  process.exit(1);
}
console.log("IU_CHMI_FIRST_PAINT_ACCENT_BLUE_GUARD=PASS");
