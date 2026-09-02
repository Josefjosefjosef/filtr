/**
 * Prehled dne CZ map — TT sprite injection must keep <symbol viewBox>.
 *
 * Root cause (XSS-TT-01): HTML DOMParser lowercases viewBox → viewbox.
 * CamelCase allowlist keys silently strip it from <symbol id="iu-cz-map">.
 * ensureCzMapSprite() sets holder.innerHTML = svgText through patched TT sinks,
 * so Doprava + ČHMÚ <use href="#iu-cz-map"> then paint a cropped/oversized path.
 *
 * Existing iu-chmi-card-cz-map-guard injects the sprite as raw HTML in the fixture
 * (bypasses TT) — this guard closes that gap.
 */
import { createRequire } from "module";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const TT = fs.readFileSync(path.join(ROOT, "assets", "iu-trusted-types-v1.js"), "utf8");
const MAP = fs.readFileSync(path.join(ROOT, "assets", "icons", "iu-cz-map.svg"), "utf8");
const UI = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const CSS = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-v1.css"), "utf8");

const fails = [];
function fail(id) {
  fails.push(id);
}

// --- Static contract ---
if (!/SYMBOL:\s*\{[^}]*\bviewbox:\s*1/.test(TT)) fail("tt_symbol_viewbox_lowercase_missing");
if (/SYMBOL:\s*\{[^}]*\bviewBox:\s*1/.test(TT) && !/SYMBOL:\s*\{[^}]*\bviewbox:\s*1/.test(TT)) {
  fail("tt_symbol_viewbox_camelcase_only");
}
if (!/SVG:\s*\{[\s\S]*?\bviewbox:\s*1/.test(TT)) fail("tt_svg_viewbox_lowercase_missing");
if (!/id="iu-cz-map"/.test(MAP) || !/viewBox="0 0 100 57\.48"/.test(MAP)) fail("map_symbol_viewbox_source");
if (!/function ensureCzMapSprite/.test(UI)) fail("ui_ensure_sprite_missing");
if (!/holder\.innerHTML\s*=\s*txt/.test(UI)) fail("ui_sprite_innerhtml_path_missing");
if (!/href="#iu-cz-map"/.test(UI)) fail("ui_use_href_missing");
if (!/\.iuPrehledDne__czMapSvg\s*\{[\s\S]*?aspect-ratio:\s*100\s*\/\s*57\.48/.test(CSS)) {
  fail("css_aspect_contract_missing");
}
if (!/\.iuPdCard--traffic[\s\S]*?\.iuPrehledDne__czMapSvg\s*\{[\s\S]*?width:\s*43\.2px/.test(CSS)) {
  fail("css_traffic_svg_size_missing");
}

function startServer() {
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
${CSS}
body{margin:0;background:#f8fafc;font-family:system-ui,sans-serif;padding:12px}
.wrap{max-width:720px;margin:0 auto}
</style>
<script>${TT}</script>
</head><body>
<div class="wrap">
  <ul class="iuPrehledDne__timeline" id="host"></ul>
</div>
</body></html>`;
  const server = http.createServer((req, res) => {
    const u = String(req.url || "/").split("?")[0];
    if (u === "/assets/icons/iu-cz-map.svg") {
      res.writeHead(200, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
      res.end(MAP);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/` });
    });
  });
}

