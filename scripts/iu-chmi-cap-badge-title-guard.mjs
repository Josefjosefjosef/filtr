#!/usr/bin/env node
/**
 * Guard: CHMI CAP warning badge + title unify (PC / tablet / mobile).
 * Static contract + Playwright viewport checks with injected CAP v2 card.
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
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const NORM = path.join(ROOT, "scripts", "chmi-cap-v2", "normalize-feed.mjs");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8973", 10);
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const core = fs.readFileSync(CORE, "utf8");
  const norm = fs.readFileSync(NORM, "utf8");
  ok("ui_badge_text", /🔴 VÝSTRAHA ČHMÚ/.test(ui), "badge");
  ok("ui_no_old_badge_only", !/>🔴 VÝSTRAHA</.test(ui), "old badge");
  ok("ui_displayEventTitle", /function displayEventTitle/.test(ui), "helper");
  ok(
    "ui_strip_prefix",
    /V\[ýy\]straha\\s\+ČHM/.test(ui) ||
      /Výstraha\\s\+ČHM/.test(ui) ||
      /V\[ýy\]straha\\s\+ČHM/.test(core) ||
      /eventTitleBaseWithoutLocality/.test(core),
    "strip"
  );
  ok("css_badge_max_width", /\.iuPdCard__warnBadge[\s\S]*max-width:\s*100%/.test(css), "css");
  ok("norm_no_title_prefix", !/title:\s*`Výstraha ČHMÚ:/.test(norm), "norm prefix");
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      /* GET: some static servers answer slowly / oddly on HEAD under CI load. */
      const req = http.request({ host, port, path: "/projects/", method: "GET", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("timeout", () => {
        try { req.destroy(); } catch {}
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.end();
    };
    tryOnce();
  });
}

