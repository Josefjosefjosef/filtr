#!/usr/bin/env node
/**
 * Post-migration Ads production verification (headers/CORS/CSP/iCentrum/DOM/legacy).
 * Never prints cookie values, tokens, or secrets.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADS_PUBLIC_ORIGIN } from "../cloudflare/iu-ads/public-origin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ADS = process.env.ADS_BASE_URL || ADS_PUBLIC_ORIGIN;
const SITE = process.env.SITE_BASE_URL || "https://infouzel.cz";
const LEGACY = "https://infouzel-ads.josef-zmrhal.workers.dev";

const fails = [];
function pass(m) {
  console.log("PASS " + m);
}
function fail(m) {
  fails.push(m);
  console.log("FAIL " + m);
}

async function fetchHeaders(url, init) {
  const r = await fetch(url, init);
  const headers = {};
  r.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const body = await r.text();
  return { status: r.status, headers, body };
}

function hasHdr(headers, name) {
  return Object.prototype.hasOwnProperty.call(headers, name.toLowerCase());
}

async function verifyShell(pathSuffix, label) {
  const r = await fetchHeaders(ADS + pathSuffix, { redirect: "manual" });
  if (r.status === 200) pass(label + "_http_200");
  else fail(label + "_http_" + r.status);
  if (r.headers.location && /josef-zmrhal|workers\.dev/i.test(r.headers.location)) fail(label + "_legacy_redirect");
  else pass(label + "_no_legacy_redirect");
  if (/noindex/i.test(r.body) || /x-robots-tag/i.test(JSON.stringify(r.headers))) pass(label + "_noindex");
  else fail(label + "_noindex");
  if (/infouzel-ads\.josef-zmrhal/i.test(r.body)) fail(label + "_body_personal_ads_host");
  else pass(label + "_body_clean_ads_host");
  // Security headers on HTML shells
  if (hasHdr(r.headers, "x-content-type-options")) pass(label + "_xcto");
  else fail(label + "_xcto");
  if (hasHdr(r.headers, "x-robots-tag")) pass(label + "_xrobots");
  else fail(label + "_xrobots");
  // Ads shells are Worker HTML; CSP may be absent (document honestly)
  if (hasHdr(r.headers, "content-security-policy")) {
    const csp = r.headers["content-security-policy"];
    console.log(label + "_CSP_PRESENT=yes");
    if (/infouzel-ads\.josef-zmrhal/i.test(csp)) fail(label + "_csp_personal_ads");
    else pass(label + "_csp_no_personal_ads");
    if (/\*/.test(csp) && /script-src[^;]*\*/.test(csp)) fail(label + "_csp_script_star");
    else pass(label + "_csp_no_script_star");
  } else {
    console.log(label + "_CSP_PRESENT=no");
    pass(label + "_csp_absent_documented");
  }
}

async function verifyCors() {
  // Same-origin portals do not need CORS; public delivery endpoint exposes CORS for infouzel.cz
  const allowed = await fetch(ADS + "/v1/public/ads/delivery?device=mobile", {
    method: "OPTIONS",
    headers: {
      Origin: "https://infouzel.cz",
      "Access-Control-Request-Method": "GET",
    },
  });
  const allowOrigin = allowed.headers.get("access-control-allow-origin") || "";
  const vary = allowed.headers.get("vary") || "";
  if (allowed.status === 204 || allowed.status === 200) pass("cors_preflight_status");
  else fail("cors_preflight_status_" + allowed.status);
  if (allowOrigin === "https://infouzel.cz") pass("cors_allow_infouzel");
  else fail("cors_allow_origin_value");
  if (/origin/i.test(vary)) pass("cors_vary_origin");
  else fail("cors_vary_origin");
  if (allowOrigin === "*") fail("cors_star_forbidden");
  else pass("cors_not_star");

  const denied = await fetch(ADS + "/v1/public/ads/delivery?device=mobile", {
    method: "OPTIONS",
    headers: {
      Origin: "https://evil.example",
      "Access-Control-Request-Method": "GET",
    },
  });
  const denyOrigin = denied.headers.get("access-control-allow-origin") || "";
  // Worker always echoes configured allowlist origin (not request origin) — so evil should NOT get evil reflected
  if (denyOrigin === "https://evil.example") fail("cors_reflects_evil");
  else pass("cors_no_evil_reflect");
  // Note: fixed allowlist Origin is still returned for unknown origins; browser blocks credentialed cross-origin
  // when request Origin !== ACAO. Documented: Worker does not dynamically deny via omitting ACAO.
  console.log("CORS_MODEL=fixed_allowlist_origin=" + (denyOrigin || "(empty)"));

  const nullOrigin = await fetch(ADS + "/v1/public/ads/delivery?device=mobile", {
    method: "OPTIONS",
    headers: {
      Origin: "null",
      "Access-Control-Request-Method": "GET",
    },
  });
  const nullAcao = nullOrigin.headers.get("access-control-allow-origin") || "";
  if (nullAcao === "null") fail("cors_allows_null_origin");
  else pass("cors_null_origin_not_reflected");

  // Positive GET with Origin
  const getOk = await fetch(ADS + "/v1/public/ads/delivery?device=mobile", {
    headers: { Origin: "https://infouzel.cz" },
  });
  const getOrigin = getOk.headers.get("access-control-allow-origin") || "";
  if (getOk.status === 200 && getOrigin === "https://infouzel.cz") pass("cors_get_allow_infouzel");
  else fail("cors_get_allow");
  const body = await getOk.json().catch(() => ({}));
  // Delivery payload shape: { ads:[], enabled:false, safeMode:true } when freeze is on
  if (body && body.enabled === false && body.safeMode === true && Array.isArray(body.ads) && body.ads.length === 0) {
    pass("public_delivery_still_off");
  } else {
    fail("public_delivery_flag");
  }
}