async function runViewport(page, label, size) {
  await page.setViewportSize(size);
  const result = await page.evaluate(async (mapSvgText) => {
    const expectedAspect = 100 / 57.48;
    // Same path as ensureCzMapSprite: create holder, then TT-patched innerHTML.
    let holder = document.getElementById("iu-cz-map-sprite");
    if (holder) holder.remove();
    holder = document.createElement("div");
    holder.id = "iu-cz-map-sprite";
    holder.hidden = true;
    holder.setAttribute("aria-hidden", "true");
    document.documentElement.appendChild(holder);
    if (window.iuTrustedHtml && typeof window.iuTrustedHtml.setInnerHtml === "function") {
      window.iuTrustedHtml.setInnerHtml(holder, mapSvgText);
    } else {
      holder.innerHTML = mapSvgText;
    }

    const symbol = document.getElementById("iu-cz-map");
    const symbolVb = symbol ? symbol.getAttribute("viewBox") || symbol.getAttribute("viewbox") : null;
    const spriteHasVb = /viewBox=["']0 0 100 57\.48["']/i.test(holder.innerHTML || "");

    const chmiMap =
      '<a class="iuPdCard__czMap iuPrehledDne__czMap" href="https://vystrahy-cr.chmi.cz/" target="_blank" rel="noopener noreferrer" data-act="open-title" aria-label="Otevřít ČHMÚ">' +
      '<svg class="iuPrehledDne__czMapSvg" viewBox="0 0 100 57.48" width="57.6" height="33.1" aria-hidden="true" focusable="false">' +
      '<use href="#iu-cz-map"></use></svg></a>';
    const trafficMap =
      '<a class="iuPdCard__czMap iuPrehledDne__czMap" href="https://www.dopravniinfo.cz/" target="_blank" rel="noopener noreferrer" data-act="open-title" aria-label="Otevřít mapu ŘSD">' +
      '<svg class="iuPrehledDne__czMapSvg" viewBox="0 0 100 57.48" width="57.6" height="33.1" aria-hidden="true" focusable="false">' +
      '<use href="#iu-cz-map"></use></svg></a>';

    const host = document.getElementById("host");
    const markup =
      '<li class="iuPdCard iuPrehledDne__item" style="--iu-pd-dot:#5B6CFF">' +
      '<div class="iuPrehledDne__timeCol"><div class="iuPdCard__time">12:00</div></div>' +
      '<div class="iuPrehledDne__axis" aria-hidden="true"><span class="iuPrehledDne__dot"></span></div>' +
      '<article class="iuPrehledDne__card iuPdCard__body iuPrehledDne__card--hasCzMap">' +
      '<div class="iuPrehledDne__cardHead"><div class="iuPrehledDne__cardHeadMain">' +
      chmiMap +
      '<span class="iuPdCard__warnBadge iuPrehledDne__warnBadge" role="status">🔴 VÝSTRAHA ČHMÚ</span>' +
      '<span class="iuPdCard__title iuPrehledDne__cardTitle">Sucho</span>' +
      "</div></div></article></li>" +
      '<li class="iuPdCard iuPdCard--traffic iuPrehledDne__item" style="--iu-pd-dot:#dc2626">' +
      '<article class="iuPrehledDne__card iuPdCard__body">' +
      '<div class="iuPdCard__actions iuPrehledDne__actions iuPdCard__actions--traffic">' +
      '<span class="iuPdCard__actionsMap">' +
      trafficMap +
      "</span>" +
      '<button type="button" class="iuPdBtn iuPdBtn--ghost">Sledovat</button>' +
      "</div></article></li>";
    if (window.iuTrustedHtml && typeof window.iuTrustedHtml.setInnerHtml === "function") {
      window.iuTrustedHtml.setInnerHtml(host, markup);
    } else {
      host.innerHTML = markup;
    }

    function sample(sel, traffic) {
      const svg = document.querySelector(sel);
      if (!svg) return { missing: true };
      const use = svg.querySelector("use");
      const sb = svg.getBoundingClientRect();
      const ub = use ? use.getBoundingClientRect() : null;
      const parent = svg.closest(".iuPrehledDne__czMap, .iuPdCard__czMap");
      const pb = parent ? parent.getBoundingClientRect() : null;
      const overflowParent =
        !!(pb &&
          ub &&
          (ub.right > pb.right + 1.5 ||
            ub.bottom > pb.bottom + 1.5 ||
            ub.left < pb.left - 1.5 ||
            ub.top < pb.top - 1.5));
      return {
        missing: false,
        traffic: !!traffic,
        href: parent ? parent.getAttribute("href") : null,
        act: parent ? parent.getAttribute("data-act") : null,
        svgW: +sb.width.toFixed(2),
        svgH: +sb.height.toFixed(2),
        aspect: sb.height ? +(sb.width / sb.height).toFixed(3) : null,
        useW: ub ? +ub.width.toFixed(2) : null,
        useH: ub ? +ub.height.toFixed(2) : null,
        useAspect: ub && ub.height ? +(ub.width / ub.height).toFixed(3) : null,
        fillRatio:
          ub && sb.width && sb.height ? +((ub.width * ub.height) / (sb.width * sb.height)).toFixed(3) : null,
        overflowParent,
        useHref: use ? use.getAttribute("href") || use.getAttribute("xlink:href") : null,
      };
    }

    return {
      ttReady: !!window.__iuTrustedTypesReady,
      symbolPresent: !!symbol,
      symbolVb,
      spriteHasVb,
      expectedAspect,
      chmi: sample(".iuPrehledDne__card--hasCzMap .iuPrehledDne__czMapSvg", false),
      traffic: sample(".iuPdCard--traffic .iuPrehledDne__czMapSvg", true),
    };
  }, MAP);

  if (!result.ttReady) fail(label + "_tt_not_ready");
  if (!result.symbolPresent) fail(label + "_symbol_missing");
  if (!result.spriteHasVb) fail(label + "_sprite_viewbox_lost");
  if (!result.symbolVb || !/0\s+0\s+100\s+57\.48/.test(result.symbolVb)) {
    fail(label + "_symbol_viewbox:" + result.symbolVb);
  }

  for (const key of ["chmi", "traffic"]) {
    const s = result[key];
    const p = label + "_" + key;
    if (!s || s.missing) {
      fail(p + "_missing");
      continue;
    }
    if (s.useHref !== "#iu-cz-map") fail(p + "_use_href");
    if (s.act !== "open-title") fail(p + "_act");
    if (!s.href) fail(p + "_href");
    if (s.aspect == null || Math.abs(s.aspect - result.expectedAspect) > 0.18) fail(p + "_svg_aspect:" + s.aspect);
    if (s.useAspect == null || Math.abs(s.useAspect - result.expectedAspect) > 0.25) {
      fail(p + "_use_aspect:" + s.useAspect);
    }
    if (s.overflowParent) fail(p + "_clipped");
    if (s.fillRatio == null || s.fillRatio < 0.55) fail(p + "_underfilled:" + s.fillRatio);
    if (s.useW == null || s.useW < 16) fail(p + "_tiny:" + s.useW);
  }

  // Click/tap contract: CHMI map still opens (popup) with same act.
  if (label === "mobile390") {
    const context = page.context();
    const popupPromise = context.waitForEvent("page", { timeout: 4000 }).catch(() => null);
    await page.locator(".iuPrehledDne__card--hasCzMap .iuPrehledDne__czMap").first().click({ force: true });
    const popup = await popupPromise;
    if (!popup) fail(label + "_click_no_popup");
    else {
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      const u = popup.url();
      if (!/chmi\.cz/i.test(u)) fail(label + "_click_url:" + u);
      await popup.close().catch(() => {});
    }
  }

  console.log(
    "IU_PD_CZMAP_TT_VP=" +
      JSON.stringify({
        label,
        size,
        symbolVb: result.symbolVb,
        chmi: result.chmi,
        traffic: result.traffic,
      })
  );
}

async function main() {
  const { server, url } = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const viewports = [
      { label: "mobile390", width: 390, height: 844 },
      { label: "tablet768", width: 768, height: 1024 },
      { label: "desktop1280", width: 1280, height: 900 },
    ];
    for (const vp of viewports) {
      await runViewport(page, vp.label, { width: vp.width, height: vp.height });
    }
  } catch (e) {
    fail("live_throw:" + String(e && e.message ? e.message : e));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  if (fails.length) {
    console.error("IU_PD_CZMAP_TT_VIEWBOX_FAIL=" + JSON.stringify(fails));
    process.exit(1);
  }
  console.log("IU_PD_CZMAP_TT_VIEWBOX_PASS=true");
}

await main();
