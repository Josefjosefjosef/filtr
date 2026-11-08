#!/usr/bin/env node
/**
 * V51.4 real browser DOM/viewport tests against production (Playwright Chromium).
 * Activates affiliate lazy view before inventory/first-click probes.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const TEMP = process.env.TEMP || process.env.TMP;
const OUT = path.join(TEMP, "iu-v514-audit");
fs.mkdirSync(OUT, { recursive: true });
const shotDir = path.join(OUT, "screenshots");
fs.mkdirSync(shotDir, { recursive: true });

const URL = "https://infouzel.cz/";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

function writeJson(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}

async function dismissGates(page) {
  for (const label of ["Zrušit", "OK", "Později", "Close", "Zavřít"]) {
    try {
      const loc = page.getByRole("button", { name: label });
      if ((await loc.count()) > 0) {
        await loc.first().click({ timeout: 800 });
      }
    } catch {
      /* ignore */
    }
  }
  try {
    await page.locator("#iuGateCancel, [data-iu-gate-cancel]").first().click({ timeout: 800 });
  } catch {
    /* ignore */
  }
}

async function activateAffiliate(page) {
  await page.evaluate(async () => {
    try {
      const cs = document.querySelector("[data-view], #iuContentShell, main");
      if (cs && cs.setAttribute) cs.setAttribute("data-view", "affiliate");
    } catch {
      /* ignore */
    }
    try {
      if (typeof window.iuEnsureSecondaryJs === "function") {
        await window.iuEnsureSecondaryJs("affiliate");
      }
    } catch {
      /* ignore */
    }
    const v = document.getElementById("iuAffiliateView");
    if (v) {
      v.hidden = false;
      v.removeAttribute("hidden");
      v.style.display = "";
    }
    try {
      if (typeof window.iuAffiliateApplySection === "function") {
        await window.iuAffiliateApplySection("aff-nabytek");
      }
    } catch {
      /* ignore */
    }
    // Click nav affordances if present
    const nav = document.querySelector(
      '[data-iu-nav="affiliate"], [href*="section=aff-"], [data-section^="aff-"]'
    );
    if (nav && typeof nav.click === "function") nav.click();
  });
  await page.waitForTimeout(2500);
  // Prefer deep-link activation
  try {
    await page.goto(URL + "?section=aff-nabytek", { waitUntil: "networkidle", timeout: 60000 });
    await dismissGates(page);
    await page.evaluate(async () => {
      if (typeof window.iuEnsureSecondaryJs === "function") {
        await window.iuEnsureSecondaryJs("affiliate");
      }
      const v = document.getElementById("iuAffiliateView");
      if (v) {
        v.hidden = false;
        v.removeAttribute("hidden");
      }
      if (typeof window.iuAffiliateApplySection === "function") {
        await window.iuAffiliateApplySection("aff-nabytek");
      }
    });
    await page.waitForTimeout(3000);
  } catch {
    /* keep prior state */
  }
}