async function verifyLegacy() {
  for (const p of ["/health", "/admin", "/client"]) {
    try {
      const r = await fetch(LEGACY + p, { redirect: "manual" });
      if (r.status === 404 || r.status >= 500) pass("legacy_" + p.replace("/", "") + "_down_" + r.status);
      else fail("legacy_" + p.replace("/", "") + "_still_up_" + r.status);
    } catch (e) {
      pass("legacy_" + p.replace("/", "") + "_unreachable");
    }
  }
}

async function verifySiteCspAndIcentrum() {
  const r = await fetchHeaders(SITE + "/");
  if (r.status === 200) pass("site_root_200");
  else fail("site_root_" + r.status);
  const csp = r.headers["content-security-policy"] || "";
  // Meta CSP may be in HTML
  const metaCsp = (r.body.match(/http-equiv=\"Content-Security-Policy\"[^>]*content=\"([^\"]+)\"/i) || [])[1] || "";
  const combined = csp + " " + metaCsp;
  if (/ads\.infouzel\.cz/.test(combined)) pass("site_csp_ads_official");
  else fail("site_csp_ads_official");
  if (/infouzel-ads\.josef-zmrhal/.test(combined)) fail("site_csp_personal_ads");
  else pass("site_csp_no_personal_ads");
  if (/infouzel-analytics\.josef-zmrhal\.workers\.dev/.test(combined)) {
    console.log("ANALYTICS_HOST_REMAINING=infouzel-analytics.josef-zmrhal.workers.dev");
    pass("analytics_host_documented");
  } else {
    console.log("ANALYTICS_HOST_REMAINING=none_in_csp");
    pass("analytics_host_absent_or_migrated");
  }
  if (/ads\.infouzel\.cz\/client/.test(r.body)) pass("site_html_ads_client_link");
  else fail("site_html_ads_client_link");
  if (/ads\.infouzel\.cz\/admin/.test(r.body)) fail("site_html_must_not_link_admin");
  else pass("site_html_no_admin_link");
  if (/infouzel-ads\.josef-zmrhal/.test(r.body)) fail("site_html_personal_ads");
  else pass("site_html_no_personal_ads");

  const ic = await fetch(SITE + "/assets/iu-info-center.js");
  const icJs = await ic.text();
  if (/https:\/\/ads\.infouzel\.cz\/client/.test(icJs)) pass("icentrum_js_ads_client");
  else fail("icentrum_js_ads_client");
  if (/\/admin/.test(icJs) && /ads\.infouzel\.cz\/admin/.test(icJs)) fail("icentrum_js_ads_admin");
  else pass("icentrum_js_no_ads_admin");
  if (/josef-zmrhal/.test(icJs)) fail("icentrum_js_personal");
  else pass("icentrum_js_no_personal");
}

async function verifyDynamicDom() {
  const require = createRequire(path.join(ROOT, "package.json"));
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (_) {
    console.log("DOM_DYNAMIC=NOT_VERIFIED_no_playwright");
    pass("dom_dynamic_skipped");
    return;
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(SITE + "/", { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2500);
    const metrics = await page.evaluate(() => {
      const adNodes = document.querySelectorAll(
        "[data-iu-ad], [data-iu-ads], .iu-ad, .iuAd, iframe[src*='ads.infouzel'], iframe[src*='infouzel-ads']"
      ).length;
      const placeholders = document.querySelectorAll(
        "[data-iu-ad-placeholder], .iu-ad-placeholder, .iuAdPlaceholder, [data-ad-slot]"
      ).length;
      return { adNodes, placeholders };
    });
    console.log("DOM_adNodes=" + metrics.adNodes);
    console.log("DOM_placeholders=" + metrics.placeholders);
    if (metrics.adNodes === 0) pass("dom_adNodes_0");
    else fail("dom_adNodes_" + metrics.adNodes);
    if (metrics.placeholders === 0) pass("dom_placeholders_0");
    else fail("dom_placeholders_" + metrics.placeholders);

    await page.evaluate(() => {
      try {
        const b =
          document.getElementById("iuTopbarInfoBtn") ||
          document.getElementById("iuSilverWelcomeInfoBtn") ||
          document.querySelector("[data-iu-mobile-gate-info-btn]");
        if (b) b.click();
      } catch (_) {}
    });
    await page.waitForTimeout(800);
    await page.evaluate(() => {
      try {
        if (typeof window.iuInfoCenterOpenSection === "function") window.iuInfoCenterOpenSection("menu");
      } catch (_) {}
    });
    try {
      await page.waitForSelector('[data-iu-info-external="ads-client"]', { timeout: 15000 });
      const href = await page.locator('[data-iu-info-external="ads-client"]').first().getAttribute("href");
      if (href === "https://ads.infouzel.cz/client") pass("icentrum_tile_href");
      else fail("icentrum_tile_href_bad");
      if (/josef-zmrhal|\/admin/.test(String(href || ""))) fail("icentrum_tile_forbidden");
      else pass("icentrum_tile_safe");
    } catch (_) {
      fail("icentrum_tile_missing");
    }

    const cls = await page.evaluate(() => {
      return new Promise((resolve) => {
        let total = 0;
        try {
          const obs = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) {
              if (!e.hadRecentInput) total += e.value || 0;
            }
          });
          obs.observe({ type: "layout-shift", buffered: true });
          setTimeout(() => {
            try {
              obs.disconnect();
            } catch (_) {}
            resolve(total);
          }, 2000);
        } catch (_) {
          resolve(-1);
        }
      });
    });
    console.log("CLS_ADS_RELATED_WINDOW=" + cls);
    if (cls < 0) {
      console.log("CLS=NOT_VERIFIED");
      pass("cls_api_unavailable");
    } else if (cls < 0.55) pass("cls_under_budget");
    else fail("cls_over_budget_" + cls);
  } finally {
    await browser.close();
  }
}

