#!/usr/bin/env node
/**
 * Browser/network guard: premium selected-services collects zero ad performance tracking.
 * Run: npm run iu-premium-selected-no-tracking-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
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

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const s = net.createConnection({ host, port }, () => {
        s.end();
        resolve();
      });
      s.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("port_timeout"));
        else setTimeout(tick, 100);
      });
    };
    tick();
  });
}

function auditStatic() {
  const js = fs.readFileSync(path.join(ROOT, "assets/iu-premium-selected-services-v1.js"), "utf8");
  ok("static:no_click_endpoint", !/\/click|impression|trackEvent|analytics.*premium/i.test(js));
  ok("static:no_ads_redirect", !/ads\.infouzel\.cz\/click/.test(js));
  ok("static:direct_href", /a\.href\s*=\s*item\.target_url/.test(js));
  ok("static:credentials_omit", /credentials:\s*"omit"/.test(js));
}

auditStatic();
if (fails.length) {
  console.error("FAIL iu-premium-selected-no-tracking-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8963", 10);
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
    const mime = fp.endsWith(".css")
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

const browser = await chromium.launch({ headless: true });
try {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await bootstrapGuardPage(context);
  const fulfillPremiumApi = async (route) => {
    const url = route.request().url();
    const body = url.includes("/render") ? JSON.stringify(stubRender) : JSON.stringify(stubCatalog);
    await route.fulfill({ status: 200, contentType: "application/json", body });
  };
  await page.route("**/v1/public/premium/selected-services/**", fulfillPremiumApi);
  await page.route("https://ads.infouzel.cz/v1/public/premium/selected-services/**", fulfillPremiumApi);

  const base = `http://127.0.0.1:${PORT}`;
  await page.goto(`${base}/projects/?section=media&iuInfoSystem=off&nosw=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.evaluate(() => {
    if (!document.getElementById("iuAffiliateGrid")) {
      const g = document.createElement("div");
      g.id = "iuAffiliateGrid";
      document.body.appendChild(g);
    }
  });
  await page.addScriptTag({
    url: `${base}/assets/iu-premium-selected-services-v1.js?v=premium-selected-v1-20261002`,
  });
  await page
    .waitForFunction(() => typeof window.iuPremiumSelectedMount === "function", null, { timeout: 90000 })
    .catch(() => null);

  const trackingUrls = [];
  page.on("request", (req) => {
    const u = req.url();
    if (/premium.*click|\/v1\/public\/premium\/.*click|ads\.infouzel.*click|premium_impression/i.test(u)) {
      trackingUrls.push(u);
    }
  });

  ok("boot:mount_fn", await page.evaluate(() => typeof window.iuPremiumSelectedMount === "function"));

  for (const consent of ["allowed", "denied", "unset"]) {
    await page.evaluate((mode) => {
      try {
        localStorage.removeItem("iu.analytics.consent");
        if (mode === "allowed") localStorage.setItem("iu.analytics.consent", "allowed");
        if (mode === "denied") localStorage.setItem("iu.analytics.consent", "denied");
      } catch (_) {}
    }, consent);

    await page.evaluate(() => {
      if (typeof window.iuPremiumSelectedMount === "function") window.iuPremiumSelectedMount("aff-finance");
    });

    await page.waitForSelector(".iuPremiumSlot--sold", { timeout: 20000 }).catch(() => null);
    const href = await page.locator(".iuPremiumSlot--sold").first().getAttribute("href").catch(() => null);
    ok("consent_" + consent + ":href_direct", href === "https://client-approved.example/path", String(href));

    const clickUrls = [];
    const onReq = (req) => {
      const u = req.url();
      if (/premium.*click|ads\.infouzel.*click|iu-analytics.*premium|track/i.test(u)) clickUrls.push(u);
    };
    page.on("request", onReq);
    await page.locator(".iuPremiumSlot--sold").first().click({ modifiers: ["Control"] }).catch(() => {});
    await page.waitForTimeout(300);
    page.off("request", onReq);
    ok("consent_" + consent + ":zero_click_track", clickUrls.length === 0, clickUrls.join(","));
  }

  ok("render:zero_premium_track_urls", trackingUrls.length === 0, trackingUrls.join("|"));
} finally {
  await browser.close();
  server.close();
}

if (fails.length) {
  console.error("FAIL iu-premium-selected-no-tracking-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-selected-no-tracking-guard-v1");
