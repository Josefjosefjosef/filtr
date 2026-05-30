#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const uxBase = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const SPEECH_VARIANTS = [
  { id: "one_line", text: "Jsem tady pro tebe 24 hodin denně." },
  { id: "medium", text: "Jak ti mám říkat?" },
  { id: "two_line", text: "Máš uloženou informaci, kterou nemůžeš najít?" },
];

const PRIVACY_LINE1 = "🔒 Co napíšeš nebo si uložíš, zůstává jen u tebe.";
const PRIVACY_LINE2 = "Nic neopouští tvoje zařízení.";
const POSITION_TOLERANCE_PX = 1;

function envUrl() {
  return uxBase.envUrl();
}

function parseRgbLuminance(color) {
  const m = String(color || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return 0;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

async function measureSpeechLayout(page, text) {
  await page.evaluate((txt) => {
    const el = document.querySelector("[data-iu-silver-speech-text]");
    if (el) el.textContent = txt;
  }, text);
  await page.waitForTimeout(120);
  return page.evaluate(({ privacy1, privacy2 }) => {
    function rect(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, width: r.width };
    }
    const hero = document.getElementById("iuSilverHeroPremium");
    if (!hero) return { hero_found: false };
    const bubble = hero.querySelector("[data-iu-silver-speech-bubble]");
    const speech = hero.querySelector("[data-iu-silver-speech-text]");
    const privacy1El = hero.querySelector("[data-iu-silver-privacy-line]");
    const privacy2El = hero.querySelector("[data-iu-silver-privacy-line-2]");
    const figure = hero.querySelector(".iu-hero-figureImg");
    const bubbleSt = bubble ? getComputedStyle(bubble) : null;
    const speechSt = speech ? getComputedStyle(speech) : null;
    const br = rect(bubble);
    const p1 = rect(privacy1El);
    const p2 = rect(privacy2El);
    const fr = rect(figure);
    const docEl = document.documentElement;
    const body = document.body;
    const overflowX =
      (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
      (body && body.scrollWidth > body.clientWidth + 1);
    let overlapFigure = false;
    if (br && fr) {
      overlapFigure = br.bottom > fr.top + 2 && br.left < fr.right && br.right > fr.left && br.top < fr.bottom;
    }
    return {
      hero_found: true,
      bubble_rect: br,
      privacy1_rect: p1,
      privacy2_rect: p2,
      privacy1_text_ok: privacy1El ? String(privacy1El.textContent || "").trim() === privacy1 : false,
      privacy2_text_ok: privacy2El ? String(privacy2El.textContent || "").trim() === privacy2 : false,
      bubble_bg: bubbleSt ? bubbleSt.background || bubbleSt.backgroundColor || "" : "",
      bubble_border_width: bubbleSt ? parseFloat(bubbleSt.borderTopWidth || "0") : 0,
      bubble_box_shadow: bubbleSt ? bubbleSt.boxShadow || "" : "",
      speech_color: speechSt ? speechSt.color || "" : "",
      overflow_x: overflowX,
      overlap_figure: overlapFigure,
    };
  }, { privacy1: PRIVACY_LINE1, privacy2: PRIVACY_LINE2 });
}

async function collectDesktopChecks(page) {
  return page.evaluate(() => {
    const hero = document.getElementById("iuSilverHeroPremium");
    if (!hero) return { desktop_hero_ok: false };
    const speechRow = hero.querySelector(".silver-speech-row");
    const privacy = hero.querySelector(".silver-privacy-line");
    const speechSt = speechRow ? getComputedStyle(speechRow) : null;
    const privacySt = privacy ? getComputedStyle(privacy) : null;
    return {
      desktop_hero_ok: true,
      desktop_speech_hidden: speechSt ? speechSt.display === "none" : true,
      desktop_privacy_hidden: privacySt ? privacySt.display === "none" : true,
    };
  });
}

function evaluateVariantPass(measurements, bubbleStyle) {
  if (!measurements.length) return { pass: false, checks: {} };
  const privacyTops = measurements.map((m) => m.privacy1_rect && m.privacy1_rect.top).filter((v) => typeof v === "number");
  const privacyBottoms = measurements.map((m) => m.privacy2_rect && m.privacy2_rect.bottom).filter((v) => typeof v === "number");
  const bubbleBottoms = measurements.map((m) => m.bubble_rect && m.bubble_rect.bottom).filter((v) => typeof v === "number");
  const bubbleTops = measurements.map((m) => m.bubble_rect && m.bubble_rect.top).filter((v) => typeof v === "number");
  const bubbleHeights = measurements.map((m) => m.bubble_rect && m.bubble_rect.height).filter((v) => typeof v === "number");

  const privacyTopDelta =
    privacyTops.length >= 2 ? Math.max(...privacyTops) - Math.min(...privacyTops) : 999;
  const privacyBottomDelta =
    privacyBottoms.length >= 2 ? Math.max(...privacyBottoms) - Math.min(...privacyBottoms) : 999;
  const bubbleBottomDelta =
    bubbleBottoms.length >= 2 ? Math.max(...bubbleBottoms) - Math.min(...bubbleBottoms) : 999;

  const privacyFixed =
    privacyTopDelta <= POSITION_TOLERANCE_PX && privacyBottomDelta <= POSITION_TOLERANCE_PX;
  const bubbleBottomFixed = bubbleBottomDelta <= POSITION_TOLERANCE_PX;
  const bubbleGrowsUpward =
    bubbleHeights.length >= 2 &&
    bubbleTops.length >= 2 &&
    bubbleHeights[bubbleHeights.length - 1] >= bubbleHeights[0] - 0.5 &&
    bubbleTops[bubbleTops.length - 1] <= bubbleTops[0] + POSITION_TOLERANCE_PX;

  const checks = {
    privacy_text_position_fixed: privacyFixed,
    bubble_grows_upward_only: bubbleBottomFixed && bubbleGrowsUpward,
    bubble_neon_ok: bubbleStyle.bubble_neon_ok,
    bubble_white_text_ok: bubbleStyle.bubble_white_text_ok,
    privacy_line1_ok: measurements.every((m) => m.privacy1_text_ok),
    privacy_line2_ok: measurements.every((m) => m.privacy2_text_ok),
    overflow_x: measurements.some((m) => m.overflow_x),
    overlap_figure: measurements.some((m) => m.overlap_figure),
    privacy_top_delta_px: Number(privacyTopDelta.toFixed(2)),
    bubble_bottom_delta_px: Number(bubbleBottomDelta.toFixed(2)),
    variant_measurements: measurements.map((m) => ({
      id: m.id,
      privacy_top: m.privacy1_rect ? Number(m.privacy1_rect.top.toFixed(2)) : null,
      privacy_bottom: m.privacy2_rect ? Number(m.privacy2_rect.bottom.toFixed(2)) : null,
      bubble_top: m.bubble_rect ? Number(m.bubble_rect.top.toFixed(2)) : null,
      bubble_bottom: m.bubble_rect ? Number(m.bubble_rect.bottom.toFixed(2)) : null,
      bubble_height: m.bubble_rect ? Number(m.bubble_rect.height.toFixed(2)) : null,
    })),
  };
  checks._pass =
    checks.privacy_text_position_fixed &&
    checks.bubble_grows_upward_only &&
    checks.bubble_neon_ok &&
    checks.bubble_white_text_ok &&
    checks.privacy_line1_ok &&
    checks.privacy_line2_ok &&
    !checks.overflow_x &&
    !checks.overlap_figure;
  return checks;
}

async function runGuard() {
  const viewports = [
    { w: 390, h: 844, mode: "mobile" },
    { w: 768, h: 1024, mode: "tablet" },
  ];
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await uxBase.installClsObserver(ctx);
  const results = [];
  try {
    for (let i = 0; i < viewports.length; i++) {
      const vp = viewports[i];
      const p = await ctx.newPage();
      try {
        await installProofGuardNetworkStubs(p);
        const ignorableTracker = createIgnorableResourceTracker();
        ignorableTracker.attachToPage(p);
        p.on("pageerror", (err) => {
          const t = String(err && err.message ? err.message : err);
          if (isIgnorableGuardConsoleError(t)) return;
        });
        await p.setViewportSize({ width: vp.w, height: vp.h });
        await p.goto(envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
        await p.waitForTimeout(2600);
        const measurements = [];
        for (let j = 0; j < SPEECH_VARIANTS.length; j++) {
          const variant = SPEECH_VARIANTS[j];
          const m = await measureSpeechLayout(p, variant.text);
          measurements.push(Object.assign({ id: variant.id }, m));
        }
        const styleSample = measurements[measurements.length - 1] || {};
        const bubbleStyle = {
          bubble_neon_ok:
            styleSample.bubble_border_width >= 1.5 &&
            String(styleSample.bubble_box_shadow || "").indexOf("139") >= 0 &&
            String(styleSample.bubble_bg || "").indexOf("255,255,255,.94") < 0,
          bubble_white_text_ok: parseRgbLuminance(styleSample.speech_color) >= 0.82,
        };
        const merged = evaluateVariantPass(measurements, bubbleStyle);
        merged.viewport = vp.w + "x" + vp.h;
        merged.mode = vp.mode;
        results.push(merged);
      } finally {
        await p.close();
      }
    }
    const p = await ctx.newPage();
    try {
      await installProofGuardNetworkStubs(p);
      await p.setViewportSize({ width: 1280, height: 900 });
      await p.goto(envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
      await p.waitForTimeout(2600);
      const desk = await collectDesktopChecks(p);
      desk.viewport = "1280x900";
      desk.mode = "desktop";
      desk.desktop_unchanged = desk.desktop_hero_ok && desk.desktop_speech_hidden && desk.desktop_privacy_hidden;
      desk._pass = desk.desktop_unchanged;
      results.push(desk);
    } finally {
      await p.close();
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  const pass = results.every((r) => r._pass);
  return { pass, results, url: envUrl() };
}

function emitBanner(out) {
  const reportPath = path.join("scripts", "silver-mobile-tablet-bubble-stable-privacy-guard-v1-report.json");
  process.stdout.write("=== SILVER_MOBILE_TABLET_BUBBLE_STABLE_PRIVACY_GUARD_V1 ===\n\n");
  for (let i = 0; i < out.results.length; i++) {
    const copy = Object.assign({}, out.results[i]);
    delete copy._pass;
    process.stdout.write(JSON.stringify(copy, null, 2) + "\n\n");
  }
  const mobilePass = out.results.filter((r) => r.mode === "mobile").every((r) => r._pass);
  const tabletPass = out.results.filter((r) => r.mode === "tablet").every((r) => r._pass);
  const desktopPass = out.results.filter((r) => r.mode === "desktop").every((r) => r._pass);
  process.stdout.write("PRIVACY_TEXT_POSITION_FIXED=" + (out.results.some((r) => r.privacy_text_position_fixed) ? "YES" : "NO") + "\n");
  process.stdout.write("BUBBLE_GROWS_UPWARD_ONLY=" + (out.results.some((r) => r.bubble_grows_upward_only) ? "YES" : "NO") + "\n");
  process.stdout.write("MOBILE_PASS=" + (mobilePass ? "YES" : "NO") + "\n");
  process.stdout.write("TABLET_PASS=" + (tabletPass ? "YES" : "NO") + "\n");
  process.stdout.write("DESKTOP_UNCHANGED=" + (desktopPass ? "YES" : "NO") + "\n");
  process.stdout.write("PASS_FAIL=" + (out.pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("report=" + reportPath + "\n");
  process.stdout.write("=== END_SILVER_MOBILE_TABLET_BUBBLE_STABLE_PRIVACY_GUARD_V1 ===\n");
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        pass: out.pass,
        url: out.url,
        results: out.results.map((r) => {
          const c = Object.assign({}, r);
          delete c._pass;
          return c;
        }),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  if (!out.pass) process.exitCode = 1;
}

async function main() {
  const out = await runGuard();
  emitBanner(out);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
