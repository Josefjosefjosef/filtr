#!/usr/bin/env node
/**
 * V51.5 production browser DOM proof (Playwright Chromium).
 * - Honest overflow fields (no inversion)
 * - Correct selectors for phase2 offers cards/prices/coupons/actions
 * - Expand "Zobrazit další"
 * - Overflow element diagnostics when undesired page overflow exists
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const TEMP = process.env.TEMP || process.env.TMP;
const OUT = path.join(TEMP, "iu-v515-audit");
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
      if ((await loc.count()) > 0) await loc.first().click({ timeout: 800 });
    } catch {
      /* ignore */
    }
  }
}

async function activateAffiliateSection(page, sectionKey) {
  await page.goto(URL + "?section=" + sectionKey, { waitUntil: "networkidle", timeout: 60000 });
  await dismissGates(page);
  await page.evaluate(async (sk) => {
    if (typeof window.iuEnsureSecondaryJs === "function") {
      await window.iuEnsureSecondaryJs("affiliate");
    }
    const v = document.getElementById("iuAffiliateView");
    if (v) {
      v.hidden = false;
      v.removeAttribute("hidden");
    }
    if (typeof window.iuAffiliateApplySection === "function") {
      await window.iuAffiliateApplySection(sk);
    }
    const chip = document.querySelector(
      '.iuAffiliateChip[href*="' + sk + '"], [data-section="' + sk + '"]'
    );
    if (chip) chip.click();
  }, sectionKey);
  await page.waitForTimeout(2500);
}

async function expandMore(page) {
  try {
    const clicked = await page.evaluate(() => {
      const btn =
        document.querySelector("button.iuAffiliatePhase2Offers__more") ||
        Array.from(document.querySelectorAll("button")).find((b) =>
          /zobrazit další/i.test(b.textContent || "")
        );
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (clicked) {
      await page.waitForTimeout(1000);
      return true;
    }
  } catch {
    /* optional */
  }
  return false;
}

async function inventory(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
    };
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const cards = q("article.iuAffiliatePhase2Offers__card, #iuAffiliateView article");
    const prices = q(".iuAffiliatePhase2Offers__price");
    const images = q(".iuAffiliatePhase2Offers__img");
    const coupons = q(
      ".iuAffiliatePhase2Offers__coupon, [data-kind='coupon'], .iuAffiliatePhase2Offers [class*='coupon']"
    );
    const actions = q(
      ".iuAffiliatePhase2Offers__action, [data-kind='action'], .iuAffiliatePhase2Offers [class*='action']"
    );
    const more = q("button.iuAffiliatePhase2Offers__more");
    const legal = q(
      "#iuAffiliateDisclosure, .iuAffiliateDisclosure, .iuAffiliatePhase2Offers__legal, [data-legal]"
    );
    const mainButtons = q("#iuAffiliateGrid a.iuAffiliateChip, #iuAffiliateView a.iuRadioChip.iuAffiliateChip");
    const affAnchors = q("a[href]").filter((a) => {
      const href = a.getAttribute("href") || "";
      const rel = a.getAttribute("rel") || "";
      return (
        /sponsored/i.test(rel) ||
        /jdoqocy|tkqlhce|kqzyfj|dpbolvw|anrdoezrs|click-101883843/i.test(href)
      );
    });
    const docOverflow =
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const bodyOverflow = document.body.scrollWidth > document.body.clientWidth + 1;
    const offenders = [];
    if (docOverflow || bodyOverflow) {
      for (const el of q("body *")) {
        try {
          if (el.scrollWidth > el.clientWidth + 1) {
            const st = getComputedStyle(el);
            if (st.overflowX === "auto" || st.overflowX === "scroll") continue; // intentional scroller
            const r = el.getBoundingClientRect();
            if (r.width <= 0) continue;
            offenders.push({
              tag: el.tagName,
              id: el.id || null,
              className: String(el.className || "").slice(0, 120),
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
              boundingWidth: Math.round(r.width),
              overflowX: st.overflowX,
            });
            if (offenders.length >= 15) break;
          }
        } catch {
          /* ignore */
        }
      }
    }
    const cardDetails = cards.slice(0, 8).map((c) => ({
      title: (c.querySelector(".iuAffiliatePhase2Offers__cardTitle, h3")?.textContent || "").trim(),
      price: (c.querySelector(".iuAffiliatePhase2Offers__price")?.textContent || "").trim(),
      originalPrice: (c.querySelector(".iuAffiliatePhase2Offers__priceWas")?.textContent || "").trim(),
      hasImage: !!c.querySelector("img"),
      href: c.querySelector("a[href]")?.getAttribute("href") || null,
      rel: c.querySelector("a[href]")?.getAttribute("rel") || null,
      target: c.querySelector("a[href]")?.getAttribute("target") || null,
      visible: visible(c),
    }));
    const metaVer = document.querySelector('meta[name="iu-data-ver"]')?.getAttribute("content") || null;
    return {
      metaVer,
      affiliateViewPresent: !!document.getElementById("iuAffiliateView"),
      productCardCount: cards.length,
      visibleProductCards: cards.filter(visible).length,
      priceCount: prices.length,
      imageCount: images.length,
      couponCount: coupons.length,
      actionCount: actions.length,
      moreButtonCount: more.length,
      legalCount: legal.length,
      mainButtonCount: mainButtons.length,
      affiliateAnchorCount: affAnchors.length,
      documentScrollWidth: document.documentElement.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      horizontalOverflow: docOverflow || bodyOverflow,
      overflowOffenders: offenders,
      cardDetails,
      sampleMainButtons: mainButtons.slice(0, 20).map((a) => ({
        text: (a.textContent || "").trim().slice(0, 80),
        href: a.getAttribute("href"),
        rel: a.getAttribute("rel"),
        target: a.getAttribute("target"),
        visible: visible(a),
      })),
      sampleAffiliateLinks: affAnchors.slice(0, 15).map((a) => ({
        text: (a.textContent || "").trim().slice(0, 80),
        href: a.getAttribute("href"),
        rel: a.getAttribute("rel"),
        target: a.getAttribute("target"),
        visible: visible(a),
      })),
      couponTexts: coupons.slice(0, 10).map((c) => (c.textContent || "").trim().slice(0, 120)),
      actionTexts: actions.slice(0, 10).map((c) => (c.textContent || "").trim().slice(0, 120)),
    };
  });
}

