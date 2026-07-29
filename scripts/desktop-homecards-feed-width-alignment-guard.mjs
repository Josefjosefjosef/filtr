#!/usr/bin/env node
/**
 * Desktop HomeCards vs open section width alignment (â‰Ą1025px, body.iu-desktop-home-grid).
 * Run: npm run desktop-homecards-feed-width-alignment-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import { exitIfMediaArticlesGuardsSkipped } from "./media-articles-cutover-skip.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8896", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const TOLERANCE_PX = 1;

const SECTIONS = [
  { accent: "pocasi", selector: "#iuWeatherView", key: "WEATHER" },
  { accent: "mapy", selector: "#iuMapyView", key: "MAPS" },
  { accent: "jr", selector: "#iuJrEmptyView", key: "TIMETABLE" },
  { accent: "tvprogram", selector: "#iuTvProgramView", key: "TV_PROGRAM" },
  { accent: "tvonline", selector: "#iuTvOnlineView", key: "TV_ONLINE" },
  { accent: "radio", selector: "#iuRadioView", key: "RADIO" },
];

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function main() {
  exitIfMediaArticlesGuardsSkipped("desktop-homecards-feed-width-alignment-guard");
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });

  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    const context = await bootstrapGuardContext(browser, {
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(BASE + "?section=media&iuRobust=1&iuInfoSystem=off", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForFunction(
      () =>
        document.body.classList.contains("iu-desktop-home-grid") &&
        !!document.getElementById("iuSilverTopCardsStack"),
      null,
      { timeout: 30000 }
    );
    await page.waitForTimeout(400);

    const regression = await page.evaluate(() => {
      const stack = document.getElementById("iuSilverTopCardsStack");
      const cards = stack ? stack.querySelectorAll('[class$="PreviewCardMount"] button').length : 0;
      const doc = document.documentElement;
      const body = document.body;
      const overflowX =
        (doc && doc.scrollWidth > doc.clientWidth + 1) || (body && body.scrollWidth > body.clientWidth + 1);
      return {
        homecardsVisible: !!(stack && stack.offsetParent !== null && cards > 0),
        homecardsClickable: cards > 0,
        noHorizontalScroll: !overflowX,
      };
    });

    const sectionResults = [];
    for (const sec of SECTIONS) {
      await page.goto(`${BASE}?section=${encodeURIComponent(sec.accent)}&iuRobust=1&iuInfoSystem=off`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForFunction(
        (ac) => String(document.body?.dataset?.section || "").toLowerCase() === String(ac || "").toLowerCase(),
        sec.accent,
        { timeout: 30000 }
      );
      await page.waitForTimeout(500);
      const row = await page.evaluate(
        ({ selector, tolerancePx }) => {
          const stack = document.getElementById("iuSilverTopCardsStack");
          const host = document.querySelector(selector);
          if (!stack || !host) return { ok: false, reason: "missing_elements" };
          const stackRect = stack.getBoundingClientRect();
          const hostRect = host.getBoundingClientRect();
          const tol = tolerancePx;
          const leftMatch = Math.abs(stackRect.left - hostRect.left) <= tol;
          const rightMatch = Math.abs(stackRect.right - hostRect.right) <= tol;
          const widthMatch = Math.abs(stackRect.width - hostRect.width) <= tol;
          return {
            ok: leftMatch && rightMatch && widthMatch,
            stackWidth: Math.round(stackRect.width * 10) / 10,
            hostWidth: Math.round(hostRect.width * 10) / 10,
            leftMatch,
            rightMatch,
            widthMatch,
          };
        },
        { selector: sec.selector, tolerancePx: TOLERANCE_PX }
      );
      sectionResults.push({ ...sec, ...row });
    }

    await browser.close();

    const lines = [];
    let allPass = true;

    lines.push("=== DESKTOP_HOMECARDS_FEED_WIDTH_ALIGNMENT ===");
    lines.push("DESKTOP_HOMECARDS_VISIBLE=" + (regression.homecardsVisible ? "YES" : "NO"));
    lines.push("DESKTOP_HOMECARDS_CLICKABLE=" + (regression.homecardsClickable ? "YES" : "NO"));
    lines.push("NO_HORIZONTAL_SCROLL=" + (regression.noHorizontalScroll ? "YES" : "NO"));
    lines.push("SECTION_SWITCHING_WORKS=YES");

    for (const row of sectionResults) {
      const pass = !!row.ok;
      if (!pass) allPass = false;
      lines.push(row.key + "_WIDTH_MATCH=" + (pass ? "YES" : "NO"));
      if (!pass) {
        lines.push(
          `  ${row.key}: stack=${row.stackWidth}px host=${row.hostWidth}px left=${row.leftMatch} right=${row.rightMatch} width=${row.widthMatch}`
        );
      }
    }

    const anySection = sectionResults.some((r) => r.ok);
    lines.push("LEFT_EDGE_MATCH=" + (anySection && sectionResults.every((r) => r.leftMatch) ? "YES" : "NO"));
    lines.push("RIGHT_EDGE_MATCH=" + (anySection && sectionResults.every((r) => r.rightMatch) ? "YES" : "NO"));
    lines.push("WIDTH_MATCH=" + (anySection && sectionResults.every((r) => r.widthMatch) ? "YES" : "NO"));
    lines.push("DESKTOP_ALIGNMENT_FIXED=" + (allPass ? "YES" : "NO"));
    lines.push("PASS=" + (allPass && regression.homecardsVisible && regression.noHorizontalScroll ? "YES" : "NO"));
    lines.push("=== END_DESKTOP_HOMECARDS_FEED_WIDTH_ALIGNMENT ===");

    console.log(lines.join("\n"));
    if (!allPass || !regression.homecardsVisible || !regression.noHorizontalScroll) {
      process.exitCode = 1;
    }
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
