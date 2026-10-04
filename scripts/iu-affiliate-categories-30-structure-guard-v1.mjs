#!/usr/bin/env node
/**
 * Freeze guard: Affiliate selected services — base 30 categories prefix preserved (≥30).
 * Run: npm run iu-affiliate-categories-30-structure-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";
import { listenGuardServer } from "./guards/guard-repo-static-server.mjs";
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
const CATALOG_DELIVERY_MARKER = "affiliate-4kids-deti-hracky-v1-20260930";
const CATALOG_BUST = CATALOG_DELIVERY_MARKER;
const SW_TOKEN = "2026-09-26-affiliate-brainmarket-zdravi-doplnky-v1";
let PORT;
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu_affiliate_categories_30_structure_guard.json"
);

const EXPECTED_ORDER = [
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

const EXPECTED_TITLES = [
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

  ok("count_gte_32", ids.length >= 32, "n=" + ids.length);
  ok(
    "order_prefix_32",
    ids.length >= EXPECTED_ORDER.length && EXPECTED_ORDER.every((id, i) => ids[i] === id),
    ids.slice(0, 32).join(",")
  );
  ok(
    "titles_prefix_32",
    titles.length >= EXPECTED_TITLES.length && EXPECTED_TITLES.every((t, i) => titles[i] === t),
    titles.slice(0, 32).join("|")
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
  const slotSlugs = {
    "aff-kvetiny-darky": "kvetiny-empty-",
    "aff-tv-streamovani": "streamovani-empty-",
    "aff-dilna-naradi": "dilna-empty-",
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
  const sperkyStart = catalog.indexOf('id: "aff-sperky-hodinky"');
  const sperkyEnd = catalog.indexOf('id: "aff-tv-streamovani"', sperkyStart);
  const sperkyBlock =
    sperkyStart >= 0 && sperkyEnd > sperkyStart ? catalog.slice(sperkyStart, sperkyEnd) : "";
  ok(
    "sperky_slots_8",
    (sperkyBlock.match(/aff(?:Item|Partner)\(/g) || []).length === 8,
    "n=" + (sperkyBlock.match(/aff(?:Item|Partner)\(/g) || []).length
  );
  ok(
    "sperky_elenys_slot1",
    /items:\s*\[\s*affPartner\(\s*"ELENYS",\s*"https:\/\/www\.dpbolvw\.net\/click-101883843-15735899"\)/.test(
      sperkyBlock
    )
  );
  let sperkySlot = 2;
  while (sperkySlot <= 8) {
    ok(
      "sperky_slot_slug:" + sperkySlot,
      sperkyBlock.includes('affItem("", "sperky-empty-' + sperkySlot + '")')
    );
    sperkySlot += 1;
  }
  const modaStart = catalog.indexOf('id: "aff-moda"');
  const modaEnd = catalog.indexOf('id: "aff-boty"', modaStart);
  const modaBlock =
    modaStart >= 0 && modaEnd > modaStart ? catalog.slice(modaStart, modaEnd) : "";
  ok(
    "moda_slots_8",
    (modaBlock.match(/aff(?:Item|Partner)\(/g) || []).length === 8,
    "n=" + (modaBlock.match(/aff(?:Item|Partner)\(/g) || []).length
  );
  ok(
    "moda_meatfly_slot1",
    /items:\s*\[\s*affPartner\(\s*"Meatfly\.cz",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-15735649"\)/.test(
      modaBlock
    )
  );
  ok(
    "moda_kabea_slot2",
    /affPartner\(\s*"Kabea\.cz",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-15735243"\)/.test(modaBlock)
  );
  ok(
    "moda_kabea_after_meatfly",
    /affPartner\(\s*"Meatfly\.cz"[\s\S]*?affPartner\(\s*"Kabea\.cz",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-15735243"\)/.test(
      modaBlock
    )
  );
  ok(
    "moda_demix_slot3",
    /affPartner\(\s*"Demix\.cz",\s*"https:\/\/www\.tkqlhce\.com\/click-101883843-15202259"\)/.test(modaBlock)
  );
  ok(
    "moda_demix_after_kabea",
    /affPartner\(\s*"Kabea\.cz"[\s\S]*?affPartner\(\s*"Demix\.cz",\s*"https:\/\/www\.tkqlhce\.com\/click-101883843-15202259"\)/.test(
      modaBlock
    )
  );
  ok(
    "moda_trenyrkarna_slot4",
    /affPartner\(\s*"Trenýrkárna\.cz",\s*"https:\/\/www\.dpbolvw\.net\/click-101883843-15736041"\)/.test(modaBlock)
  );
  ok(
    "moda_trenyrkarna_after_demix",
    /affPartner\(\s*"Demix\.cz"[\s\S]*?affPartner\(\s*"Trenýrkárna\.cz",\s*"https:\/\/www\.dpbolvw\.net\/click-101883843-15736041"\)/.test(
      modaBlock
    )
  );
  ok("moda_trenyrkarna_label_not_europe", !/Trenyrkarna Europe/i.test(modaBlock));
  ok(
    "moda_vip_pradlo_slot5",
    /affPartner\(\s*"VIP-pradlo\.cz",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-15769149"\)/.test(modaBlock)
  );
  ok(
    "moda_vip_pradlo_after_trenyrkarna",
    /affPartner\(\s*"Trenýrkárna\.cz"[\s\S]*?affPartner\(\s*"VIP-pradlo\.cz",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-15769149"\)/.test(
      modaBlock
    )
  );
  const modaPlaceholders = ["bushman", "prm", "gant"];
  let modaSlot = 0;
  while (modaSlot < modaPlaceholders.length) {
    ok(
      "moda_slot_slug:" + (modaSlot + 6),
      modaBlock.includes('affItem("", "' + modaPlaceholders[modaSlot] + '")')
    );
    modaSlot += 1;
  }
  const botyStart = catalog.indexOf('id: "aff-boty"');
  const botyEnd = catalog.indexOf('id: "aff-deti-hracky"', botyStart);
  const botyBlock =
    botyStart >= 0 && botyEnd > botyStart ? catalog.slice(botyStart, botyEnd) : "";
  ok(
    "boty_slots_8",
    (botyBlock.match(/aff(?:Item|Partner)\(/g) || []).length === 8,
    "n=" + (botyBlock.match(/aff(?:Item|Partner)\(/g) || []).length
  );
  ok(
    "boty_rejnok_slot1",
    /items:\s*\[\s*affPartner\(\s*"Rejnok obuv",\s*"https:\/\/www\.dpbolvw\.net\/click-101883843-12939731"\)/.test(
      botyBlock
    )
  );
  ok(
    "boty_zdrava_slot2",
    /affPartner\(\s*"Zdrava-obuv-eshop\.cz",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-17274691"\)/.test(
      botyBlock
    )
  );
  ok(
    "boty_zdrava_after_rejnok",
    /affPartner\(\s*"Rejnok obuv"[\s\S]*?affPartner\(\s*"Zdrava-obuv-eshop\.cz",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-17274691"\)/.test(
      botyBlock
    )
  );
  const botyPlaceholders = ["shooos", "rejnok", "realfoot", "belenka", "barebarics", "skinners"];
  let botySlot = 0;
  while (botySlot < botyPlaceholders.length) {
    ok(
      "boty_slot_slug:" + (botySlot + 3),
      botyBlock.includes('affItem("", "' + botyPlaceholders[botySlot] + '")')
    );
    botySlot += 1;
  }
  ok("boty_no_queens_placeholder", !botyBlock.includes('affItem("", "queens")'));
  ok("boty_no_footshop_placeholder", !botyBlock.includes('affItem("", "footshop")'));
  const detiStart = catalog.indexOf('id: "aff-deti-hracky"');
  const detiEnd = catalog.indexOf('id: "aff-sportovni-obleceni"', detiStart);
  const detiBlock =
    detiStart >= 0 && detiEnd > detiStart ? catalog.slice(detiStart, detiEnd) : "";
  ok(
    "deti_slots_8",
    (detiBlock.match(/aff(?:Item|Partner)\(/g) || []).length === 8,
    "n=" + (detiBlock.match(/aff(?:Item|Partner)\(/g) || []).length
  );
  ok(
    "deti_bambule_slot1",
    /items:\s*\[\s*affPartner\(\s*"Bambule\.cz",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-12990634"\)/.test(
      detiBlock
    )
  );
  ok(
    "deti_feedo_slot2",
    /affPartner\(\s*"Feedo\.cz",\s*"https:\/\/www\.anrdoezrs\.net\/click-101883843-12984087"\)/.test(
      detiBlock
    )
  );
  ok(
    "deti_feedo_after_bambule",
    /affPartner\(\s*"Bambule\.cz"[\s\S]*?affPartner\(\s*"Feedo\.cz",\s*"https:\/\/www\.anrdoezrs\.net\/click-101883843-12984087"\)/.test(
      detiBlock
    )
  );
  ok(
    "deti_4kids_slot3",
    /affPartner\(\s*"4KIDS\.cz",\s*"https:\/\/www\.kqzyfj\.com\/click-101883843-14299748"\)/.test(
      detiBlock
    )
  );
  ok(
    "deti_4kids_after_feedo",
    /affPartner\(\s*"Feedo\.cz"[\s\S]*?affPartner\(\s*"4KIDS\.cz",\s*"https:\/\/www\.kqzyfj\.com\/click-101883843-14299748"\)/.test(
      detiBlock
    )
  );
  const detiPlaceholders = [
    "deti-hracky-4",
    "deti-hracky-5",
    "deti-hracky-6",
    "deti-hracky-7",
    "deti-hracky-8",
  ];
  let detiSlot = 0;
  while (detiSlot < detiPlaceholders.length) {
    ok(
      "deti_slot_slug:" + (detiSlot + 4),
      detiBlock.includes('affItem("", "' + detiPlaceholders[detiSlot] + '")')
    );
    detiSlot += 1;
  }
  ok("deti_no_deti_hracky_1_placeholder", !detiBlock.includes('affItem("", "deti-hracky-1")'));
  ok("deti_no_deti_hracky_2_placeholder", !detiBlock.includes('affItem("", "deti-hracky-2")'));
  ok("deti_no_deti_hracky_3_placeholder", !detiBlock.includes('affItem("", "deti-hracky-3")'));
  const sportStart = catalog.indexOf('id: "aff-sport-outdoor"');
  const sportEnd = catalog.indexOf('id: "aff-dum-zahrada"', sportStart);
  const sportBlock =
    sportStart >= 0 && sportEnd > sportStart ? catalog.slice(sportStart, sportEnd) : "";
  ok(
    "sport_slots_8",
    (sportBlock.match(/aff(?:Item|Partner)\(/g) || []).length === 8,
    "n=" + (sportBlock.match(/aff(?:Item|Partner)\(/g) || []).length
  );
  ok(
    "sport_parys_slot5",
    /affPartner\(\s*"PARYS\.CZ",\s*"https:\/\/www\.jdoqocy\.com\/click-101883843-12905804"\)/.test(sportBlock)
  );
  ok(
    "sport_urbane_slot6",
    /affPartner\(\s*"Urbane\.cz",\s*"https:\/\/www\.kqzyfj\.com\/click-101883843-15359455"\)/.test(sportBlock)
  );
  ok(
    "sport_urbane_after_parys",
    /affPartner\(\s*"PARYS\.CZ"[\s\S]*?affPartner\(\s*"Urbane\.cz",\s*"https:\/\/www\.kqzyfj\.com\/click-101883843-15359455"\)/.test(
      sportBlock
    )
  );
  ok("sport_slot_slug:7", sportBlock.includes('affItem("", "chytapust")'));
  ok("sport_slot_slug:8", sportBlock.includes('affItem("", "parys")'));
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

PORT = await listenGuardServer(server);
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

    ok(vp.name + ":rail_count_gte_30", layout.count >= 30, "n=" + layout.count);
    ok(
      vp.name + ":rail_order_prefix",
      layout.ids.length >= EXPECTED_ORDER.length && EXPECTED_ORDER.every((id, i) => layout.ids[i] === id),
      layout.ids.slice(0, 30).join(",")
    );
    ok(
      vp.name + ":rail_titles_prefix",
      layout.labels.length >= EXPECTED_TITLES.length &&
        EXPECTED_TITLES.every((t, i) => layout.labels[i] === t),
      layout.labels.slice(0, 30).join("|")
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
      ok(vp.name + ":rows_half", layout.rowSizes.length === expectRows, "rows=" + layout.rowSizes.length);
      ok(
        vp.name + ":pairs_ok",
        layout.rowSizes.length === expectRows &&
          layout.rowSizes.slice(0, -1).every((n) => n === 2),
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

  for (const section of NEW_IDS.concat(["aff-knihy", "aff-cestovni-kancelare", "aff-moda", "aff-sport-outdoor"])) {
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
      if (
        NEW_IDS.includes(section) ||
        section === "aff-moda" ||
        section === "aff-boty" ||
        section === "aff-deti-hracky" ||
        section === "aff-sport-outdoor"
      ) {
        ok(vp.name + ":" + section + ":slots_8", snap.slots === 8, "n=" + snap.slots);
        if (section === "aff-sperky-hodinky") {
          const chipSnap = await page.evaluate(() => {
            const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
            const first = chips[0];
            return first
              ? {
                  text: (first.textContent || "").replace(/\s+/g, " ").trim(),
                  href: first.getAttribute("href") || "",
                  target: first.getAttribute("target") || "",
                  rel: first.getAttribute("rel") || "",
                  ready: first.getAttribute("data-aff-ready") || "",
                }
              : null;
          });
          ok(
            vp.name + ":" + section + ":elenys_slot1",
            chipSnap &&
              chipSnap.text === "ELENYS" &&
              chipSnap.href === "https://www.dpbolvw.net/click-101883843-15735899" &&
              chipSnap.target === "_blank" &&
              chipSnap.rel === "sponsored noopener" &&
              chipSnap.ready === "1"
          );
        } else if (section === "aff-moda") {
          const chipSnap = await page.evaluate(() => {
            const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
            const chipAt = (idx) => {
              const el = chips[idx];
              return el
                ? {
                    text: (el.textContent || "").replace(/\s+/g, " ").trim(),
                    href: el.getAttribute("href") || "",
                    target: el.getAttribute("target") || "",
                    rel: el.getAttribute("rel") || "",
                    ready: el.getAttribute("data-aff-ready") || "",
                  }
                : null;
            };
            return {
              first: chipAt(0),
              second: chipAt(1),
              third: chipAt(2),
              fourth: chipAt(3),
              fifth: chipAt(4),
            };
          });
          ok(
            vp.name + ":" + section + ":meatfly_slot1",
            chipSnap.first &&
              chipSnap.first.text === "Meatfly.cz" &&
              chipSnap.first.href === "https://www.jdoqocy.com/click-101883843-15735649" &&
              chipSnap.first.target === "_blank" &&
              chipSnap.first.rel === "sponsored noopener" &&
              chipSnap.first.ready === "1"
          );
          ok(
            vp.name + ":" + section + ":kabea_slot2",
            chipSnap.second &&
              chipSnap.second.text === "Kabea.cz" &&
              chipSnap.second.href === "https://www.jdoqocy.com/click-101883843-15735243" &&
              chipSnap.second.target === "_blank" &&
              chipSnap.second.rel === "sponsored noopener" &&
              chipSnap.second.ready === "1"
          );
          ok(
            vp.name + ":" + section + ":demix_slot3",
            chipSnap.third &&
              chipSnap.third.text === "Demix.cz" &&
              chipSnap.third.href === "https://www.tkqlhce.com/click-101883843-15202259" &&
              chipSnap.third.target === "_blank" &&
              chipSnap.third.rel === "sponsored noopener" &&
              chipSnap.third.ready === "1"
          );
          ok(
            vp.name + ":" + section + ":trenyrkarna_slot4",
            chipSnap.fourth &&
              chipSnap.fourth.text === "Trenýrkárna.cz" &&
              chipSnap.fourth.href === "https://www.dpbolvw.net/click-101883843-15736041" &&
              chipSnap.fourth.target === "_blank" &&
              chipSnap.fourth.rel === "sponsored noopener" &&
              chipSnap.fourth.ready === "1" &&
              !/Trenyrkarna Europe/i.test(chipSnap.fourth.text)
          );
          ok(
            vp.name + ":" + section + ":vip_pradlo_slot5",
            chipSnap.fifth &&
              chipSnap.fifth.text === "VIP-pradlo.cz" &&
              chipSnap.fifth.href === "https://www.jdoqocy.com/click-101883843-15769149" &&
              chipSnap.fifth.target === "_blank" &&
              chipSnap.fifth.rel === "sponsored noopener" &&
              chipSnap.fifth.ready === "1"
          );
        } else if (section === "aff-boty") {
          const chipSnap = await page.evaluate(() => {
            const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
            const chipAt = (idx) => {
              const el = chips[idx];
              return el
                ? {
                    text: (el.textContent || "").replace(/\s+/g, " ").trim(),
                    href: el.getAttribute("href") || "",
                    target: el.getAttribute("target") || "",
                    rel: el.getAttribute("rel") || "",
                    ready: el.getAttribute("data-aff-ready") || "",
                  }
                : null;
            };
            return { first: chipAt(0), second: chipAt(1) };
          });
          ok(
            vp.name + ":" + section + ":rejnok_slot1",
            chipSnap.first &&
              chipSnap.first.text === "Rejnok obuv" &&
              chipSnap.first.href === "https://www.dpbolvw.net/click-101883843-12939731" &&
              chipSnap.first.target === "_blank" &&
              chipSnap.first.rel === "sponsored noopener" &&
              chipSnap.first.ready === "1"
          );
          ok(
            vp.name + ":" + section + ":zdrava_slot2",
            chipSnap.second &&
              chipSnap.second.text === "Zdrava-obuv-eshop.cz" &&
              chipSnap.second.href === "https://www.jdoqocy.com/click-101883843-17274691" &&
              chipSnap.second.target === "_blank" &&
              chipSnap.second.rel === "sponsored noopener" &&
              chipSnap.second.ready === "1"
          );
        } else if (section === "aff-deti-hracky") {
          const chipSnap = await page.evaluate(() => {
            const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
            const chipAt = (idx) => {
              const el = chips[idx];
              return el
                ? {
                    text: (el.textContent || "").replace(/\s+/g, " ").trim(),
                    href: el.getAttribute("href") || "",
                    target: el.getAttribute("target") || "",
                    rel: el.getAttribute("rel") || "",
                    ready: el.getAttribute("data-aff-ready") || "",
                  }
                : null;
            };
            return { first: chipAt(0), second: chipAt(1), third: chipAt(2) };
          });
          ok(
            vp.name + ":" + section + ":bambule_slot1",
            chipSnap.first &&
              chipSnap.first.text === "Bambule.cz" &&
              chipSnap.first.href === "https://www.jdoqocy.com/click-101883843-12990634" &&
              chipSnap.first.target === "_blank" &&
              chipSnap.first.rel === "sponsored noopener" &&
              chipSnap.first.ready === "1"
          );
          ok(
            vp.name + ":" + section + ":feedo_slot2",
            chipSnap.second &&
              chipSnap.second.text === "Feedo.cz" &&
              chipSnap.second.href === "https://www.anrdoezrs.net/click-101883843-12984087" &&
              chipSnap.second.target === "_blank" &&
              chipSnap.second.rel === "sponsored noopener" &&
              chipSnap.second.ready === "1"
          );
          ok(
            vp.name + ":" + section + ":4kids_slot3",
            chipSnap.third &&
              chipSnap.third.text === "4KIDS.cz" &&
              chipSnap.third.href === "https://www.kqzyfj.com/click-101883843-14299748" &&
              chipSnap.third.target === "_blank" &&
              chipSnap.third.rel === "sponsored noopener" &&
              chipSnap.third.ready === "1"
          );
        } else if (section === "aff-sport-outdoor") {
          const chipSnap = await page.evaluate(() => {
            const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
            const chipAt = (idx) => {
              const el = chips[idx];
              return el
                ? {
                    text: (el.textContent || "").replace(/\s+/g, " ").trim(),
                    href: el.getAttribute("href") || "",
                    target: el.getAttribute("target") || "",
                    rel: el.getAttribute("rel") || "",
                    ready: el.getAttribute("data-aff-ready") || "",
                  }
                : null;
            };
            return { fifth: chipAt(5), bushman: chipAt(0), parys: chipAt(4) };
          });
          ok(
            vp.name + ":" + section + ":urbane_slot6",
            chipSnap.fifth &&
              chipSnap.fifth.text === "Urbane.cz" &&
              chipSnap.fifth.href === "https://www.kqzyfj.com/click-101883843-15359455" &&
              chipSnap.fifth.target === "_blank" &&
              chipSnap.fifth.rel === "sponsored noopener" &&
              chipSnap.fifth.ready === "1"
          );
          ok(
            vp.name + ":" + section + ":bushman_slot1",
            chipSnap.bushman && chipSnap.bushman.text === "Bushman" && chipSnap.bushman.ready === "1"
          );
          ok(
            vp.name + ":" + section + ":parys_slot5",
            chipSnap.parys &&
              chipSnap.parys.text === "PARYS.CZ" &&
              chipSnap.parys.href === "https://www.jdoqocy.com/click-101883843-12905804" &&
              chipSnap.parys.ready === "1"
          );
        } else if (NEW_IDS.includes(section)) {
          ok(
            vp.name + ":" + section + ":partners_0",
            snap.emptyTitles === true && snap.noHttps === true && snap.allNeutral === true
          );
        }
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
  IU_AFFILIATE_CATEGORIES_30_STRUCTURE_GUARD: pass ? "PASS" : "FAIL",
  count: EXPECTED_ORDER.length,
  samples,
  fails,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
