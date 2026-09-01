#!/usr/bin/env node
"use strict";

/* silver_copy_guard
   Ověřuje: Silver okno zobrazuje Phase 8A privacy text (qualified local-first + network note).
   Statická kontrola zdroje (projects/index.html) + DOM kontrola na mobilu/tabletu. */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const shared = require("./mobile-stability-guards-v1-shared.cjs");

const GUARD_NAME = "SILVER_COPY_GUARD_V1";
const REPORT = "scripts/silver-copy-guard-v1-report.json";

const LINE1 = "🔒 Co napíšeš nebo si uložíš, zůstává jen u tebe.";
const LINE2 = "Síť jen pro provoz webu — viz iCentrum.";
const FORBIDDEN = [
  "Osobní záznamy ukládáme primárně",
  "Část webu může používat externí služby",
  "Nic neopouští tvoje zařízení",
];

function staticCheck() {
  const html = fs.readFileSync(path.join(shared.ROOT, "projects", "index.html"), "utf8");
  return {
    check: "static_source",
    line1_present: html.indexOf("data-iu-silver-privacy-line>" + LINE1 + "<") >= 0,
    line2_present: html.indexOf("data-iu-silver-privacy-line-2>" + LINE2 + "<") >= 0,
    forbidden_absent: FORBIDDEN.every((f) => html.indexOf(f) < 0),
  };
}

async function domCheck(browser, baseUrl, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  try {
    await shared.preparePage(page);
    await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2600);
    const m = await page.evaluate(({ line1, line2 }) => {
      const el1 = document.querySelector("[data-iu-silver-privacy-line]");
      const el2 = document.querySelector("[data-iu-silver-privacy-line-2]");
      return {
        line1_text: el1 ? String(el1.textContent || "").trim() : null,
        line2_text: el2 ? String(el2.textContent || "").trim() : null,
        line1_ok: el1 ? String(el1.textContent || "").trim() === line1 : false,
        line2_ok: el2 ? String(el2.textContent || "").trim() === line2 : false,
      };
    }, { line1: LINE1, line2: LINE2 });
    m.check = "dom";
    m.viewport = vp.w + "x" + vp.h;
    m.mode = vp.mode;
    return m;
  } finally {
    await page.close();
    await ctx.close();
  }
}

async function runGuard(baseUrl) {
  const results = [];
  const st = staticCheck();
  st._pass = st.line1_present && st.line2_present && st.forbidden_absent;
  results.push(st);

  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of shared.VIEWPORTS) {
      const m = await domCheck(browser, baseUrl, vp);
      m._pass = m.line1_ok && m.line2_ok;
      results.push(m);
    }
  } finally {
    await browser.close();
  }
  return { pass: results.every((r) => r._pass), results, url: baseUrl };
}

module.exports = { runGuard, GUARD_NAME, REPORT };

if (require.main === module) {
  shared.runStandalone(runGuard, GUARD_NAME, REPORT).catch((e) => {
    process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
    process.exit(1);
  });
}
