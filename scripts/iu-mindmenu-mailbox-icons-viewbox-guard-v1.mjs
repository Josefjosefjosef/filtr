/**
 * MindMenu mailbox gear + social icons — SVG viewBox must survive TT allowlist.
 * Root cause guard for: HTML DOMParser lowercases viewBox → viewbox; camelCase
 * allowlist keys silently strip it and corrupt icon geometry.
 */
import { createRequire } from "module";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const TT = fs.readFileSync(path.join(ROOT, "assets", "iu-trusted-types-v1.js"), "utf8");
const FEED = fs.readFileSync(path.join(ROOT, "assets", "iu-app-feed-pipeline-v1.js"), "utf8");

const fails = [];

function fail(id) {
  fails.push(id);
}

// Static: allowlist must use lowercase viewbox (HTML attr names are lowercased).
if (!/SVG:\s*\{[\s\S]*?\bviewbox:\s*1/.test(TT)) fail("tt_svg_viewbox_lowercase_missing");
if (/\bviewBox:\s*1/.test(TT) && !/\bviewbox:\s*1/.test(TT)) fail("tt_svg_viewbox_camelcase_only");
if (!/SVG:\s*\{[\s\S]*?"stroke-width":\s*1/.test(TT)) fail("tt_svg_stroke_width_missing");
if (!/SVG:\s*\{[\s\S]*?"stroke-linecap":\s*1/.test(TT)) fail("tt_svg_stroke_linecap_missing");

// Static: MindMenu still emits viewBox on gear + social SVGs in source.
if (!/iu-mailbox-gear-svg[^>]{0,120}viewBox="0 0 24 24"/.test(FEED)) fail("feed_gear_viewbox_source");
if (!/iuMailboxSocialIconSvg[\s\S]{0,400}viewBox=\\"0 0 24 24\\"/.test(FEED)) fail("feed_social_viewbox_source");

function startServer() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><script>${TT}</script></head><body><div id="sink"></div></body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

async function runLive() {
  const { server, url } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const result = await page.evaluate(() => {
      const gear =
        '<button class="iu-mailbox-gear" type="button"><svg class="iu-mailbox-gear-svg" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>';
      const social =
        '<a class="iu-pill-social-slot" data-social="facebook"><span class="iu-pill-social-icon iu-social-ios40"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg></span></a>';
      const el = document.getElementById("sink");
      window.iuTrustedHtml.setInnerHtml(el, "<div class=\"iu-mailbox-row\">" + gear + social + "</div>");
      const g = el.querySelector(".iu-mailbox-gear-svg");
      const s = el.querySelector(".iu-pill-social-icon svg");
      return {
        ready: !!window.__iuTrustedTypesReady,
        gearViewBox: g && (g.getAttribute("viewBox") || g.getAttribute("viewbox")),
        gearStrokeWidth: g && g.getAttribute("stroke-width"),
        socialViewBox: s && (s.getAttribute("viewBox") || s.getAttribute("viewbox")),
        gearHtml: g ? g.outerHTML.slice(0, 220) : null,
        socialHtml: s ? s.outerHTML.slice(0, 220) : null,
      };
    });
    if (!result.ready) fail("tt_not_ready");
    if (result.gearViewBox !== "0 0 24 24") fail("live_gear_viewbox");
    if (result.gearStrokeWidth !== "1.8") fail("live_gear_stroke_width");
    if (result.socialViewBox !== "0 0 24 24") fail("live_social_viewbox");
    console.log(
      "IU_MM_ICONS_VIEWBOX_LIVE=" +
        JSON.stringify({
          gearViewBox: result.gearViewBox,
          gearStrokeWidth: result.gearStrokeWidth,
          socialViewBox: result.socialViewBox,
        })
    );
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

await runLive().catch((e) => {
  fail("live_throw:" + String(e && e.message ? e.message : e));
});

if (fails.length) {
  console.error("IU_MM_ICONS_VIEWBOX_FAIL=" + JSON.stringify(fails));
  process.exit(1);
}
console.log("IU_MM_ICONS_VIEWBOX_PASS=true");
