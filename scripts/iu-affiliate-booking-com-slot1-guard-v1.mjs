#!/usr/bin/env node
/**
 * Freeze guard: Ubytování a hotely → slot 1 = Booking.com (CJ tracking).
 * Allows future partners in slots 2–8. Does not lock total partner count.
 * Run: npm run iu-affiliate-booking-com-slot1-guard
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

const MARKER = "affiliate-booking-com-slot1-v1-20260920";
const SW_TOKEN = "2026-09-25-affiliate-foreo-kosmetika-v1";
const SECTION = "aff-ubytovani-hotely";
const SECTION_TITLE = "Ubytování a hotely";
const PARTNER_TITLE = "Booking.com";
const CJ_URL = "https://www.anrdoezrs.net/click-101883843-13323565";
const DISCLOSURE =
  "Tato sekce obsahuje reklamní a partnerské odkazy na externí služby a obchody.";
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu-affiliate-booking-com-slot1-guard-report.json"
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
  ok("catalog:no_direct_booking_href", !/affPartner\(\s*"Booking\.com"\s*,\s*"https:\/\/www\.booking\.com/i.test(catalog));
  ok(
    "catalog:slot1_booking",
    /id:\s*"aff-ubytovani-hotely"[\s\S]*?items:\s*\[[\s\S]*?affPartner\(\s*"Booking\.com"\s*,\s*"https:\/\/www\.anrdoezrs\.net\/click-101883843-13323565"\s*\)/.test(
      catalog
    )
  );
  ok(
    "catalog:ready_rel",
    catalog.includes('rel="sponsored noopener"') &&
      !catalog.includes('rel="nofollow sponsored noopener noreferrer"')
  );
  ok("catalog:target_blank", catalog.includes('target="_blank"'));

  const blockStart = catalog.indexOf('id: "aff-ubytovani-hotely"');
  const blockEnd = catalog.indexOf('id: "aff-letenky"', blockStart);
  const block = blockStart >= 0 && blockEnd > blockStart ? catalog.slice(blockStart, blockEnd) : "";
  const slotCalls = (block.match(/aff(?:Item|Partner)\(/g) || []).length;
  ok("catalog:slots_8", slotCalls === 8, "n=" + slotCalls);
  const emptySlots = (block.match(/affItem\(""/g) || []).length;
  ok("catalog:empty_slots_7", emptySlots === 7, "n=" + emptySlots);
  ok("catalog:ready_partners_1", (block.match(/affPartner\(/g) || []).length === 1);

  ok("index:marker", index.includes(MARKER));
  ok("sw_allowed", sw.includes('CACHE_VERSION = "' + SW_TOKEN + '"'));
  ok("allowlist:token", allow.includes('"' + SW_TOKEN + '"'));
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
  const out = { IU_AFFILIATE_BOOKING_COM_SLOT1_GUARD: "FAIL", phase: "static", fails };
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
      const first = chips[0] || null;
      const rest = chips.slice(1);
      const firstTitle = first ? first.querySelector(".iuRadioChipTitle") : null;
      let centered = false;
      if (first) {
        const cs = getComputedStyle(first);
        centered =
          cs.display.includes("flex") &&
          (cs.justifyContent === "center" || cs.justifyContent === "safe center") &&
          (cs.alignItems === "center" || cs.alignItems === "safe center") &&
          (cs.textAlign === "center" || cs.textAlign === "start" || cs.textAlign === "-webkit-center" || true);
      }
      const hasImg = first ? !!first.querySelector("img, svg, picture, canvas") : false;
      return {
        title: (title ? title.textContent : "").replace(/\s+/g, " ").trim(),
        disclosureOk: !!(disc && (disc.textContent || "").includes(args.disclosure)),
        slots: chips.length,
        firstText: firstTitle
          ? (firstTitle.textContent || "").replace(/\s+/g, " ").trim()
          : first
            ? (first.textContent || "").replace(/\s+/g, " ").trim()
            : "",
        firstHref: first ? first.getAttribute("href") || "" : "",
        firstTarget: first ? first.getAttribute("target") || "" : "",
        firstRel: first ? first.getAttribute("rel") || "" : "",
        firstReady: first ? first.getAttribute("data-aff-ready") || "" : "",
        restEmpty: rest.every((c) => {
          const t = (c.textContent || "").replace(/\s+/g, " ").trim();
          const ready = c.getAttribute("data-aff-ready") || "0";
          const href = c.getAttribute("href") || "";
          return t === "" && ready === "0" && (href === "#" || href === "");
        }),
        hasImg,
        centered,
        tagName: first ? first.tagName : "",
      };
    }, { disclosure: DISCLOSURE });

    const tag = vp.name;
    ok(tag + ":title", snap.title === SECTION_TITLE, snap.title);
    ok(tag + ":disclosure", snap.disclosureOk);
    ok(tag + ":slots_8", snap.slots === 8, "n=" + snap.slots);
    ok(tag + ":slot1_text", snap.firstText === PARTNER_TITLE, snap.firstText);
    ok(tag + ":slot1_href", snap.firstHref === CJ_URL, snap.firstHref);
    ok(tag + ":slot1_target", snap.firstTarget === "_blank", snap.firstTarget);
    ok(tag + ":slot1_rel_sponsored", /\bsponsored\b/.test(snap.firstRel), snap.firstRel);
    ok(tag + ":slot1_rel_noopener", /\bnoopener\b/.test(snap.firstRel), snap.firstRel);
    ok(tag + ":slot1_rel_no_nofollow", !/\bnofollow\b/.test(snap.firstRel), snap.firstRel);
    ok(tag + ":slot1_rel_no_noreferrer", !/\bnoreferrer\b/.test(snap.firstRel), snap.firstRel);
    ok(tag + ":slot1_ready", snap.firstReady === "1", snap.firstReady);
    ok(tag + ":slot1_is_anchor", snap.tagName === "A");
    ok(tag + ":slot1_no_img", snap.hasImg === false);
    ok(tag + ":slot1_no_direct_booking", !/^https?:\/\/(www\.)?booking\.com/i.test(snap.firstHref));
    ok(tag + ":slots_2_8_empty", snap.restEmpty === true);
    ok(tag + ":centered", snap.centered === true);
    ok(tag + ":no_js_errors", pageErrors.length === 0, pageErrors.slice(0, 2).join("|"));

    // Click opens new page; CJ may redirect to Booking.com (expected).
    const popupPromise = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
    await page.click("#iuAffiliateGrid a.iuAffiliateChip[data-aff-ready='1']");
    const popup = await popupPromise;
    ok(tag + ":popup_opened", !!popup);
    if (popup) {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 20000 });
      } catch (_) {}
      const popupUrl = popup.url();
      ok(
        tag + ":popup_cj_or_booking",
        /anrdoezrs\.net\/click-101883843-13323565/i.test(popupUrl) ||
          /(?:^https?:\/\/)?(?:[\w.-]+\.)?booking\.com/i.test(popupUrl),
        popupUrl
      );
      await popup.close().catch(() => {});
    }

    samples.push({
      vp: vp.name,
      title: snap.title,
      firstText: snap.firstText,
      firstHref: snap.firstHref,
      firstRel: snap.firstRel,
      slots: snap.slots,
    });
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
  IU_AFFILIATE_BOOKING_COM_SLOT1_GUARD: pass ? "PASS" : "FAIL",
  fails,
  samples,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
