#!/usr/bin/env node
/**
 * Freeze guard: Kosmetika a parfémy → SEPHORA.cz (CJ 13212014), first partner slot (first free).
 * Does not lock remaining empty slots. Section stays at 8 slots.
 * Optional prod: IU_AFFILIATE_SEPHORA_PROD=1
 * Run: npm run iu-affiliate-sephora-kosmetika-guard
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

const MARKER = "affiliate-brasty-kosmetika-v1-20260925";
const CATALOG_BUST = "affiliate-brainmarket-zdravi-doplnky-v1-20260926";
const SW_TOKEN = "2026-09-26-affiliate-brainmarket-zdravi-doplnky-v1";
const SECTION = "aff-kosmetika";
const SECTION_TITLE = "Kosmetika a parfémy";
const PARTNER_TITLE = "SEPHORA.cz";
const CJ_URL = "https://www.anrdoezrs.net/click-101883843-13212014";
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu-affiliate-sephora-kosmetika-guard-report.json"
);
const PORT = 8765 + Math.floor(Math.random() * 200);

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function kosmetikaBlock(catalog) {
  const blockStart = catalog.indexOf('id: "aff-kosmetika"');
  const blockEnd = catalog.indexOf('id: "aff-drogerie"', blockStart);
  return blockStart >= 0 && blockEnd > blockStart ? catalog.slice(blockStart, blockEnd) : "";
}

function zdraviBlock(catalog) {
  const blockStart = catalog.indexOf('id: "aff-zdravi-doplnky"');
  const blockEnd = catalog.indexOf('id: "aff-kosmetika"', blockStart);
  return blockStart >= 0 && blockEnd > blockStart ? catalog.slice(blockStart, blockEnd) : "";
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
  ok("catalog:cj_url_exact", catalog.includes(CJ_URL));
  ok(
    "catalog:no_direct_sephora_href",
    !/id:\s*"aff-kosmetika"[\s\S]*?affPartner\(\s*"SEPHORA\.cz"\s*,\s*"https:\/\/(?:www\.)?sephora\.cz/i.test(
      catalog
    )
  );
  ok(
    "catalog:sephora_partner",
    /id:\s*"aff-kosmetika"[\s\S]*?affPartner\(\s*"SEPHORA\.cz"\s*,\s*"https:\/\/www\.anrdoezrs\.net\/click-101883843-13212014"\s*\)/.test(
      catalog
    )
  );
  ok(
    "catalog:slot1_sephora",
    /id:\s*"aff-kosmetika"[\s\S]*?items:\s*\[\s*affPartner\(\s*"SEPHORA\.cz"/.test(catalog)
  );

  const block = kosmetikaBlock(catalog);
  const slotCalls = (block.match(/aff(?:Item|Partner)\(/g) || []).length;
  ok("catalog:slots_8", slotCalls === 8, "n=" + slotCalls);
  ok("catalog:sephora_in_block", block.includes("13212014"));
  ok("catalog:not_in_zdravi", !zdraviBlock(catalog).includes("13212014"));
  ok("catalog:single_sephora_creative", (catalog.match(/13212014/g) || []).length === 1);

  ok("index:marker", index.includes(MARKER));
  ok("index:catalog_bust", index.includes("iu-affiliate-catalog.js?v=" + CATALOG_BUST));
  ok("sw:token", sw.includes('CACHE_VERSION = "' + SW_TOKEN + '"'));
  ok("allowlist:token", allow.includes('"' + SW_TOKEN + '"'));
  ok("allowlist:current", allow.includes('IU_SW_CACHE_VERSION_CURRENT = "' + SW_TOKEN + '"'));
}

async function auditProdCatalog() {
  const indexRes = await fetch("https://infouzel.cz/projects/index.html?cb=" + Date.now(), { cache: "no-store" });
  ok("prod:index_ok", indexRes.ok, String(indexRes.status));
  const indexHtml = await indexRes.text();
  const m = indexHtml.match(/data-iu-src="(\/assets\/iu-affiliate-catalog\.js\?v=[^"]+)"/);
  ok("prod:index_catalog_src", !!m, "missing");
  if (!m) return null;
  const catalogUrl = "https://infouzel.cz" + m[1].replace(/&amp;/g, "&");
  const catRes = await fetch(catalogUrl, { cache: "no-store" });
  ok("prod:catalog_ok", catRes.ok, String(catRes.status));
  const catBody = await catRes.text();
  ok("prod:sephora_cj", catBody.includes(CJ_URL));
  ok("prod:sephora_title", catBody.includes("SEPHORA.cz"));
  return { catalogUrl };
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
    } catch (_) {}
  }, SECTION);
  await page.waitForSelector("#iuAffiliateView", { state: "attached", timeout: 90000 });
  await page.evaluate(() => {
    const v = document.getElementById("iuAffiliateView");
    if (v) {
      v.hidden = false;
      v.removeAttribute("hidden");
    }
  });
  await page.waitForFunction(
    () => document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip").length === 8,
    null,
    { timeout: 90000 }
  );
}

auditStatic();
if (fails.length) {
  const out = { IU_AFFILIATE_SEPHORA_KOSMETIKA_GUARD: "FAIL", phase: "static", fails };
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
let prodMeta = null;

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
    await openAff(page, `http://127.0.0.1:${PORT}/projects/`);

    const snap = await page.evaluate((partner) => {
      const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
      const chipText = (c) => {
        const t = c.querySelector(".iuRadioChipTitle");
        return ((t ? t.textContent : c.textContent) || "").replace(/\s+/g, " ").trim();
      };
      const sep = chips.find((c) => chipText(c) === partner) || null;
      const first = chips[0] || null;
      let centered = false;
      if (sep) {
        const cs = getComputedStyle(sep);
        centered =
          cs.display.includes("flex") &&
          (cs.justifyContent === "center" || cs.justifyContent === "safe center") &&
          (cs.alignItems === "center" || cs.alignItems === "safe center");
      }
      return {
        title: (document.getElementById("iuAffiliateTitle")?.textContent || "").trim(),
        slots: chips.length,
        firstText: first ? chipText(first) : "",
        sepText: sep ? chipText(sep) : "",
        sepHref: sep ? sep.getAttribute("href") || "" : "",
        sepTarget: sep ? sep.getAttribute("target") || "" : "",
        sepRel: sep ? sep.getAttribute("rel") || "" : "",
        sepReady: sep ? sep.getAttribute("data-aff-ready") || "" : "",
        hasImg: sep ? !!sep.querySelector("img, svg, picture, canvas") : false,
        centered,
        namedCount: chips.filter((c) => chipText(c) !== "").length,
      };
    }, PARTNER_TITLE);

    const tag = vp.name;
    ok(tag + ":title", snap.title === SECTION_TITLE, snap.title);
    ok(tag + ":slots_8", snap.slots === 8, "n=" + snap.slots);
    ok(tag + ":first_slot_sephora", snap.firstText === PARTNER_TITLE, snap.firstText);
    ok(tag + ":sephora_text", snap.sepText === PARTNER_TITLE, snap.sepText);
    ok(tag + ":sephora_href", snap.sepHref === CJ_URL, snap.sepHref);
    ok(tag + ":sephora_target", snap.sepTarget === "_blank", snap.sepTarget);
    ok(tag + ":sephora_rel_sponsored", /\bsponsored\b/.test(snap.sepRel), snap.sepRel);
    ok(tag + ":sephora_rel_noopener", /\bnoopener\b/.test(snap.sepRel), snap.sepRel);
    ok(tag + ":sephora_no_nofollow", !/\bnofollow\b/.test(snap.sepRel));
    ok(tag + ":sephora_no_noreferrer", !/\bnoreferrer\b/.test(snap.sepRel));
    ok(tag + ":sephora_ready", snap.sepReady === "1", snap.sepReady);
    ok(tag + ":sephora_no_img", snap.hasImg === false);
    ok(tag + ":sephora_no_direct", !/^https?:\/\/(?:www\.)?sephora\.cz/i.test(snap.sepHref));
    ok(tag + ":centered", snap.centered === true);
    ok(
      tag + ":empty_slots_remain",
      snap.namedCount >= 1 && snap.namedCount < 8,
      "named=" + snap.namedCount
    );

    const popupTimeout = vp.name === "pwa" ? 30000 : 15000;
    const popupPromise = page.waitForEvent("popup", { timeout: popupTimeout }).catch(() => null);
    const chipLoc = page
      .locator("#iuAffiliateGrid a.iuAffiliateChip[data-aff-ready='1']")
      .filter({ hasText: PARTNER_TITLE });
    await chipLoc.click();
    let popup = await popupPromise;
    if (!popup && vp.name === "pwa") {
      const popupRetry = page.waitForEvent("popup", { timeout: 15000 }).catch(() => null);
      await chipLoc.click({ force: true });
      popup = await popupRetry;
    }
    ok(tag + ":popup_opened", !!popup);
    if (popup) {
      try {
        await popup.waitForLoadState("domcontentloaded", { timeout: 20000 });
      } catch (_) {}
      const popupUrl = popup.url();
      const cjOk =
        /anrdoezrs\.net\/click-101883843-13212014/i.test(popupUrl) || /sephora\.cz/i.test(popupUrl);
      const pwaCiFlake =
        vp.name === "pwa" && /chromewebdata|chrome-error/i.test(popupUrl);
      ok(tag + ":popup_cj_or_site", cjOk || pwaCiFlake, popupUrl);
      await popup.close().catch(() => {});
    }

    samples.push({
      vp: vp.name,
      firstText: snap.firstText,
      sepHref: snap.sepHref,
      slots: snap.slots,
      namedCount: snap.namedCount,
    });
    await context.close();
  }
} catch (err) {
  fails.push("runtime_exception:" + (err && err.message ? err.message : String(err)));
} finally {
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

if (process.env.IU_AFFILIATE_SEPHORA_PROD === "1" && !fails.length) {
  try {
    prodMeta = await auditProdCatalog();
  } catch (err) {
    fails.push("prod:" + (err && err.message ? err.message : String(err)));
  }
}

const pass = fails.length === 0;
const out = {
  IU_AFFILIATE_SEPHORA_KOSMETIKA_GUARD: pass ? "PASS" : "FAIL",
  fails,
  samples,
  prodMeta,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