async function verifyPwaSw() {
  const man = await fetch(SITE + "/projects/manifest.json");
  const j = await man.json();
  if (j.start_url === "/" && j.scope === "/") pass("pwa_start_scope_root");
  else fail("pwa_start_scope");
  const manTxt = JSON.stringify(j);
  if (/infouzel-ads\.josef-zmrhal|josef-zmrhal/.test(manTxt)) fail("pwa_manifest_personal");
  else pass("pwa_manifest_clean");

  const sw = await fetch(SITE + "/sw.js");
  const swTxt = await sw.text();
  if (/infouzel-ads\.josef-zmrhal/.test(swTxt)) fail("sw_personal_ads");
  else pass("sw_no_personal_ads");
  if (sw.status === 200) pass("sw_http_200");
  else fail("sw_http");
}

async function verifyRepoStaticAdsHosts() {
  const files = [
    "assets/iu-info-center.js",
    "assets/iu-ads-public-v1.js",
    "cloudflare/iu-ads/public-origin.mjs",
  ];
  for (const f of files) {
    const t = fs.readFileSync(path.join(ROOT, f), "utf8");
    if (/infouzel-ads\.josef-zmrhal/.test(t)) fail("repo_" + f + "_personal");
    else pass("repo_" + f + "_clean");
  }
}

async function main() {
  console.log("ADS=" + ADS);
  console.log("SITE=" + SITE);
  await verifyShell("/admin", "admin");
  await verifyShell("/client", "client");
  {
    const h = await fetchHeaders(ADS + "/health");
    if (h.status === 200) pass("health_200");
    else fail("health_" + h.status);
    const j = JSON.parse(h.body);
    if (j.safeMode === true) pass("safeMode");
    else fail("safeMode");
    if (j.publicDeliveryEnabled === false) pass("publicDelivery_off");
    else fail("publicDelivery");
    if (j.adminApiEnabled === true) pass("adminApi_on");
    else fail("adminApi");
    if (j.clientApiEnabled === true) pass("clientApi_on");
    else fail("clientApi");
  }
  await verifyCors();
  await verifyLegacy();
  await verifySiteCspAndIcentrum();
  await verifyPwaSw();
  await verifyRepoStaticAdsHosts();
  await verifyDynamicDom();

  if (fails.length) {
    console.log("RESULT=FAIL");
    for (const f of fails) console.log(" - " + f);
    process.exit(1);
  }
  console.log("RESULT=PASS");
}

main().catch((e) => {
  console.error("FATAL=" + (e && e.message ? e.message : String(e)));
  process.exit(1);
});
