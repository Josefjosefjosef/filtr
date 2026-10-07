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
const SALES_PANEL_HINT_CS =
  "Pořadí reklam se automaticky posouvá nahoru, pokud před nimi není obsazená vyšší pozice. " +
  "Zakoupená pozice určuje nejzazší pořadí, na kterém se může reklama zobrazit. " +
  "Dočasně lepší zobrazení nezakládá nárok na jiný produkt, slevu ani refund.";
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

function loadPremiumAffiliateSlugs() {
  const src = fs.readFileSync(
    path.join(ROOT, "cloudflare/iu-ads/src/premium-selected-services.ts"),
    "utf8"
  );
  const block = src.match(/PREMIUM_AFFILIATE_CATEGORY_SLUGS[\s\S]*?=\s*\[([\s\S]*?)\];/);
  if (!block) return [];
  const slugs = [];
  const re = /"(aff-[^"]+)"/g;
  let m;
  while ((m = re.exec(block[1]))) slugs.push(m[1]);
  return slugs;
}

function auditStatic() {
  const js = fs.readFileSync(path.join(ROOT, "assets/iu-premium-selected-services-v1.js"), "utf8");
  ok("static:affiliate_section_visible_fn", /function affiliateSelectedSectionVisible\(\)/.test(js));
  ok("static:no_hidden_only_gate", !/if\s*\(\s*!view\s*\|\|\s*view\.hidden\s*\)\s*return/.test(js));
  ok("static:body_section_observer", /attributeFilter:\s*\["data-section"\]/.test(js));
  ok(
    "static:sales_grid_before_panel_hint",
    /function renderSalesPanel[\s\S]*?parts\.push\('<div class="iuRadioGrid iuJRGrid iuPremiumGrid iuPremiumSalesGrid"/.test(
      js
    )
  );
  ok(
    "static:no_panel_hint_before_sales_grid",
    !/function renderSalesPanel[\s\S]{0,500}<p class="iuPremiumSalesHint">/.test(js)
  );
  ok("static:premium_grid_before_affiliate", /insertBefore\(host,\s*gridEl\)/.test(js));
}

