#!/usr/bin/env node
/**
 * Freeze guard: Pojištění → Klik.cz deeplink (CJ 15024026), first free partner slot.
 * Does not change Cestovní pojištění Klik (15024030). Section stays at 8 slots.
 * Run: npm run iu-affiliate-klik-pojisteni-guard
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

const MARKER = "affiliate-klik-pojisteni-v1-20260922";
const CATALOG_BUST = "affiliate-mentislab-zdravi-doplnky-v1-20260924";
const SW_TOKEN = "2026-09-24-affiliate-mentislab-zdravi-doplnky-v1";
const SECTION = "aff-pojisteni";
const SECTION_TITLE = "Pojištění";
const PARTNER_TITLE = "Klik.cz";
const CJ_URL = "https://www.dpbolvw.net/click-101883843-15024026";
const CESTOVNI_KLIK_CJ = "https://www.dpbolvw.net/click-101883843-15024030";
const DISCLOSURE =
  "Tato sekce obsahuje reklamní a partnerské odkazy na externí služby a obchody.";
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu-affiliate-klik-pojisteni-guard-report.json"
);
const PORT = 8765 + Math.floor(Math.random() * 200);

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const allow = fs.readFileSync(
    path.join(ROOT, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs"),
    "utf8"
  );

  ok("catalog:section_id", catalog.includes('id: "' + SECTION + '"'));
  ok("catalog:section_title", catalog.includes('title: "' + SECTION_TITLE + '"'));
  ok("catalog:disclosure", catalog.includes(DISCLOSURE));
  ok("catalog:affPartner_helper", catalog.includes("function affPartner("));
  ok("catalog:cj_url_exact", catalog.includes(CJ_URL));
  ok(
    "catalog:no_direct_klik_href",
    !/id:\s*"aff-pojisteni"[\s\S]*?affPartner\(\s*"Klik\.cz"\s*,\s*"https:\/\/(?:www\.)?klik\.cz/i.test(
      catalog
    )
  );
  ok(
    "catalog:klik_partner",
    /id:\s*"aff-pojisteni"[\s\S]*?affPartner\(\s*"Klik\.cz"\s*,\s*"https:\/\/www\.dpbolvw\.net\/click-101883843-15024026"\s*\)/.test(
      catalog
    )
  );
  ok(
    "catalog:slot1_klik",
    /id:\s*"aff-pojisteni"[\s\S]*?items:\s*\[\s*affPartner\(\s*"Klik\.cz"/.test(catalog)
  );
  ok(
    "catalog:ready_rel",
    catalog.includes('rel="sponsored noopener"') &&
      !catalog.includes('rel="nofollow sponsored noopener noreferrer"')
  );
  ok("catalog:target_blank", catalog.includes('target="_blank"'));

  const blockStart = catalog.indexOf('id: "aff-pojisteni"');
  const blockEnd = catalog.indexOf('id: "aff-finance"', blockStart);
  const block = blockStart >= 0 && blockEnd > blockStart ? catalog.slice(blockStart, blockEnd) : "";
  const slotCalls = (block.match(/aff(?:Item|Partner)\(/g) || []).length;
  ok("catalog:slots_8", slotCalls === 8, "n=" + slotCalls);
  ok("catalog:klik_in_pojisteni_block", block.includes("15024026"));
  ok("catalog:no_travel_cj_in_pojisteni", !block.includes("15024030"));
  ok(
    "catalog:cestovni_klik_preserved",
    /id:\s*"aff-cestovni-pojisteni"[\s\S]*?15024030/.test(catalog)
  );
  const cestStart = catalog.indexOf('id: "aff-cestovni-pojisteni"');
  const cestEnd = catalog.indexOf('id: "aff-auto-moto"', cestStart);
  const cestBlock =
    cestStart >= 0 && cestEnd > cestStart ? catalog.slice(cestStart, cestEnd) : "";
  ok("catalog:not_in_cestovni_block", !cestBlock.includes("15024026"));

  ok("index:marker", index.includes(MARKER));
  ok("index:catalog_bust", index.includes("iu-affiliate-catalog.js?v=" + CATALOG_BUST));
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

async function openAff(page, baseUrl) {
  await dismissConsent(page);
  await page.goto(`${baseUrl}?section=${SECTION}&nosw=1&cb=${Date.now()}`, {
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
  }, SECTION);
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
    SECTION,
    { timeout: 90000 }
  );
}

auditStatic();
if (fails.length) {
  const out = { IU_AFFILIATE_KLIK_POJISTENI_GUARD: "FAIL", phase: "static", fails };
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
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e && e.message ? e.message : e)));

    await openAff(page, `http://127.0.0.1:${PORT}/projects/`);

    const snap = await page.evaluate((args) => {
      const title = document.getElementById("iuAffiliateTitle");
      const disc = document.getElementById("iuAffiliateDisclosure");
      const grid = document.getElementById("iuAffiliateGrid");
      const chips = grid ? Array.from(grid.querySelectorAll("a.iuAffiliateChip")) : [];
      const chipText = (c) => {
        const t = c.querySelector(".iuRadioChipTitle");
        return ((t ? t.textContent : c.textContent) || "").replace(/\s+/g, " ").trim();
      };
      const klik = chips.find((c) => chipText(c) === args.partner) || null;
      const firstChip = chips[0] || null;
      let centered = false;
      if (klik) {
        const cs = getComputedStyle(klik);
        centered =
          cs.display.includes("flex") &&
          (cs.justifyContent === "center" || cs.justifyContent === "safe center") &&
          (cs.alignItems === "center" || cs.alignItems === "safe center");
      }
      const hasImg = klik ? !!klik.querySelector("img, svg, picture, canvas") : false;
      return {
        title: (title ? title.textContent : "").replace(/\s+/g, " ").trim(),
        disclosureOk: !!(disc && (disc.textContent || "").includes(args.disclosure)),
        slots: chips.length,
        klikText: klik ? chipText(klik) : "",
        klikHref: klik ? klik.getAttribute("href") || "" : "",
        klikTarget: klik ? klik.getAttribute("target") || "" : "",
        klikRel: klik ? klik.getAttribute("rel") || "" : "",
        klikReady: klik ? klik.getAttribute("data-aff-ready") || "" : "",
        firstText: firstChip ? chipText(firstChip) : "",
        hasImg,
        centered,
        tagName: klik ? klik.tagName : "",
      };
    }, { disclosure: DISCLOSURE, partner: PARTNER_TITLE });

    const tag = vp.name;
    ok(tag + ":title", snap.title === SECTION_TITLE, snap.title);
    ok(tag + ":disclosure", snap.disclosureOk);
    ok(tag + ":slots_8", snap.slots === 8, "n=" + snap.slots);
    ok(tag + ":first_slot_klik", snap.firstText === PARTNER_TITLE, snap.firstText);
    ok(tag + ":klik_text", snap.klikText === PARTNER_TITLE, snap.klikText);
    ok(tag + ":klik_href", snap.klikHref === CJ_URL, snap.klikHref);
    ok(tag + ":klik_target", snap.klikTarget === "_blank", snap.klikTarget);
    ok(tag + ":klik_rel_sponsored", /\bsponsored\b/.test(snap.klikRel), snap.klikRel);
    ok(tag + ":klik_rel_noopener", /\bnoopener\b/.test(snap.klikRel), snap.klikRel);
    ok(tag + ":klik_rel_no_nofollow", !/\bnofollow\b/.test(snap.klikRel), snap.klikRel);
    ok(tag + ":klik_rel_no_noreferrer", !/\bnoreferrer\b/.test(snap.klikRel), snap.klikRel);
    ok(tag + ":klik_ready", snap.klikReady === "1", snap.klikReady);
    ok(tag + ":klik_is_anchor", snap.tagName === "A");
    ok(tag + ":klik_no_img", snap.hasImg === false);
    ok(tag + ":klik_no_direct_klik", !/^https?:\/\/(www\.)?klik\.cz/i.test(snap.klikHref));
    ok(tag + ":centered", snap.centered === true);
    ok(tag + ":no_js_errors", pageErrors.length === 0, pageErrors.slice(0, 2).join("|"));

    const popupPromise = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
    await page
      .locator("#iuAffiliateGrid a.iuAffiliateChip[data-aff-ready='1']")
      .filter({ hasText: PARTNER_TITLE })
      .click();
    const popup = await popupPromise;
    ok(tag + ":popup_opened", !!popup);
    if (popup) {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 20000 });
      } catch (_) {}
      const popupUrl = popup.url();
      ok(
        tag + ":popup_cj_or_klik",
        /dpbolvw\.net\/click-101883843-15024026/i.test(popupUrl) || /klik\.cz/i.test(popupUrl),
        popupUrl
      );
      await popup.close().catch(() => {});
    }

    samples.push({
      vp: vp.name,
      title: snap.title,
      klikText: snap.klikText,
      klikHref: snap.klikHref,
      klikRel: snap.klikRel,
      slots: snap.slots,
      firstText: snap.firstText,
    });
    await context.close();
  }

  const ctx = await bootstrapGuardContext(browser, { viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await bootstrapGuardPage(ctx);
  await page.goto(`http://127.0.0.1:${PORT}/projects/?section=aff-cestovni-pojisteni&nosw=1`, {
    waitUntil: "domcontentloaded",
  });
  await page.evaluate(() => {
    if (typeof window.iuAffiliateApplySection === "function") window.iuAffiliateApplySection("aff-cestovni-pojisteni");
    const v = document.getElementById("iuAffiliateView");
    if (v) {
      v.hidden = false;
      v.removeAttribute("hidden");
    }
  });
  await page.waitForFunction(() => document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip").length === 8);
  const travel = await page.evaluate((cj) => {
    const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
    const chipText = (c) => ((c.querySelector(".iuRadioChipTitle") || c).textContent || "").trim();
    const k = chips.find((c) => chipText(c) === "Klik.cz");
    return { href: k ? k.getAttribute("href") : "" };
  }, CESTOVNI_KLIK_CJ);
  ok("regression:cestovni_klik_href", travel.href === CESTOVNI_KLIK_CJ, travel.href);
  await ctx.close();
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

const pass = fails.length === 0;
const out = {
  IU_AFFILIATE_KLIK_POJISTENI_GUARD: pass ? "PASS" : "FAIL",
  fails,
  samples,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
