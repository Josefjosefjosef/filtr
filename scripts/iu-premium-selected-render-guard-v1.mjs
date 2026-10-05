#!/usr/bin/env node
/**
 * Regression: premium P1/P2 must render visibly when #iuAffiliateView stays [hidden] (CSS-shown affiliate section).
 * Run: npm run iu-premium-selected-render-guard
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

const SECTION = "aff-zdravi-doplnky";
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
  ok("static:affiliate_section_visible_fn", /function affiliateSelectedSectionVisible\(\)/.test(js));
  ok("static:no_hidden_only_gate", !/if\s*\(\s*!view\s*\|\|\s*view\.hidden\s*\)\s*return/.test(js));
  ok("static:body_section_observer", /attributeFilter:\s*\["data-section"\]/.test(js));
}

auditStatic();
if (fails.length) {
  console.error("FAIL iu-premium-selected-render-guard-v1 static");
  for (const f of fails) console.error(f);
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8968", 10);
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
  category: SECTION,
  premium_capacity: 2,
  sales_catalog_positions: 8,
  slots: [
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.01",
      position: 1,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p1",
      price_label_cs: "5 990 Kč bez DPH / 6 měsíců",
      position_label_cs: "1. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.02",
      position: 2,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p2",
      price_label_cs: "5 690 Kč bez DPH / 6 měsíců",
      position_label_cs: "2. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.03",
      position: 3,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p3",
      price_label_cs: "5 390 Kč bez DPH / 6 měsíců",
      position_label_cs: "3. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.04",
      position: 4,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p4",
      price_label_cs: "5 090 Kč bez DPH / 6 měsíců",
      position_label_cs: "4. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.05",
      position: 5,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p5",
      price_label_cs: "4 790 Kč bez DPH / 6 měsíců",
      position_label_cs: "5. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.06",
      position: 6,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p6",
      price_label_cs: "4 490 Kč bez DPH / 6 měsíců",
      position_label_cs: "6. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.07",
      position: 7,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p7",
      price_label_cs: "4 190 Kč bez DPH / 6 měsíců",
      position_label_cs: "7. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.08",
      position: 8,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p8",
      price_label_cs: "3 890 Kč bez DPH / 6 měsíců",
      position_label_cs: "8. pozice v této sekci",
    },
  ],
  measurement: { impressions: false, clicks: false, ctr: false },
};
const stubRender = {
  active: [
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.01",
      position: 1,
      display_rank: 1,
      target_url: "https://example.test/ad-p1",
      creative_format: "logo",
      accessible_name: "Test P1",
      creative_cdn_url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    },
  ],
  measurement: { impressions: false, clicks: false, ctr: false },
};

const browser = await chromium.launch({ headless: true });
try {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1280, height: 800 },
    hasTouch: false,
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
  await page.goto(`${base}/projects/?section=${SECTION}&iuInfoSystem=off&nosw=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  await page
    .waitForFunction(
      () => typeof window.iuAffiliateApplySection === "function",
      null,
      { timeout: 120000 }
    )
    .catch(() => null);

  await page
    .waitForSelector("#iuAffiliateGrid a.iuAffiliateChip", { timeout: 120000 })
    .catch(() => null);

  const prodHidden = await page.evaluate(() => {
    const view = document.getElementById("iuAffiliateView");
    return !!(view && view.hasAttribute("hidden"));
  });
  ok("dom:affiliate_view_hidden_attr", prodHidden);

  await page
    .waitForFunction(
      () => document.querySelectorAll("#iuPremiumSelectedGrid a.iuPremiumSlot--sold").length >= 1,
      null,
      { timeout: 60000 }
    )
    .catch(() => null);

  const snap = await page.evaluate(() => {
    const prem = Array.from(document.querySelectorAll("#iuPremiumSelectedGrid a.iuPremiumSlot--sold"));
    const freePublic = document.querySelectorAll("#iuPremiumSelectedGrid a.iuPremiumSlot--free").length;
    const salesLink = document.getElementById("iuPremiumSalesToggle");
    const chips = Array.from(document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip"));
    function vis(el) {
      if (!el) return false;
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 4 && r.height > 4;
    }
    const premHost = document.getElementById("iuPremiumSelectedGrid");
    const grid = document.getElementById("iuAffiliateGrid");
    const orderOk =
      premHost && grid && premHost.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING;
    return {
      premCount: prem.length,
      chipCount: chips.length,
      premVisible: prem.filter(vis).length,
      orderOk: !!orderOk,
      p1Href: prem[0] ? prem[0].getAttribute("href") : "",
      section: document.body && document.body.dataset ? document.body.dataset.section : "",
      freePublic: freePublic,
      salesLink: !!salesLink,
    };
  });

  ok("render:active_only_count", snap.premCount === 1, "n=" + snap.premCount);
  ok("render:active_visible", snap.premVisible === 1, "vis=" + snap.premVisible);
  ok("render:no_free_public", snap.freePublic === 0, "free=" + snap.freePublic);
  ok("render:sales_link", snap.salesLink);
  ok("render:chips_8", snap.chipCount === 8, "n=" + snap.chipCount);
  ok("render:prem_before_standard", snap.orderOk);
  ok("render:section_key", snap.section === SECTION, snap.section);
  ok("render:p1_live_href", snap.p1Href === "https://example.test/ad-p1", snap.p1Href);

  await page.click("#iuPremiumSalesToggle").catch(() => null);
  await page
    .waitForFunction(
      () => document.querySelectorAll("#iuPremiumSalesPanel a.iuPremiumSlot--sale").length >= 8,
      null,
      { timeout: 30000 }
    )
    .catch(() => null);
  const salesSnap = await page.evaluate(() => {
    const cards = document.querySelectorAll("#iuPremiumSalesPanel a.iuPremiumSlot--sale");
    const hrefs = Array.from(cards).map((a) => a.getAttribute("href") || "");
    return { count: cards.length, hrefs };
  });
  ok("sales_panel:card_count_8", salesSnap.count === 8, "n=" + salesSnap.count);
  ok(
    "sales_panel:p3_p4_buyable",
    salesSnap.hrefs.includes("https://example.test/order-p3") &&
      salesSnap.hrefs.includes("https://example.test/order-p4"),
    JSON.stringify(salesSnap.hrefs)
  );

  const mobileContext = await bootstrapGuardContext(browser, {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const mobilePage = await bootstrapGuardPage(mobileContext);
  await mobilePage.route("**/v1/public/premium/selected-services/**", fulfillPremiumApi);
  await mobilePage.route("https://ads.infouzel.cz/v1/public/premium/selected-services/**", fulfillPremiumApi);
  await mobilePage.goto(`${base}/projects/?section=${SECTION}&iuInfoSystem=off&nosw=1`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await mobilePage
    .waitForSelector("#iuPremiumSelectedGrid a.iuPremiumSlot--sold", { timeout: 60000 })
    .catch(() => null);
  const mobileGeom = await mobilePage.evaluate(() => {
    const prem = document.querySelector("#iuPremiumSelectedGrid a.iuPremiumSlot--sold");
    const chip = document.querySelector("#iuAffiliateGrid a.iuAffiliateChip");
    if (!prem || !chip) return { ok: false, reason: "missing" };
    const ph = prem.getBoundingClientRect().height;
    const ch = chip.getBoundingClientRect().height;
    return { ok: Math.abs(ph - ch) <= 1.5, ph, ch };
  });
  ok("mobile:prem_footprint_matches_chip", mobileGeom.ok, JSON.stringify(mobileGeom));
  await mobileContext.close();
} finally {
  await browser.close();
  server.close();
}

if (fails.length) {
  console.error("FAIL iu-premium-selected-render-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-selected-render-guard-v1");
