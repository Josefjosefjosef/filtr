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
];

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
  const itemCount = (catalog.match(/affItem\(/g) || []).length;
  ok("catalog:items_present", itemCount >= 25, "items=" + itemCount);
  ok("catalog:placeholder_urls_intact", catalog.includes('url: "#affiliate-placeholder-" + slug'));
  ok("catalog:cedok_slug", catalog.includes('affItem("Čedok", "cedok")'));
  ok("catalog:ready_gate", catalog.includes("affiliateUrlReady === true"));
  ok("catalog:nofollow_sponsored", catalog.includes("nofollow sponsored noopener noreferrer"));
  for (const b of FORBIDDEN) {
    ok("catalog:no:" + b.slice(0, 36), !catalog.includes(b));
  }

  ok("index:default_title", index.includes(">" + SECTION_TITLE + "<") || index.includes('iuAffiliateTitle">' + SECTION_TITLE));
  ok("index:cache_bust", index.includes("affiliate-selected-services-neutral-v1-20260907"));
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
  "aff-finance",
  "aff-pojisteni",
  "aff-energie-uspor",
  "aff-lekarny",
  "aff-zdravi-doplnky",
  "aff-software",
  "aff-elektro",
  "aff-moda",
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
      ok(tag + ":no_forbidden", !snap.forbiddenHit, snap.forbiddenHit);
      ok(tag + ":no_h_overflow", !snap.overflow);
      ok(tag + ":seo_has_neprovozuje", /neprovozuje/.test(snap.seoText));
      ok(tag + ":seo_no_keywords", !/Klíčová slova/.test(snap.seoText));
      if (section === "aff-cestovni-kancelare") {
        ok(tag + ":travel_intro", snap.subtitle === TRAVEL_INTRO, snap.subtitle);
        ok(tag + ":travel_seo_h2", snap.seoText.includes(TRAVEL_SEO_H2));
      }
      if (vp.name === "desktop" && section === "aff-cestovni-kancelare") {
        ok(tag + ":rail_title", snap.railTitle === SECTION_TITLE || /Vybrané služby a odkazy/i.test(snap.railTitle), snap.railTitle);
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
