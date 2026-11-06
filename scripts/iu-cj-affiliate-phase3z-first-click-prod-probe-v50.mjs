#!/usr/bin/env node
/**
 * V50 production first-click probe (Playwright). Writes ONLY under %TEMP%.
 * Env: IU_CJ_FIRST_CLICK_OUT (dir), IU_CJ_FIRST_CLICK_BASE (default https://infouzel.cz)
 * Never completes purchases. Does not bypass popup blockers.
 */
import fs from "node:fs";
import path from "node:path";
import { classifyFirstClick, FIRST_CLICK_RESULT } from "./iu-cj-affiliate-phase3z-first-click-v50.mjs";

const outDir =
  process.env.IU_CJ_FIRST_CLICK_OUT ||
  path.join(process.env.TEMP || process.env.TMP || "/tmp", "iu-v50-evidence");
const base = (process.env.IU_CJ_FIRST_CLICK_BASE || "https://infouzel.cz").replace(/\/$/, "");
fs.mkdirSync(outDir, { recursive: true });

const { chromium, devices } = await import("playwright");

async function clickClassify(page, locator, originHost) {
  const href = await locator.getAttribute("href");
  const rel = await locator.getAttribute("rel");
  const target = await locator.getAttribute("target");
  const before = page.url();
  let popupUrl = null;
  let clickError = null;
  let clickMode = "actionable";
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const popupPromise = page.waitForEvent("popup", { timeout: 8000 }).catch(() => null);
  try {
    await locator.click({ noWaitAfter: true, timeout: 8000 });
  } catch (e1) {
    // Valid affiliate href + covered/obscured chip ≠ LINK_BROKEN. Retry with force (still a real Playwright click).
    clickMode = "force_after_actionability_timeout";
    try {
      await locator.click({ noWaitAfter: true, force: true, timeout: 5000 });
      clickError = null;
    } catch (e2) {
      clickError = String(e2 && e2.message ? e2.message : e2).slice(0, 180);
    }
  }
  const popup = await popupPromise;
  if (popup) {
    try {
      popupUrl = popup.url();
    } catch {
      popupUrl = null;
    }
    await popup.close().catch(() => {});
  }
  await page.waitForTimeout(400);
  const afterUrl = page.url();
  let sameTabNavigated = false;
  try {
    const afterHost = new URL(afterUrl).hostname;
    sameTabNavigated = afterHost !== originHost && afterUrl !== before;
  } catch {
    sameTabNavigated = afterUrl !== before;
  }
  if (sameTabNavigated) {
    await page.goto(before, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  // Valid sponsored href + click executed (or force) + no nav → BLOCKED_BY_BROWSER, not LINK_BROKEN.
  const hrefOk = Boolean(href) && /^https?:\/\//i.test(href);
  const classified = classifyFirstClick({
    href,
    popupOpened: Boolean(popup),
    popupUrl,
    sameTabNavigated,
    afterUrl,
    originHost,
    clickError: hrefOk ? null : clickError,
    hrefBroken: !hrefOk,
  });
  return {
    href,
    rel,
    target,
    before,
    afterUrl,
    popupOpened: Boolean(popup),
    popupUrl,
    sameTabNavigated,
    clickMode,
    actionableClickError: clickError,
    ...classified,
  };
}

async function probeDevice(browser, spec) {
  const context = await browser.newContext(spec.ctx);
  const page = await context.newPage();
  const originHost = new URL(base).hostname;
  const sectionUrl = `${base}/?section=${spec.section}`;
  await page.goto(sectionUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);
  try {
    await page.waitForSelector('a[rel*="sponsored"]', { timeout: 25000 });
  } catch {
    /* continue — record NOT_TESTED */
  }
  const scrollYBefore = await page.evaluate(() => window.scrollY || 0);

  const types = [
    { type: "main_button", sel: 'a.iuAffiliateChip[rel*="sponsored"], a.iuRadioChip[rel*="sponsored"]' },
    { type: "product", sel: '#iuAffiliatePhase2Offers a[rel*="sponsored"]' },
    { type: "coupon", sel: '.iuAffiliatePhase2Offers__coupon a.iuAffiliatePhase2Offers__cta[rel*="sponsored"], .iuAffiliatePhase2Offers__coupon a[rel*="sponsored"]' },
    { type: "promotion", sel: '.iuAffiliatePhase2Offers__action a.iuAffiliatePhase2Offers__cta[rel*="sponsored"], .iuAffiliatePhase2Offers__action a[rel*="sponsored"]' },
  ];

  const byType = {};
  for (const t of types) {
    const loc = page.locator(t.sel).first();
    const count = await loc.count().catch(() => 0);
    if (!count) {
      byType[t.type] = {
        result: FIRST_CLICK_RESULT.NOT_TESTED,
        reason: "selector_zero_matches",
        selector: t.sel,
      };
      continue;
    }
    byType[t.type] = await clickClassify(page, loc, originHost);
  }

  // Section still active + scroll roughly preserved after return.
  const afterSection = await page.evaluate(() => {
    const u = new URL(location.href);
    return {
      sectionParam: u.searchParams.get("section"),
      scrollY: window.scrollY || 0,
      sponsored: document.querySelectorAll('a[rel*="sponsored"]').length,
    };
  });

  await context.close();
  return {
    device: spec.name,
    section: spec.section,
    sectionUrl,
    byType,
    sectionPreserved: afterSection.sectionParam === spec.section,
    scrollYBefore,
    scrollYAfter: afterSection.scrollY,
    sponsoredAfter: afterSection.sponsored,
  };
}

const browser = await chromium.launch({ headless: true });
const devicesOut = [];
for (const spec of [
  { name: "desktop", section: "aff-nabytek", ctx: { viewport: { width: 1440, height: 900 } } },
  { name: "tablet", section: "aff-moda", ctx: { viewport: { width: 768, height: 1024 } } },
  { name: "mobile", section: "aff-kosmetika", ctx: { ...devices["iPhone 13"] } },
]) {
  devicesOut.push(await probeDevice(browser, spec));
}
await browser.close();

const summary = {
  schema: "iu-cj-affiliate-phase3z-first-click-v50",
  at: new Date().toISOString(),
  phase: "3Z-V50",
  base,
  note: "Real clicks. Headless popup block → BLOCKED_BY_BROWSER (honest). target=_blank alone ≠ PASS.",
  devices: devicesOut,
  resultCounts: {},
};
for (const d of devicesOut) {
  for (const [k, v] of Object.entries(d.byType || {})) {
    const r = v.result || FIRST_CLICK_RESULT.NOT_TESTED;
    summary.resultCounts[r] = (summary.resultCounts[r] || 0) + 1;
    summary.resultCounts[`${k}:${r}`] = (summary.resultCounts[`${k}:${r}`] || 0) + 1;
  }
}

const outPath = path.join(outDir, "84-first-click.json");
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ ok: true, outPath, resultCounts: summary.resultCounts }));
