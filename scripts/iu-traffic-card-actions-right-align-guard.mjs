#!/usr/bin/env node
/**
 * Guard: traffic card bottom action row (map → Sledovat → Skrýt) is right-aligned
 * to the card's inner content edge on mobile / tablet / desktop. Light + dark.
 * Static CSS/DOM contract + Playwright geometry. Pure local (served assets).
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
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8987", 10);
const EDGE_TOL_PX = 2.5;
const fails = [];
const results = [];

function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");

  ok("ui_actionsMap", ui.includes("iuPdCard__actionsMap"), "map wrapper");
  ok("ui_traffic_follow", /data-act="traffic-follow"/.test(ui), "follow");
  ok("ui_hide", /data-act="hide"/.test(ui), "hide");
  ok("ui_actions_traffic_class", ui.includes("iuPdCard__actions--traffic"), "class");

  // DOM order in template: actionsMap → traffic-follow → hide
  const mapIdx = ui.indexOf("iuPdCard__actionsMap");
  const followIdx = ui.indexOf('data-act="traffic-follow"');
  const hideIdx = ui.indexOf(
    'data-act="hide"',
    followIdx > 0 ? followIdx : 0
  );
  ok(
    "MAP_ACTION_ORDER",
    mapIdx > 0 && followIdx > mapIdx && hideIdx > followIdx,
    "order map→follow→hide"
  );

  // Traffic override must right-align (not flex-start).
  const trafficBlock = css.match(
    /\.iuPdCard--traffic\s+\.iuPdCard__actions\.iuPdCard__actions--traffic[\s\S]{0,280}?\{([\s\S]*?)\}/
  );
  const blockCss = trafficBlock ? trafficBlock[1] : "";
  ok(
    "css_traffic_actions_flex_end",
    /justify-content:\s*flex-end/.test(blockCss),
    blockCss.slice(0, 120)
  );
  ok(
    "css_traffic_actions_no_flex_start",
    !/justify-content:\s*flex-start/.test(blockCss),
    "no flex-start regression"
  );
  ok(
    "css_generic_actions_flex_end",
    /\.iuPdCard__actions[\s\S]{0,120}justify-content:\s*flex-end/.test(css),
    "generic"
  );
  ok(
    "css_no_fixed_nudge",
    !/\.iuPdCard__actions--traffic[\s\S]{0,200}(margin-left:\s*\d{2,}px|transform:\s*translateX)/.test(
      css
    ),
    "no screenshot nudge"
  );
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request(
        { host, port, path: "/assets/iu-prehled-dne-v1.css", method: "HEAD", timeout: 800 },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

function fixtureHtml(dark) {
  return `<!doctype html><html${dark ? ' class="dark" data-theme="dark"' : ""}><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="stylesheet" href="http://127.0.0.1:${PORT}/assets/iu-prehled-dne-v1.css"/>
<style>
  body{margin:0;background:${dark ? "#0f172a" : "#f8fafc"};font-family:system-ui,sans-serif}
  .wrap{max-width:720px;margin:0 auto;padding:12px}
  .iuPrehledDne__timeline{list-style:none;margin:0;padding:0}
</style>
</head><body><div class="wrap" id="host">
<ul class="iuPrehledDne__timeline iuPdFeed">
  <li class="iuPdCard iuPrehledDne__item iuPdCard--traffic" data-iu-traffic="1" style="--iu-pd-dot:#2563eb">
    <div class="iuPrehledDne__timeCol"><div class="iuPdCard__time iuPrehledDne__time">12:00</div></div>
    <div class="iuPrehledDne__axis" aria-hidden="true"><span class="iuPrehledDne__dot"></span></div>
    <article class="iuPrehledDne__card iuPdCard__body iuPdCard__body--traffic">
      <div class="iuPdTrafficCard" data-iu-traffic-unified="1">
        <div class="iuPdTrafficBlock"><p>Silnice I/26 · Plzeň · práce na silnici.</p></div>
      </div>
      <div class="iuPdCard__actions iuPrehledDne__actions iuPdCard__actions--traffic">
        <span class="iuPdCard__actionsMap">
          <a class="iuPdCard__czMap iuPrehledDne__czMap" href="https://www.dopravniinfo.cz/" target="_blank" rel="noopener noreferrer" aria-label="Mapa">
            <svg class="iuPrehledDne__czMapSvg" viewBox="0 0 48 28" aria-hidden="true"><rect width="48" height="28" rx="4"/></svg>
          </a>
        </span>
        <button type="button" class="iuPdBtn iuPdBtn--primary" data-act="traffic-follow">Sledovat</button>
        <button type="button" class="iuPdBtn iuPdBtn--ghost" data-act="hide">Skrýt</button>
      </div>
    </article>
  </li>
</ul>
</div></body></html>`;
}

async function measure(page, label, dark) {
  await page.setContent(fixtureHtml(dark), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".iuPdCard__actions--traffic", { timeout: 5000 });
  const m = await page.evaluate((tol) => {
    const card = document.querySelector("article.iuPdCard__body--traffic, article.iuPrehledDne__card");
    const actions = document.querySelector(".iuPdCard__actions--traffic");
    const mapWrap = actions && actions.querySelector(".iuPdCard__actionsMap");
    const mapLink = mapWrap && mapWrap.querySelector("a.iuPdCard__czMap, a.iuPrehledDne__czMap");
    const follow = actions && actions.querySelector('[data-act="traffic-follow"]');
    const hide = actions && actions.querySelector('[data-act="hide"]');
    if (!card || !actions || !mapWrap || !follow || !hide) {
      return { ok: false, reason: "missing_nodes" };
    }
    const cs = getComputedStyle(actions);
    const cardCs = getComputedStyle(card);
    const cr = card.getBoundingClientRect();
    const padRight = parseFloat(cardCs.paddingRight) || 0;
    const contentRight = cr.right - padRight;
    const mr = mapWrap.getBoundingClientRect();
    const fr = follow.getBoundingClientRect();
    const hr = hide.getBoundingClientRect();
    const ar = actions.getBoundingClientRect();
    const edgeDelta = Math.abs(hr.right - contentRight);
    const pageOverflow =
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const cardOverflow = card.scrollWidth > card.clientWidth + 1;
    function intersects(a, b) {
      return !(
        a.right <= b.left + 0.5 ||
        b.right <= a.left + 0.5 ||
        a.bottom <= b.top + 0.5 ||
        b.bottom <= a.top + 0.5
      );
    }
    const overlap = intersects(mr, fr) || intersects(fr, hr);
    // Horizontal / reading order: map before follow before hide (DOM order already fixed;
    // when wrapped, compare document order via offsetTop then offsetLeft).
    const orderOk =
      (mr.top + 1 < fr.top || mr.left <= fr.left + 1) &&
      (fr.top + 1 < hr.top || fr.left <= hr.left + 1);
    const clipped =
      hr.right > cr.right + 1 ||
      mr.left < cr.left - 1 ||
      fr.top < 0;
    return {
      ok: true,
      justify: cs.justifyContent,
      edgeDelta,
      contentRight,
      hideRight: hr.right,
      orderOk,
      pageOverflow,
      cardOverflow,
      overlap,
      clipped,
      mapHref: mapLink ? String(mapLink.getAttribute("href") || "") : "",
      followText: (follow.textContent || "").trim(),
      hideText: (hide.textContent || "").trim(),
      actionsWidth: ar.width,
      cardWidth: cr.width,
      withinTol: edgeDelta <= tol,
    };
  }, EDGE_TOL_PX);

  const mode = dark ? "dark" : "light";
  const prefix = label + "_" + mode;
  ok(prefix + "_nodes", m.ok === true, m.reason || "");
  if (!m.ok) return;

  ok(prefix + "_justify_flex_end", m.justify === "flex-end", m.justify);
  ok(prefix + "_RIGHT_ALIGNMENT", m.withinTol === true, "delta=" + m.edgeDelta);
  ok(prefix + "_MAP_ACTION_ORDER", m.orderOk === true, "geometry order");
  ok(prefix + "_PAGE_HORIZONTAL_OVERFLOW", m.pageOverflow === false, "page");
  ok(prefix + "_CARD_HORIZONTAL_OVERFLOW", m.cardOverflow === false, "card");
  ok(prefix + "_no_overlap", m.overlap === false, "overlap");
  ok(prefix + "_no_clip", m.clipped === false, "clip");
  ok(prefix + "_MAP_CLICK", /^https?:\/\//.test(m.mapHref), m.mapHref);
  ok(prefix + "_FOLLOW_ACTION", /Sledovat|Sleduji/.test(m.followText), m.followText);
  ok(prefix + "_HIDE_ACTION", /Skrýt|Skryt/.test(m.hideText), m.hideText);
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

  const viewports = [
    { id: "MOBILE_NARROW", size: { width: 320, height: 720 } },
    { id: "MOBILE", size: { width: 390, height: 844 } },
    { id: "TABLET", size: { width: 768, height: 1024 } },
    { id: "DESKTOP", size: { width: 1280, height: 900 } },
  ];

  try {
    for (const vp of viewports) {
      await page.setViewportSize(vp.size);
      await measure(page, vp.id, false);
      await measure(page, vp.id, true);
    }
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  const mobilePass = !fails.some((f) => f.startsWith("MOBILE") && f.includes("RIGHT_ALIGNMENT"));
  const tabletPass = !fails.some((f) => f.startsWith("TABLET") && f.includes("RIGHT_ALIGNMENT"));
  const desktopPass = !fails.some((f) => f.startsWith("DESKTOP") && f.includes("RIGHT_ALIGNMENT"));
  const overflowNone = !fails.some((f) => /HORIZONTAL_OVERFLOW/.test(f));
  const pass = fails.length === 0;

  console.log(
    JSON.stringify(
      {
        guard: "iu-traffic-card-actions-right-align",
        pass,
        MOBILE_RIGHT_ALIGNMENT: mobilePass ? "PASS" : "FAIL",
        TABLET_RIGHT_ALIGNMENT: tabletPass ? "PASS" : "FAIL",
        DESKTOP_RIGHT_ALIGNMENT: desktopPass ? "PASS" : "FAIL",
        CARD_HORIZONTAL_OVERFLOW: overflowNone ? "NONE" : "FAIL",
        PAGE_HORIZONTAL_OVERFLOW: overflowNone ? "NONE" : "FAIL",
        TRAFFIC_CARD_FOOTER_REGRESSION_GUARD: pass ? "PASS" : "FAIL",
        failCount: fails.length,
        fails,
      },
      null,
      2
    )
  );
  if (!pass) process.exit(1);
  console.log("TRAFFIC_CARD_FOOTER_REGRESSION_GUARD=PASS");
}

main().catch((e) => {
  console.error("IU_TRAFFIC_CARD_ACTIONS_RIGHT_ALIGN_GUARD_FATAL", e);
  process.exit(1);
});
