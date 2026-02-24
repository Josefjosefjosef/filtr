#!/usr/bin/env node
/**
 * Proof: AI panel close (×) works when click target is text node.
 * Opens AI panel, clicks on the × character inside close button, asserts panel closes.
 * Screenshots: artifacts/proof_ai_close_clicked_x.png (before), artifacts/proof_ai_close_closed.png (after).
 * Run from repo root (playwright installed). Uses production URL by default.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");

const BASE_URL = process.env.PROOF_BASE_URL || "https://infouzel.cz/projects/";

async function main() {
  let browser = null;
  let page = null;
  const pageErrors = [];

  try {
    fs.mkdirSync(ARTIFACTS, { recursive: true });

    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.goto(BASE_URL + (BASE_URL.includes("?") ? "&" : "?") + "panel=ai", {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    await page.waitForTimeout(1500);

    const panel = page.locator("#iu-aiPanel");
    await panel.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});

    const panelHiddenBefore = await panel.getAttribute("hidden");
    if (panelHiddenBefore !== null) {
      const trigger = page.locator('[data-iuq="ai"], [data-action="ai-panel"]').first();
      if ((await trigger.count()) > 0) {
        await trigger.click();
        await page.waitForTimeout(800);
      }
    }

    const closeBtn = page.locator("#iu-aiPanel button[data-iu-close]");
    if ((await closeBtn.count()) === 0) {
      throw new Error("Close button #iu-aiPanel button[data-iu-close] not found");
    }

    await page.screenshot({ path: path.join(ARTIFACTS, "proof_ai_close_clicked_x.png"), fullPage: false });

    const closeBtnText = closeBtn.getByText("×", { exact: true });
    if ((await closeBtnText.count()) > 0) {
      await closeBtnText.click();
    } else {
      await closeBtn.click();
    }

    await page.waitForTimeout(600);

    const panelHiddenAfter = await panel.getAttribute("hidden");
    if (panelHiddenAfter === null) {
      throw new Error("Panel should have hidden after close click (proof failed)");
    }

    await page.screenshot({ path: path.join(ARTIFACTS, "proof_ai_close_closed.png"), fullPage: false });

    if (pageErrors.length > 0) {
      const noise = [/videos\.json/i, /loadAiAssistants/i];
      const critical = pageErrors.filter((m) => !noise.some((r) => r.test(m)));
      if (critical.length > 0) {
        console.error("Page errors:", critical);
        process.exitCode = 1;
      }
    }
  } catch (err) {
    console.error("proof_ai_close_textnode failed:", err.message);
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main();
