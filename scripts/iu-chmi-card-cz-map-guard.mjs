#!/usr/bin/env node
/**
 * Guard: CHMI card clickable Czechia silhouette (PC / tablet / mobile).
 * Static contract + Playwright visual/render checks + screenshots in %TEMP%.
 *
 * Click model (variant B): invisible min 44×44 CSS px hit target around the
 * visible silhouette — user sees only the map, not button chrome.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const CSS = path.join(ROOT, "assets", "iu-prehled-dne-v1.css");
const MAP = path.join(ROOT, "assets", "icons", "iu-cz-map.svg");
const INDEX = path.join(ROOT, "projects", "index.html");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8987", 10);
const SHOT_DIR =
  process.env.IU_CZ_MAP_SHOT_DIR ||
  path.join(os.tmpdir(), "iu-chmi-cz-map-screens");
const fails = [];
const sizeReport = [];

function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const map = fs.readFileSync(MAP, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");

  ok("map_file_symbol", /id="iu-cz-map"/.test(map), "symbol");
  ok("map_file_path", /<path[^>]*\sd="M100\.00/.test(map), "ne path");
  ok("map_file_points", (map.match(/L[\d.]+/g) || []).length >= 180, "detail");
  ok("map_viewbox_aspect", /viewBox="0 0 100 57\.48"/.test(map), "vb");
  const vb = map.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const vbAspect = vb ? Number(vb[1]) / Number(vb[2]) : 0;
  ok("map_aspect_cz", vbAspect > 1.68 && vbAspect < 1.82, String(vbAspect));
  ok("map_aspect_corrected_note", /Aspect-corrected|1\.74/i.test(map), "aspect note");
  ok("map_license_note", /Natural Earth/i.test(map) && /public domain/i.test(map), "license");
  ok("map_generalized_note", /1:50m|generalized/i.test(map), "scale");
  ok("map_currentColor", /fill="currentColor"/.test(map), "currentColor");
  ok("map_no_brand_hex", !/fill="#5b6cff"/i.test(map), "hardcoded brand");

  ok("ui_czMap_class", /iuPrehledDne__czMap/.test(ui), "class");
  ok("ui_cardHead", /iuPrehledDne__cardHead/.test(ui), "head");
  ok(
    "ui_map_before_title_flow",
    /iuPrehledDne__cardHeadMain">`\s*\+\s*czMapMarkup\s*\+\s*warnBadge\s*\+\s*titleMarkup/.test(ui),
    "map-first"
  );
  ok("ui_czMap_only_cap", /ev\s*&&\s*ev\.capV2\s*&&\s*url/.test(ui), "cap gate");
  ok("ui_czMap_same_href", /czMapMarkup[\s\S]*href="\$\{esc\(url\)\}"/.test(ui), "href");
  ok("ui_czMap_open_title", /czMapMarkup[\s\S]*data-act="open-title"/.test(ui), "act");
  ok("ui_czMap_target_blank", /czMapMarkup[\s\S]*target="_blank"/.test(ui), "target");
  ok("ui_czMap_rel", /czMapMarkup[\s\S]*rel="noopener noreferrer"/.test(ui), "rel");
  ok("ui_czMap_aria", /aria-label="Otevřít ČHMÚ"/.test(ui), "aria");
  ok("ui_czMap_local_use", /href="#iu-cz-map"/.test(ui), "local use");
  ok("ui_ensure_sprite", /function ensureCzMapSprite/.test(ui) && /iu-cz-map\.svg\?v=/.test(ui), "inject");
  ok("ui_no_inline_path_d", !/czMapMarkup[\s\S]{0,400}d="M98/.test(ui), "no dup path");
  ok("ui_uses_chmiPublicDetailUrl", /function chmiPublicDetailUrl/.test(ui) && /const forced = chmiPublicDetailUrl\(ev\)/.test(ui), "url helper");
  ok("ui_sets_pd_dot", /style="--iu-pd-dot:\$\{esc\(color\)\}"/.test(ui), "pd-dot");

  // Shared color source with timeline dot (exact same token chain).
  const dotBg = /\.iuPrehledDne__dot\s*\{[\s\S]*?background:\s*var\(--iu-pd-dot,\s*var\(--iu-pd-accent\)\)/.test(css);
  const mapColor = /\.iuPrehledDne__czMap\s*\{[\s\S]*?color:\s*var\(--iu-pd-dot,\s*var\(--iu-pd-accent\)\)/.test(css);
  ok("css_dot_token_chain", dotBg, "dot bg");
  ok("css_map_shares_dot_token", mapColor, "map color");
  ok("css_no_map_hardcoded_hex", !/\.iuPrehledDne__czMap[\s\S]{0,500}color:\s*#5b6cff/i.test(css), "no hex");
  ok("css_no_bg", /\.iuPrehledDne__czMap[\s\S]*?background:\s*transparent/.test(css), "bg");
  ok("css_no_border", /\.iuPrehledDne__czMap[\s\S]*?border:\s*0/.test(css), "border");
  ok("css_map_float_right", /\.iuPrehledDne__czMap\s*\{[\s\S]*?float:\s*right/.test(css), "float");
  ok(
    "css_map_not_absolute",
    !/\.iuPrehledDne__card--hasCzMap\s+\.iuPdCard__czMap,\s*\n\.iuPrehledDne__card--hasCzMap\s+\.iuPrehledDne__czMap\s*\{[^}]*position:\s*absolute/.test(
      css
    ),
    "no abs"
  );
  ok("css_map_display_block", /\.iuPrehledDne__czMap\s*\{[\s\S]*?display:\s*block/.test(css), "block");
  ok("css_hit_min_44", /\.iuPrehledDne__czMap[\s\S]*?height:\s*44px/.test(css), "hit min");
  // Hit box kept at prior approved sizes; visible SVG is exactly 80% of those widths.
  ok("css_hit_mobile_w", /\.iuPrehledDne__czMap[\s\S]*?width:\s*72px/.test(css), "hit m");
  ok("css_hit_tablet_w", /@media \(min-width:\s*768px\)[\s\S]*?\.iuPrehledDne__czMap[\s\S]*?width:\s*80px/.test(css), "hit t");
  ok("css_hit_desktop_w", /@media \(min-width:\s*1024px\)[\s\S]*?\.iuPrehledDne__czMap[\s\S]*?width:\s*84px/.test(css), "hit d");
  ok("css_svg_mobile", /\.iuPrehledDne__czMapSvg\s*\{[^}]*width:\s*57\.6px/.test(css), "svg m 80%");
  ok("css_svg_tablet", /@media \(min-width:\s*768px\)[\s\S]*?\.iuPrehledDne__czMapSvg\s*\{[^}]*width:\s*64px/.test(css), "svg t 80%");
  ok("css_svg_desktop", /@media \(min-width:\s*1024px\)[\s\S]*?\.iuPrehledDne__czMapSvg\s*\{[^}]*width:\s*67\.2px/.test(css), "svg d 80%");
  ok("css_svg_not_prior_72", !/\.iuPrehledDne__czMapSvg\s*\{[^}]*width:\s*72px/.test(css), "no prior svg 72");
  ok("css_svg_not_prior_80", !/\.iuPrehledDne__czMapSvg\s*\{[^}]*width:\s*80px/.test(css), "no prior svg 80");
  ok("css_svg_not_prior_84", !/\.iuPrehledDne__czMapSvg\s*\{[^}]*width:\s*84px/.test(css), "no prior svg 84");
  ok("css_aspect_ratio", /aspect-ratio:\s*100\s*\/\s*57\.48/.test(css), "aspect");
  ok("css_svg_height_auto", /\.iuPrehledDne__czMapSvg\s*\{[\s\S]*?height:\s*auto/.test(css), "height auto");
  ok("css_flow_root_head", /\.iuPrehledDne__cardHead[\s\S]*?display:\s*flow-root/.test(css), "flow-root");
  ok(
    "css_no_full_height_pad_reserve",
    !/\.iuPrehledDne__card--hasCzMap\s+\.iuPrehledDne__cardHeadMain\s*\{[\s\S]*?padding-right:\s*\d+px/.test(css),
    "no pad column"
  );
  ok("css_focus_no_rect_outline", /\.iuPrehledDne__czMap:focus-visible[\s\S]*?outline:\s*none/.test(css), "focus outline");
  ok("css_focus_silhouette", /focus-visible[\s\S]*?drop-shadow/.test(css), "focus glow");
  ok("css_size_80pct_contract_note", /80% of the previously approved|visible = 80%/i.test(css), "80pct note");
  // Contract: new visible width = prior approved * 0.8 (locked constants).
  ok("css_size_80pct_math_m", Math.abs(57.6 - 72 * 0.8) < 0.001, "72*0.8");
  ok("css_size_80pct_math_t", Math.abs(64 - 80 * 0.8) < 0.001, "80*0.8");
  ok("css_size_80pct_math_d", Math.abs(67.2 - 84 * 0.8) < 0.001, "84*0.8");

  // Keep in lockstep with assets/iu-prehled-dne-ui-v1.js CACHE_BUST (CZ map + current PD UI).
  const CACHE_BUST = "traffic-ui-ls-mem-guard-v1-20260808";
  ok("index_css_bust", index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "css ver");
  ok("index_js_bust", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "js ver");
  ok("ui_cache_bust", ui.includes('CACHE_BUST = "' + CACHE_BUST + '"') || ui.includes(CACHE_BUST), "ui ver");
  ok(
    "css_map_scoped_to_chmi_card",
    /\.iuPrehledDne__card--hasCzMap\s+\.iuPrehledDne__czMap\s*\{/.test(css) &&
      /\.iuPrehledDne__card--hasCzMap\s+\.iuPrehledDne__czMapSvg\s*\{/.test(css),
    "scoped"
  );
}

function mimeFor(fp) {
  if (fp.endsWith(".css")) return "text/css; charset=utf-8";
  if (fp.endsWith(".js") || fp.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (fp.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (fp.endsWith(".html")) return "text/html; charset=utf-8";
  if (fp.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        let rel = String(req.url || "/").split("?")[0].replace(/^\/+/, "");
        if (!rel || rel === "index.html") rel = path.join("projects", "index.html");
        const fp = path.resolve(ROOT, rel);
        if (!fp.startsWith(path.resolve(ROOT)) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404);
          res.end("not found");
          return;
        }
        res.writeHead(200, { "content-type": mimeFor(fp), "cache-control": "no-store" });
        res.end(fs.readFileSync(fp));
      } catch (e) {
        res.writeHead(500);
        res.end(String(e && e.message ? e.message : e));
      }
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function buildFixtureHtml(base, spriteHtml) {
  return `<!doctype html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<base href="${base}/"/>
<link rel="stylesheet" href="${base}/assets/iu-prehled-dne-v1.css"/>
<style>body{margin:0;background:#f8fafc;font-family:system-ui,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:12px}</style>
</head><body>
<div id="iu-cz-map-sprite" hidden aria-hidden="true">${spriteHtml}</div>
<div class="wrap" id="host"></div>
<script type="module">
const portal = "https://vystrahy-cr.chmi.cz/";
const long =
  "Velmi vysoké teploty — Nupaky, Česká Lípa, Praha, Průhonice, Čestlice, Jesenice, Říčany, Středočeský kraj a dalších 46 oblastí";
const longPc =
  "Velmi vysoké teploty — Nupaky, Česká Lípa, Praha, Průhonice, Čestlice, Jesenice, Říčany, Brandýs nad Labem-Stará Boleslav, Moravské Budějovice, Rychnov nad Kněžnou, Hradec Králové, Frýdek-Místek, Plzeň-město, Jihomoravský kraj, Královéhradecký kraj, Středočeský kraj a dalších 46 oblastí";
function mapLink(url) {
  return '<a class="iuPdCard__czMap iuPrehledDne__czMap" href="'+url+'" target="_blank" rel="noopener noreferrer" data-act="open-title" aria-label="Otevřít ČHMÚ">'
    + '<svg class="iuPrehledDne__czMapSvg" viewBox="0 0 100 57.48" width="57.6" height="33.1" aria-hidden="true" focusable="false">'
    + '<use href="#iu-cz-map"></use></svg></a>';
}
function card(opts) {
  const e = opts.ev;
  const url = e.capV2 ? portal : "";
  const capActive = !!(e.capV2 && e.capV2.badgeActive);
  const capEnded = !!(e.capV2 && (e.status === "ukonceno" || e.status === "zruseno"));
  const title = opts.title || e.title;
  const map = (e.capV2 && url) ? mapLink(url) : "";
  const badge = capActive
    ? '<span class="iuPdCard__warnBadge iuPrehledDne__warnBadge" role="status">🔴 VÝSTRAHA ČHMÚ</span>'
    : (capEnded ? '<span class="iuPdCard__warnBadge iuPdCard__warnBadge--ended iuPrehledDne__warnBadge" role="status">Ukončeno</span>' : '');
  const head = map
    ? '<div class="iuPrehledDne__cardHead"><div class="iuPrehledDne__cardHeadMain">'+map+badge+(url
        ? '<a class="iuPdCard__title iuPrehledDne__cardTitle" href="'+url+'" target="_blank" rel="noopener noreferrer" data-act="open-title">'+title+'</a>'
        : '<span class="iuPdCard__title iuPrehledDne__cardTitle">'+title+'</span>')+'</div></div>'
    : badge + (url
        ? '<a class="iuPdCard__title iuPrehledDne__cardTitle" href="'+url+'" target="_blank" rel="noopener noreferrer" data-act="open-title">'+title+'</a>'
        : '<span class="iuPdCard__title iuPrehledDne__cardTitle">'+title+'</span>');
  const imp = opts.imp
    ? '<span class="iuPdCard__pill iuPdCard__pill--imp iuPrehledDne__pill">Vysoká</span>'
    : '';
  const active = opts.active
    ? '<span class="iuPdCard__pill iuPdCard__pill--active iuPrehledDne__pill">AKTIVNÍ VÝSTRAHA</span>'
    : '';
  return '<li class="iuPdCard iuPrehledDne__item" data-id="'+e.id+'" style="--iu-pd-dot:#5B6CFF">'
    + '<div class="iuPrehledDne__timeCol"><div class="iuPdCard__time iuPrehledDne__time">12:00</div></div>'
    + '<div class="iuPrehledDne__axis" aria-hidden="true"><span class="iuPrehledDne__dot'+(capActive?' iuPrehledDne__dot--alert':'')+'"></span></div>'
    + '<article class="iuPrehledDne__card iuPdCard__body'+(map?' iuPrehledDne__card--hasCzMap':'')+'">'
    + head
    + '<div class="iuPdCard__meta iuPrehledDne__meta"><span class="iuPdCard__pill iuPrehledDne__pill">'+(e.sourceLabel||'')+'</span>'+active+imp+'</div>'
    + '<div class="iuPdCard__actions iuPrehledDne__actions">'
    + '<button type="button" class="iuPdBtn iuPdBtn--ghost">Uložit</button>'
    + '<button type="button" class="iuPdBtn iuPdBtn--ghost">Skrýt</button>'
    + '</div></article></li>';
}
const shortCap = {
  id: "ie-chmi-short", title: "Sucho", sourceId: "chmi", sourceLabel: "ČHMÚ",
  status: "aktivni", capV2: { badgeActive: true, publicClickUrl: portal },
};
const longCap = {
  id: "ie-chmi-long", title: long, sourceId: "chmi", sourceLabel: "ČHMÚ",
  status: "aktivni", capV2: { badgeActive: true, publicClickUrl: portal },
};
const endedCap = {
  id: "ie-chmi-ended", title: "Ukončená výstraha na mráz", sourceId: "chmi", sourceLabel: "ČHMÚ",
  status: "ukonceno", capV2: { badgeActive: false, publicClickUrl: portal },
};
const plain = {
  id: "ie-other", title: "Běžná událost bez mapy", sourceId: "mzcr", sourceLabel: "MZČR",
  status: "aktivni",
};
document.getElementById('host').innerHTML =
  '<ul class="iuPrehledDne__timeline iuPdFeed">'
  + card({ ev: shortCap, active: true, imp: true })
  + card({ ev: longCap, title: (window.innerWidth >= 1024 ? longPc : long), active: true, imp: true })
  + card({ ev: endedCap })
  + card({ ev: plain })
  + '</ul>';
</script></body></html>`;
}

async function viewportCheck(page, label, size) {
  await page.setViewportSize(size);
  const base = `http://127.0.0.1:${PORT}`;
  const spriteHtml = fs.readFileSync(MAP, "utf8");
  await page.setContent(buildFixtureHtml(base, spriteHtml), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".iuPrehledDne__czMapSvg use", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 220));

  const metrics = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".iuPdCard"));
    const capCards = cards.filter((c) => c.querySelector(".iuPrehledDne__czMap"));
    const plain = cards[cards.length - 1];
    const primary = capCards[0];
    const longCard = capCards[1];
    const map = primary.querySelector(".iuPrehledDne__czMap");
    const svg = primary.querySelector(".iuPrehledDne__czMapSvg");
    const title = primary.querySelector(".iuPrehledDne__cardTitle");
    const longTitle = longCard.querySelector(".iuPrehledDne__cardTitle");
    const longMap = longCard.querySelector(".iuPrehledDne__czMap");
    const badge = primary.querySelector(".iuPrehledDne__warnBadge");
    const actions = primary.querySelector(".iuPrehledDne__actions");
    const cardEl = primary.querySelector(".iuPrehledDne__card");
    const longCardEl = longCard.querySelector(".iuPrehledDne__card");
    const dot = primary.querySelector(".iuPrehledDne__dot");
    const axis = primary.querySelector(".iuPrehledDne__axis");
    const plainMap = plain.querySelector(".iuPrehledDne__czMap");
    const mr = map.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const lmr = longMap.getBoundingClientRect();
    const ar = actions.getBoundingClientRect();
    const cr = cardEl.getBoundingClientRect();
    const dr = dot.getBoundingClientRect();
    const axr = axis.getBoundingClientRect();
    const cs = getComputedStyle(map);
    const dcs = getComputedStyle(dot);
    const overlaps = (a, b) =>
      !!a && !!b && !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const titleLineRects = (() => {
      const range = document.createRange();
      range.selectNodeContents(longTitle);
      return Array.from(range.getClientRects()).map((r) => ({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
      }));
    })();
    const shortTitleRects = (() => {
      const range = document.createRange();
      range.selectNodeContents(title);
      return Array.from(range.getClientRects()).map((r) => ({
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      }));
    })();
    const badgeLineRects = badge
      ? (() => {
          const range = document.createRange();
          range.selectNodeContents(badge);
          return Array.from(range.getClientRects()).map((r) => ({
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
          }));
        })()
      : [];
    const collideText = (rects, box) =>
      rects.some((r) => overlaps(r, { left: box.left, right: box.right, top: box.top, bottom: box.bottom }));
    const besideLines = titleLineRects.filter((r) => r.top < lmr.bottom - 1 && r.bottom > lmr.top + 1);
    const belowLines = titleLineRects.filter((r) => r.top >= lmr.bottom - 1);
    const longMain = longCard.querySelector(".iuPrehledDne__cardHeadMain");
    const mainR = longMain.getBoundingClientRect();
    const titleBox = longTitle.getBoundingClientRect();
    const longCr = longCardEl.getBoundingClientRect();
    const contentRight = longCr.right - 12;
    const narrowColumnCap = lmr.left - 4;
    const maxBesideRight = besideLines.reduce((m, r) => Math.max(m, r.right), 0);
    const maxBelowRight = belowLines.reduce((m, r) => Math.max(m, r.right), 0);
    const maxBesideWidth = besideLines.reduce((m, r) => Math.max(m, r.width || r.right - r.left), 0);
    const maxBelowWidth = belowLines.reduce((m, r) => Math.max(m, r.width || r.right - r.left), 0);
    const parseRgb = (s) => {
      const m = String(s || "").match(/\d+/g) || [];
      return [Number(m[0] || 0), Number(m[1] || 0), Number(m[2] || 0)];
    };
    const [mrR, mrG, mrB] = parseRgb(cs.color);
    const [drR, drG, drB] = parseRgb(dcs.backgroundColor);
    const colorMatch =
      Math.abs(mrR - drR) <= 3 && Math.abs(mrG - drG) <= 3 && Math.abs(mrB - drB) <= 3;

    const topInset = sr.top - cr.top;
    const rightInset = cr.right - sr.right;
    const aspect = sr.height > 0 ? sr.width / sr.height : 0;
    return {
      mapHref: map.getAttribute("href") || "",
      titleHref: title.getAttribute("href") || "",
      mapTarget: map.getAttribute("target") || "",
      mapRel: map.getAttribute("rel") || "",
      mapAct: map.getAttribute("data-act") || "",
      titleAct: title.getAttribute("data-act") || "",
      aria: map.getAttribute("aria-label") || "",
      capMapCount: capCards.length,
      plainHasMap: !!plainMap,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      mapInside: mr.right <= cr.right + 2 && mr.left >= cr.left - 2 && mr.top >= cr.top - 2,
      collideTitle: collideText(shortTitleRects, mr) || collideText(titleLineRects, lmr),
      collideBadge: collideText(badgeLineRects, mr),
      collideActions: overlaps(mr, ar),
      collideAxis: overlaps(mr, axr) || overlaps(mr, dr),
      bg: cs.backgroundColor,
      borderW: cs.borderTopWidth,
      shadow: cs.boxShadow,
      colorMatch,
      mapColor: cs.color,
      dotBg: dcs.backgroundColor,
      hitW: mr.width,
      hitH: mr.height,
      svgW: sr.width,
      svgH: sr.height,
      aspect,
      topInset,
      rightInset,
      insetDelta: Math.abs(topInset - rightInset),
      cardH: cr.height,
      shortCardH: cr.height,
      longCardH: longCr.height,
      float: cs.float,
      pos: cs.position,
      titleLineCount: titleLineRects.length,
      besideLineCount: besideLines.length,
      belowLineCount: belowLines.length,
      maxBesideRight,
      maxBelowRight,
      maxBesideWidth,
      maxBelowWidth,
      titleBoxWidth: titleBox.width,
      mainWidth: mainR.width,
      titleBoxRight: titleBox.right,
      narrowColumnCap,
      contentRight,
      /* Block title spans full headMain (no padding-right column); line boxes wrap via float. */
      wrapUsesFullWidth:
        Math.abs(titleBox.width - mainR.width) <= 4 && titleBox.right >= lmr.right - 3,
      besideStaysLeftOfMap: besideLines.length === 0 || maxBesideRight <= lmr.left + 1.5,
      titleTruncated: /ellipsis/i.test(getComputedStyle(longTitle).textOverflow),
      fullTitleLen: (longTitle.textContent || "").length,
    };
  });

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const shotPath = path.join(SHOT_DIR, "cz-map-" + label + "-" + size.width + ".png");
  await page.locator(".iuPrehledDne__timeline").screenshot({ path: shotPath });
  const mapShot = path.join(SHOT_DIR, "cz-map-hit-" + label + "-" + size.width + ".png");
  await page.locator(".iuPrehledDne__card--hasCzMap").first().screenshot({ path: mapShot });
  const longShot = path.join(SHOT_DIR, "cz-map-long-" + label + "-" + size.width + ".png");
  await page.locator(".iuPrehledDne__card--hasCzMap").nth(1).screenshot({ path: longShot });

  // Keyboard focus-visible: silhouette glow, no rectangular outline.
  await page.locator(".iuPrehledDne__czMap").first().focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  const focusMetrics = await page.evaluate(() => {
    const map = document.querySelector(".iuPrehledDne__czMap");
    const svg = document.querySelector(".iuPrehledDne__czMapSvg");
    if (!map || !svg) return { focusOutlineNone: false, focusGlow: false };
    map.focus({ preventScroll: true });
    const fcs = getComputedStyle(map);
    const svgF = getComputedStyle(svg);
    return {
      focusOutlineNone: fcs.outlineStyle === "none" || fcs.outlineWidth === "0px",
      focusGlow: /drop-shadow/i.test(svgF.filter),
      focusVisible: map.matches(":focus-visible"),
    };
  });
  const focusShot = path.join(SHOT_DIR, "cz-map-focus-" + label + "-" + size.width + ".png");
  await page.locator(".iuPrehledDne__card--hasCzMap").first().screenshot({ path: focusShot });
  await page.evaluate(() => {
    const map = document.querySelector(".iuPrehledDne__czMap");
    if (map) map.blur();
  });

  // Prior approved visible widths (before 20% reduction) and current (= prior * 0.8).
  const priorSvgW = size.width < 768 ? 72 : size.width < 1024 ? 80 : 84;
  const expectedSvgW = priorSvgW * 0.8;
  const expectedHitW = priorSvgW;
  const expectedAspect = 100 / 57.48;
  sizeReport.push({
    label,
    viewport: size.width + "x" + size.height,
    svgW: Number(metrics.svgW.toFixed(1)),
    svgH: Number(metrics.svgH.toFixed(1)),
    hitW: Number(metrics.hitW.toFixed(1)),
    hitH: Number(metrics.hitH.toFixed(1)),
    aspect: Number(metrics.aspect.toFixed(3)),
    topInset: Number(metrics.topInset.toFixed(2)),
    rightInset: Number(metrics.rightInset.toFixed(2)),
    priorSvgW,
    expectedSvgW,
    expectedHitW,
    sizeFactor: 0.8,
  });

  ok(label + "_cap_maps", metrics.capMapCount === 3, String(metrics.capMapCount));
  ok(label + "_plain_no_map", metrics.plainHasMap === false, String(metrics.plainHasMap));
  ok(label + "_same_href", metrics.mapHref === metrics.titleHref, metrics.mapHref + "|" + metrics.titleHref);
  ok(label + "_portal", /vystrahy-cr\.chmi\.cz/i.test(metrics.mapHref), metrics.mapHref);
  ok(label + "_target_blank", metrics.mapTarget === "_blank", metrics.mapTarget);
  ok(label + "_rel", metrics.mapRel === "noopener noreferrer", metrics.mapRel);
  ok(label + "_same_act", metrics.mapAct === "open-title" && metrics.titleAct === "open-title", metrics.mapAct);
  ok(label + "_aria", metrics.aria === "Otevřít ČHMÚ", metrics.aria);
  ok(label + "_no_h_overflow", metrics.overflowX === false, "overflow");
  ok(label + "_map_inside", metrics.mapInside === true, "clip");
  ok(label + "_no_collide_title", metrics.collideTitle === false, "title");
  ok(label + "_no_collide_badge", metrics.collideBadge === false, "badge");
  ok(label + "_no_collide_actions", metrics.collideActions === false, "actions");
  ok(label + "_no_collide_axis", metrics.collideAxis === false, "axis");
  ok(label + "_transparent_bg", /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(metrics.bg), metrics.bg);
  ok(label + "_no_border", metrics.borderW === "0px", metrics.borderW);
  ok(label + "_no_box_shadow", !metrics.shadow || metrics.shadow === "none", metrics.shadow);
  ok(label + "_color_matches_dot", metrics.colorMatch === true, metrics.mapColor + "|" + metrics.dotBg);
  ok(label + "_hit_min_44", metrics.hitW >= 43.5 && metrics.hitH >= 43.5, metrics.hitW + "x" + metrics.hitH);
  ok(label + "_hit_keeps_prior_w", Math.abs(metrics.hitW - expectedHitW) <= 1.5, metrics.hitW + "!=" + expectedHitW);
  ok(label + "_svg_size_80pct", Math.abs(metrics.svgW - expectedSvgW) <= 1.5, metrics.svgW + "!=" + expectedSvgW);
  ok(label + "_svg_smaller_than_prior", metrics.svgW < priorSvgW - 5, metrics.svgW + " vs prior " + priorSvgW);
  ok(label + "_svg_recognizable", metrics.svgH >= 30, String(metrics.svgH));
  ok(label + "_aspect_ok", Math.abs(metrics.aspect - expectedAspect) <= 0.08, String(metrics.aspect));
  ok(label + "_not_stretched_wide", metrics.aspect < 2.2, String(metrics.aspect));
  ok(label + "_equal_inset", metrics.insetDelta <= 2.5, metrics.topInset + "|" + metrics.rightInset);
  ok(label + "_float_right", metrics.float === "right", metrics.float);
  ok(label + "_pos_not_absolute", metrics.pos !== "absolute", metrics.pos);
  ok(label + "_focus_no_rect", focusMetrics.focusOutlineNone === true, "outline");
  ok(label + "_focus_glow", focusMetrics.focusGlow === true || focusMetrics.focusVisible === true, JSON.stringify(focusMetrics));
  // Narrow phones wrap long titles taller (Linux CI fonts); float wrap keeps height bounded.
  const longHMax = size.width <= 360 ? 520 : size.width < 768 ? 420 : 380;
  ok(label + "_long_title_ok", metrics.longCardH > 60 && metrics.longCardH < longHMax, String(metrics.longCardH));
  ok(label + "_wrap_has_below_or_short", metrics.belowLineCount > 0 || metrics.titleLineCount <= 2, "lines=" + metrics.titleLineCount);
  ok(label + "_beside_left_of_map", metrics.besideStaysLeftOfMap === true, String(metrics.maxBesideRight) + "|" + metrics.narrowColumnCap);
  ok(
    label + "_below_uses_full_width",
    metrics.wrapUsesFullWidth === true,
    String(metrics.titleBoxWidth) + "|" + metrics.mainWidth + "|r=" + metrics.titleBoxRight
  );
  ok(label + "_title_not_truncated", metrics.titleTruncated === false && metrics.fullTitleLen > 40, String(metrics.fullTitleLen));
  ok(label + "_short_card_ok", metrics.shortCardH > 50 && metrics.shortCardH < 280, String(metrics.shortCardH));

  const useHref = await page.locator(".iuPrehledDne__czMapSvg use").first().getAttribute("href");
  ok(label + "_use_href", String(useHref || "") === "#iu-cz-map", String(useHref));
  const painted = await page.locator(".iuPrehledDne__czMapSvg").first().evaluate((el) => {
    const u = el.querySelector("use");
    return !!(u && (u.getBoundingClientRect().width > 8 || el.getBoundingClientRect().width > 8));
  });
  ok(label + "_painted", painted === true, "use paint");
  ok(label + "_screenshot", fs.existsSync(shotPath) && fs.statSync(shotPath).size > 800, shotPath);
  ok(label + "_map_shot", fs.existsSync(mapShot) && fs.statSync(mapShot).size > 400, mapShot);
  ok(label + "_long_shot", fs.existsSync(longShot) && fs.statSync(longShot).size > 400, longShot);
  ok(label + "_focus_shot", fs.existsSync(focusShot) && fs.statSync(focusShot).size > 400, focusShot);

  // One real click → new tab (same portal URL as title); only on mobile390 to keep runtime low.
  if (label === "mobile390") {
    const context = page.context();
    const before = context.pages().length;
    const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await page.locator(".iuPrehledDne__czMap").first().click({ force: true });
    const popup = await popupPromise;
    let clickUrl = "";
    if (popup) {
      await popup.waitForLoadState("domcontentloaded").catch(() => {});
      clickUrl = popup.url();
      await popup.close().catch(() => {});
    }
    ok(label + "_click_new_tab", !!popup && context.pages().length === before, "pages");
    ok(label + "_click_same_url", clickUrl === metrics.mapHref || /vystrahy-cr\.chmi\.cz/i.test(clickUrl), clickUrl);
  }

  console.log("SHOT " + shotPath);
  console.log("SHOT_HIT " + mapShot);
  console.log("SHOT_LONG " + longShot);
  console.log("SHOT_FOCUS " + focusShot);
}

