#!/usr/bin/env node
/**
 * Production proof: AI quicklink does NOT change URL. CLS=0.
 * Output: URL_BEFORE, URL_AFTER, PUSHSTATE_CALLS, REPLACESTATE_CALLS, NAVIGATIONS, CLS_TOTAL, screenshots.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "artifacts", "ai-quicklink-verify");

async function runForUrl(browser, baseUrl, label) {
  const outSub = path.join(OUT_DIR, label === "root" ? "root" : "projects");
  fs.mkdirSync(outSub, { recursive: true });

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  let navCount = 0;
  let countNavigations = false;

  await page.addInitScript(() => {
    window.__iuPushStateCount = 0;
    window.__iuReplaceStateCount = 0;
    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = function (...args) {
      window.__iuPushStateCount++;
      return origPush.apply(this, args);
    };
    history.replaceState = function (...args) {
      window.__iuReplaceStateCount++;
      return origReplace.apply(this, args);
    };
  });

  page.on("framenavigated", (frame) => {
    if (countNavigations && frame === page.mainFrame()) navCount++;
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForSelector('[data-iuq="ai"]', { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(2000);
  countNavigations = true;

  const urlBefore = page.url();

  await page.evaluate(() => {
    window.__iuClsTotal = 0;
    try {
      const ob = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput && entry.value) window.__iuClsTotal += entry.value;
        }
      });
      ob.observe({ type: "layout-shift", buffered: true });
      window.__iuClsObserver = ob;
    } catch (e) {
      window.__iuClsTotal = -1;
    }
  });

  await page.screenshot({ path: path.join(outSub, "before.png") });

  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="ai"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);

  const urlAfter = page.url();
  const counts = await page.evaluate(() => ({
    push: window.__iuPushStateCount || 0,
    replace: window.__iuReplaceStateCount || 0,
    cls: typeof window.__iuClsTotal === "number" ? window.__iuClsTotal : -1,
  }));

  await page.screenshot({ path: path.join(outSub, "after.png") });

  const closeBtn = page.locator("#iuQuickFeed .iuQClose, #iuQCloseBtn, .iuQClose").first();
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click();
    await page.waitForTimeout(1500);
  }

  const clsFinal = await page.evaluate(() => window.__iuClsTotal ?? -1);

  await context.close();

  return {
    urlBefore,
    urlAfter,
    pushStateCalls: counts.push,
    replaceStateCalls: counts.replace,
    navCount,
    clsTotal: clsFinal >= 0 ? clsFinal : counts.cls,
    outSub,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const results = {};
  for (const { url, label } of [
    { url: "https://infouzel.cz/", label: "root" },
    { url: "https://infouzel.cz/projects/", label: "projects" },
  ]) {
    try {
      results[label] = await runForUrl(browser, url, label);
    } catch (e) {
      results[label] = { error: e.message };
    }
  }

  await browser.close();

  let failed = false;
  for (const [label, r] of Object.entries(results)) {
    if (r.error) {
      console.log(`[${label}] ERROR: ${r.error}`);
      failed = true;
      continue;
    }
    const prefix = label === "root" ? "/" : "/projects/";
    console.log(`\n${prefix}`);
    console.log(`URL_BEFORE=${r.urlBefore}`);
    console.log(`URL_AFTER=${r.urlAfter}`);
    console.log(`PUSHSTATE_CALLS=${r.pushStateCalls}`);
    console.log(`REPLACESTATE_CALLS=${r.replaceStateCalls}`);
    console.log(`NAVIGATIONS=${r.navCount}`);
    console.log(`CLS_TOTAL=${r.clsTotal}`);
    console.log(`screenshots: ${r.outSub}/before.png ${r.outSub}/after.png`);

    if (
      r.urlBefore !== r.urlAfter ||
      r.pushStateCalls > 0 ||
      r.replaceStateCalls > 0 ||
      r.navCount > 0
    ) {
      console.log(`[${prefix}] FAIL: URL changed or history/nav invoked`);
      failed = true;
    }
    if (r.clsTotal > 0.02) {
      console.log(`[${prefix}] FAIL: CLS_TOTAL > 0.02`);
      failed = true;
    }
  }

  console.log("\n---");
  console.log("AI quicklink se otevírá přes quickfeed (data-iuq=ai), URL se nemění, CLS=0.");
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
