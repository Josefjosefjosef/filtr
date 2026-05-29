#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { installProofGuardNetworkStubs } = require("./proofs/open_meteo_guard_stub.cjs");

const url = String(process.env.SILVER_HOME_UX_GUARD_URL || "http://127.0.0.1:8890/projects/").trim();
const outDir = String(process.env.SILVER_HOME_UX_SCREENSHOT_DIR || path.join(process.env.TEMP || ".", "iu-silver-home-ux-v1"));

async function shot(page, w, h, name) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2800);
  const hero = page.locator("#iuSilverHeroPremium");
  await hero.screenshot({ path: path.join(outDir, name) });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await installProofGuardNetworkStubs(page);
  try {
    await shot(page, 390, 844, "silver-home-ux-mobile-390.png");
    await shot(page, 768, 1024, "silver-home-ux-tablet-768.png");
    process.stdout.write("SCREENSHOT_DIR=" + outDir + "\n");
    process.stdout.write("PASS=true\n");
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