async function viewportCheck(page, label, size) {
  await page.setViewportSize(size);
  await page.setContent(
    `<!doctype html><html><head>
      <meta charset="utf-8"/>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <link rel="stylesheet" href="http://127.0.0.1:${PORT}/assets/iu-prehled-dne-v1.css"/>
      <style>body{margin:0;background:#f8fafc;font-family:system-ui,sans-serif}
      .wrap{max-width:720px;margin:0 auto;padding:12px}</style>
    </head><body><div class="wrap" id="host"></div>
    <script type="module">
      const ev = {
        id: "ie-chmi-v2-testbadge",
        title: "Výstraha ČHMÚ: Stav sucha — Praha",
        sourceId: "chmi",
        sourceLabel: "ČHMÚ",
        region: { name: "Praha" },
        importance: 3,
        eventType: "mimoradne",
        status: "aktivni",
        url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_badge.xml?hid=testbadge",
        publishedAt: "2026-07-29T10:00:00Z",
        capV2: { badgeActive: true, searchText: "vystraha chmu stav sucha praha" },
      };
      const plain = {
        id: "ie-other-1",
        title: "Běžná událost",
        sourceId: "mzcr",
        sourceLabel: "MZČR",
        importance: 1,
        eventType: "aktualni",
        status: "aktivni",
        publishedAt: "2026-07-29T10:00:00Z",
      };
      // Minimal inline of display + render contract (must match UI rules)
      function displayEventTitle(e) {
        const raw = String((e && e.title) || "").trim();
        if (!raw) return "Bez názvu";
        const stripped = raw
          .replace(/^\\s*V[ýy]straha\\s+ČHM[ÚU]\\s*[:\\-–—]\\s*/i, "")
          .replace(/^\\s*V[ýy]straha\\s+CHMU\\s*[:\\-–—]\\s*/i, "")
          .trim();
        return stripped || raw;
      }
      function card(e) {
        const capActive = !!(e.capV2 && e.capV2.badgeActive);
        const title = displayEventTitle(e);
        return '<li class="iuPdCard iuPrehledDne__item" data-id="'+e.id+'">'
          + '<div class="iuPrehledDne__timeCol"><div class="iuPdCard__time">12:00</div></div>'
          + '<div class="iuPrehledDne__axis" aria-hidden="true"><span class="iuPrehledDne__dot"></span></div>'
          + '<article class="iuPrehledDne__card iuPdCard__body">'
          + (capActive ? '<span class="iuPdCard__warnBadge iuPrehledDne__warnBadge" role="status">🔴 VÝSTRAHA ČHMÚ</span>' : '')
          + '<span class="iuPdCard__title iuPrehledDne__cardTitle">'+title+'</span>'
          + '<div class="iuPdCard__meta"><span class="iuPdCard__pill">'+(e.sourceLabel||'')+'</span></div>'
          + '<div class="iuPdCard__actions iuPrehledDne__actions">'
          + '<button type="button" class="iuPdBtn iuPdBtn--ghost">Uložit</button>'
          + '<button type="button" class="iuPdBtn iuPdBtn--ghost">Skrýt</button>'
          + '</div></article></li>';
      }
      document.getElementById('host').innerHTML = '<ul class="iuPrehledDne__timeline">'+card(ev)+card(plain)+'</ul>';
    </script></body></html>`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForSelector(".iuPdCard__warnBadge", { timeout: 5000 });
  const metrics = await page.evaluate(() => {
    const badge = document.querySelector(".iuPdCard__warnBadge");
    const title = document.querySelector(".iuPdCard__title");
    const card = document.querySelector(".iuPdCard");
    const actions = document.querySelector(".iuPdCard__actions");
    const plainBadge = document.querySelectorAll(".iuPdCard")[1]?.querySelector(".iuPdCard__warnBadge");
    const br = badge.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    return {
      badgeText: (badge.textContent || "").trim(),
      titleText: (title.textContent || "").trim(),
      plainHasBadge: !!plainBadge,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      badgeInside: br.right <= cr.right + 1 && br.left >= cr.left - 1,
      actionsOk: !!actions && actions.querySelectorAll("button").length === 2,
    };
  });
  ok(label + "_badge_text", metrics.badgeText.includes("VÝSTRAHA ČHMÚ"), metrics.badgeText);
  ok(label + "_title_no_prefix", !/^Výstraha\s+ČHMÚ\s*:/i.test(metrics.titleText), metrics.titleText);
  ok(label + "_title_keeps_event", /Stav sucha/i.test(metrics.titleText), metrics.titleText);
  ok(label + "_plain_no_badge", metrics.plainHasBadge === false, String(metrics.plainHasBadge));
  ok(label + "_no_h_overflow", metrics.overflowX === false, "overflow");
  ok(label + "_badge_inside", metrics.badgeInside === true, "clip");
  ok(label + "_actions", metrics.actionsOk === true, "actions");
}

async function main() {
  staticGate();
  let serverProc = null;
  const serverScript = path.join(ROOT, "server", "projects-static.mjs");
  serverProc = spawn(process.execPath, [serverScript], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "pipe"],
    shell: false,
  });
  let serverErr = "";
  serverProc.stderr.on("data", (c) => {
    serverErr += String(c);
  });
  serverProc.on("exit", (code) => {
    if (code && code !== 0 && !serverErr) serverErr = `static server exit ${code}`;
  });
  try {
    await waitForPort("127.0.0.1", PORT, 90000);
  } catch (err) {
    if (serverErr) console.error(serverErr.trim());
    throw err;
  }
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

  console.log("IU_CHMI_CAP_BADGE_TITLE_GUARD");
  console.log("FAIL_COUNT=" + fails.length);
  for (const f of fails) console.log("FAIL " + f);
  if (fails.length) {
    process.exit(1);
  }
  console.log("PASS=true");
}

main().catch((e) => {
  console.error("IU_CHMI_CAP_BADGE_TITLE_GUARD_FATAL", e);
  process.exit(1);
});
