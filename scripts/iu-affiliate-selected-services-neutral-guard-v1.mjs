#!/usr/bin/env node
/**
 * Guard: Affiliate / selected services — neutral presentation + ad disclosure.
 * Run: npm run iu-affiliate-selected-services-neutral-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const SECTION_TITLE = "Vybrané služby a odkazy";
const DISCLOSURE =
  "Tato sekce obsahuje reklamní a partnerské odkazy na externí služby a obchody.";
const TRAVEL_INTRO =
  "Odkazy na vybrané cestovní kanceláře a služby související s cestováním.";
const TRAVEL_SEO_H2 = "Cestovní kanceláře – odkazy na vybrané externí služby";
const TRAVEL_SEO_P3 =
  "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.";

const FORBIDDEN = [
  "DOPORUČENÉ SLUŽBY",
  "Doporučené služby",
  "ověřené služby a obchody",
  "Vyberte si cestovní kancelář a zobrazte aktuální nabídku zájezdů.",
  "Klíčová slova:",
  "může obsahovat reklamní",
  "bez zbytečného proklikávání",
  "Praktický rozcestník ušetří",
];

const EXPECTED_CAT_IDS = [
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
  "aff-inzerce-bazary",
  "aff-realitni-kancelare",
  "aff-reality-nemovitosti",
  "aff-kancelarske-potreby",
];

const EXPECTED_CAT_TITLES = {
  "aff-letenky": "Doprava a cestování",
  "aff-letenky-letecka-doprava": "Letenky a letecká doprava",
  "aff-moda": "Móda a doplňky",
  "aff-deti-hracky": "Děti a hračky",
  "aff-nabytek": "Bydlení a vybavení",
  "aff-knihy": "Knihy, hudba a hry",
  "aff-kvetiny-darky": "Květiny a dárky",
  "aff-sperky-hodinky": "Šperky a hodinky",
  "aff-tv-streamovani": "TV a streamování",
  "aff-dilna-naradi": "Dílna a nářadí",
  "aff-inzerce-bazary": "Inzerce a bazary",
  "aff-realitni-kancelare": "Realitní kanceláře",
  "aff-reality-nemovitosti": "Reality a nemovitosti",
  "aff-kancelarske-potreby": "Kancelářské potřeby a vybavení",
};

const EXPECTED_CAT_ICONS = {
  "aff-letenky": "iu-aff-transport",
  "aff-letenky-letecka-doprava": "iu-aff-plane",
  "aff-moda": "iu-aff-shirt",
  "aff-deti-hracky": "iu-aff-blocks",
  "aff-nabytek": "iu-aff-sofa",
  "aff-knihy": "iu-aff-book",
  "aff-kvetiny-darky": "iu-aff-flower",
  "aff-sperky-hodinky": "iu-aff-watch",
  "aff-tv-streamovani": "iu-aff-tv",
  "aff-dilna-naradi": "iu-aff-hammer",
  "aff-inzerce-bazary": "iu-aff-marketplace",
  "aff-realitni-kancelare": "iu-aff-agency",
  "aff-reality-nemovitosti": "iu-aff-property",
  "aff-kancelarske-potreby": "iu-aff-office",
};

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");

  ok("catalog:disclosure", catalog.includes(DISCLOSURE));
  ok("catalog:section_title", catalog.includes('title.textContent = "' + SECTION_TITLE + '"'));
  ok("catalog:travel_intro", catalog.includes(TRAVEL_INTRO));
  ok("catalog:travel_seo_h2", catalog.includes(TRAVEL_SEO_H2));
  ok("catalog:travel_seo_p3", catalog.includes(TRAVEL_SEO_P3));
  ok("catalog:no_keywords_render", !catalog.includes("Klíčová slova:"));
  ok("catalog:no_keywords_field", !/\bkeywords\s*:/.test(catalog));
  for (const id of EXPECTED_CAT_IDS) {
    ok("catalog:cat:" + id, catalog.includes('id: "' + id + '"'));
    ok("catalog:seo:" + id, catalog.includes('"' + id + '": affSeo('));
  }
  ok("catalog:count_gte_36", EXPECTED_CAT_IDS.length >= 36, "n=" + EXPECTED_CAT_IDS.length);
  ok("catalog:no_old_knihy_label", !catalog.includes("Knihy, filmy a hry"));
  ok("catalog:new_knihy_label", catalog.includes("Knihy, hudba a hry"));
  const catalogMarker = catalog.indexOf("var IU_AFFILIATE_CATALOG");
  const catalogSlice = catalogMarker >= 0 ? catalog.slice(catalogMarker) : catalog;
  const catalogIds = [];
  const catIdRe = /id:\s*"(aff-[^"]+)"/g;
  let cm;
  while ((cm = catIdRe.exec(catalogSlice))) catalogIds.push(cm[1]);
  ok("catalog:order_len_gte", catalogIds.length >= EXPECTED_CAT_IDS.length, "got=" + catalogIds.length);
  ok(
    "catalog:order_prefix",
    catalogIds.length >= EXPECTED_CAT_IDS.length &&
      EXPECTED_CAT_IDS.every((id, i) => catalogIds[i] === id),
    catalogIds.join(",")
  );
  for (const [id, title] of Object.entries(EXPECTED_CAT_TITLES)) {
    ok("catalog:title:" + id, catalog.includes('title: "' + title + '"'), title);
    ok("catalog:seo_title:" + id, catalog.includes(title + " – odkazy"), title);
  }
  for (const [id, icon] of Object.entries(EXPECTED_CAT_ICONS)) {
    const blockRe = new RegExp('id:\\s*"' + id + '"[\\s\\S]*?icon:\\s*"' + icon + '"');
    ok("catalog:icon:" + id, blockRe.test(catalog), icon);
  }
  const sprite = fs.readFileSync(path.join(ROOT, "assets", "icons", "iu-sprite.svg"), "utf8");
  for (const icon of Object.values(EXPECTED_CAT_ICONS)) {
    ok("sprite:symbol:" + icon, sprite.includes('id="' + icon + '"'));
  }
  ok("css:deti_accent", fs.readFileSync(path.join(ROOT, "assets", "app.css"), "utf8").includes("--iuAff-aff-deti-hracky"));
  const itemCount = (catalog.match(/affItem\(/g) || []).length;
  ok("catalog:items_present", itemCount >= 25, "items=" + itemCount);
  ok("catalog:placeholder_urls_intact", catalog.includes('url: "#affiliate-placeholder-" + slug'));
  ok("catalog:cedok_slug", catalog.includes('affItem("", "cedok")'));
  const namedPlaceholders = (catalog.match(/affItem\("([^"]*)",/g) || [])
    .map((s) => {
      const m = s.match(/affItem\("([^"]*)",/);
      return m ? m[1] : "";
    })
    .filter((t) => t !== "");
  ok("catalog:placeholder_labels_empty", namedPlaceholders.length === 0, "named=" + namedPlaceholders.join("|"));
  ok("catalog:booking_partner", /affPartner\(\s*"Booking\.com"/.test(catalog));
  ok("catalog:booking_cj_url", catalog.includes("https://www.anrdoezrs.net/click-101883843-13323565"));
  ok("catalog:leo_partner", /affPartner\(\s*"Leo Express"/.test(catalog));
  ok("catalog:leo_cj_url", catalog.includes("https://www.jdoqocy.com/click-101883843-15736211"));
  ok("catalog:ready_gate", catalog.includes("affiliateUrlReady === true"));
  ok("catalog:sponsored_noopener", catalog.includes('rel="sponsored noopener"'));
  ok("catalog:no_legacy_nofollow_rel", !catalog.includes('rel="nofollow sponsored noopener noreferrer"'));
  for (const b of FORBIDDEN) {
    ok("catalog:no:" + b.slice(0, 36), !catalog.includes(b));
  }

  ok("index:default_title", index.includes(">" + SECTION_TITLE + "<") || index.includes('iuAffiliateTitle">' + SECTION_TITLE));
  ok("index:cache_bust", index.includes("affiliate-catalog-network-first-v1-20260924"));
  ok("index:leo_marker_retained", index.includes("affiliate-leo-express-slot1-v1-20260920"));
  ok("index:shell", index.includes('id="iuAffiliateView"'));
  ok("index:no_doporucene_in_aff_shell", !/iuAffiliateTitle">Doporučené služby</.test(index));
  ok("index:info_center_no_doporucovane", !index.includes("Doporučované služby"));
  ok("index:info_center_no_doporucene_sluzby", !/Některé doporučené služby/.test(index));
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
  await page.waitForSelector("#iuAffiliateGrid .iuAffiliateChip", { state: "attached", timeout: 90000 });
}

auditStatic();
if (fails.length) {
  console.log(
    JSON.stringify({ IU_AFFILIATE_SELECTED_SERVICES_NEUTRAL_GUARD: "FAIL", phase: "static", fails }, null, 2)
  );
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8957", 10);
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

const sampleSections = [
  "aff-cestovni-kancelare",
  "aff-letenky",
  "aff-finance",
  "aff-pojisteni",
  "aff-energie-uspor",
  "aff-lekarny",
  "aff-zdravi-doplnky",
  "aff-software",
  "aff-elektro",
  "aff-moda",
  "aff-deti-hracky",
  "aff-nabytek",
];

const browser = await chromium.launch({ headless: true });
try {
  for (const vp of [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ]) {
    for (const section of sampleSections) {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.name !== "desktop",
      });
      const page = await bootstrapGuardPage(context);
      await openAff(page, `http://127.0.0.1:${PORT}/projects/`, section);

      const snap = await page.evaluate((args) => {
        const forbidden = args.forbidden;
        const disclosureExpected = args.disclosure;
        const view = document.getElementById("iuAffiliateView");
        const disc = document.getElementById("iuAffiliateDisclosure");
        const sub = document.getElementById("iuAffiliateSubtitle");
        const seo = document.getElementById("iuAffiliateSeo");
        const title = document.getElementById("iuAffiliateTitle");
        const chips = [...document.querySelectorAll("#iuAffiliateGrid .iuAffiliateChip")].map((a) => ({
          text: (a.innerText || "").replace(/\s+/g, " ").trim(),
          href: a.getAttribute("href") || "",
          ready: a.getAttribute("data-aff-ready") || "",
        }));
        const body = view ? view.textContent || "" : "";
        const rail = document.querySelector(".iuLeftRailSectionTitle--affiliate");
        return {
          title: (title ? title.textContent : "").replace(/\s+/g, " ").trim(),
          subtitle: (sub ? sub.textContent : "").replace(/\s+/g, " ").trim(),
          disclosure: (disc ? disc.textContent : "").replace(/\s+/g, " ").trim(),
          seoText: (seo ? seo.textContent : "").replace(/\s+/g, " ").trim(),
          railTitle: rail ? (rail.textContent || "").replace(/\s+/g, " ").trim() : "",
          chipCount: chips.length,
          chips,
          overflow: view ? view.scrollWidth > view.clientWidth + 1 : false,
          forbiddenHit: forbidden.find((b) => body.includes(b)) || null,
          disclosureOk: (disc ? disc.textContent : "").includes(disclosureExpected),
        };
      }, { forbidden: FORBIDDEN, disclosure: DISCLOSURE });

      const tag = vp.name + ":" + section;
      ok(tag + ":disclosure", snap.disclosureOk, snap.disclosure);
      ok(tag + ":chips", snap.chipCount >= 1, "chips=" + snap.chipCount);
      const namedChips = (snap.chips || []).filter((c) => (c.text || "").trim() !== "");
      if (section === "aff-letenky") {
        ok(
          tag + ":chips_named_leo_only",
          namedChips.length === 1 && namedChips[0].text === "Leo Express",
          namedChips.map((c) => c.text).join("|")
        );
      } else if (section === "aff-lekarny") {
        const lekCz = namedChips.find((c) => c.text === "Lékárna.cz");
        const lemon = namedChips.find((c) => c.text === "Lékárna Lemon");
        ok(
          tag + ":chips_named_lekarny_partners",
          namedChips.length === 2 &&
            lekCz &&
            lemon &&
            lekCz.href === "https://www.kqzyfj.com/click-101883843-15734937" &&
            lemon.href === "https://www.jdoqocy.com/click-101883843-14563148" &&
            lekCz.ready === "1" &&
            lemon.ready === "1",
          namedChips.map((c) => c.text + ":" + c.href).join("|")
        );
      } else if (section === "aff-zdravi-doplnky") {
        const klub = namedChips.find((c) => c.text === "Klub zdraví");
        const bw = namedChips.find((c) => c.text === "BodyWorld");
        const uniz = namedChips.find((c) => c.text === "Unizdrav");
        ok(
          tag + ":chips_named_zdravi_partners",
          namedChips.length === 3 &&
            klub &&
            bw &&
            uniz &&
            klub.href === "https://www.dpbolvw.net/click-101883843-13884010" &&
            bw.href === "https://www.tkqlhce.com/click-101883843-15735791" &&
            uniz.href === "https://www.kqzyfj.com/click-101883843-15735719" &&
            klub.ready === "1" &&
            bw.ready === "1" &&
            uniz.ready === "1",
          namedChips.map((c) => c.text + ":" + c.href).join("|")
        );
      } else if (section === "aff-pojisteni") {
        const klikChip = namedChips.find((c) => c.text === "Klik.cz");
        const kalkChip = namedChips.find((c) => c.text === "Kalkulator.cz");
        ok(
          tag + ":chips_named_pojisteni_partners",
          namedChips.length === 2 &&
            klikChip &&
            kalkChip &&
            klikChip.href === "https://www.dpbolvw.net/click-101883843-15024026" &&
            kalkChip.href === "https://www.kqzyfj.com/click-101883843-15616442" &&
            klikChip.ready === "1" &&
            kalkChip.ready === "1",
          namedChips.map((c) => c.text + ":" + c.href).join("|")
        );
      } else {
        ok(tag + ":chips_labels_empty", namedChips.length === 0, namedChips[0] ? namedChips[0].text : "");
      }
      ok(tag + ":no_forbidden", !snap.forbiddenHit, snap.forbiddenHit);
      ok(tag + ":no_h_overflow", !snap.overflow);
      ok(tag + ":seo_has_neprovozuje", /neprovozuje/.test(snap.seoText));
      ok(tag + ":seo_no_keywords", !/Klíčová slova/.test(snap.seoText));
      if (section === "aff-cestovni-kancelare") {
        ok(tag + ":travel_intro", snap.subtitle === TRAVEL_INTRO, snap.subtitle);
        ok(tag + ":travel_seo_h2", snap.seoText.includes(TRAVEL_SEO_H2));
      }
      if (section === "aff-letenky") {
        ok(tag + ":title_doprava", snap.title === "Doprava a cestování", snap.title);
      }
      if (section === "aff-moda") {
        ok(tag + ":title_moda", snap.title === "Móda a doplňky", snap.title);
      }
      if (section === "aff-nabytek") {
        ok(tag + ":title_bydleni", snap.title === "Bydlení a vybavení", snap.title);
      }
      if (section === "aff-deti-hracky") {
        ok(tag + ":title_deti", snap.title === "Děti a hračky", snap.title);
      }
      if (vp.name === "desktop" && section === "aff-cestovni-kancelare") {
        ok(tag + ":rail_title", snap.railTitle === SECTION_TITLE || /Vybrané služby a odkazy/i.test(snap.railTitle), snap.railTitle);
        const railSnap = await page.evaluate((expectedIds) => {
          const items = Array.from(
            document.querySelectorAll('#iuLeftRail .iu-leftNavItem[data-rail="affiliate"]')
          );
          return {
            count: items.length,
            ids: items.map((el) => el.getAttribute("data-accent") || ""),
            labels: items.map((el) => {
              const lab = el.querySelector(".iu-leftNavLabel");
              return lab ? (lab.textContent || "").replace(/\s+/g, " ").trim() : "";
            }),
          };
        }, EXPECTED_CAT_IDS);
        ok(tag + ":rail_count_gte_34", railSnap.count >= EXPECTED_CAT_IDS.length, "count=" + railSnap.count);
        ok(
          tag + ":rail_order_prefix",
          railSnap.ids.length >= EXPECTED_CAT_IDS.length &&
            EXPECTED_CAT_IDS.every((id, i) => railSnap.ids[i] === id),
          railSnap.ids.join(",")
        );
        ok(tag + ":rail_label_doprava", railSnap.labels[2] === "Doprava a cestování", railSnap.labels[2]);
        ok(
          tag + ":rail_label_letenky",
          railSnap.labels[3] === "Letenky a letecká doprava",
          railSnap.labels[3]
        );
        ok(tag + ":rail_label_auto", railSnap.labels[5] === "Auto a moto", railSnap.labels[5]);
        ok(tag + ":rail_label_pneu", railSnap.labels[6] === "Pneu a pneuservis", railSnap.labels[6]);
        ok(tag + ":rail_label_pojisteni", railSnap.labels[7] === "Pojištění", railSnap.labels[7]);
        ok(tag + ":rail_label_moda", railSnap.labels[14] === "Móda a doplňky", railSnap.labels[14]);
        ok(tag + ":rail_label_deti", railSnap.labels[16] === "Děti a hračky", railSnap.labels[16]);
        ok(tag + ":rail_label_bydleni", railSnap.labels[20] === "Bydlení a vybavení", railSnap.labels[20]);
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
console.log(
  JSON.stringify(
    {
      IU_AFFILIATE_SELECTED_SERVICES_NEUTRAL_GUARD: pass ? "PASS" : "FAIL",
      fails,
      categories: EXPECTED_CAT_IDS.length,
      REAL_IOS: "NOT_TESTED",
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