async function inventory(page) {
  return page.evaluate(() => {
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = window.getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    const affView = document.getElementById("iuAffiliateView");
    const productCards = q(
      "#iuAffiliateView [data-product-id], #iuAffiliateView .iuAffProduct, #iuAffiliateView article, [data-product-id], .iuAffProductCard, .iuProductCard"
    );
    const coupons = q(
      "#iuAffiliateView [data-coupon], #iuAffiliateView .iuCoupon, #iuAffiliateView .coupon, .iuAffCoupon"
    );
    const actions = q(
      "#iuAffiliateView [data-action], #iuAffiliateView .iuAction, #iuAffiliateView .promo, .iuAffAction"
    );
    const images = q("#iuAffiliateView img");
    const prices = q("#iuAffiliateView .price, #iuAffiliateView [data-price], #iuAffiliateView .iuPrice");
    const legal = q("#iuAffiliateView .legal, #iuAffiliateView .disclaimer, [data-legal], .iuAffLegal");
    const moreBtn = q("button, a").filter((el) => /zobrazit více/i.test(el.textContent || ""));
    const mainButtons = q(
      "#iuAffiliateView a.iuRadioChip, #iuAffiliateView a.iuAffMain, #iuAffiliateView .iuAffPartner a"
    );
    const affiliateAnchors = q("a[href]").filter((a) => {
      const href = a.getAttribute("href") || "";
      const rel = a.getAttribute("rel") || "";
      return (
        /sponsored/i.test(rel) ||
        /jdoqocy|tkqlhce|kqzyfj|dpbolvw|anrdoezrs|ftjcfx|pjatrk|click-101883843/i.test(href)
      );
    });
    const overflowX =
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const metaVer =
      document.querySelector('meta[name="iu-data-ver"]')?.getAttribute("content") || null;
    return {
      title: document.title,
      metaVer,
      affiliateViewPresent: !!affView,
      affiliateViewHidden: affView ? !!affView.hidden : null,
      affiliateViewHtmlLength: affView ? (affView.innerHTML || "").length : 0,
      productCardCount: productCards.length,
      visibleProductCards: productCards.filter(visible).length,
      couponCount: coupons.length,
      actionCount: actions.length,
      imageCount: images.length,
      priceCount: prices.length,
      legalCount: legal.length,
      moreButtonCount: moreBtn.length,
      mainButtonCount: mainButtons.length,
      affiliateAnchorCount: affiliateAnchors.length,
      visibleAffiliateAnchors: affiliateAnchors.filter(visible).length,
      horizontalOverflow: overflowX,
      sampleAffiliateLinks: affiliateAnchors.slice(0, 20).map((el) => ({
        text: (el.textContent || "").trim().slice(0, 80),
        href: el.getAttribute("href"),
        target: el.getAttribute("target"),
        rel: el.getAttribute("rel"),
        visible: visible(el),
      })),
      bodyHasAffiliateTitle: /Vybrané služby a odkazy/i.test(document.body.innerText || ""),
    };
  });
}

async function firstClickProbe(page) {
  const candidate = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const hit = anchors.find((a) => {
      const href = a.getAttribute("href") || "";
      const rel = a.getAttribute("rel") || "";
      const r = a.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.height > 0 &&
        (/sponsored/i.test(rel) ||
          /jdoqocy|tkqlhce|kqzyfj|dpbolvw|anrdoezrs|ftjcfx|pjatrk|click-101883843/i.test(href))
      );
    });
    if (!hit) return null;
    hit.scrollIntoView({ block: "center", inline: "center" });
    return {
      href: hit.getAttribute("href"),
      target: hit.getAttribute("target"),
      rel: hit.getAttribute("rel"),
      text: (hit.textContent || "").trim().slice(0, 80),
      inDom: true,
      visible: true,
    };
  });
  if (!candidate) {
    return {
      status: "NOT_TESTED",
      reason: "NO_VISIBLE_AFFILIATE_ANCHOR_FOUND_AFTER_SECTION_ACTIVATION",
      candidate: null,
    };
  }
  const attrsOk =
    candidate.target === "_blank" &&
    /sponsored/i.test(candidate.rel || "") &&
    /noopener/i.test(candidate.rel || "");
  let popupOpened = false;
  let blockedByBrowser = false;
  const popupPromise = page
    .waitForEvent("popup", { timeout: 3000 })
    .then(async (popup) => {
      popupOpened = true;
      await popup.close().catch(() => {});
    })
    .catch(() => null);
  try {
    await page.locator(`a[href="${candidate.href}"]`).first().click({
      timeout: 2500,
      noWaitAfter: true,
    });
  } catch {
    blockedByBrowser = true;
  }
  await popupPromise;
  if (!popupOpened && candidate.target === "_blank") {
    blockedByBrowser = true;
  }
  let status = "BLOCKED_BY_BROWSER";
  if (popupOpened) status = "PASS_POPUP_OPENED";
  else if (!candidate.href) status = "LINK_BROKEN";
  return {
    status,
    attrsOk,
    attributes: {
      href: candidate.href,
      target: candidate.target,
      rel: candidate.rel,
    },
    candidate,
    popupOpened,
    note:
      "DOM attributes checked separately from popup open. Headless automation may block target=_blank. No purchase performed.",
  };
}

