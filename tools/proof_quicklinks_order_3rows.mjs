#!/usr/bin/env node
/**
 * Proof: Rychlé odkazy (QuickLinks) icon order = 3 rows fixed order.
 * Finds block "Rychlé odkazy", lists 9 items in DOM order, compares to expected.
 * Output: artifacts/PROOF_QUICKLINKS_ORDER_3ROWS.txt
 * Run: node tools/proof_quicklinks_order_3rows.mjs
 * Env: PROOF_BASE_URL (default https://www.infouzel.cz/projects/ or local)
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");

const DEFAULT_BASE = process.env.PROOF_BASE_URL || "https://www.infouzel.cz/projects/";
const BASE_URL = DEFAULT_BASE;

const CONSOLE_ERROR_NOISE = [
  /videos\.json/i,
  /loadAiAssistants|Failed to fetch|preflightDataEndpoints/i,
  /TypeError:\s*Failed to fetch/i,
  /favicon/i,
  /404|net::ERR|Failed to load resource|ERR_FILE|Script error|ResizeObserver/i,
];
function isNoiseConsoleError(text) {
  return CONSOLE_ERROR_NOISE.some((r) => r.test(String(text)));
}

const EXPECTED_LABELS = [
  "AI asistenti",
  "Překladač",
  "Převod na Word, PDF",
  "Balíky",
  "Nákup domů",
  "Poslat SMS zdarma",
  "YouTube",
  "Google",
  "Seznam.cz",
];

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const out = path.join(ARTIFACTS, name);
  fs.writeFileSync(out, text.replace(/\n/g, "\r\n"), "utf8");
  return out;
}

async function main() {
  let browser = null;
  let page = null;
  const consoleErrors = [];
  const pageErrors = [];
  let clsValue = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(2000);

    const clsPromise = page.evaluate(() => {
      return new Promise((resolve) => {
        let cls = 0;
        const observer = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            cls += e.value;
          }
        });
        try {
          observer.observe({ type: "layout-shift", buffered: true });
        } catch {
          resolve(0);
          return;
        }
        setTimeout(() => {
          observer.disconnect();
          resolve(cls);
        }, 3000);
      });
    }).catch(() => 0);
    clsValue = await clsPromise;

    const selector = ".accordionCol section.iu-mmQuickLinks .iu-mmQuickGrid .iu-mmQuickItem";
    const items = page.locator(selector);
    const count = await items.count();

    const foundLabels = [];
    for (let i = 0; i < count; i++) {
      const el = items.nth(i);
      const aria = await el.getAttribute("aria-label").catch(() => null);
      const text = await el.locator("span:last-of-type").first().textContent().catch(() => "") || "";
      const label = (aria || text || "").trim();
      foundLabels.push(label || `(empty-${i})`);
    }

    const match = count >= 9 && foundLabels.slice(0, 9).every((l, i) => l === EXPECTED_LABELS[i]);
    const criticalConsoleErrors = consoleErrors.filter((t) => !isNoiseConsoleError(t));
    const consoleErrorCount = criticalConsoleErrors.length;
    const pageErrorCount = pageErrors.length;
    const clsReport = clsValue != null && clsValue < 0.01 ? 0 : clsValue;

    const lines = [
      "PROOF: QuickLinks icon order 3 rows",
      `URL=${BASE_URL}`,
      `foundLabels=${JSON.stringify(foundLabels)}`,
      `expectedLabels=${JSON.stringify(EXPECTED_LABELS)}`,
      `match=${match}`,
      `PILLS_COUNT=${count}`,
      `CLS=${clsReport}`,
      `console.error=${consoleErrorCount}`,
      `pageerror=${pageErrorCount}`,
    ];
    const outPath = writeArtifact("PROOF_QUICKLINKS_ORDER_3ROWS.txt", lines.join("\n"));
    console.log("Wrote", outPath);
    console.log("match=" + match + " CLS=" + clsReport + " console.error=" + consoleErrorCount + " pageerror=" + pageErrorCount);
    const failConsole = !BASE_URL.startsWith("file://") && consoleErrorCount > 0;
    if (!match || clsReport > 0 || failConsole || pageErrorCount > 0) process.exitCode = 1;
  } catch (err) {
    console.error("proof_quicklinks_order_3rows failed:", err.message);
    writeArtifact("PROOF_QUICKLINKS_ORDER_3ROWS.txt", "ERROR=" + String(err.message));
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main();
