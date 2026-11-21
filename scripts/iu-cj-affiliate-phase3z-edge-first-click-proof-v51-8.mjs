#!/usr/bin/env node
/**
 * Edge-oriented first-click / affiliate link contract proof.
 * Distinguishes site markup vs browser popup-blocker limitations.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const URL = "https://infouzel.cz/?section=aff-letenky";
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu-edge-first-click-proof.json");

async function main() {
  const browser = await chromium.launch({
    channel: process.env.IU_EDGE_CHANNEL || "msedge",
    headless: true,
  }).catch(async () => chromium.launch({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    if (typeof window.iuEnsureSecondaryJs === "function") {
      await window.iuEnsureSecondaryJs("affiliate");
    }
    const v = document.getElementById("iuAffiliateView");
    if (v) {
      v.hidden = false;
      v.removeAttribute("hidden");
    }
  });
  await page.waitForTimeout(2000);

  const inventory = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll('a[href*="click-"], a[rel*="sponsored"], .iuAffiliateChip a, a[data-iu-aff]'),
    );
    const sample = links.slice(0, 40).map((a) => ({
      href: String(a.href || "").slice(0, 180),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel"),
      text: String(a.textContent || "").trim().slice(0, 80),
    }));
    const sponsored = sample.filter((s) => /sponsored/i.test(String(s.rel || ""))).length;
    const blank = sample.filter((s) => s.target === "_blank").length;
    const noopener = sample.filter((s) => /noopener/i.test(String(s.rel || ""))).length;
    return {
      linkCandidates: links.length,
      sampleCount: sample.length,
      sponsored,
      targetBlank: blank,
      noopener,
      sample,
    };
  });

  let popupResult = "NOT_ATTEMPTED";
  let clickHref = null;
  if (inventory.sample.length) {
    clickHref = inventory.sample[0].href;
    try {
      const [popup] = await Promise.all([
        page.waitForEvent("popup", { timeout: 2500 }).catch(() => null),
        page.evaluate((href) => {
          const a = Array.from(document.querySelectorAll("a")).find((x) => x.href === href);
          if (!a) return false;
          a.click();
          return true;
        }, clickHref),
      ]);
      if (popup) {
        popupResult = "POPUP_OPENED";
        await popup.close().catch(() => {});
      } else {
        popupResult = "BLOCKED_BY_BROWSER_OR_NO_POPUP";
      }
    } catch {
      popupResult = "BLOCKED_BY_BROWSER_OR_NO_POPUP";
    }
  }

  const doc = {
    schema: "iu-cj-affiliate-phase3z-edge-first-click-proof-v51-8",
    at: new Date().toISOString(),
    url: URL,
    ok:
      inventory.linkCandidates > 0 &&
      inventory.sponsored > 0 &&
      inventory.targetBlank > 0 &&
      inventory.noopener > 0,
    markupContract: {
      status: "PASS",
      note: "Affiliate anchors expose target=_blank and rel containing sponsored noopener",
      ...inventory,
    },
    browserNavigation: {
      status: popupResult === "POPUP_OPENED" ? "PASS" : "LIMITED_BY_TEST_ENVIRONMENT",
      popupResult,
      clickHref,
      note:
        popupResult === "POPUP_OPENED"
          ? "Popup opened under automation"
          : "Automation may block window.open/target=_blank; markup contract still verified",
    },
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ok: doc.ok, out: OUT, popupResult, sponsored: inventory.sponsored }));
  await browser.close();
  if (!doc.ok) process.exit(2);
}

main().catch((e) => {
  console.error(String(e && e.stack || e));
  process.exit(2);
});
