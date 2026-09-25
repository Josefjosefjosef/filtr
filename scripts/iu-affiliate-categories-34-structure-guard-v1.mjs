#!/usr/bin/env node
/**
 * Freeze guard: Affiliate selected services — base 30 preserved + 4 new cats (31–34).
 * Does NOT require exact total count (future 35+ allowed). Protects the four new categories.
 * Run: npm run iu-affiliate-categories-34-structure-guard
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

const STRUCTURE_MARKER = "affiliate-categories-34-structure-v1-20260920";
const BOOKING_MARKER = "affiliate-booking-com-slot1-v1-20260920";
const LEO_MARKER = "affiliate-leo-express-slot1-v1-20260920";
const LETENKY_MARKER = "affiliate-letenky-letecka-doprava-v1-20260921";
const AXA_MARKER = "affiliate-axa-assistance-cestovni-pojisteni-v1-20260921";
const KLIK_MARKER = "affiliate-klik-cz-cestovni-pojisteni-v1-20260921";
const PNEU_MARKER = "affiliate-pneu-pneuservis-v1-20260921";
const AUTOHOTAREK_MARKER = "affiliate-autohotarek-auto-moto-v1-20260921";
const AHIFI_MARKER = "affiliate-ahifi-auto-moto-v1-20260922";
const KLIK_POJISTENI_MARKER = "affiliate-klik-pojisteni-v1-20260922";
const KALKULATOR_POJISTENI_MARKER = "affiliate-kalkulator-pojisteni-v1-20260922";
const LEKARNA_LEKARNY_MARKER = "affiliate-lekarna-lekarny-v1-20260922";
const LEKARNA_LEMON_MARKER = "affiliate-lekarna-lemon-lekarny-v1-20260923";
const KLUB_ZDRAVI_MARKER = "affiliate-klub-zdravi-zdravi-doplnky-v1-20260924";
const CATALOG_DELIVERY_MARKER = "affiliate-brasty-kosmetika-v1-20260925";
const CATALOG_BUST = CATALOG_DELIVERY_MARKER;
const SW_TOKEN = "2026-09-25-affiliate-brasty-kosmetika-v1";
const PORT = parseInt(process.env.IU_GUARD_PORT || "8964", 10);
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu_affiliate_categories_34_structure_guard.json"
);

/** Original 30 — must remain prefix in this order. */
const BASE_ORDER = [
  "aff-cestovni-kancelare",
  "aff-ubytovani-hotely",
  "aff-letenky",
  "aff-letenky-letecka-doprava",
  "aff-cestovni-pojisteni",
  "aff-auto-moto",
  "aff-pneu-pneuservis",
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

const BASE_TITLES = [
  "Cestovní kanceláře",
  "Ubytování a hotely",
  "Doprava a cestování",
  "Letenky a letecká doprava",
  "Cestovní pojištění",
  "Auto a moto",
  "Pneu a pneuservis",
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

/** Positions 31–34 (0-based 30–33). Future cats may follow. */
const NEW_ORDER = [
  "aff-inzerce-bazary",
  "aff-realitni-kancelare",
  "aff-reality-nemovitosti",
  "aff-kancelarske-potreby",
];

const NEW_TITLES = [
  "Inzerce a bazary",
  "Realitní kanceláře",
  "Reality a nemovitosti",
  "Kancelářské potřeby a vybavení",
];

const NEW_ICONS = [
  "iu-aff-marketplace",
  "iu-aff-agency",
  "iu-aff-property",
  "iu-aff-office",
];

const NEW_IDS = NEW_ORDER.slice();
const EXPECTED_ORDER = BASE_ORDER.concat(NEW_ORDER);
const EXPECTED_TITLES = BASE_TITLES.concat(NEW_TITLES);

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

  ok("count_gte_36", ids.length >= 36, "n=" + ids.length);
  ok(
    "base32_prefix",
    ids.length >= 32 && BASE_ORDER.every((id, i) => ids[i] === id),
    ids.slice(0, 32).join(",")
  );
  ok(
    "base32_titles",
    titles.length >= 32 && BASE_TITLES.every((t, i) => titles[i] === t),
    titles.slice(0, 32).join("|")
  );
  ok(
    "new4_positions_33_36",
    ids.length >= 36 && NEW_ORDER.every((id, i) => ids[32 + i] === id),
    ids.slice(32, 36).join(",")
  );
  ok(
    "new4_titles",
    titles.length >= 36 && NEW_TITLES.every((t, i) => titles[32 + i] === t),
    titles.slice(32, 36).join("|")
  );
  ok("no_old_label", !catalog.includes("Knihy, filmy a hry") && !titles.includes("Knihy, filmy a hry"));
  ok("has_new_knihy", titles.includes("Knihy, hudba a hry"));
  ok("no_wrong_office_name", !titles.includes("Kancelář a škola") && !titles.includes("Škola a kancelář"));
  for (let ni = 0; ni < NEW_IDS.length; ni++) {
    const id = NEW_IDS[ni];
    ok("new_id:" + id, ids.includes(id));
    ok("seo:" + id, catalog.includes('"' + id + '": affSeo('));
    ok("css_var:" + id, css.includes("--iuAff-" + id));
    ok("css_view:" + id, css.includes('data-aff-category="' + id + '"'));
    ok("css_nav:" + id, css.includes('data-accent="' + id + '"'));
    ok("icon_ref:" + id, catalog.includes('icon: "' + NEW_ICONS[ni] + '"'));
    ok("sprite:" + NEW_ICONS[ni], sprite.includes('id="' + NEW_ICONS[ni] + '"'));
  }
  ok("icons_distinct_agency_property", NEW_ICONS[1] !== NEW_ICONS[2]);
  const uniq = new Set(ids);
  ok("no_dup_ids", uniq.size === ids.length, "uniq=" + uniq.size);
  ok("index_structure_marker", index.includes(STRUCTURE_MARKER));
  ok("index_booking_marker", index.includes(BOOKING_MARKER));
  ok("index_leo_marker", index.includes(LEO_MARKER));
  ok("index_letenky_marker", index.includes(LETENKY_MARKER));
  ok("index_axa_marker", index.includes(AXA_MARKER));
  ok("index_klik_marker", index.includes(KLIK_MARKER));
  ok("index_pneu_marker", index.includes(PNEU_MARKER));
  ok("index_autohotarek_marker", index.includes(AUTOHOTAREK_MARKER));
  ok("index_ahifi_marker", index.includes(AHIFI_MARKER));
  ok("index_klik_pojisteni_marker", index.includes(KLIK_POJISTENI_MARKER));
  ok("index_kalkulator_pojisteni_marker", index.includes(KALKULATOR_POJISTENI_MARKER));
  ok("index_lekarna_lekarny_marker", index.includes(LEKARNA_LEKARNY_MARKER));
  ok("index_lekarna_lemon_marker", index.includes(LEKARNA_LEMON_MARKER));
  ok("index_klub_zdravi_marker", index.includes(KLUB_ZDRAVI_MARKER));
  ok("index_catalog_delivery_marker", index.includes(CATALOG_DELIVERY_MARKER));
  ok("css_structure_marker", css.includes(STRUCTURE_MARKER));
  ok("js_bust", index.includes("iu-affiliate-catalog.js?v=" + CATALOG_BUST));
  ok("sw_allowed", swHasAllowedCacheVersion(sw));
  ok("allowlist_token", allow.includes(SW_TOKEN));
  ok("sw_token", sw.includes(SW_TOKEN));
  ok("letenky_icon", catalog.includes('id: "aff-letenky-letecka-doprava"') && catalog.includes('icon: "iu-aff-plane"'));
  ok("letenky_css", css.includes("--iuAff-aff-letenky-letecka-doprava"));
  ok("sprite:iu-aff-plane", sprite.includes('id="iu-aff-plane"'));
  const letStart = catalog.indexOf('id: "aff-letenky-letecka-doprava"');
  const letEnd = catalog.indexOf('id: "aff-cestovni-pojisteni"', letStart);
  const letBlock = letStart >= 0 && letEnd > letStart ? catalog.slice(letStart, letEnd) : "";
  ok("letenky_slots_8", (letBlock.match(/affItem\(/g) || []).length === 8, "n=" + (letBlock.match(/affItem\(/g) || []).length);
  ok("letenky_no_https", !/https:\/\//i.test(letBlock));
  ok("letenky_after_doprava", catalog.indexOf('id: "aff-letenky-letecka-doprava"') > catalog.indexOf('id: "aff-letenky"'));
  ok("pneu_icon", catalog.includes('id: "aff-pneu-pneuservis"') && catalog.includes('icon: "iu-aff-wheel"'));
  ok("pneu_after_auto", catalog.indexOf('id: "aff-pneu-pneuservis"') > catalog.indexOf('id: "aff-auto-moto"'));
  ok("pneu_before_pojisteni", catalog.indexOf('id: "aff-pojisteni"') > catalog.indexOf('id: "aff-pneu-pneuservis"'));
  ok("sprite_wheel", sprite.includes('id="iu-aff-wheel"'));
  const slotSlugs = {
    "aff-inzerce-bazary": "inzerce-empty-",
    "aff-realitni-kancelare": "realitni-kancelare-empty-",
    "aff-reality-nemovitosti": "reality-empty-",
    "aff-kancelarske-potreby": "kancelarske-empty-",
  };
  for (const id of Object.keys(slotSlugs)) {
    const prefix = slotSlugs[id];
    const start = catalog.indexOf('id: "' + id + '"');
    const next = catalog.indexOf("\n    {", start + 10);
    const block = start >= 0 ? catalog.slice(start, next > start ? next : start + 1200) : "";
    const n = (block.match(/affItem\(/g) || []).length;
    ok("slots8:" + id, n === 8, "n=" + n);
    ok("slots_no_https:" + id, !/https:\/\//i.test(block));
    ok("slots_no_named_partner:" + id, !/affItem\(\s*"[^"]+"/.test(block));
    ok("slots_wrapper:" + id, /items:\s*\[/.test(block));
    let i = 1;
    while (i <= 8) {
      ok("slot_slug:" + id + ":" + i, block.includes('affItem("", "' + prefix + i + '")'));
      i += 1;
    }
  }
  const travelStart = catalog.indexOf('id: "aff-cestovni-kancelare"');
  const travelEnd = catalog.indexOf('id: "aff-ubytovani-hotely"');
  const travelBlock = travelStart >= 0 && travelEnd > travelStart ? catalog.slice(travelStart, travelEnd) : "";
  const travelItems = (travelBlock.match(/affItem\(/g) || []).length;
  ok("reference_slots_8", travelItems === 8, "n=" + travelItems);
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
  const out = { IU_AFFILIATE_CATEGORIES_34_STRUCTURE_GUARD: "FAIL", phase: "static", fails };
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

    ok(vp.name + ":rail_count_gte_36", layout.count >= 36, "n=" + layout.count);
    ok(
      vp.name + ":rail_base32",
      layout.ids.length >= 32 && BASE_ORDER.every((id, i) => layout.ids[i] === id),
      layout.ids.slice(0, 32).join(",")
    );
    ok(
      vp.name + ":rail_new4",
      layout.ids.length >= 36 && NEW_ORDER.every((id, i) => layout.ids[32 + i] === id),
      layout.ids.slice(32, 36).join(",")
    );
    ok(
      vp.name + ":rail_titles_prefix36",
      layout.labels.length >= 36 &&
        EXPECTED_TITLES.every((t, i) => layout.labels[i] === t),
      layout.labels.slice(0, 36).join("|")
    );
    ok(vp.name + ":no_old_label_ui", !layout.labels.includes("Knihy, filmy a hry"));
    ok(vp.name + ":no_h_overflow", !layout.overflow);

    if (vp.name === "desktop") {
      ok(vp.name + ":one_col", layout.maxPerRow === 1 && layout.colCount === 1, "max=" + layout.maxPerRow + ";cols=" + layout.colCount);
      const icons = await page.evaluate((ids) => {
        const out = {};
        for (const id of ids) {
          const a = document.querySelector('.iu-leftNavItem[data-accent="' + id + '"] .iu-leftNavIcon');
          const svg = a ? a.querySelector("svg") : null;
          const r = svg ? svg.getBoundingClientRect() : { width: 0, height: 0 };
          out[id] = !!(svg && r.width > 2 && r.height > 2);
        }
        return out;
      }, NEW_IDS);
      for (const id of NEW_IDS) {
        ok("desktop:icon:" + id, icons[id] === true);
      }
    } else {
      const twoColCss = (layout.gridCols || "").split(/\s+/).filter(Boolean).length >= 2;
      ok(vp.name + ":two_col_css", twoColCss, layout.gridCols);
      ok(vp.name + ":two_col", layout.colCount === 2 || layout.maxPerRow === 2, "colCount=" + layout.colCount + ";max=" + layout.maxPerRow);
      const expectRows = Math.ceil(layout.count / 2);
      ok(vp.name + ":rows_half", layout.rowSizes.length === expectRows, "rows=" + layout.rowSizes.length + ";expect=" + expectRows);
      ok(
        vp.name + ":pairs_or_last",
        layout.rowSizes.length === expectRows &&
          layout.rowSizes.slice(0, -1).every((n) => n === 2) &&
          (layout.rowSizes[layout.rowSizes.length - 1] === 2 ||
            layout.rowSizes[layout.rowSizes.length - 1] === 1),
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

  for (const section of NEW_IDS.concat(["aff-knihy", "aff-cestovni-kancelare", "aff-letenky-letecka-doprava"])) {
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
        });
      }
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
        const grid = document.getElementById("iuAffiliateGrid");
        const seo = document.getElementById("iuAffiliateSeo");
        const chips = grid ? Array.from(grid.querySelectorAll("a.iuAffiliateChip")) : [];
        const titles = chips.map((c) => (c.textContent || "").replace(/\s+/g, " ").trim());
        const hrefs = chips.map((c) => c.getAttribute("href") || "");
        const ready = chips.map((c) => c.getAttribute("data-aff-ready") || "");
        let seoAfterGrid = false;
        if (grid && seo && grid.compareDocumentPosition) {
          seoAfterGrid = (grid.compareDocumentPosition(seo) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        }
        return {
          title: (title ? title.textContent : "").replace(/\s+/g, " ").trim(),
          cat: view ? view.getAttribute("data-aff-category") || "" : "",
          overflow: view ? view.scrollWidth > view.clientWidth + 1 : false,
          hasBackHint: backCandidates.length > 0 || !!(view && view.offsetParent !== null),
          slots: chips.length,
          emptyTitles: titles.every((t) => t === ""),
          noHttps: hrefs.every((h) => !/^https?:/i.test(h)),
          allNeutral: ready.every((r) => r === "0"),
          seoAfterGrid,
          seoVisible: !!(seo && !seo.hidden && (seo.textContent || "").trim().length > 0),
        };
      }, section);
      const expectedTitle = EXPECTED_TITLES[EXPECTED_ORDER.indexOf(section)];
      ok(vp.name + ":" + section + ":title", snap.title === expectedTitle, snap.title);
      ok(vp.name + ":" + section + ":cat", snap.cat === section, snap.cat);
      ok(vp.name + ":" + section + ":no_overflow", !snap.overflow);
      ok(vp.name + ":" + section + ":view", snap.hasBackHint);
      if (NEW_IDS.includes(section) || section === "aff-letenky-letecka-doprava") {
        ok(vp.name + ":" + section + ":slots_8", snap.slots === 8, "n=" + snap.slots);
        ok(vp.name + ":" + section + ":partners_0", snap.emptyTitles === true && snap.noHttps === true && snap.allNeutral === true);
        ok(vp.name + ":" + section + ":seo_after_slots", snap.seoAfterGrid === true && snap.seoVisible === true);
      }
      if (section === "aff-cestovni-kancelare") {
        ok(vp.name + ":reference_slots_8", snap.slots === 8, "n=" + snap.slots);
      }
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
  IU_AFFILIATE_CATEGORIES_34_STRUCTURE_GUARD: pass ? "PASS" : "FAIL",
  countMin: 35,
  protectedNew: NEW_IDS,
  samples,
  fails,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
