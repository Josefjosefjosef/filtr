#!/usr/bin/env node
/**
 * Freeze guard: Affiliate selected services — exactly 30 categories, order, layout.
 * Run: npm run iu-affiliate-categories-30-structure-guard
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

const MARKER = "affiliate-categories-30-structure-v1-20260919";
const SW_TOKEN = "2026-09-19-affiliate-categories-30-v1";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8963", 10);
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu_affiliate_categories_30_structure_guard.json"
);

const EXPECTED_ORDER = [
  "aff-cestovni-kancelare",
  "aff-ubytovani-hotely",
  "aff-letenky",
  "aff-cestovni-pojisteni",
  "aff-auto-moto",
  "aff-pojisteni",
  "aff-finance",
  "aff-energie-uspor",
  "aff-lekarny",
  "aff-zdravi-doplnky",
  "aff-kosmetika",
  "aff-drogerie",
  "aff-moda",
  "aff-boty",
  "aff-deti-hracky",
  "aff-sportovni-obleceni",
  "aff-sport-outdoor",
  "aff-dum-zahrada",
  "aff-nabytek",
  "aff-kuchyn",
  "aff-elektro",
  "aff-mobily",
  "aff-software",
  "aff-knihy",
  "aff-jidlo",
  "aff-zvirata",
  "aff-kvetiny-darky",
  "aff-sperky-hodinky",
  "aff-tv-streamovani",
  "aff-dilna-naradi",
];

const EXPECTED_TITLES = [
  "Cestovní kanceláře",
  "Ubytování a hotely",
  "Doprava a cestování",
  "Cestovní pojištění",
  "Auto a moto",
  "Pojištění",
  "Finance",
  "Energie a úspory",
  "Lékárny",
  "Zdraví a doplňky",
  "Kosmetika a parfémy",
  "Drogerie",
  "Móda a doplňky",
  "Boty a tenisky",
  "Děti a hračky",
  "Sportovní oblečení",
  "Sport a outdoor",
  "Dům a zahrada",
  "Bydlení a vybavení",
  "Kuchyně a domácnost",
  "Elektro a chytrá domácnost",
  "Mobily a příslušenství",
  "Software a bezpečnost",
  "Knihy, hudba a hry",
  "Jídlo a potraviny",
  "Zvířata a chovatelství",
  "Květiny a dárky",
  "Šperky a hodinky",
  "TV a streamování",
  "Dílna a nářadí",
];

const NEW_IDS = [
  "aff-kvetiny-darky",
  "aff-sperky-hodinky",
  "aff-tv-streamovani",
  "aff-dilna-naradi",
];

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function readCatalogIdsAndTitles() {
  const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const marker = catalog.indexOf("var IU_AFFILIATE_CATALOG");
  const slice = marker >= 0 ? catalog.slice(marker) : catalog;
  const ids = [];
  const titles = [];
  const blockRe = /id:\s*"(aff-[^"]+)"[\s\S]*?title:\s*"([^"]*)"/g;
  let m;
  while ((m = blockRe.exec(slice))) {
    ids.push(m[1]);
    titles.push(m[2]);
  }
  return { catalog, ids, titles };
}

function auditStatic() {
  const { catalog, ids, titles } = readCatalogIdsAndTitles();
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "assets", "app.css"), "utf8");
  const sprite = fs.readFileSync(path.join(ROOT, "assets", "icons", "iu-sprite.svg"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const allow = fs.readFileSync(
    path.join(ROOT, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs"),
    "utf8"
  );

  ok("count_30", ids.length === 30, "n=" + ids.length);
  ok(
    "order_exact",
    ids.length === EXPECTED_ORDER.length && EXPECTED_ORDER.every((id, i) => ids[i] === id),
    ids.join(",")
  );
  ok(
    "titles_exact",
    titles.length === EXPECTED_TITLES.length && EXPECTED_TITLES.every((t, i) => titles[i] === t),
    titles.join("|")
  );
  ok("no_old_label", !catalog.includes("Knihy, filmy a hry") && !titles.includes("Knihy, filmy a hry"));
  ok("has_new_knihy", titles.includes("Knihy, hudba a hry"));
  for (const id of NEW_IDS) {
    ok("new_id:" + id, ids.includes(id));
    ok("seo:" + id, catalog.includes('"' + id + '": affSeo('));
    ok("css_var:" + id, css.includes("--iuAff-" + id));
    ok("css_view:" + id, css.includes('data-aff-category="' + id + '"'));
    ok("css_nav:" + id, css.includes('data-accent="' + id + '"'));
  }
  for (const icon of ["iu-aff-flower", "iu-aff-watch", "iu-aff-tv", "iu-aff-hammer", "iu-aff-book"]) {
    ok("sprite:" + icon, sprite.includes('id="' + icon + '"'));
  }
  const uniq = new Set(ids);
  ok("no_dup_ids", uniq.size === ids.length, "uniq=" + uniq.size);
  ok("index_marker", index.includes(MARKER));
  ok("css_marker", css.includes(MARKER));
  ok("js_bust", index.includes("iu-affiliate-catalog.js?v=" + MARKER));
  ok("sw_allowed", swHasAllowedCacheVersion(sw));
  ok("allowlist_token", allow.includes(SW_TOKEN));
  ok("sw_token", sw.includes(SW_TOKEN));
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

async function openMenuRail(page, baseUrl, vp) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=menu&nosw=1&cb=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 90000,
  });
  await dismissConsent(page);
  await page
    .waitForFunction(() => typeof window.IU_AFFILIATE_CATALOG === "object", null, { timeout: 90000 })
    .catch(() => null);
  await page.waitForSelector('.iu-leftNavItem[data-rail="affiliate"]', { state: "attached", timeout: 90000 });
  if (vp && vp.name !== "desktop") {
    await page.evaluate(() => {
      try {
        document.body.classList.add("iu-mobileGateOverlayOpen");
        const wrap = document.getElementById("iuMobileGateWrap");
        if (wrap) wrap.setAttribute("data-iu-mobile-gate", "nav");
        const panel = document.getElementById("iuMobileGatePanelNav");
        if (panel) {
          panel.hidden = false;
          try {
            panel.removeAttribute("hidden");
          } catch (_) {}
          panel.style.display = "block";
        }
        const rail = document.querySelector("#iuMobileGatePanelNav #iuLeftRail") || document.getElementById("iuLeftRail");
        if (rail) {
          rail.hidden = false;
          try {
            rail.removeAttribute("hidden");
          } catch (_) {}
        }
      } catch (_) {}
    });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 80)));
  }
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
    (sec) => {
      const v = document.getElementById("iuAffiliateView");
      const t = document.getElementById("iuAffiliateTitle");
      return v && v.getAttribute("data-aff-category") === sec && t && (t.textContent || "").trim().length > 0;
    },
    section,
    { timeout: 90000 }
  );
}

auditStatic();
if (fails.length) {
  const out = { IU_AFFILIATE_CATEGORIES_30_STRUCTURE_GUARD: "FAIL", phase: "static", fails };
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

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, hasTouch: true },
  { name: "tablet", width: 768, height: 1024, hasTouch: true },
  { name: "desktop", width: 1280, height: 900, hasTouch: false },
  { name: "pwa", width: 390, height: 844, hasTouch: true, pwa: true },
];

const browser = await chromium.launch({ headless: true });
const samples = [];
try {
  for (const vp of VIEWPORTS) {
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
    await openMenuRail(page, `http://127.0.0.1:${PORT}/projects/`, vp);

    const layout = await page.evaluate((isDesktop) => {
      const title = document.querySelector(".iuLeftRailSectionTitle--affiliate");
      const items = [];
      if (title) {
        let el = title.nextElementSibling;
        while (el) {
          if (el.classList && el.classList.contains("iu-leftNavItem") && el.getAttribute("data-rail") === "affiliate") {
            items.push(el);
            el = el.nextElementSibling;
            continue;
          }
          break;
        }
      }
      if (!items.length) {
        const scope =
          (!isDesktop && document.querySelector("#iuMobileGatePanelNav #iuLeftRail")) ||
          document.getElementById("iuLeftRail");
        items.push(...((scope || document).querySelectorAll('.iu-leftNavItem[data-rail="affiliate"]')));
      }
      const labels = items.map((a) => {
        const lab = a.querySelector(".iu-leftNavLabel");
        return (lab ? lab.textContent : a.textContent || "").replace(/\s+/g, " ").trim();
      });
      const ids = items.map((a) => a.getAttribute("data-accent") || "");
      const tops = [];
      for (const a of items) {
        const r = a.getBoundingClientRect();
        if (r.width < 2 && r.height < 2) continue;
        const top = r.top;
        let placed = false;
        for (let ti = 0; ti < tops.length; ti++) {
          if (Math.abs(tops[ti].top - top) <= 8) {
            tops[ti].n += 1;
            placed = true;
            break;
          }
        }
        if (!placed) tops.push({ top: top, n: 1 });
      }
      const rowSizes = tops.map((row) => row.n);
      const overflow = items.some((a) => a.scrollWidth > a.clientWidth + 1);
      const lefts = [
        ...new Set(
          items
            .map((a) => Math.round(a.getBoundingClientRect().left))
            .filter((x) => Number.isFinite(x))
        ),
      ].sort((a, b) => a - b);
      let gridCols = "";
      try {
        const scope =
          (!isDesktop && document.querySelector("#iuMobileGatePanelNav #iuLeftRail")) ||
          document.getElementById("iuLeftRail");
        if (scope) gridCols = getComputedStyle(scope).gridTemplateColumns || "";
      } catch (_) {}
      return {
        count: items.length,
        labels,
        ids,
        rowSizes,
        maxPerRow: rowSizes.length ? Math.max(...rowSizes) : 0,
        overflow,
        gridCols,
        colCount: lefts.length,
      };
    }, vp.name === "desktop");

    ok(vp.name + ":rail_count_30", layout.count === 30, "n=" + layout.count);
    ok(
      vp.name + ":rail_order",
      layout.ids.length === EXPECTED_ORDER.length && EXPECTED_ORDER.every((id, i) => layout.ids[i] === id),
      layout.ids.join(",")
    );
    ok(
      vp.name + ":rail_titles",
      layout.labels.length === EXPECTED_TITLES.length &&
        EXPECTED_TITLES.every((t, i) => layout.labels[i] === t),
      layout.labels.join("|")
    );
    ok(vp.name + ":no_old_label_ui", !layout.labels.includes("Knihy, filmy a hry"));
    ok(vp.name + ":no_h_overflow", !layout.overflow);

    if (vp.name === "desktop") {
      ok(vp.name + ":one_col", layout.maxPerRow === 1 && layout.colCount === 1, "max=" + layout.maxPerRow + ";cols=" + layout.colCount);
    } else {
      const twoColCss = (layout.gridCols || "").split(/\s+/).filter(Boolean).length >= 2;
      ok(vp.name + ":two_col_css", twoColCss, layout.gridCols);
      ok(vp.name + ":two_col", layout.colCount === 2 || layout.maxPerRow === 2, "colCount=" + layout.colCount + ";max=" + layout.maxPerRow);
      ok(vp.name + ":rows_15", layout.rowSizes.length === 15, "rows=" + layout.rowSizes.length);
      ok(
        vp.name + ":all_pairs",
        layout.rowSizes.length === 15 && layout.rowSizes.every((n) => n === 2),
        layout.rowSizes.join(",")
      );
    }

    samples.push({
      vp: vp.name,
      count: layout.count,
      maxPerRow: layout.maxPerRow,
      rows: layout.rowSizes.length,
    });
    await context.close();
  }

  for (const section of NEW_IDS.concat(["aff-knihy"])) {
    for (const vp of [
      { name: "mobile", width: 390, height: 844, hasTouch: true },
      { name: "desktop", width: 1280, height: 900, hasTouch: false },
    ]) {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.hasTouch,
      });
      const page = await bootstrapGuardPage(context);
      await openAff(page, `http://127.0.0.1:${PORT}/projects/`, section);
      const snap = await page.evaluate((sec) => {
        const title = document.getElementById("iuAffiliateTitle");
        const view = document.getElementById("iuAffiliateView");
        const backCandidates = [
          document.querySelector('[data-iu-back]'),
          document.getElementById("iuSectionBack"),
          document.querySelector(".iuSectionBack"),
        ].filter(Boolean);
        return {
          title: (title ? title.textContent : "").replace(/\s+/g, " ").trim(),
          cat: view ? view.getAttribute("data-aff-category") || "" : "",
          overflow: view ? view.scrollWidth > view.clientWidth + 1 : false,
          hasBackHint: backCandidates.length > 0 || !!(view && view.offsetParent !== null),
        };
      }, section);
      const expectedTitle = EXPECTED_TITLES[EXPECTED_ORDER.indexOf(section)];
      ok(vp.name + ":" + section + ":title", snap.title === expectedTitle, snap.title);
      ok(vp.name + ":" + section + ":cat", snap.cat === section, snap.cat);
      ok(vp.name + ":" + section + ":no_overflow", !snap.overflow);
      ok(vp.name + ":" + section + ":view", snap.hasBackHint);
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
  IU_AFFILIATE_CATEGORIES_30_STRUCTURE_GUARD: pass ? "PASS" : "FAIL",
  count: EXPECTED_ORDER.length,
  samples,
  fails,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
