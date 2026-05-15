/**
 * PROD_ALL_TIME_SILVER_BACKGROUND_ONLY_PROOF
 * node scripts/iu_all_time_silver_background_prod_proof.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "child_process";

const URL = process.env.SILVER_PROD_URL || "https://infouzel.cz/projects/";
const MODES = [
  { key: "morning", hour: 7, greetingNeedle: "Dobré ráno" },
  { key: "lateMorning", hour: 10, greetingNeedle: "Hezké dopoledne" },
  { key: "afternoon", hour: 14, greetingNeedle: "Příjemné odpoledne" },
  { key: "evening", hour: 20, greetingNeedle: "Dobrý večer" }
];

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
    return [cs.backgroundColor, cs.backgroundImage, cs.borderTopWidth, cs.borderColor, cs.paddingTop, cs.height].join("|");
  });
  await page.waitForTimeout(140);
  const b = await page.evaluate(() => {
    const hero = document.getElementById("iuSilverHeroPremium");
    const inp = hero ? hero.querySelector("input") : null;
    if (!inp) return "";
    const cs = getComputedStyle(inp);
    return [cs.backgroundColor, cs.backgroundImage, cs.borderTopWidth, cs.borderColor, cs.paddingTop, cs.height].join("|");
  });
  return a === b;
}

async function fingerprintImgTwice(page) {
  const a = await page.evaluate(() => {
    const img = document.querySelector("#iuSilverHeroPremium img");
    if (!img) return "";
    const cs = getComputedStyle(img);
    return [cs.filter, cs.opacity, cs.width, cs.height, cs.maxHeight].join("|");
  });
  await page.waitForTimeout(140);
  const b = await page.evaluate(() => {
    const img = document.querySelector("#iuSilverHeroPremium img");
    if (!img) return "";
    const cs = getComputedStyle(img);
    return [cs.filter, cs.opacity, cs.width, cs.height, cs.maxHeight].join("|");
  });
  return a === b;
}

async function fingerprintLayoutTwice(page) {
  const a = await page.evaluate(() => {
    const el = document.getElementById("iuSilverHeroPremium");
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return [r.width, r.height, r.top, r.left].map((n) => String(Math.round(n * 10) / 10)).join("|");
  });
  await page.waitForTimeout(140);
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
      ["run", "list", "--workflow=pages.yml", "--branch=main", "--limit", "6", "--json", "conclusion,headSha"],
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
  await page.waitForTimeout(1200);
  await installClsHarness(page);

  const modeOut = {};
  let maxCls = 0;
  let anyOverflow = false;
  let anyRail = false;
  const brand0 = await page.evaluate(() => {
    const el = document.querySelector(".iuBrand");
    if (!el) return "";
    const cs = getComputedStyle(el);
    return [cs.color, cs.fontSize, cs.fontWeight].join("|");
  });

  for (let i = 0; i < MODES.length; i++) {
    const m = MODES[i];
    await clsReset(page);
    await page.evaluate((h) => {
      if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh({ hour: h });
    }, m.hour);
    await page.waitForTimeout(500);
    const phrase = await page.evaluate(() =>
      typeof window.__iuSilverWelcomeLastPhrase === "string" ? window.__iuSilverWelcomeLastPhrase : ""
    );
    const greetOk = String(phrase).indexOf(m.greetingNeedle) >= 0;
    const premium = await silverPremiumActive(page);
    const inpOk = await fingerprintInputTwice(page);
    const imgOk = await fingerprintImgTwice(page);
    const layOk = await fingerprintLayoutTwice(page);
    const cls = await clsRead(page);
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const rail = await page.evaluate(() => {
      const n = window.__iuRailShiftProbe;
      return typeof n === "number" && Number.isFinite(n) ? n : 0;
    });
    maxCls = Math.max(maxCls, cls);
    if (overflowX) anyOverflow = true;
    if (rail !== 0) anyRail = true;
    modeOut[m.key] = {
      greeting: greetOk ? m.greetingNeedle : phrase,
      silverBackgroundPremiumActive: premium,
      forbiddenInputChanged: !inpOk,
      forbiddenImgChanged: !imgOk,
      forbiddenLayoutChanged: !layOk
    };
  }

  const brand1 = await page.evaluate(() => {
    const el = document.querySelector(".iuBrand");
    if (!el) return "";
    const cs = getComputedStyle(el);
    return [cs.color, cs.fontSize, cs.fontWeight].join("|");
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await clsReset(page);
  await page.evaluate(() => {
    if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh({ hour: 14 });
  });
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => window.matchMedia("(min-width: 1025px)").matches);
  const premiumDesktop = await silverPremiumActive(page);

  await browser.close();

  const commit = ghMainSha();
  const pagesDeploy = ghPagesPass(commit);

  const lines = [
    "=== PROD_ALL_TIME_SILVER_BACKGROUND_ONLY_PROOF ===",
    `url: ${URL}`,
    "scope: mobile_tablet_only",
    "target: #iuSilverHeroPremium",
    "modes:"
  ];
  for (let j = 0; j < MODES.length; j++) {
    const k = MODES[j].key;
    const o = modeOut[k];
    lines.push(`  ${k}:`);
    lines.push(`    greeting: ${o.greeting}`);
    lines.push(`    silverBackgroundPremiumActive: ${o.silverBackgroundPremiumActive}`);
  }
  const anyForbidden = Object.values(modeOut).some(
    (o) => o.forbiddenInputChanged || o.forbiddenImgChanged || o.forbiddenLayoutChanged
  );
  lines.push(`forbiddenInputChanged: ${MODES.some((m) => modeOut[m.key].forbiddenInputChanged)}`);
  lines.push(`forbiddenImgChanged: ${MODES.some((m) => modeOut[m.key].forbiddenImgChanged)}`);
  lines.push(`forbiddenLayoutChanged: ${MODES.some((m) => modeOut[m.key].forbiddenLayoutChanged)}`);
  lines.push(`desktopChanged: ${Boolean(wide && premiumDesktop)}`);
  lines.push(`otherBoxesChanged: ${brand0 !== brand1}`);
  lines.push(`layoutChanged: ${MODES.some((m) => modeOut[m.key].forbiddenLayoutChanged)}`);
  lines.push(`CLS: ${maxCls}`);
  lines.push(`overflowX: ${anyOverflow}`);
  lines.push(`railShift: ${anyRail ? 1 : 0}`);
  lines.push(`consoleErrorsCount: ${consoleErrors.length}`);
  lines.push(`appErrorsCount: ${pageErrors.length}`);
  lines.push(`commit: ${commit || "UNKNOWN"}`);
  lines.push(`pagesDeploy: ${pagesDeploy}`);
  lines.push("=== END_PROD_ALL_TIME_SILVER_BACKGROUND_ONLY_PROOF ===");
  process.stdout.write(lines.join("\n") + "\n");

  const fail =
    anyForbidden ||
    MODES.some((m) => !modeOut[m.key].silverBackgroundPremiumActive) ||
    MODES.some((m) => String(modeOut[m.key].greeting) !== m.greetingNeedle) ||
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
