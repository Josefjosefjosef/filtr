#!/usr/bin/env node
/**
 * Guard: prod HTML catalog ?v= must match repo catalog bust comment; SW network-first for catalog;
 * prod catalog URL from live HTML must contain Leo Express CJ (15736211). Playwright prod smoke without ?nosw=1.
 * Run: npm run iu-affiliate-catalog-prod-delivery-guard
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const CATALOG_BUST = "affiliate-ecomodi-drogerie-v1-20260926";
const SW_TOKEN = "2026-09-26-affiliate-brainmarket-zdravi-doplnky-v1";
const LEO_CJ = "https://www.jdoqocy.com/click-101883843-15736211";
const PROD_INDEX = "https://infouzel.cz/projects/index.html";
const SECTION = "aff-letenky";
const REPORT = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  "iu-affiliate-catalog-prod-delivery-guard-report.json"
);

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function extractCatalogSrc(html) {
  const m = html.match(/data-iu-src="(\/assets\/iu-affiliate-catalog\.js\?v=[^"]+)"/);
  return m ? m[1] : "";
}

function auditStatic() {
  const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
  const catalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const allow = fs.readFileSync(
    path.join(ROOT, "scripts", "guards", "iu-sw-cache-version-allowlist.cjs"),
    "utf8"
  );

  ok("index:catalog_bust", index.includes("iu-affiliate-catalog.js?v=" + CATALOG_BUST));
  ok(
    "catalog:bust_comment",
    catalog.includes("iu-affiliate-catalog-bust: " + CATALOG_BUST)
  );
  ok("catalog:leo_cj", catalog.includes(LEO_CJ));
  ok(
    "sw:catalog_network_first",
    /iu-affiliate-catalog\.js[\s\S]{0,400}cacheKey = new Request\(url\.origin \+ url\.pathname \+ url\.search\)/.test(
      sw
    )
  );
  ok("sw:token", sw.includes('CACHE_VERSION = "' + SW_TOKEN + '"'));
  ok("allowlist:current", allow.includes('IU_SW_CACHE_VERSION_CURRENT = "' + SW_TOKEN + '"'));
}

async function auditProdHttp() {
  const indexRes = await fetch(PROD_INDEX + "?cb=" + Date.now(), { cache: "no-store" });
  ok("prod:index_ok", indexRes.ok, String(indexRes.status));
  const indexHtml = await indexRes.text();
  const src = extractCatalogSrc(indexHtml);
  ok("prod:index_catalog_src", !!src, src || "missing");
  if (!src) return;

  const catalogUrl = "https://infouzel.cz" + src.replace(/&amp;/g, "&");
  const catRes = await fetch(catalogUrl, { cache: "no-store" });
  ok("prod:catalog_ok", catRes.ok, String(catRes.status));
  const catBody = await catRes.text();
  ok("prod:catalog_leo", catBody.includes("Leo Express") && catBody.includes("15736211"));

  const cc = catRes.headers.get("cache-control") || "";
  const cf = catRes.headers.get("cf-cache-status") || "";
  const etag = catRes.headers.get("etag") || "";

  const localCatalog = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const prodBust = (src.match(/\?v=([^"&]+)/) || [])[1] || "";

  if (prodBust === CATALOG_BUST) {
    ok("prod:catalog_has_bust_comment", catBody.includes("iu-affiliate-catalog-bust: " + CATALOG_BUST));
    ok("prod:catalog_sha_matches_repo", sha256(catBody) === sha256(localCatalog));
  }

  return { catalogUrl, cacheControl: cc, cfCacheStatus: cf, etag, prodBust };
}

async function auditProdUi() {
  const browser = await chromium.launch({ headless: true });
  const samples = [];
  try {
    for (const vp of [
      { name: "mobile", width: 390, height: 844, hasTouch: true },
      { name: "desktop", width: 1280, height: 800, hasTouch: false },
    ]) {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: vp.width, height: vp.height },
        hasTouch: vp.hasTouch,
      });
      const page = await bootstrapGuardPage(context);
      await page.goto(`https://infouzel.cz/projects/?section=${SECTION}&cb=${Date.now()}`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
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
      await page
        .waitForFunction(() => typeof window.iuAffiliateApplySection === "function", null, {
          timeout: 120000,
        })
        .catch(() => null);
      await page.evaluate((sec) => {
        try {
          if (typeof window.iuAffiliateApplySection === "function") window.iuAffiliateApplySection(sec);
        } catch (_) {}
      }, SECTION);
      await page.waitForFunction(
        () => document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip").length === 8,
        null,
        { timeout: 120000 }
      );
      const snap = await page.evaluate((cj) => {
        const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
        const chipText = (c) => {
          const t = c.querySelector(".iuRadioChipTitle");
          return ((t ? t.textContent : c.textContent) || "").replace(/\s+/g, " ").trim();
        };
        const first = chips[0] || null;
        return {
          firstText: first ? chipText(first) : "",
          href: first ? first.getAttribute("href") || "" : "",
          target: first ? first.getAttribute("target") || "" : "",
          rel: first ? first.getAttribute("rel") || "" : "",
          ready: first ? first.getAttribute("data-aff-ready") || "" : "",
        };
      }, LEO_CJ);
      const tag = vp.name;
      ok(tag + ":leo_slot1", snap.firstText === "Leo Express", snap.firstText);
      ok(tag + ":leo_href", snap.href === LEO_CJ, snap.href);
      ok(tag + ":leo_target", snap.target === "_blank", snap.target);
      ok(tag + ":leo_sponsored", /\bsponsored\b/.test(snap.rel), snap.rel);
      ok(tag + ":leo_noopener", /\bnoopener\b/.test(snap.rel), snap.rel);
      samples.push({ vp: tag, ...snap });
      await context.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return samples;
}

auditStatic();
let prodMeta = null;
if (!fails.length) {
  try {
    prodMeta = await auditProdHttp();
  } catch (err) {
    fails.push("prod_http:" + (err && err.message ? err.message : String(err)));
  }
}
let uiSamples = [];
if (!fails.length) {
  try {
    uiSamples = await auditProdUi();
  } catch (err) {
    fails.push("prod_ui:" + (err && err.message ? err.message : String(err)));
  }
}

const pass = fails.length === 0;
const out = {
  IU_AFFILIATE_CATALOG_PROD_DELIVERY_GUARD: pass ? "PASS" : "FAIL",
  fails,
  prodMeta,
  uiSamples,
};
fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(pass ? 0 : 1);