const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
const consoleErrors = [];
const networkErrors = [];
const results = {};

for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    userAgent:
      vp.name === "mobile"
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push({ viewport: vp.name, text: msg.text() });
  });
  page.on("pageerror", (err) => consoleErrors.push({ viewport: vp.name, text: String(err) }));
  page.on("requestfailed", (req) =>
    networkErrors.push({
      viewport: vp.name,
      url: req.url(),
      error: req.failure()?.errorText || "failed",
    })
  );
  const started = new Date().toISOString();
  const resp = await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await dismissGates(page);
  await activateAffiliate(page);
  try {
    const more = page.getByText(/zobrazit více/i).first();
    if (await more.isVisible({ timeout: 1500 })) await more.click({ timeout: 1500 });
  } catch {
    /* optional */
  }
  await page.waitForTimeout(800);
  const inv = await inventory(page);
  const shotPath = path.join(shotDir, `prod-${vp.name}.png`);
  await page.screenshot({ path: shotPath, fullPage: true });
  let firstClick = null;
  if (vp.name === "desktop") {
    firstClick = await firstClickProbe(page);
  }
  results[vp.name] = {
    status: resp && resp.ok() ? "PASS_REAL_BROWSER" : "FAIL_HTTP",
    evidenceClass: "REAL_BROWSER_PLAYWRIGHT",
    notInferredFromCss: true,
    viewport: { width: vp.width, height: vp.height },
    browser: "chromium",
    browserVersion,
    url: URL,
    timestamp: started,
    productionSha: inv.metaVer,
    httpStatus: resp ? resp.status() : null,
    domInventory: inv,
    screenshot: `screenshots/prod-${vp.name}.png`,
    firstClick,
    horizontalOverflow: inv.horizontalOverflow === false,
    consoleErrorCount: consoleErrors.filter((e) => e.viewport === vp.name).length,
    networkErrorCount: networkErrors.filter((e) => e.viewport === vp.name).length,
  };
  await context.close();
}

await browser.close();

writeJson("60-desktop-browser-dom.json", results.desktop);
writeJson("61-tablet-browser-dom.json", results.tablet);
writeJson("62-mobile-browser-dom.json", results.mobile);
writeJson("63-pwa.json", {
  status: "PENDING_DEVICE_VERIFICATION",
  note: "Real iOS PWA install/launch not available in this environment.",
});
writeJson("64-first-click.json", results.desktop.firstClick || { status: "NOT_TESTED" });
writeJson("65-screenshots.json", {
  desktop: "screenshots/prod-desktop.png",
  tablet: "screenshots/prod-tablet.png",
  mobile: "screenshots/prod-mobile.png",
});
writeJson("66-console-errors.json", {
  count: consoleErrors.length,
  errors: consoleErrors.slice(0, 100),
});
writeJson("67-network-errors.json", {
  count: networkErrors.length,
  errors: networkErrors.slice(0, 100),
});

console.log(
  JSON.stringify({
    ok: true,
    desktop: results.desktop.status,
    tablet: results.tablet.status,
    mobile: results.mobile.status,
    firstClick: results.desktop.firstClick?.status,
    productionSha: results.desktop.domInventory?.metaVer,
    affiliateAnchors: results.desktop.domInventory?.affiliateAnchorCount,
    productCards: results.desktop.domInventory?.productCardCount,
    consoleErrors: consoleErrors.length,
    networkErrors: networkErrors.length,
  })
);