auditStatic();
if (fails.length) {
  console.error("FAIL iu-premium-selected-render-guard-v1 static");
  for (const f of fails) console.error(f);
  process.exit(1);
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8972", 10);
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
  sales_panel_hint_cs: SALES_PANEL_HINT_CS,
  slots: [
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.01",
      position: 1,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p1",
      price_label_cs: "Celková cena za 6 měsíců: 5 990 Kč bez DPH",
      position_label_cs: "1. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.02",
      position: 2,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p2",
      price_label_cs: "Celková cena za 6 měsíců: 5 690 Kč bez DPH",
      position_label_cs: "2. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.03",
      position: 3,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p3",
      price_label_cs: "Celková cena za 6 měsíců: 5 390 Kč bez DPH",
      position_label_cs: "3. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.04",
      position: 4,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p4",
      price_label_cs: "Celková cena za 6 měsíců: 5 090 Kč bez DPH",
      position_label_cs: "4. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.05",
      position: 5,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p5",
      price_label_cs: "Celková cena za 6 měsíců: 4 790 Kč bez DPH",
      position_label_cs: "5. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.06",
      position: 6,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p6",
      price_label_cs: "Celková cena za 6 měsíců: 4 490 Kč bez DPH",
      position_label_cs: "6. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.07",
      position: 7,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p7",
      price_label_cs: "Celková cena za 6 měsíců: 4 190 Kč bez DPH",
      position_label_cs: "7. pozice v této sekci",
    },
    {
      placement_id: "selected_services.aff-zdravi-doplnky.premium.08",
      position: 8,
      publicly_listed: true,
      buyable: true,
      sale_state: "available",
      order_url: "https://example.test/order-p8",
      price_label_cs: "Celková cena za 6 měsíců: 3 890 Kč bez DPH",
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

  const salesOrderSnap = await page.evaluate((hintText) => {
    const panel = document.getElementById("iuPremiumSalesPanel");
    if (!panel) return { ok: false, reason: "no_panel" };
    const kids = Array.from(panel.children);
    const gridIdx = kids.findIndex((el) => el.classList.contains("iuPremiumSalesGrid"));
    const hintIdx = kids.findIndex(
      (el) => el.classList.contains("iuPremiumSalesHint") && !el.classList.contains("muted")
    );
    const hintEl = hintIdx >= 0 ? kids[hintIdx] : null;
    const firstChild = kids[0];
    return {
      ok: gridIdx === 0 && hintIdx > gridIdx && firstChild && firstChild.classList.contains("iuPremiumSalesGrid"),
      gridIdx,
      hintIdx,
      hintTextOk: hintEl ? hintEl.textContent === hintText : false,
    };
  }, SALES_PANEL_HINT_CS);
  ok("sales_panel:grid_before_explanation", salesOrderSnap.ok, JSON.stringify(salesOrderSnap));
  ok("sales_panel:explanation_text_unchanged", salesOrderSnap.hintTextOk);

  const premiumSlugs = loadPremiumAffiliateSlugs();
  ok("sales_panel:authoritative_slug_list", premiumSlugs.length >= 30, "n=" + premiumSlugs.length);

  const stubCatalogForSection = (section) => ({
    ...stubCatalog,
    category: section,
    slots: stubCatalog.slots.map((slot) => ({
      ...slot,
      placement_id: slot.placement_id.replace("aff-zdravi-doplnky", section),
    })),
  });

  const catPage = await bootstrapGuardPage(context);
  let categoryLoopSection = SECTION;
  const fulfillPremiumApiForSection = async (route) => {
    const url = route.request().url();
    const body = url.includes("/render")
      ? JSON.stringify(stubRender)
      : JSON.stringify(stubCatalogForSection(categoryLoopSection));
    await route.fulfill({ status: 200, contentType: "application/json", body });
  };
  await catPage.route("**/v1/public/premium/selected-services/**", fulfillPremiumApiForSection);
  await catPage.route("https://ads.infouzel.cz/v1/public/premium/selected-services/**", fulfillPremiumApiForSection);

  for (const section of premiumSlugs) {
    categoryLoopSection = section;
    await catPage.goto(`${base}/projects/?section=${section}&iuInfoSystem=off&nosw=1`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await catPage.waitForSelector("#iuPremiumSalesToggle", { timeout: 30000 }).catch(() => null);
    const beforeExpand = await catPage.evaluate(() => {
      const panel = document.getElementById("iuPremiumSalesPanel");
      function vis(el) {
        if (!el) return false;
        const st = window.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 4 && r.height > 4;
      }
      const visibleCards = panel
        ? Array.from(panel.querySelectorAll("a.iuPremiumSlot--sale")).filter(vis).length
        : 0;
      return { panelHidden: panel ? panel.hidden : true, visibleCards };
    });
    ok(section + ":sales_hidden_before_expand", beforeExpand.panelHidden === true);
    ok(section + ":no_visible_sales_before_expand", beforeExpand.visibleCards === 0, "n=" + beforeExpand.visibleCards);
    await catPage.click("#iuPremiumSalesToggle").catch(() => null);
    await catPage
      .waitForFunction(
        () => document.querySelectorAll("#iuPremiumSalesPanel a.iuPremiumSlot--sale").length >= 8,
        null,
        { timeout: 30000 }
      )
      .catch(() => null);
    const catSnap = await catPage.evaluate(() => {
      const panel = document.getElementById("iuPremiumSalesPanel");
      if (!panel) return { pCount: 0, orderOk: false };
      const kids = Array.from(panel.children);
      const gridIdx = kids.findIndex((el) => el.classList.contains("iuPremiumSalesGrid"));
      const hintIdx = kids.findIndex(
        (el) => el.classList.contains("iuPremiumSalesHint") && !el.classList.contains("muted")
      );
      return {
        pCount: panel.querySelectorAll("a.iuPremiumSlot--sale").length,
        orderOk: gridIdx === 0 && hintIdx > gridIdx,
      };
    });
    ok(section + ":p1_p8_present", catSnap.pCount === 8, "n=" + catSnap.pCount);
    ok(section + ":p1_p8_before_explanation", catSnap.orderOk);
  }
  await catPage.close();

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
  await mobilePage.click("#iuPremiumSalesToggle").catch(() => null);
  await mobilePage
    .waitForFunction(
      () => document.querySelectorAll("#iuPremiumSalesPanel a.iuPremiumSlot--sale").length >= 8,
      null,
      { timeout: 30000 }
    )
    .catch(() => null);
  const mobileSalesOrder = await mobilePage.evaluate(() => {
    const panel = document.getElementById("iuPremiumSalesPanel");
    if (!panel) return { ok: false };
    const kids = Array.from(panel.children);
    const gridIdx = kids.findIndex((el) => el.classList.contains("iuPremiumSalesGrid"));
    const hintIdx = kids.findIndex(
      (el) => el.classList.contains("iuPremiumSalesHint") && !el.classList.contains("muted")
    );
    return { ok: gridIdx === 0 && hintIdx > gridIdx, docWidth: document.documentElement.scrollWidth, vw: window.innerWidth };
  });
  ok("mobile:sales_grid_before_explanation", mobileSalesOrder.ok);
  ok(
    "mobile:no_horizontal_overflow_sales",
    mobileSalesOrder.docWidth <= mobileSalesOrder.vw + 1,
    "doc=" + mobileSalesOrder.docWidth
  );
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
