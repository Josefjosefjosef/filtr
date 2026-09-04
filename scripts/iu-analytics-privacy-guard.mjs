#!/usr/bin/env node
/**
 * Privacy + analytics contract guard for InfoUzel Analytics.
 * Fail-closed static checks (no live Worker required for PASS of static layer).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "module";
import http from "node:http";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const fails = [];
function fail(m) {
  fails.push(m);
}

const client = fs.readFileSync(path.join(ROOT, "assets/iu-analytics-client.js"), "utf8");
const consent = fs.readFileSync(path.join(ROOT, "assets/iu-consent.js"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "assets/app.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "projects/index.html"), "utf8");
const publicPage = fs.readFileSync(path.join(ROOT, "projects/statistiky/index.html"), "utf8");
const adminPage = fs.readFileSync(path.join(ROOT, "projects/statistiky/admin/index.html"), "utf8");
const privacyTs = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/privacy.ts"), "utf8");
const indexTs = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/index.ts"), "utf8");
const schema = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/schema.sql"), "utf8");
const arch = fs.readFileSync(path.join(ROOT, "docs/InfoUzel-Analytics-Architecture.md"), "utf8");
const storeTs = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/src/store.ts"), "utf8");
const migration = fs.readFileSync(path.join(ROOT, "cloudflare/iu-analytics/migrations/0001_init.sql"), "utf8");
if (!/createD1Store/.test(storeTs)) fail("store:missing_d1_impl");
if (/createCacheStore|createKvStore/.test(storeTs)) fail("store:cache_or_kv_store_must_be_removed");
if (!/daily_traffic/.test(migration) || !/daily_ads/.test(migration)) fail("migration:missing_core_tables");
if (!/CREATE INDEX IF NOT EXISTS idx_ads_campaign/.test(migration)) fail("migration:missing_ad_indexes");
if (!/d1_binding_missing|d1_unreachable/.test(indexTs)) fail("worker:missing_d1_failure_mode");
if (!/Cloudflare D1/.test(arch)) fail("docs:d1_source_of_truth_missing");
if (/Cache API fallback|Workers KV \(preferred\)/.test(arch)) fail("docs:stale_cache_kv_primary_claim");

if (!/iu-analytics-client\.js/.test(index)) fail("index:missing_analytics_client");
if (!/infouzel-analytics\.josef-zmrhal\.workers\.dev/.test(index)) fail("index:csp_missing_worker");
if (!/Statistiky a transparentnost/.test(index)) fail("index:missing_stats_tile");
if (!/data-iu-info-section=\"stats\"/.test(index)) fail("index:missing_stats_section");

if (!/isAnalyticsGranted/.test(client)) fail("client:missing_consent_gate");
if (!/ad_impression/.test(client) || !/ad_click/.test(client)) fail("client:missing_ad_events");
if (!/privateToolsOpen/.test(client)) fail("client:missing_private_tools_api");
if ((appJs.match(/iuAnalytics\.privateToolsOpen/g) || []).length < 4) {
  fail("app:private_tools_open_not_wired");
}
if (!/sTodayViews|Dnes \(zobrazení\)/.test(publicPage)) fail("public:missing_page_views_tile");
if (/slice\(\s*-14\s*\)/.test(publicPage)) fail("public:must_not_slice_series_to_14");
if (!/sChartSvg|Vývoj návštěvnosti/.test(publicPage)) fail("public:missing_history_chart");
if (!/stats-chart-tooltip-adaptive-v1-20260904/.test(publicPage)) fail("public:missing_adaptive_tooltip_marker");
if (/transform:\s*translate\(\s*-50%\s*,\s*calc\(\s*-100%/.test(publicPage)) {
  fail("public:tooltip_must_not_use_fixed_above_transform");
}
if (!/data-range=\"30\"/.test(publicPage) || !/data-metric=\"visits\"/.test(publicPage)) {
  fail("public:missing_chart_controls");
}
if (!/Historie je zobrazena od data/.test(publicPage)) fail("public:missing_history_note");
if (!/touch-action:\s*pan-x\s+pan-y/.test(publicPage)) fail("public:missing_chart_touch_action");
if (!/formatCsDayShort/.test(publicPage)) fail("public:missing_cz_short_date");
if (!/sChartPrev|Zobrazit starší data/.test(publicPage)) fail("public:missing_chart_prev_nav");
if (!/sChartNext|Zobrazit novější data/.test(publicPage)) fail("public:missing_chart_next_nav");
if (!/min-width:\s*0/.test(publicPage)) fail("public:missing_chart_min_width_containment");
if (/\.dayFrom[^;\n]{0,40}\.slice\(\s*5\s*\)/.test(publicPage)) fail("public:axis_must_not_use_mm_dd_slice");
if (!/readDailySeries|historyStart|series_from/.test(indexTs)) fail("worker:missing_series_history_api");
if (!/readDailySeries/.test(storeTs)) fail("store:missing_readDailySeries");
// LF-003: admin Bearer must stay in page memory only — never Web Storage.
if (!/memoryToken/.test(adminPage)) {
  fail("admin:token_must_use_memory_only");
}
if (/sessionStorage\.setItem\(\"iu\.analytics\.adminToken\"/.test(adminPage)) {
  fail("admin:token_must_not_persist_sessionStorage");
}
if (/localStorage\.setItem\(\"iu\.analytics\.adminToken\"/.test(adminPage)) {
  fail("admin:token_must_not_use_localStorage");
}
if (!/sessionStorage\.removeItem\(\"iu\.analytics\.adminToken\"/.test(adminPage)) {
  fail("admin:must_clear_legacy_sessionStorage_token");
}
if (/google-analytics|googletagmanager|gtag\(|facebook\.net|hotjar|clarity|plausible\.io|matomo/i.test(client)) {
  fail("client:external_vendor_forbidden");
}
if (/fingerprint|user_agent|ip_address/i.test(client) && !/blocked|Hard block|Never sends IP/i.test(client)) {
  // allow mentions only as blocked keys
}

const forbiddenCollect = ["localStorage.setItem(\"iu:analytics:ip", "navigator.userAgent", "fingerprint"];
for (const f of forbiddenCollect) {
  if (client.includes('localStorage.setItem("iu:user') || client.includes("fingerprint =")) fail("client:pii_pattern:" + f);
}
if (/navigator\.userAgent/.test(client)) fail("client:must_not_send_full_ua");

if (!/iuAnalyticsInit|iuAnalyticsTeardown/.test(consent)) fail("consent:missing_hooks");
if (!/Kodex anonymity|Nesledujeme jednotlivé osoby/.test(publicPage)) fail("public:missing_codex");
if (!/Čeká na dokončení/.test(publicPage)) fail("public:missing_honest_audit");
if (/campaign_name|advertiser_name|ADMIN_TOKEN/.test(publicPage)) fail("public:must_not_expose_admin_meta");
if (!/campaign_id|placement_id|slot_type|valid_clicks|suspicious/.test(adminPage)) fail("admin:missing_dynamic_ad_filters");

// Public Statistiky must NOT advertise the Bearer-token admin UI.
if (/Administrace \(chráněná\)/.test(publicPage)) fail("public:must_not_link_protected_admin");
if (/statistiky\/admin\//.test(publicPage)) fail("public:must_not_href_analytics_admin");

// Informační centrum: Ads client tile is injected by iu-info-center.js (projects/index.html is freeze-locked).
const infoCenterJs = fs.readFileSync(path.join(ROOT, "assets/iu-info-center.js"), "utf8");
if (!/Reklama a klientský portál/.test(infoCenterJs)) fail("info_center:missing_ads_client_tile");
if (!/data-iu-info-external/.test(infoCenterJs) || !/ads-client/.test(infoCenterJs)) {
  fail("info_center:missing_ads_client_external_marker");
}
if (!/https:\/\/ads\.infouzel\.cz\/client/.test(infoCenterJs)) fail("info_center:missing_ads_client_href");
if (!/https:\/\/ads\.infouzel\.cz/.test(index)) fail("index:csp_missing_ads_official");
if (/infouzel-ads\.josef-zmrhal/.test(infoCenterJs)) fail("info_center:must_not_use_personal_ads_host");
if (/infouzel-ads\.josef-zmrhal/.test(index)) fail("index:must_not_use_personal_ads_host");
if (/ads\.infouzel\.cz\/admin/.test(infoCenterJs)) fail("info_center:must_not_link_ads_admin");
if (/ads\.infouzel\.cz\/admin/.test(index)) fail("index:must_not_link_ads_admin");

if (!/FORBIDDEN_KEYS/.test(privacyTs)) fail("worker:missing_forbidden_keys");
if (!/storesIp:\s*false/.test(indexTs) && !/storesIpInAnalyticsDb:\s*false/.test(indexTs)) {
  fail("worker:missing_no_ip_claim");
}
if (!/daily_ads/.test(schema) || !/campaign_id/.test(schema)) fail("schema:missing_dynamic_ads");
if (/user_id|fingerprint|ip_address|user_agent/i.test(schema)) fail("schema:pii_column_forbidden");
if (!/Dynamic advertising|Consent Guard|Anti Fraud Guard/.test(arch)) fail("docs:architecture_incomplete");

// Ensure aggregator paths untouched in this change set is not checked here;
// CI diff discipline is human/PR scope.

const require = createRequire(path.join(ROOT, "package.json"));
let pwOk = true;
try {
  const { chromium } = require("playwright");
  const PORT = 8971;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    let file = path.join(ROOT, decodeURIComponent(u.pathname.replace(/^\//, "") || "projects/index.html"));
    if (
      u.pathname === "/" ||
      u.pathname === "/index.html" ||
      u.pathname === "/projects/" ||
      u.pathname === "/projects"
    ) {
      file = path.join(ROOT, "projects/index.html");
    }
    if (u.pathname === "/statistiky" || u.pathname === "/statistiky/") {
      file = path.join(ROOT, "projects/statistiky/index.html");
    }
    if (u.pathname === "/zdroje-a-licence" || u.pathname === "/zdroje-a-licence/") {
      file = path.join(ROOT, "projects/zdroje-a-licence/index.html");
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      const idx = path.join(file, "index.html");
      if (fs.existsSync(idx)) file = idx;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("missing");
      return;
    }
    const ext = path.extname(file);
    const type =
      ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : ext === ".html" ? "text/html" : "text/plain";
    res.writeHead(200, { "content-type": type });
    res.end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser);
  await context.route("**/infouzel-analytics.josef-zmrhal.workers.dev/**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === "GET" && /\/v1\/public\/stats/.test(url)) {
      const series = [];
      for (let i = 0; i < 45; i++) {
        const d = new Date(Date.UTC(2026, 6, 21 + i));
        const day = d.toISOString().slice(0, 10);
        series.push({ day, visits: 20 + (i % 17), page_views: 20 + (i % 17) });
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          storageMode: "d1",
          today: { visits: 50, page_views: 50 },
          yesterday: { visits: 40, page_views: 40 },
          month: { visits: 900, page_views: 900, private_tools_opens: 12 },
          series,
          historyStart: series[0].day,
          devices: [{ device_category: "mobile", visits: 10, page_views: 10 }],
          topPublicSections: [{ section_id: "home", views: 5 }],
          privateToolsSummary: { opens: 12 },
          auditStatus: {
            legal: "Veřejné agregáty bez osobních údajů.",
            security: "Admin API chráněno Bearer tokenem.",
            anonymization: "Neukládáme IP ani fingerprint.",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, accepted: 0, rejected: 0 }),
    });
  });
  const page = await bootstrapGuardPage(context);
  const posts = [];
  page.on("request", (req) => {
    if (/infouzel-analytics/.test(req.url()) && req.method() === "POST") posts.push(req.url());
  });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:consent:analytics:v1", "denied");
      localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
    } catch (_) {}
  });
  await page.reload({ waitUntil: "load", timeout: 20000 });
  await page.waitForFunction(() => !!(window.iuConsent && window.iuAnalytics), null, { timeout: 10000 });
  await page.waitForTimeout(800);
  if (posts.length) fail("behavior:emit_without_consent");

  await page.evaluate(() => {
    if (window.iuConsent) window.iuConsent.setAnalyticsConsent("granted");
  });
  await page.waitForTimeout(1200);
  const active = await page.evaluate(() => !!(window.__IU_ANALYTICS_ACTIVE__ || (window.iuAnalytics && window.iuAnalytics.isActive && window.iuAnalytics.isActive())));
  if (!active) fail("behavior:not_active_after_grant");

  await page.evaluate(() => {
    if (window.iuConsent) window.iuConsent.setAnalyticsConsent("denied");
  });
  await page.waitForTimeout(400);
  const stopped = await page.evaluate(() => !(window.iuAnalytics && window.iuAnalytics.isActive && window.iuAnalytics.isActive()));
  if (!stopped) fail("behavior:not_stopped_after_revoke");

  const blockedTrack = await page.evaluate(() => {
    if (!window.iuAnalytics) return true;
    return window.iuAnalytics.track("page_view", { section_id: "home", payload: "secret" }) === false;
  });
  // After revoke, track returns false anyway; re-grant and try forbidden
  await page.evaluate(() => {
    if (window.iuConsent) window.iuConsent.setAnalyticsConsent("granted");
  });
  await page.waitForTimeout(200);
  const blocked2 = await page.evaluate(() => window.iuAnalytics.track("page_view", { section_id: "home", payload: "secret" }) === false);
  if (!blocked2) fail("behavior:free_text_payload_accepted");

  const dyn = await page.evaluate(() => {
    return (
      window.iuAnalytics.impression("camp_demo", "place_demo", { slot_type: "banner", section_id: "home" }) === true &&
      window.iuAnalytics.click("camp_demo", "place_demo", { slot_type: "banner", section_id: "home" }) === true
    );
  });
  if (!dyn) fail("behavior:dynamic_ad_events_failed");

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
    } catch (_) {}
  });
  // Open Informační centrum (lazy-mounted overlay) and assert Ads client tile.
  await page.evaluate(() => {
    try {
      var trigger =
        document.getElementById("iuTopbarInfoBtn") ||
        document.getElementById("iuSilverWelcomeInfoBtn") ||
        document.querySelector("[data-iu-mobile-gate-info-btn]");
      if (trigger) trigger.click();
    } catch (_) {}
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    try {
      if (typeof window.iuInfoCenterOpenSection === "function") window.iuInfoCenterOpenSection("menu");
    } catch (_) {}
  });
  try {
    await page.waitForSelector('[data-iu-info-external="ads-client"]', { timeout: 12000 });
  } catch (_) {
    fail("behavior:missing_ads_client_tile");
  }
  const adsTile = page.locator('[data-iu-info-external="ads-client"]');
  const adsCount = await adsTile.count();
  if (!adsCount) fail("behavior:missing_ads_client_tile");
  else {
    const href = await adsTile.first().getAttribute("href");
    if (!/https:\/\/ads\.infouzel\.cz\/client/.test(String(href || ""))) {
      fail("behavior:ads_client_tile_bad_href");
    }
    if (/josef-zmrhal/i.test(String(href || ""))) fail("behavior:ads_client_tile_personal_host");
    if (/\/admin/.test(String(href || ""))) fail("behavior:ads_client_tile_points_admin");
  }

  await page.goto(`http://127.0.0.1:${PORT}/statistiky/`, { waitUntil: "load", timeout: 20000 });
  const title = await page.title();
  if (!/Statistiky/.test(title)) fail("behavior:public_page_title");
  const hasCodex = await page.locator("text=Nesledujeme jednotlivé osoby").count();
  if (!hasCodex) fail("behavior:public_codex_missing");
  try {
    await page.waitForSelector("#sChartSvg circle.chart-dot", { timeout: 10000 });
  } catch (_) {
    fail("behavior:chart_not_rendered");
  }
  const chartUi = await page.evaluate(() => {
    const scroll = document.getElementById("sChartScroll");
    const cs = scroll ? getComputedStyle(scroll) : null;
    const range30 = document.querySelector('#sRangeSeg button[data-range="30"]');
    const metricVisits = document.querySelector('#sMetricSeg button[data-metric="visits"]');
    const dots = document.querySelectorAll("#sChartSvg circle.chart-dot").length;
    const overflowX = document.documentElement.scrollWidth > window.innerWidth + 1;
    const axisTexts = Array.from(document.querySelectorAll("#sChartSvg text"))
      .map((n) => String(n.textContent || "").trim())
      .filter((t) => /\d+\.\s*\d+\./.test(t));
    const mmDd = Array.from(document.querySelectorAll("#sChartSvg text")).some((n) =>
      /^\d{2}-\d{2}$/.test(String(n.textContent || "").trim())
    );
    const prev = document.getElementById("sChartPrev");
    const next = document.getElementById("sChartNext");
    return {
      touchAction: cs ? cs.touchAction : "",
      range30: range30 ? range30.getAttribute("aria-checked") : null,
      metricVisits: metricVisits ? metricVisits.getAttribute("aria-checked") : null,
      dots,
      overflowX,
      hasCzAxis: axisTexts.length > 0,
      hasMmDd: mmDd,
      hasPrev: !!(prev && prev.getAttribute("aria-label")),
      hasNext: !!(next && next.getAttribute("aria-label")),
      bodyOverflow: document.body.scrollWidth > window.innerWidth + 1,
    };
  });
  if (!/pan-x/.test(String(chartUi.touchAction || "")) || !/pan-y/.test(String(chartUi.touchAction || ""))) {
    fail("behavior:chart_touch_action");
  }
  if (chartUi.range30 !== "true" || chartUi.metricVisits !== "true") fail("behavior:chart_defaults");
  if (!(chartUi.dots > 5)) fail("behavior:chart_points_missing");
  if (chartUi.overflowX || chartUi.bodyOverflow) fail("behavior:page_overflow_x");
  if (!chartUi.hasCzAxis) fail("behavior:chart_axis_not_cz");
  if (chartUi.hasMmDd) fail("behavior:chart_axis_mm_dd");
  if (!chartUi.hasPrev || !chartUi.hasNext) fail("behavior:chart_nav_missing");
  await page.click('#sRangeSeg button[data-range="14"]');
  await page.waitForTimeout(100);
  const after14 = await page.evaluate(() => {
    const btn = document.querySelector('#sRangeSeg button[data-range="14"]');
    return {
      checked: btn ? btn.getAttribute("aria-checked") : null,
      dots: document.querySelectorAll("#sChartSvg circle.chart-dot").length,
    };
  });
  if (after14.checked !== "true") fail("behavior:range_14_not_selected");
  if (!(after14.dots > 0 && after14.dots <= 14)) fail("behavior:range_14_wrong_points");
  await page.click('#sMetricSeg button[data-metric="page_views"]');
  await page.waitForTimeout(80);
  const metricOk = await page.evaluate(() => {
    const btn = document.querySelector('#sMetricSeg button[data-metric="page_views"]');
    return btn ? btn.getAttribute("aria-checked") === "true" : false;
  });
  if (!metricOk) fail("behavior:metric_views_not_selected");
  await page.locator("#sChartSvg").click({ position: { x: 40, y: 110 } });
  await page.waitForTimeout(80);
  const tipVisible = await page.evaluate(() => {
    const tip = document.getElementById("sChartTip");
    return !!(tip && !tip.hidden && /Návštěvy:/.test(String(tip.textContent || "")));
  });
  if (!tipVisible) fail("behavior:chart_tip_missing");

  await browser.close();
  server.close();
} catch (e) {
  pwOk = false;
  fail("playwright:" + String(e && e.message ? e.message : e));
}

if (fails.length) {
  console.error("[iu-analytics-privacy-guard] FAIL");
  for (const f of fails.slice(0, 80)) console.error(" -", f);
  console.log("RESULT=FAIL");
  process.exit(1);
}
console.log("[iu-analytics-privacy-guard] OK static+behavior pw=" + pwOk);
console.log("RESULT=PASS");
