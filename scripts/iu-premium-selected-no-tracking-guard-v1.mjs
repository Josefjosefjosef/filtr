#!/usr/bin/env node
/**
 * Browser/network guard: premium selected-services collects zero ad performance tracking.
 * Run: npm run iu-premium-selected-no-tracking-guard
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

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const js = fs.readFileSync(path.join(ROOT, "assets/iu-premium-selected-services-v1.js"), "utf8");
  ok("static:no_click_endpoint", !/\/click|impression|trackEvent|analytics.*premium/i.test(js));
  ok("static:no_ads_redirect", !/ads\.infouzel\.cz\/click/.test(js));
  ok("static:direct_href", /a\.href\s*=\s*item\.target_url/.test(js));
  ok("static:credentials_omit", /credentials:\s*"omit"/.test(js));
}

async function runBrowser() {
  const ctx = await bootstrapGuardContext(chromium, ROOT);
  const page = await bootstrapGuardPage(ctx, `${ctx.base}/projects/?section=media&iuInfoSystem=off&nosw=1`);

  const trackingUrls = [];
  page.on("request", (req) => {
    const u = req.url();
    if (/premium.*click|\/v1\/public\/premium\/.*click|ads\.infouzel.*click|iu-analytics|premium_impression/i.test(u)) {
      trackingUrls.push(u);
    }
  });

  const stubCatalog = {
    product: "premium_selected_services_v1",
    category: "aff-finance",
    premium_capacity: 2,
    slots: [
      {
        placement_id: "selected_services.aff-finance.premium.01",
        position: 1,
        publicly_listed: true,
        order_url: "https://example.test/order",
        price_label_cs: "5 990 Kč bez DPH / 6 měsíců",
      },
    ],
    measurement: { impressions: false, clicks: false, ctr: false },
  };
  const stubRender = {
    active: [
      {
        placement_id: "selected_services.aff-finance.premium.01",
        target_url: "https://client-approved.example/path",
        creative_format: "logo",
        creative_cdn_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        accessible_name: "Test premium",
      },
    ],
  };

  await page.route("**/v1/public/premium/selected-services/**", async (route) => {
    const url = route.request().url();
    const body = url.includes("/render") ? JSON.stringify(stubRender) : JSON.stringify(stubCatalog);
    await route.fulfill({ status: 200, contentType: "application/json", body });
  });

  for (const consent of ["allowed", "denied", "unset"]) {
    await page.evaluate((mode) => {
      try {
        localStorage.removeItem("iu.analytics.consent");
        if (mode === "allowed") localStorage.setItem("iu.analytics.consent", "allowed");
        if (mode === "denied") localStorage.setItem("iu.analytics.consent", "denied");
      } catch (_) {}
    }, consent);

    await page.evaluate(() => {
      if (typeof window.iuPremiumSelectedMount === "function") {
        window.iuPremiumSelectedMount("aff-finance");
      }
    });

    await page.waitForSelector(".iuPremiumSlot--sold", { timeout: 15000 }).catch(() => null);
    const href = await page.locator(".iuPremiumSlot--sold").first().getAttribute("href").catch(() => null);
    ok("consent_" + consent + ":href_direct", href === "https://client-approved.example/path", String(href));

    const clickUrls = [];
    page.removeAllListeners("request");
    page.on("request", (req) => {
      const u = req.url();
      if (/premium.*click|ads\.infouzel.*click|iu-analytics.*premium|track/i.test(u)) clickUrls.push(u);
    });
    await page.locator(".iuPremiumSlot--sold").first().click({ modifiers: ["Control"] }).catch(() => {});
    await page.waitForTimeout(300);
    ok("consent_" + consent + ":zero_click_track", clickUrls.length === 0, clickUrls.join(","));
  }

  ok("render:zero_premium_track_urls", trackingUrls.length === 0, trackingUrls.join("|"));
  await ctx.browser.close();
}

auditStatic();
await runBrowser();

if (fails.length) {
  console.error("FAIL iu-premium-selected-no-tracking-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-selected-no-tracking-guard-v1");
