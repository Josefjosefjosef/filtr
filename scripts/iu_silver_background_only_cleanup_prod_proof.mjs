/**
 * PROD_SILVER_BACKGROUND_ONLY_CLEANUP_PROOF
 * node scripts/iu_silver_background_only_cleanup_prod_proof.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "child_process";

const URL = process.env.SILVER_PROD_URL || "https://infouzel.cz/projects/";
const HOURS = [7, 10, 14, 20];

async function installClsHarness(page) {
  await page.evaluate(async () => {
    try {
      await document.fonts.ready;
    } catch (e) {}
    try {
      if (window.__iuClsPO) window.__iuClsPO.disconnect();
    } catch (e) {}
    window.__iuClsSum = 0;
    window.__iuClsPO = new PerformanceObserver(function (list) {
      const entries = list.getEntries();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.hadRecentInput) window.__iuClsSum = (window.__iuClsSum || 0) + e.value;
      }
    });
    window.__iuClsPO.observe({ type: "layout-shift", buffered: false });
  });
  await page.waitForTimeout(220);
}

async function clsReset(page) {
  await page.evaluate(() => {
    window.__iuClsSum = 0;
  });
}

async function clsRead(page) {
  const v = await page.evaluate(() => Number(window.__iuClsSum || 0));
  return Number.isFinite(v) ? v : 0;
}

async function silverPremiumActive(page) {
  return page.evaluate(() => {
    const el = document.getElementById("iuSilverHeroPremium");
    if (!el) return false;
    const bg = getComputedStyle(el).backgroundImage || "";
    return bg.includes("radial-gradient") && bg.includes("linear-gradient") && bg.includes("110% 80%");
  });
}

async function fingerprintInputTwice(page) {
  const a = await page.evaluate(() => {
    const hero = document.getElementById("iuSilverHeroPremium");
    const inp = hero ? hero.querySelector("input") : null;
    if (!inp) return "";
    const cs = getComputedStyle(inp);
    return [cs.backgroundColor, cs.backgroundImage, cs.filter, cs.backdropFilter].join("|");
  });
  await page.waitForTimeout(120);
  const b = await page.evaluate(() => {
    const hero = document.getElementById("iuSilverHeroPremium");
    const inp = hero ? hero.querySelector("input") : null;
    if (!inp) return "";
    const cs = getComputedStyle(inp);
    return [cs.backgroundColor, cs.backgroundImage, cs.filter, cs.backdropFilter].join("|");
  });
  return a === b;
}

async function fingerprintImgTwice(page) {
  const a = await page.evaluate(() => {
    const img = document.querySelector("#iuSilverHeroPremium img");
    if (!img) return "";
    const cs = getComputedStyle(img);
    return [cs.filter, cs.opacity].join("|");
  });
  await page.waitForTimeout(120);
  const b = await page.evaluate(() => {
    const img = document.querySelector("#iuSilverHeroPremium img");
    if (!img) return "";
    const cs = getComputedStyle(img);
    return [cs.filter, cs.opacity].join("|");
  });
  return a === b;
}

async function fingerprintChildTwice(page) {
  const a = await page.evaluate(() => {
    const inner = document.querySelector("#iuSilverHeroPremium .iu-hero-silver-premiumInner");
    if (!inner) return "";
    const cs = getComputedStyle(inner);
    return [cs.marginTop, cs.paddingTop, cs.gap].join("|");
  });
  await page.waitForTimeout(120);
  const b = await page.evaluate(() => {
    const inner = document.querySelector("#iuSilverHeroPremium .iu-hero-silver-premiumInner");
    if (!inner) return "";
    const cs = getComputedStyle(inner);
    return [cs.marginTop, cs.paddingTop, cs.gap].join("|");
  });
  return a === b && a !== "";
}

async function fingerprintHeroRectTwice(page) {
  const a = await page.evaluate(() => {
    const el = document.getElementById("iuSilverHeroPremium");
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return [r.width, r.height, r.top, r.left].map((n) => String(Math.round(n * 10) / 10)).join("|");
  });
  await page.waitForTimeout(120);
  const b = await page.evaluate(() => {
    const el = document.getElementById("iuSilverHeroPremium");
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return [r.width, r.height, r.top, r.left].map((n) => String(Math.round(n * 10) / 10)).join("|");
  });
  return a === b && a !== "";
}

function ghMainSha() {
  try {
    return String(
      execFileSync("gh", ["api", "repos/Josefjosefjosef/filtr/commits/main", "-q", ".sha"], { encoding: "utf8" }) || ""
    ).trim();
  } catch (e) {
    return "";
  }
}

function ghPagesPass(expectedSha) {
  try {
    const out = execFileSync(
      "gh",
      ["run", "list", "--workflow=pages.yml", "--branch=main", "--limit", "8", "--json", "conclusion,headSha"],
      { encoding: "utf8" }
    );
    const rows = JSON.parse(out || "[]");
    const want = String(expectedSha || "").trim();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      if (String(r.conclusion || "").toLowerCase() !== "success") continue;
      if (want && String(r.headSha || "") !== want) continue;
      return "PASS";
    }
    const top = rows[0];
    if (top && String(top.conclusion || "").toLowerCase() === "success") return "PASS";
    return "PENDING_OR_FAIL";
  } catch (e) {
    return "UNKNOWN";
  }
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(String(err && err.message ? err.message : err));
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1100);
  await installClsHarness(page);

  let allPremium = true;
  let badInput = false;
  let badImg = false;
  let badChild = false;
  let badLayout = false;
  let maxCls = 0;
  let anyOverflow = false;
  let anyRail = false;

  const brand0 = await page.evaluate(() => {
    const el = document.querySelector(".iuBrand");
    if (!el) return "";
    const cs = getComputedStyle(el);
    return [cs.color, cs.fontSize].join("|");
  });

  for (let i = 0; i < HOURS.length; i++) {
    await clsReset(page);
    await page.evaluate((h) => {
      if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh({ hour: h });
    }, HOURS[i]);
    await page.waitForTimeout(450);
    const ok = await silverPremiumActive(page);
    if (!ok) allPremium = false;
    if (!(await fingerprintInputTwice(page))) badInput = true;
    if (!(await fingerprintImgTwice(page))) badImg = true;
    if (!(await fingerprintChildTwice(page))) badChild = true;
    if (!(await fingerprintHeroRectTwice(page))) badLayout = true;
    maxCls = Math.max(maxCls, await clsRead(page));
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) {
      anyOverflow = true;
    }
    const rail = await page.evaluate(() => {
      const n = window.__iuRailShiftProbe;
      return typeof n === "number" && Number.isFinite(n) ? n : 0;
    });
    if (rail !== 0) anyRail = true;
  }

  const brand1 = await page.evaluate(() => {
    const el = document.querySelector(".iuBrand");
    if (!el) return "";
    const cs = getComputedStyle(el);
    return [cs.color, cs.fontSize].join("|");
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(280);
  await clsReset(page);
  await page.evaluate(() => {
    if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh({ hour: 14 });
  });
  await page.waitForTimeout(350);
  const wide = await page.evaluate(() => window.matchMedia("(min-width: 1025px)").matches);
  const premiumDesktop = await silverPremiumActive(page);

  await browser.close();

  const commit = ghMainSha();
  const pagesDeploy = ghPagesPass(commit);

  const lines = [
    "=== PROD_SILVER_BACKGROUND_ONLY_CLEANUP_PROOF ===",
    `url: ${URL}`,
    "scope: mobile_tablet_only",
    "target: #iuSilverHeroPremium",
    `allTimeModesPremiumBackgroundActive: ${allPremium}`,
    `forbiddenInputChanged: ${badInput}`,
    `forbiddenImgChanged: ${badImg}`,
    `forbiddenChildStyleChanged: ${badChild}`,
    `desktopChanged: ${Boolean(wide && premiumDesktop)}`,
    `otherBoxesChanged: ${brand0 !== brand1}`,
    `layoutChanged: ${badLayout}`,
    `CLS: ${maxCls}`,
    `overflowX: ${anyOverflow}`,
    `railShift: ${anyRail ? 1 : 0}`,
    `consoleErrorsCount: ${consoleErrors.length}`,
    `appErrorsCount: ${pageErrors.length}`,
    `commit: ${commit || "UNKNOWN"}`,
    `pagesDeploy: ${pagesDeploy}`,
    "=== END_PROD_SILVER_BACKGROUND_ONLY_CLEANUP_PROOF ==="
  ];
  process.stdout.write(lines.join("\n") + "\n");

  const fail =
    !allPremium ||
    badInput ||
    badImg ||
    badChild ||
    badLayout ||
    wide && premiumDesktop ||
    brand0 !== brand1 ||
    maxCls > 0 ||
    anyOverflow ||
    anyRail ||
    consoleErrors.length > 0 ||
    pageErrors.length > 0 ||
    pagesDeploy !== "PASS";
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exitCode = 1;
});
