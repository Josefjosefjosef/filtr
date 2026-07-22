#!/usr/bin/env node
/**
 * Production consent E2E for InfoUzel Analytics (Playwright).
 * Requires live Worker with storageMode=d1.
 * Does not open private module content — only overlay open for anonymous total.
 */
import { createRequire } from "module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const { chromium } = require("playwright");

// Default uses ?nosw=1 so Playwright UA overrides reach the Worker (installed SW can
// otherwise re-fetch ingest with HeadlessChrome and trip the crawler guard). Production
// browsers share one UA between page and SW; cross-origin SW passthrough is also required.
const SITE = process.env.IU_ANALYTICS_E2E_SITE || "https://infouzel.cz/projects/?nosw=1";
const WORKER = process.env.IU_ANALYTICS_E2E_WORKER || "https://infouzel-analytics.josef-zmrhal.workers.dev";
const fails = [];
function fail(m) {
  fails.push(m);
}

async function publicVisits() {
  const r = await fetch(WORKER + "/v1/public/stats?t=" + Date.now(), { cache: "no-store" });
  const j = await r.json();
  return { storageMode: j.storageMode, visits: Number(j.today && j.today.visits) || 0, j };
}

async function main() {
  const health = await (await fetch(WORKER + "/health")).json();
  if (!health.ok || health.storageMode !== "d1") {
    fail("worker_not_d1:" + JSON.stringify(health));
    console.error("[iu-analytics-consent-e2e] FAIL");
    for (const f of fails) console.error(" -", f);
    console.log("RESULT=FAIL");
    process.exit(1);
  }

  const before = await publicVisits();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  const posts = [];
  const postBodies = [];
  page.on("request", async (req) => {
    if (req.method() === "POST" && /infouzel-analytics/.test(req.url())) {
      posts.push(req.url());
      try {
        postBodies.push(req.postData() || "");
      } catch (_) {}
    }
  });

  // Prefer fetch over sendBeacon in headless (beacon can be dropped before navigation).
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "sendBeacon", {
        configurable: true,
        value: function () {
          return false;
        },
      });
    } catch (_) {}
  });

  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:consent:analytics:v1", "denied");
      localStorage.setItem("iu:consent:layer:dismissed:v1", "1");
    } catch (_) {}
  });
  await page.reload({ waitUntil: "load", timeout: 45000 });
  await page.waitForFunction(() => !!(window.iuConsent && window.iuAnalytics), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  const postsDenied = posts.length;
  if (postsDenied) fail("emit_without_consent:" + postsDenied);

  const mid = await publicVisits();
  if (mid.visits !== before.visits) fail("visits_changed_without_consent:" + before.visits + "->" + mid.visits);

  await page.evaluate(() => {
    if (window.iuConsent) window.iuConsent.setAnalyticsConsent("granted");
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    if (window.iuAnalytics && window.iuAnalytics.track) {
      window.iuAnalytics.track("page_view", { section_id: "home" });
      window.iuAnalytics.track("public_section_view", { section_id: "media" });
      window.iuAnalytics.privateToolsOpen();
    }
    if (window.iuAnalytics && window.iuAnalytics.flush) window.iuAnalytics.flush();
  });
  await page.waitForTimeout(3000);
  const active = await page.evaluate(
    () => !!(window.iuAnalytics && window.iuAnalytics.isActive && window.iuAnalytics.isActive())
  );
  if (!active) fail("not_active_after_grant");
  if (!posts.length) fail("no_ingest_after_grant");

  // Open a private tool overlay path if MindMenu quick action exists (anonymous total only)
  try {
    const opened = await page.evaluate(() => {
      if (typeof window.iuOpenOverlay === "function") {
        window.iuOpenOverlay("datovka");
        return true;
      }
      return false;
    });
    if (opened) {
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        if (window.iuAnalytics && window.iuAnalytics.flush) window.iuAnalytics.flush();
      });
      await page.waitForTimeout(1500);
    }
  } catch (_) {}

  await page.evaluate(() => {
    if (window.iuConsent) window.iuConsent.setAnalyticsConsent("denied");
  });
  await page.waitForTimeout(800);
  const stopped = await page.evaluate(
    () => !(window.iuAnalytics && window.iuAnalytics.isActive && window.iuAnalytics.isActive())
  );
  if (!stopped) fail("not_stopped_after_revoke");
  const postsAfterRevoke = posts.length;
  await page.goto(SITE + "?section=media", { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(2000);
  if (posts.length > postsAfterRevoke) fail("emit_after_revoke");

  // PC viewport pass
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(SITE, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1000);
  const stillDeniedPosts = posts.length;
  await page.evaluate(() => {
    if (window.iuConsent) window.iuConsent.setAnalyticsConsent("granted");
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    if (window.iuAnalytics && window.iuAnalytics.track) {
      window.iuAnalytics.track("page_view", { section_id: "home" });
    }
    if (window.iuAnalytics && window.iuAnalytics.flush) window.iuAnalytics.flush();
  });
  await page.waitForTimeout(3000);
  if (posts.length <= stillDeniedPosts) fail("pc_no_ingest_after_grant");

  // Tablet viewport classification path (consent still granted from PC step — revoke first)
  await page.evaluate(() => {
    if (window.iuConsent) window.iuConsent.setAnalyticsConsent("denied");
  });
  await page.setViewportSize({ width: 834, height: 1112 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    if (window.iuConsent) window.iuConsent.setAnalyticsConsent("granted");
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    if (window.iuAnalytics && window.iuAnalytics.track) {
      window.iuAnalytics.track("page_view", { section_id: "home" });
    }
    if (window.iuAnalytics && window.iuAnalytics.flush) window.iuAnalytics.flush();
  });
  await page.waitForTimeout(2500);

  await browser.close();

  // Poll public API beyond HTTP cache TTL
  let after = before;
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    after = await publicVisits();
    if (after.storageMode !== "d1") {
      fail("public_not_d1");
      break;
    }
    if (after.visits > before.visits || (after.j.month && after.j.month.page_views > (before.j.month && before.j.month.page_views))) {
      break;
    }
  }
  if (!(after.visits > before.visits)) {
    fail(
      "public_visits_did_not_increase:" +
        before.visits +
        "->" +
        after.visits +
        ";posts=" +
        posts.length +
        ";bodies=" +
        postBodies.filter(Boolean).length
    );
  }

  if (fails.length) {
    console.error("[iu-analytics-consent-e2e] FAIL");
    for (const f of fails.slice(0, 40)) console.error(" -", f);
    console.log("RESULT=FAIL");
    process.exit(1);
  }
  console.log("[iu-analytics-consent-e2e] OK before=" + before.visits + " after=" + after.visits);
  console.log("RESULT=PASS");
}

main().catch((e) => {
  console.error("[iu-analytics-consent-e2e] FAIL", e);
  console.log("RESULT=FAIL");
  process.exit(1);
});