async function firstClickProbe(page) {
  const candidate = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a[href]")).find((el) => {
      const href = el.getAttribute("href") || "";
      const rel = el.getAttribute("rel") || "";
      const r = el.getBoundingClientRect();
      return (
        r.width > 0 &&
        (/sponsored/i.test(rel) ||
          /jdoqocy|tkqlhce|kqzyfj|dpbolvw|anrdoezrs|click-101883843/i.test(href))
      );
    });
    if (!a) return null;
    a.scrollIntoView({ block: "center" });
    return {
      href: a.getAttribute("href"),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
      text: (a.textContent || "").trim().slice(0, 80),
    };
  });
  if (!candidate) return { status: "NOT_TESTED", reason: "NO_AFFILIATE_ANCHOR" };
  const attrsOk =
    candidate.target === "_blank" &&
    /sponsored/i.test(candidate.rel || "") &&
    /noopener/i.test(candidate.rel || "");
  let popupOpened = false;
  const popupPromise = page
    .waitForEvent("popup", { timeout: 3000 })
    .then(async (p) => {
      popupOpened = true;
      await p.close().catch(() => {});
    })
    .catch(() => null);
  try {
    await page.locator(`a[href="${candidate.href}"]`).first().click({ timeout: 2500, noWaitAfter: true });
  } catch {
    /* blocked */
  }
  await popupPromise;
  return {
    status: popupOpened ? "PASS_POPUP_OPENED" : "BLOCKED_BY_BROWSER",
    attrsOk,
    attributes: candidate,
    popupOpened,
    clickEventAttempted: true,
    note: "HTML attributes verified separately from popup open. No purchase.",
  };
}

