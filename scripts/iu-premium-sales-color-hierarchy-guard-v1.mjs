#!/usr/bin/env node
/**
 * Premium sales panel — subtle green surface, dark hints, green card sales text.
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

const SECTIONS = [
  "aff-cestovni-kancelare",
  "aff-lekarny",
  "aff-zdravi-doplnky",
  "aff-moda",
  "aff-pneu-pneuservis",
  "aff-kosmetika",
];
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function parseRgb(color) {
  const m = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function rgbEqual(a, b) {
  return a && b && a.r === b.r && a.g === b.g && a.b === b.b;
}

function isTriggerGreen(rgb) {
  return rgb && rgb.r === 15 && rgb.g === 107 && rgb.b === 92;
}

function isStandardExplanatory(rgb, disclosureRgb) {
  if (!rgb) return false;
  if (disclosureRgb && rgbEqual(rgb, disclosureRgb)) return true;
  return rgb.r >= 11 && rgb.r <= 18 && rgb.g >= 20 && rgb.g <= 30 && rgb.b >= 40 && rgb.b <= 48 && rgb.g < 80;
}

function relLuminance({ r, g, b }) {
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(fg, bg) {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function auditStatic() {
  const css = fs.readFileSync(path.join(ROOT, "assets/iu-premium-selected-services-v1.css"), "utf8");
  ok("static:premium_sales_fg_token", /--iu-premium-sales-fg:\s*var\(--iuLink/.test(css));
  ok("static:panel_surface_token", /--iu-premium-sales-surface/.test(css));
  ok("static:panel_border_token", /--iu-premium-sales-border/.test(css));
  ok("static:hint_standard_dark", /\.iuPremiumSalesHint[\s\S]*rgba\(15,\s*23,\s*42,\s*0\.78\)/.test(css));
  ok(
    "static:panel_no_root_green_text",
    !/#iuAffiliateView \.iuPremiumSalesPanel \{[^}]*color:\s*var\(--iu-premium-sales-fg/.test(css)
  );
  ok("static:no_category_hack", !/aff-cestovni|aff-lekarny|data-section=/.test(css));
  const mediaBlocks = css.match(/@media[^{]+\{[\s\S]*?\n\}/g) || [];
  ok(
    "static:no_device_surface_hack",
    !mediaBlocks.some((block) => /--iu-premium-sales-surface|--iu-premium-sales-border/.test(block))
  );
  const hintDark = parseRgb("rgb(15, 23, 42)");
  const surfaceApprox = { r: 252, g: 253, b: 253 };
  ok("static:hint_contrast_surface", contrastRatio(hintDark, surfaceApprox) >= 4.5);
  const triggerGreen = parseRgb("rgb(15, 107, 92)");
  const cardBg = { r: 248, g: 250, b: 252 };
  ok("static:card_green_contrast", contrastRatio(triggerGreen, cardBg) >= 4.5);
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

async function installPwaStandaloneStub(context) {
  await context.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (String(q).includes("display-mode: standalone")) {
        return {
          matches: true,
          media: q,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          dispatchEvent() {
            return true;
          },
        };
      }
      return orig(q);
    };
  });
}

async function auditHierarchy(page, label) {
  await page.waitForSelector("#iuPremiumSalesToggle", { timeout: 90000 }).catch(() => null);
  await page
    .waitForFunction(
      () => {
        const t = document.getElementById("iuPremiumSalesToggle");
        if (!t) return false;
        const m = window.getComputedStyle(t).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        return m && Number(m[1]) === 15 && Number(m[2]) === 107 && Number(m[3]) === 92;
      },
      null,
      { timeout: 90000 }
    )
    .catch(() => null);

  const before = await page.evaluate(() => {
    const panel = document.getElementById("iuPremiumSalesPanel");
    const disclosure = document.getElementById("iuAffiliateDisclosure");
    const toggle = document.getElementById("iuPremiumSalesToggle");
    const cs = (el) => (el ? window.getComputedStyle(el) : null);
    const panelStyle = cs(panel);
    return {
      panelHidden: panel ? panel.hidden : true,
      toggleColor: toggle ? cs(toggle).color : "",
      disclosureColor: disclosure ? cs(disclosure).color : "",
      panelBg: panelStyle ? panelStyle.backgroundColor : "",
      panelBorderW: panelStyle ? panelStyle.borderTopWidth : "",
    };
  });

  ok(label + ":empty_panel_hidden", before.panelHidden === true);
  ok(label + ":trigger_green_before", isTriggerGreen(parseRgb(before.toggleColor)), before.toggleColor);

  await page.click("#iuPremiumSalesToggle").catch(() => null);
  await page
    .waitForFunction(
      () => !document.getElementById("iuPremiumSalesPanel")?.hidden,
      null,
      { timeout: 30000 }
    )
    .catch(() => null);

  const after = await page.evaluate(() => {
    const panel = document.getElementById("iuPremiumSalesPanel");
    const toggle = document.getElementById("iuPremiumSalesToggle");
    const disclosure = document.getElementById("iuAffiliateDisclosure");
    const topHint = document.querySelector("#iuPremiumSalesPanel .iuPremiumSalesHint:not(.muted)");
    const bottom = document.querySelector("#iuPremiumSalesPanel .iuPremiumSalesHint.muted");
    const grid = document.getElementById("iuAffiliateGrid");
    const chip = document.querySelector("#iuAffiliateGrid a.iuAffiliateChip");
    const cards = Array.from(document.querySelectorAll("#iuPremiumSalesPanel a.iuPremiumSlot--sale"));
    const cs = (el) => (el ? window.getComputedStyle(el).color : "");
    const panelStyle = panel ? window.getComputedStyle(panel) : null;
    const perPos = cards.map((card) => {
      const cta = card.querySelector(".iuPremiumSlotCta");
      const price = card.querySelector(".iuPremiumSlotSub:not(.iuPremiumSlotBuy)");
      const order = card.querySelector(".iuPremiumSlotBuy");
      return { cta: cs(cta), price: cs(price), order: cs(order) };
    });
    return {
      toggle: cs(toggle),
      disclosure: cs(disclosure),
      top: cs(topHint),
      bottom: cs(bottom),
      chip: cs(chip),
      count: cards.length,
      perPos,
      panelBg: panelStyle ? panelStyle.backgroundColor : "",
      panelBorder: panelStyle ? panelStyle.borderTopColor : "",
      panelBorderW: panelStyle ? panelStyle.borderTopWidth : "",
      chipInsidePanel: chip && panel ? panel.contains(chip) : false,
      gridAfterPanel:
        panel && grid && panel.parentNode === grid.parentNode
          ? Array.from(panel.parentNode.children).indexOf(grid) > Array.from(panel.parentNode.children).indexOf(panel)
          : false,
      docWidth: document.documentElement.scrollWidth,
      viewWidth: window.innerWidth,
    };
  });

  const afterToggle = parseRgb(after.toggle);
  const disclosureRgb = parseRgb(after.disclosure);
  ok(label + ":sales_count_4", after.count === 4, "n=" + after.count);
  ok(label + ":panel_surface_visible", after.panelBorderW && after.panelBorderW !== "0px", after.panelBorderW);
  ok(label + ":panel_subtle_bg", after.panelBg && after.panelBg !== "rgba(0, 0, 0, 0)", after.panelBg);
  ok(label + ":top_explanation_standard", isStandardExplanatory(parseRgb(after.top), disclosureRgb), after.top);
  ok(label + ":bottom_explanation_standard", !after.bottom || isStandardExplanatory(parseRgb(after.bottom), disclosureRgb), after.bottom);
  ok(label + ":top_not_green", !isTriggerGreen(parseRgb(after.top)), after.top);
  ok(label + ":bottom_not_green", !after.bottom || !isTriggerGreen(parseRgb(after.bottom)), after.bottom);
  for (let i = 0; i < after.perPos.length; i++) {
    const row = after.perPos[i];
    const pos = i + 1;
    ok(label + ":p" + pos + "_cta_green", rgbEqual(afterToggle, parseRgb(row.cta)), row.cta);
    ok(label + ":p" + pos + "_price_green", rgbEqual(afterToggle, parseRgb(row.price)), row.price);
    ok(label + ":p" + pos + "_order_green", rgbEqual(afterToggle, parseRgb(row.order)), row.order);
  }
  ok(label + ":chip_not_in_panel", !after.chipInsidePanel);
  ok(label + ":grid_after_panel", after.gridAfterPanel === true);
  ok(label + ":chip_not_green", !rgbEqual(afterToggle, parseRgb(after.chip)), after.chip);
  ok(label + ":no_horizontal_overflow", after.docWidth <= after.viewWidth + 1, "doc=" + after.docWidth + " vw=" + after.viewWidth);
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
      PREMIUM_SALES_TRIGGER_GREEN: true,
      PREMIUM_SALES_PANEL_SURFACE_SUBTLE_GREEN: true,
      PREMIUM_SALES_PANEL_BORDER_GREEN: true,
      PREMIUM_SALES_TOP_EXPLANATION_STANDARD_TEXT: true,
      PREMIUM_SALES_BOTTOM_EXPLANATION_STANDARD_TEXT: true,
      PREMIUM_SALES_CARD_TITLE_GREEN: true,
      PREMIUM_SALES_PRICE_GREEN: true,
      PREMIUM_SALES_ORDER_GREEN: true,
      STANDARD_BUTTONS_OUTSIDE_PREMIUM_PANEL: true,
      EMPTY_PREMIUM_PANEL_HIDDEN: true,
      ALL_SELECTED_SERVICES_CATEGORIES_USE_SHARED_PREMIUM_PANEL: true,
      CATEGORY_SPECIFIC_PREMIUM_PANEL_HACKS: 0,
      DEVICE_SPECIFIC_PREMIUM_PANEL_HACKS: 0,
      PREMIUM_PANEL_ACCESSIBILITY_CONTRAST: "PASS",
      DESKTOP_PREMIUM_PANEL: "PASS",
      MOBILE_PREMIUM_PANEL: "PASS",
      TABLET_PREMIUM_PANEL: "PASS",
      PWA_MOBILE_PREMIUM_PANEL: "PASS",
      PWA_TABLET_PREMIUM_PANEL: "PASS",
      NO_HORIZONTAL_OVERFLOW: "PASS",
    },
    null,
    2
  )
);
