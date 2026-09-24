#!/usr/bin/env node
/**
 * Freeze guard: Pneu a pneuservis — structure + 8 empty slots (partners may be added later).
 * Protects category order / Booking + Leo regression. Does not require empty slots forever.
 * Run: npm run iu-affiliate-pneu-pneuservis-guard
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

const MARKER = "affiliate-pneu-pneuservis-v1-20260921";
const SW_TOKEN = "2026-09-24-affiliate-nazuby-zdravi-doplnky-v1";
const SECTION = "aff-pneu-pneuservis";
const SECTION_TITLE = "Pneu a pneuservis";
const INTRO = "Odkazy na vybrané prodejce pneumatik, pneuservisy a související služby.";
const SEO_H2 = "Pneu a pneuservis – odkazy na vybrané externí služby";
const SEO_P1 =
  "Sekce Pneu a pneuservis obsahuje odkazy na vybrané externí prodejce pneumatik, pneuservisy a služby související s pneumatikami, přezutím a servisem kol. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.";
const DISCLOSURE =
  "Tato sekce obsahuje reklamní a partnerské odkazy na externí služby a obchody.";
const BOOKING_CJ = "https://www.anrdoezrs.net/click-101883843-13323565";
const LEO_CJ = "https://www.jdoqocy.com/click-101883843-15736211";
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu-affiliate-pneu-pneuservis-guard-report.json"
);
const PORT = 8765 + Math.floor(Math.random() * 200);

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "assets", "app.css"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const allow = fs.readFileSync(
    path.join(ROOT, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs"),
    "utf8"
  );

  ok("catalog:section_id", catalog.includes('id: "' + SECTION + '"'));
  ok("catalog:section_title", catalog.includes('title: "' + SECTION_TITLE + '"'));
  ok("catalog:intro", catalog.includes(INTRO));
  ok("catalog:seo_h2", catalog.includes(SEO_H2));
  ok("catalog:seo_p1", catalog.includes(SEO_P1));
  ok("catalog:disclosure", catalog.includes(DISCLOSURE));
  ok("catalog:icon_wheel", catalog.includes('id: "' + SECTION + '"') && catalog.includes('icon: "iu-aff-wheel"'));
  ok("catalog:after_auto_moto", catalog.indexOf('id: "' + SECTION + '"') > catalog.indexOf('id: "aff-auto-moto"'));
  ok("catalog:before_pojisteni", catalog.indexOf('id: "aff-pojisteni"') > catalog.indexOf('id: "' + SECTION + '"'));
  ok("catalog:auto_moto_bestdrive", /id:\s*"aff-auto-moto"[\s\S]*?affItem\("", "bestdrive"\)/.test(catalog));

  const blockStart = catalog.indexOf('id: "' + SECTION + '"');
  const blockEnd = catalog.indexOf('id: "aff-pojisteni"', blockStart);
  const block = blockStart >= 0 && blockEnd > blockStart ? catalog.slice(blockStart, blockEnd) : "";
  const slotCalls = (block.match(/affItem\(/g) || []).length;
  ok("catalog:slots_8", slotCalls === 8, "n=" + slotCalls);
  ok("catalog:no_affPartner", !/affPartner\(/i.test(block));
  ok("catalog:no_https", !/https:\/\//i.test(block));
  ok("catalog:no_named_affItem", !/affItem\(\s*"[^"]+"/.test(block));
  for (let i = 1; i <= 8; i++) {
    ok("catalog:slot_slug_" + i, block.includes('affItem("", "pneu-pneuservis-empty-' + i + '")'));
  }

  ok("catalog:booking_preserved", /affPartner\(\s*"Booking\.com"[\s\S]*?13323565/.test(catalog));
  ok("catalog:leo_preserved", /affPartner\(\s*"Leo Express"[\s\S]*?15736211/.test(catalog));
  ok("catalog:leo_in_doprava", /id:\s*"aff-letenky"[\s\S]*?affPartner\(\s*"Leo Express"/.test(catalog));

  ok("css:accent", css.includes("--iuAff-aff-pneu-pneuservis"));
  ok("css:view", css.includes('data-aff-category="aff-pneu-pneuservis"'));
  ok("css:nav", css.includes('data-accent="aff-pneu-pneuservis"'));
  const sprite = fs.readFileSync(path.join(ROOT, "assets", "icons", "iu-sprite.svg"), "utf8");
  ok("sprite:wheel", sprite.includes('id="iu-aff-wheel"'));
  ok("css:marker", css.includes(MARKER));
  ok("index:marker", index.includes(MARKER));
  ok("index:catalog_bust", index.includes("iu-affiliate-catalog.js?v=affiliate-nazuby-zdravi-doplnky-v1-20260924"));
  ok("sw:token", sw.includes('CACHE_VERSION = "' + SW_TOKEN + '"'));
  ok("allowlist:token", allow.includes('"' + SW_TOKEN + '"'));
  ok("allowlist:current", allow.includes('IU_SW_CACHE_VERSION_CURRENT = "' + SW_TOKEN + '"'));
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
  const out = { IU_AFFILIATE_PNEU_PNEUSERVIS_GUARD: "FAIL", phase: "static", fails };
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
  { name: "desktop", width: 1280, height: 800, hasTouch: false },
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
      });
    }
    const page = await bootstrapGuardPage(context);
    await openAff(page, `http://127.0.0.1:${PORT}/projects/`, SECTION);

    const snap = await page.evaluate((args) => {
      const title = document.getElementById("iuAffiliateTitle");
      const intro = document.getElementById("iuAffiliateIntro");
      const disc = document.getElementById("iuAffiliateDisclosure");
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
        intro: (intro ? intro.textContent : "").replace(/\s+/g, " ").trim(),
        disclosureOk: !!(disc && (disc.textContent || "").includes(args.disclosure)),
        slots: chips.length,
        emptyTitles: titles.every((t) => t === ""),
        noHttps: hrefs.every((h) => !/^https?:/i.test(h)),
        allNeutral: ready.every((r) => r === "0"),
        seoAfterGrid,
        seoVisible: !!(seo && !seo.hidden && (seo.textContent || "").includes(args.seoH2)),
        seoHasP1: !!(seo && (seo.textContent || "").includes("pneuservisy a služby související s pneumatikami")),
      };
    }, { disclosure: DISCLOSURE, seoH2: SEO_H2 });

    const tag = vp.name;
    ok(tag + ":title", snap.title === SECTION_TITLE, snap.title);
    ok(tag + ":intro", snap.intro.includes("prodejce pneumatik"), snap.intro);
    ok(tag + ":disclosure", snap.disclosureOk);
    ok(tag + ":slots_8", snap.slots === 8, "n=" + snap.slots);
    ok(tag + ":empty_slots", snap.emptyTitles && snap.noHttps && snap.allNeutral);
    ok(tag + ":seo_after_slots", snap.seoAfterGrid && snap.seoVisible && snap.seoHasP1);
    samples.push({ vp: vp.name, slots: snap.slots, title: snap.title });
    await context.close();
  }

  for (const [sec, partner, cj] of [
    ["aff-ubytovani-hotely", "Booking.com", BOOKING_CJ],
    ["aff-letenky", "Leo Express", LEO_CJ],
  ]) {
    const context = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, hasTouch: true });
    const page = await bootstrapGuardPage(context);
    await openAff(page, `http://127.0.0.1:${PORT}/projects/`, sec);
    const partnerSnap = await page.evaluate(() => {
      const chip = document.querySelector("#iuAffiliateGrid a.iuAffiliateChip[data-aff-ready='1']");
      const t = chip ? chip.querySelector(".iuRadioChipTitle") : null;
      return {
        text: t ? (t.textContent || "").trim() : "",
        href: chip ? chip.getAttribute("href") || "" : "",
      };
    });
    ok("regression:" + sec + ":text", partnerSnap.text === partner, partnerSnap.text);
    ok("regression:" + sec + ":href", partnerSnap.href === cj, partnerSnap.href);
    await context.close();
  }
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
const out = {
  IU_AFFILIATE_PNEU_PNEUSERVIS_GUARD: pass ? "PASS" : "FAIL",
  fails,
  samples,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
