#!/usr/bin/env node
/**
 * Guard: CHMI card clickable Czechia silhouette map (PC / tablet / mobile).
 * Static contract + Playwright viewport checks — same URL as title, no button chrome.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8974", 10);
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const map = fs.readFileSync(MAP, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");

  ok("map_file_symbol", /id="iu-cz-map"/.test(map), "symbol");
  ok("map_file_path", /<path\s+fill="currentColor"\s+d="M98\.08/.test(map), "ne path");
  ok("map_file_points", (map.match(/L[\d.]+/g) || []).length >= 180, "detail");
  ok("map_no_button_fill_attr", !/fill="#5b6cff"/i.test(map), "hardcoded fill");

  ok("ui_czMap_class", /iuPrehledDne__czMap/.test(ui), "class");
  ok("ui_czMap_only_cap", /ev\s*&&\s*ev\.capV2\s*&&\s*url/.test(ui), "cap gate");
  ok("ui_czMap_same_href", /czMapMarkup[\s\S]*href="\$\{esc\(url\)\}"/.test(ui), "href");
  ok("ui_czMap_open_title", /czMapMarkup[\s\S]*data-act="open-title"/.test(ui), "act");
  ok("ui_czMap_aria", /aria-label="Otevřít ČHMÚ"/.test(ui), "aria");
  ok("ui_czMap_shared_use", /iu-cz-map\.svg#iu-cz-map/.test(ui), "sprite use");
  ok("ui_no_inline_path_d", !/czMapMarkup[\s\S]{0,400}d="M98/.test(ui), "no dup path");
  ok("ui_uses_chmiPublicDetailUrl", /function chmiPublicDetailUrl/.test(ui) && /const forced = chmiPublicDetailUrl\(ev\)/.test(ui), "url helper");

  ok("css_accent_color", /\.iuPrehledDne__czMap[\s\S]*?color:\s*var\(--iu-pd-accent\)/.test(css), "accent");
  ok("css_no_bg", /\.iuPrehledDne__czMap[\s\S]*?background:\s*transparent/.test(css), "bg");
  ok("css_no_border", /\.iuPrehledDne__czMap[\s\S]*?border:\s*0/.test(css), "border");
  ok("css_no_shadow", /\.iuPrehledDne__czMap[\s\S]*?box-shadow:\s*none/.test(css), "shadow");
  ok("css_absolute", /\.iuPrehledDne__czMap[\s\S]*?position:\s*absolute/.test(css), "abs");
  ok("css_title_pad", /\.iuPrehledDne__card--hasCzMap[\s\S]*?padding-right:\s*44px/.test(css), "pad");
  ok("css_root_accent", /--iu-pd-accent:\s*#5b6cff/.test(css), "token");

  ok("index_css_bust", /iu-prehled-dne-v1\.css\?v=chmi-cz-map-click-/.test(index), "css ver");
  ok("index_js_bust", /iu-prehled-dne-ui-v1\.js\?v=chmi-cz-map-click-/.test(index), "js ver");
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

async function viewportCheck(page, label, size) {
  await page.setViewportSize(size);
  const base = `http://127.0.0.1:${PORT}`;
  const mapHref = base + "/assets/icons/iu-cz-map.svg#iu-cz-map";
  await page.setContent(
    `<!doctype html><html><head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <link rel="stylesheet" href="${base}/assets/iu-prehled-dne-v1.css"/>
      <style>body{margin:0;background:#f8fafc;font-family:system-ui,sans-serif}
      .wrap{max-width:720px;margin:0 auto;padding:12px}</style>
    </head><body><div class="wrap" id="host"></div>
    <script type="module">
      const portal = "https://vystrahy-cr.chmi.cz/";
      const mapUse = ${JSON.stringify(mapHref)};
      const ev = {
        id: "ie-chmi-v2-czmap",
        title: "Stav sucha — Praha",
        sourceId: "chmi",
        sourceLabel: "ČHMÚ",
        region: { name: "Praha" },
        importance: 3,
        eventType: "mimoradne",
        status: "aktivni",
        url: portal,
        publishedAt: "2026-07-29T10:00:00Z",
        publicClickUrl: portal,
        capV2: { badgeActive: true, publicClickUrl: portal, searchText: "stav sucha praha" },
      };
      const plain = {
        id: "ie-other-czmap",
        title: "Běžná událost",
        sourceId: "mzcr",
        sourceLabel: "MZČR",
        importance: 1,
        eventType: "aktualni",
        status: "aktivni",
        publishedAt: "2026-07-29T10:00:00Z",
      };
      function card(e) {
        const url = e.capV2 ? portal : "";
        const capActive = !!(e.capV2 && e.capV2.badgeActive);
        const title = e.title;
        const map = (e.capV2 && url)
          ? '<a class="iuPdCard__czMap iuPrehledDne__czMap" href="'+url+'" target="_blank" rel="noopener noreferrer" data-act="open-title" aria-label="Otevřít ČHMÚ">'
            + '<svg class="iuPrehledDne__czMapSvg" viewBox="0 0 100 36.51" width="28" height="10" aria-hidden="true" focusable="false">'
            + '<use href="'+mapUse+'"></use></svg></a>'
          : "";
        return '<li class="iuPdCard iuPrehledDne__item" data-id="'+e.id+'">'
          + '<div class="iuPrehledDne__timeCol"><div class="iuPdCard__time iuPrehledDne__time">12:00</div></div>'
          + '<div class="iuPrehledDne__axis" aria-hidden="true"><span class="iuPrehledDne__dot iuPrehledDne__dot--alert"></span></div>'
          + '<article class="iuPrehledDne__card iuPdCard__body'+(map ? ' iuPrehledDne__card--hasCzMap' : '')+'">'
          + map
          + (capActive ? '<span class="iuPdCard__warnBadge iuPrehledDne__warnBadge" role="status">🔴 VÝSTRAHA ČHMÚ</span>' : '')
          + (url
            ? '<a class="iuPdCard__title iuPrehledDne__cardTitle" href="'+url+'" target="_blank" rel="noopener noreferrer" data-act="open-title">'+title+'</a>'
            : '<span class="iuPdCard__title iuPrehledDne__cardTitle">'+title+'</span>')
          + '<div class="iuPdCard__meta iuPrehledDne__meta"><span class="iuPdCard__pill iuPrehledDne__pill">'+(e.sourceLabel||'')+'</span></div>'
          + '<div class="iuPdCard__actions iuPrehledDne__actions">'
          + '<button type="button" class="iuPdBtn iuPdBtn--ghost">Uložit</button>'
          + '<button type="button" class="iuPdBtn iuPdBtn--ghost">Skrýt</button>'
          + '</div></article></li>';
      }
      document.getElementById('host').innerHTML = '<ul class="iuPrehledDne__timeline iuPdFeed">'+card(ev)+card(plain)+'</ul>';
    </script></body></html>`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForSelector(".iuPrehledDne__czMap", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 150));

  const metrics = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".iuPdCard"));
    const cap = cards[0];
    const plain = cards[1];
    const map = cap.querySelector(".iuPrehledDne__czMap");
    const title = cap.querySelector(".iuPrehledDne__cardTitle");
    const badge = cap.querySelector(".iuPrehledDne__warnBadge");
    const actions = cap.querySelector(".iuPrehledDne__actions");
    const cardEl = cap.querySelector(".iuPrehledDne__card");
    const plainMap = plain.querySelector(".iuPrehledDne__czMap");
    const mr = map.getBoundingClientRect();
    const tr = title.getBoundingClientRect();
    const br = badge.getBoundingClientRect();
    const ar = actions.getBoundingClientRect();
    const cr = cardEl.getBoundingClientRect();
    const cs = getComputedStyle(map);
    const tcs = getComputedStyle(title);
    const padR = parseFloat(tcs.paddingRight) || 0;
    const titleContent = { left: tr.left, right: tr.right - padR, top: tr.top, bottom: tr.bottom };
    const overlaps = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    const rgb = cs.color.match(/\d+/g) || [];
    const r = Number(rgb[0] || 0);
    const g = Number(rgb[1] || 0);
    const b = Number(rgb[2] || 0);
    // #5b6cff ≈ 91,108,255
    const accentish = Math.abs(r - 91) <= 12 && Math.abs(g - 108) <= 12 && b >= 230;
    return {
      mapHref: map.getAttribute("href") || "",
      titleHref: title.getAttribute("href") || "",
      mapAct: map.getAttribute("data-act") || "",
      titleAct: title.getAttribute("data-act") || "",
      aria: map.getAttribute("aria-label") || "",
      plainHasMap: !!plainMap,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      mapInside: mr.right <= cr.right + 2 && mr.left >= cr.left - 2 && mr.top >= cr.top - 2,
      collideTitle: overlaps(mr, titleContent),
      collideBadge: overlaps(mr, br),
      collideActions: overlaps(mr, ar),
      bg: cs.backgroundColor,
      borderW: cs.borderTopWidth,
      shadow: cs.boxShadow,
      pos: cs.position,
      accentish,
      mapW: mr.width,
      mapH: mr.height,
      cardH: cr.height,
      tabIndexable: map.tabIndex >= 0 || map.getAttribute("href"),
    };
  });

  ok(label + "_map_href_portal", /vystrahy-cr\.chmi\.cz/i.test(metrics.mapHref), metrics.mapHref);
  ok(label + "_same_href", metrics.mapHref === metrics.titleHref, metrics.mapHref + "|" + metrics.titleHref);
  ok(label + "_same_act", metrics.mapAct === "open-title" && metrics.titleAct === "open-title", metrics.mapAct);
  ok(label + "_aria", metrics.aria === "Otevřít ČHMÚ", metrics.aria);
  ok(label + "_plain_no_map", metrics.plainHasMap === false, String(metrics.plainHasMap));
  ok(label + "_no_h_overflow", metrics.overflowX === false, "overflow");
  ok(label + "_map_inside", metrics.mapInside === true, "clip");
  ok(label + "_no_collide_title", metrics.collideTitle === false, "title");
  ok(label + "_no_collide_badge", metrics.collideBadge === false, "badge");
  ok(label + "_no_collide_actions", metrics.collideActions === false, "actions");
  ok(label + "_transparent_bg", /rgba?\(0,\s*0,\s*0,\s*0\)|transparent/i.test(metrics.bg), metrics.bg);
  ok(label + "_no_border", metrics.borderW === "0px", metrics.borderW);
  ok(label + "_no_shadow", !metrics.shadow || metrics.shadow === "none", metrics.shadow);
  ok(label + "_absolute", metrics.pos === "absolute", metrics.pos);
  ok(label + "_accent_blue", metrics.accentish === true, "color");
  ok(label + "_touch_target", metrics.mapW >= 40 && metrics.mapH >= 32, String(metrics.mapW) + "x" + String(metrics.mapH));
  ok(label + "_focusable_link", !!metrics.tabIndexable, "a[href]");
  ok(label + "_card_height_stable", metrics.cardH > 40 && metrics.cardH < 420, String(metrics.cardH));
}

async function main() {
  staticGate();
  let serverProc = null;
  serverProc = spawn("npx", ["serve", ROOT, "-l", String(PORT)], {
    cwd: ROOT,
    stdio: "ignore",
    shell: true,
  });
  await waitForPort("127.0.0.1", PORT, 45000);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await viewportCheck(page, "mobile", { width: 390, height: 844 });
    await viewportCheck(page, "tablet_portrait", { width: 768, height: 1024 });
    await viewportCheck(page, "tablet_landscape", { width: 1024, height: 768 });
    await viewportCheck(page, "pc", { width: 1280, height: 900 });
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  console.log("IU_CHMI_CARD_CZ_MAP_GUARD");
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
