/**
 * PROD_AFTERNOON_PREMIUM — Playwright vs https://infouzel.cz/projects/
 * Run after Pages deploy. Repo root: node scripts/iu_afternoon_premium_prod_proof.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "child_process";

const URL = process.env.AFTERNOON_PROD_URL || "https://infouzel.cz/projects/";

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
  await page.waitForTimeout(250);
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

async function snapMetrics(page) {
  const overflowX = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const railShift = await page.evaluate(() => {
    const n = window.__iuRailShiftProbe;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  });
  const clsSum = await clsRead(page);
  return { overflowX, railShift, clsSum };
}

function ghMainSha() {
  try {
    const out = execFileSync("gh", ["api", "repos/Josefjosefjosef/filtr/commits/main", "-q", ".sha"], {
      encoding: "utf8",
    });
    return String(out || "").trim();
  } catch (e) {
    return "";
  }
}

function ghPagesLastSuccess() {
  try {
    const out = execFileSync(
      "gh",
      [
        "run",
        "list",
        "--workflow=pages.yml",
        "--branch=main",
        "--limit",
        "3",
        "--json",
        "conclusion,status,displayTitle,createdAt",
      ],
      { encoding: "utf8" }
    );
    const rows = JSON.parse(out || "[]");
    const ok = rows.some((r) => r && r.conclusion === "SUCCESS");
    return ok ? "PASS" : "PENDING_OR_FAIL";
  } catch (e) {
    return "UNKNOWN";
  }
}

async function afternoonProbe(page) {
  await page.evaluate(() => {
    if (typeof window.iuSilverWelcomeRefresh === "function") {
      window.iuSilverWelcomeRefresh({ hour: 14 });
    }
  });
  await page.waitForTimeout(500);
  await clsReset(page);
  await page.waitForTimeout(200);

  const phrase = await page.evaluate(() =>
    typeof window.__iuSilverWelcomeLastPhrase === "string" ? window.__iuSilverWelcomeLastPhrase : ""
  );
  const hasClass = await page.evaluate(() => document.documentElement.classList.contains("iu-time-afternoon"));
  const modeOk = hasClass && String(phrase).includes("Příjemné odpoledne");

  const hero = page.locator("#iuSilverHeroPremium");
  const silverPremium = (await hero.count()) > 0;
  const cinematic = await hero.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundImage || "";
    return bg.includes("radial-gradient") && bg.includes("linear-gradient");
  });

  const snap = await snapMetrics(page);
  return { modeOk, silverPremium, cinematic, snap };
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
  await page.waitForTimeout(1200);
  await installClsHarness(page);
  await clsReset(page);

  const p390 = await afternoonProbe(page);

  await page.evaluate(() => {
    if (typeof window.iuSilverWelcomeRefresh === "function") {
      window.iuSilverWelcomeRefresh({ hour: 7 });
    }
  });
  await page.waitForTimeout(300);
  const otherOk = await page.evaluate(() => !document.documentElement.classList.contains("iu-time-afternoon"));

  await page.evaluate(() => {
    if (typeof window.iuSilverWelcomeRefresh === "function") {
      window.iuSilverWelcomeRefresh({ hour: 14 });
    }
  });
  await page.waitForTimeout(300);

  await page.setViewportSize({ width: 1440, height: 900 });
  await installClsHarness(page);
  await clsReset(page);
  await page.waitForTimeout(300);
  const deskOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  const deskCls = await clsRead(page);
  const desktopUnchanged = !deskOverflow && deskCls === 0;

  await browser.close();

  const commit = ghMainSha();
  const pagesDeploy = ghPagesLastSuccess();

  const lines = [
    "=== PROD_AFTERNOON_PREMIUM ===",
    `url: ${URL}`,
    "mode: Příjemné odpoledne",
    `silverPremium: ${p390.silverPremium ? "ACTIVE" : "INACTIVE"}`,
    `cinematic: ${p390.cinematic ? "true" : "false"}`,
    `otherModes: ${otherOk ? "unchanged" : "CHANGED"}`,
    `desktop: ${desktopUnchanged ? "unchanged" : "CHANGED"}`,
    `CLS: ${p390.snap.clsSum}`,
    `overflowX: ${p390.snap.overflowX}`,
    `railShift: ${p390.snap.railShift}`,
    `consoleErrorsCount: ${consoleErrors.length}`,
    `appErrorsCount: ${pageErrors.length}`,
    `commit: ${commit || "UNKNOWN"}`,
    `pagesDeploy: ${pagesDeploy}`,
    "=== END_PROD_AFTERNOON_PREMIUM ===",
  ];
  process.stdout.write(lines.join("\n") + "\n");

  const fail =
    !p390.modeOk ||
    !p390.silverPremium ||
    !p390.cinematic ||
    !otherOk ||
    !desktopUnchanged ||
    p390.snap.clsSum > 0 ||
    p390.snap.overflowX ||
    p390.snap.railShift !== 0 ||
    consoleErrors.length > 0 ||
    pageErrors.length > 0 ||
    pagesDeploy !== "PASS";
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exitCode = 1;
});