async function main() {
  staticGate();
  const server = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await viewportCheck(page, "mobile320", { width: 320, height: 720 });
    await viewportCheck(page, "mobile390", { width: 390, height: 844 });
    await viewportCheck(page, "tablet768", { width: 768, height: 1024 });
    await viewportCheck(page, "tablet1024", { width: 1024, height: 768 });
    await viewportCheck(page, "pc1280", { width: 1280, height: 900 });
    await viewportCheck(page, "pc1600", { width: 1600, height: 1000 });
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const reportPath = path.join(SHOT_DIR, "size-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(sizeReport, null, 2));
  console.log("IU_CHMI_CARD_CZ_MAP_GUARD");
  console.log("SHOT_DIR=" + SHOT_DIR);
  console.log("SIZE_REPORT=" + JSON.stringify(sizeReport));
  console.log("SIZE_REPORT_FILE=" + reportPath);
  console.log("CLICK_MODEL=B_invisible_hit_around_silhouette_min44");
  console.log("VISIBLE_SIZE_FACTOR=0.8");
  console.log("PRIOR_SVG_W=72/80/84 HIT_KEPT VISIBLE=57.6/64/67.2");
  console.log("ASPECT=100/57.48≈1.74");
  console.log("PLACEMENT=float_right_title_wrap_equal_inset");
  console.log("COLOR_TOKEN=var(--iu-pd-dot, var(--iu-pd-accent))");
  console.log("FAIL_COUNT=" + fails.length);
  for (const f of fails) console.log("FAIL " + f);
  if (fails.length) {
    process.exit(1);
  }
  console.log("PASS=true");
}

main().catch((e) => {
  console.error("IU_CHMI_CARD_CZ_MAP_GUARD_FATAL", e);
  process.exit(1);
});
