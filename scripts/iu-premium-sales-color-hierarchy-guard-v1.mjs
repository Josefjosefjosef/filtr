#!/usr/bin/env node
/**
 * Premium sales panel — green trigger + blue expanded content (all affiliate sections).
 * Run: npm run iu-premium-sales-color-hierarchy-guard
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";
import { closeGuardServer, createRepoStaticServer, listenGuardServer } from "./guards/guard-repo-static-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const SECTIONS = ["aff-cestovni-kancelare", "aff-lekarny", "aff-zdravi-doplnky"];
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function auditStatic() {
  const css = fs.readFileSync(path.join(ROOT, "assets/iu-premium-selected-services-v1.css"), "utf8");
  ok("static:premium_sales_fg_token", /--iu-premium-sales-fg/.test(css));
  ok("static:panel_scope", /#iuAffiliateView \.iuPremiumSalesPanel/.test(css));
  ok("static:trigger_green_separate", /#iuAffiliateView \.iuPremiumSalesLink[\s\S]*var\(--iuLink/.test(css));
  ok("static:no_category_color_hack", !/aff-cestovni|aff-zdravi|data-category|data-section=/.test(css));
  const mediaBlocks = css.match(/@media[^{]+\{[\s\S]*?\n\}/g) || [];
  ok(
    "static:no_device_color_media",
    !mediaBlocks.some((block) => /--iu-premium-sales-fg/.test(block))
  );
}

auditStatic();
if (fails.length) {
  console.error("FAIL iu-premium-sales-color-hierarchy-guard-v1 static");
  for (const f of fails) console.error(f);
  process.exit(1);
}

const stubCatalog = {
  product: "premium_selected_services_v1",
  category: "stub",
  sales_catalog_positions: 4,
  sales_panel_hint_cs: "Pořadí reklam se automaticky posouvá nahoru.",
  slots: [1, 2, 3, 4].map((pos) => ({
    placement_id: "selected_services.stub.premium.0" + pos,
    position: pos,
    publicly_listed: true,
    buyable: true,
    sale_state: "available",
    order_url: "https://example.test/order-p" + pos,
    price_label_cs: pos === 1 ? "5 990 Kč bez DPH / 6 měsíců" : "test",
    position_label_cs: pos + ". pozice v této sekci",
    position_explanation_cs: pos === 1 ? "Zakoupená P1 je v rámci Premium pozic vždy první." : "",
  })),
  measurement: { impressions: false, clicks: false, ctr: false },
};
const stubRender = {
  active: [],
  measurement: { impressions: false, clicks: false, ctr: false },
};

function parseRgb(color) {
  const m = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function isPremiumBlue(rgb) {
  return rgb && rgb.r === 11 && rgb.g === 42 && rgb.b === 74;
}

function isTriggerGreen(rgb) {
  return rgb && rgb.r === 15 && rgb.g === 107 && rgb.b === 92;
}

async function installPwaStandaloneStub(context) {
  await context.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (String(q).includes("display-mode: standalone")) {
        return { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
      }
      return orig(q);
    };
  });
}

async function auditHierarchy(page, label) {
  await page
    .waitForFunction(() => typeof window.iuAffiliateApplySection === "function", null, { timeout: 120000 })
    .catch(() => null);
  await page
    .waitForSelector("#iuAffiliateDisclosure", { timeout: 60000 })
    .catch(() => null);
  await page
    .waitForSelector("#iuPremiumSalesToggle", { timeout: 90000 })
    .catch(() => null);

  const before = await page.evaluate(() => {
    const disclosure = document.getElementById("iuAffiliateDisclosure");
    const toggle = document.getElementById("iuPremiumSalesToggle");
    const chip = document.querySelector("#iuAffiliateGrid a.iuAffiliateChip");
    const disclosureCs = disclosure ? window.getComputedStyle(disclosure) : null;
    const toggleCs = toggle ? window.getComputedStyle(toggle) : null;
    const chipCs = chip ? window.getComputedStyle(chip) : null;
    return {
      disclosureColor: disclosureCs ? disclosureCs.color : "",
      toggleColor: toggleCs ? toggleCs.color : "",
      chipColor: chipCs ? chipCs.color : "",
    };
  });

  ok(label + ":disclosure_unchanged", !isPremiumBlue(parseRgb(before.disclosureColor)), before.disclosureColor);
  ok(label + ":trigger_green", isTriggerGreen(parseRgb(before.toggleColor)), before.toggleColor);
  ok(label + ":chip_unchanged", !isPremiumBlue(parseRgb(before.chipColor)), before.chipColor);

  await page.click("#iuPremiumSalesToggle").catch(() => null);
  await page
    .waitForFunction(
      () => document.querySelectorAll("#iuPremiumSalesPanel a.iuPremiumSlot--sale").length >= 4,
      null,
      { timeout: 30000 }
    )
    .catch(() => null);

  const after = await page.evaluate(() => {
    const toggle = document.getElementById("iuPremiumSalesToggle");
    const topHint = document.querySelector("#iuPremiumSalesPanel .iuPremiumSalesHint");
    const p1 = document.querySelector("#iuPremiumSalesPanel a.iuPremiumSlot--sale .iuPremiumSlotCta");
    const price = document.querySelector("#iuPremiumSalesPanel a.iuPremiumSlot--sale .iuPremiumSlotSub");
    const order = document.querySelector("#iuPremiumSalesPanel a.iuPremiumSlot--sale .iuPremiumSlotBuy");
    const bottom = document.querySelector("#iuPremiumSalesPanel .iuPremiumSalesHint.muted");
    const chip = document.querySelector("#iuAffiliateGrid a.iuAffiliateChip");
    const cs = (el) => (el ? window.getComputedStyle(el).color : "");
    return {
      toggle: cs(toggle),
      top: cs(topHint),
      p1: cs(p1),
      price: cs(price),
      order: cs(order),
      bottom: cs(bottom),
      chip: cs(chip),
      count: document.querySelectorAll("#iuPremiumSalesPanel a.iuPremiumSlot--sale").length,
    };
  });

  ok(label + ":sales_count_4", after.count === 4, "n=" + after.count);
  ok(label + ":trigger_still_green", isTriggerGreen(parseRgb(after.toggle)), after.toggle);
  ok(label + ":top_hint_blue", isPremiumBlue(parseRgb(after.top)), after.top);
  ok(label + ":p1_blue", isPremiumBlue(parseRgb(after.p1)), after.p1);
  ok(label + ":price_blue", isPremiumBlue(parseRgb(after.price)), after.price);
  ok(label + ":order_blue", isPremiumBlue(parseRgb(after.order)), after.order);
  if (after.bottom) ok(label + ":bottom_blue", isPremiumBlue(parseRgb(after.bottom)), after.bottom);
  ok(label + ":chip_still_not_blue", !isPremiumBlue(parseRgb(after.chip)), after.chip);
}

const server = createRepoStaticServer(ROOT);
const PORT = await listenGuardServer(server);
const base = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ headless: true });
try {
  const fulfillPremiumApi = async (route) => {
    const url = route.request().url();
    const body = url.includes("/render") ? JSON.stringify(stubRender) : JSON.stringify(stubCatalog);
    await route.fulfill({ status: 200, contentType: "application/json", body });
  };

  const profiles = [
    { label: "desktop", width: 1280, height: 900, touch: false, pwa: false },
    { label: "tablet", width: 768, height: 1024, touch: true, pwa: false },
    { label: "mobile", width: 390, height: 844, touch: true, pwa: false },
    { label: "pwa_mobile", width: 390, height: 844, touch: true, pwa: true },
    { label: "pwa_tablet", width: 768, height: 1024, touch: true, pwa: true },
  ];

  for (const section of SECTIONS) {
    for (const profile of profiles) {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: profile.width, height: profile.height },
        hasTouch: profile.touch,
      });
      if (profile.pwa) await installPwaStandaloneStub(context);
      const page = await bootstrapGuardPage(context);
      await page.route("**/v1/public/premium/selected-services/**", fulfillPremiumApi);
      await page.route("https://ads.infouzel.cz/v1/public/premium/selected-services/**", fulfillPremiumApi);
      await page.goto(`${base}/projects/?section=${section}&iuInfoSystem=off&nosw=1`, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await auditHierarchy(page, section + ":" + profile.label);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await closeGuardServer(server);
}

if (fails.length) {
  console.error("FAIL iu-premium-sales-color-hierarchy-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-sales-color-hierarchy-guard-v1");
console.log(
  JSON.stringify(
    {
      DEVICE_SPECIFIC_PREMIUM_COLOR_HACKS: 0,
      CATEGORY_SPECIFIC_PREMIUM_COLOR_HACKS: 0,
      ALL_SELECTED_SERVICES_CATEGORIES_USE_SHARED_PREMIUM_STYLE: true,
      DESKTOP_PREMIUM_COLOR_HIERARCHY: "PASS",
      MOBILE_PREMIUM_COLOR_HIERARCHY: "PASS",
      TABLET_PREMIUM_COLOR_HIERARCHY: "PASS",
      PWA_MOBILE_PREMIUM_COLOR_HIERARCHY: "PASS",
      PWA_TABLET_PREMIUM_COLOR_HIERARCHY: "PASS",
    },
    null,
    2
  )
);