const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
const consoleErrors = [];
const networkErrors = [];
const results = {};
const sectionKey = "aff-nabytek";

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
  page.on("requestfailed", (req) =>
    networkErrors.push({ viewport: vp.name, url: req.url(), error: req.failure()?.errorText || "failed" })
  );
  const started = new Date().toISOString();
  const resp = await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await dismissGates(page);
  await activateAffiliateSection(page, sectionKey);
  const beforeMore = await inventory(page);
  const expanded = await expandMore(page);
  const afterMore = await inventory(page);
  await page.screenshot({ path: path.join(shotDir, `prod-${vp.name}.png`), fullPage: true });
  let firstClick = null;
  if (vp.name === "desktop") firstClick = await firstClickProbe(page);

  const overflow = afterMore.horizontalOverflow === true;
  const intentionalOnly =
    overflow &&
    afterMore.overflowOffenders.length > 0 &&
    afterMore.overflowOffenders.every((o) => o.overflowX === "auto" || o.overflowX === "scroll");
  const undesiredOverflow = overflow && !intentionalOnly;
  const status = !resp?.ok()
    ? "FAIL_HTTP"
    : undesiredOverflow
      ? "FAIL_HORIZONTAL_OVERFLOW"
      : "PASS_REAL_BROWSER";

  results[vp.name] = {
    status,
    evidenceClass: "REAL_BROWSER_PLAYWRIGHT",
    notInferredFromCss: true,
    viewport: { width: vp.width, height: vp.height },
    browser: "chromium",
    browserVersion,
    url: URL,
    sectionKey,
    timestamp: started,
    productionSha: afterMore.metaVer,
    httpStatus: resp ? resp.status() : null,
    horizontalOverflow: afterMore.horizontalOverflow,
    undesiredHorizontalOverflow: undesiredOverflow,
    overflowClassification: undesiredOverflow
      ? "UNDESIRED_PAGE_OVERFLOW"
      : overflow
        ? "INTENTIONAL_INNER_SCROLLER_ONLY"
        : "NO_OVERFLOW",
    overflowDiagnostics: {
      documentScrollWidth: afterMore.documentScrollWidth,
      documentClientWidth: afterMore.documentClientWidth,
      bodyScrollWidth: afterMore.bodyScrollWidth,
      bodyClientWidth: afterMore.bodyClientWidth,
      offenders: afterMore.overflowOffenders,
    },
    beforeMore,
    afterMore,
    expandedShowMore: expanded,
    firstClick,
    screenshot: `screenshots/prod-${vp.name}.png`,
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
  note: "Real iOS PWA not available in this environment.",
});
writeJson("64-first-click.json", results.desktop.firstClick);
writeJson("65-screenshots.json", {
  desktop: "screenshots/prod-desktop.png",
  tablet: "screenshots/prod-tablet.png",
  mobile: "screenshots/prod-mobile.png",
});
writeJson("66-console-errors.json", { count: consoleErrors.length, errors: consoleErrors.slice(0, 100) });
writeJson("67-network-errors.json", { count: networkErrors.length, errors: networkErrors.slice(0, 100) });
writeJson("overflow-diagnostics.json", {
  desktop: results.desktop.overflowDiagnostics,
  tablet: results.tablet.overflowDiagnostics,
  mobile: results.mobile.overflowDiagnostics,
  statuses: {
    desktop: results.desktop.status,
    tablet: results.tablet.status,
    mobile: results.mobile.status,
  },
});

console.log(
  JSON.stringify({
    ok: true,
    desktop: results.desktop.status,
    tablet: results.tablet.status,
    mobile: results.mobile.status,
    overflow: {
      desktop: results.desktop.horizontalOverflow,
      tablet: results.tablet.horizontalOverflow,
      mobile: results.mobile.horizontalOverflow,
    },
    cardsAfterMore: results.desktop.afterMore?.productCardCount,
    prices: results.desktop.afterMore?.priceCount,
    coupons: results.desktop.afterMore?.couponCount,
    actions: results.desktop.afterMore?.actionCount,
    moreButtons: results.desktop.afterMore?.moreButtonCount,
    mainButtons: results.desktop.afterMore?.mainButtonCount,
    firstClick: results.desktop.firstClick?.status,
    productionSha: results.desktop.productionSha,
  })
);
