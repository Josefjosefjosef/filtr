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

const BUBBLE_TEXT = "Jsem Silver, tvůj soukromý asistent.";
const PRIVACY_LINE1 = "🔒 Co napíšeš nebo si uložíš, zůstává jen u tebe.";
const PRIVACY_LINE2 = "Nic neopouští tvoje zařízení.";
const OLD_PRIVACY_SNIPPET = "🔒 Co napíšeš, zůstává jen u tebe";
const FIGURE_HEIGHT_PX = 140;
const TAIL_TOP_MIN_PCT = 48;
const TICKER_INTRO = "Zeptej se Silvera:";

function envUrl() {
  return uxBase.envUrl();
}

async function collectCardChecks(page) {
  return page.evaluate(
    ({ bubbleText, privacy1, privacy2, oldPrivacy, figureH, tailMin }) => {
      function isVisible(el) {
        if (!el) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }
      const hero = document.getElementById("iuSilverHeroPremium");
      if (!hero) return { hero_found: false };
      const bubble = hero.querySelector("[data-iu-silver-speech-bubble]");
      const speech = hero.querySelector("[data-iu-silver-speech-text]");
      const tail = hero.querySelector(".silver-speech-tail");
      const privacyLines = hero.querySelectorAll(".silver-privacy-line");
      const legacyTrust = hero.querySelectorAll(".iu-silver-trust__line--legacy");
      const staticTitle = hero.querySelector(".iu-hero-silverTitle--static");
      const staticSub = hero.querySelector(".iu-hero-silverSub--static");
      const img = hero.querySelector(".iu-hero-figureImg");
      const inp = hero.querySelector("#iuSilverHomeInput");
      const ticker = document.getElementById("iuSilverHomeQueryTicker");
      const tickerText = ticker ? ticker.querySelector(".iuSilverHomeQueryTickerText") : null;
      const allHeroText = hero.innerText || "";
      const lockCount = (allHeroText.match(/🔒/g) || []).length;
      const bubbleSt = bubble ? getComputedStyle(bubble) : null;
      const tailSt = tail ? getComputedStyle(tail) : null;
      const tailTopPct = tailSt ? parseFloat(tailSt.top) / (bubble ? bubble.getBoundingClientRect().height || 1 : 1) * 100 : 0;
      const tailTopRaw = tailSt ? tailSt.top : "";
      let tailTopNum = 0;
      if (tailSt && tailSt.top && String(tailSt.top).indexOf("%") >= 0) {
        tailTopNum = parseFloat(tailSt.top);
      } else if (bubble && tail) {
        const br = bubble.getBoundingClientRect();
        const tr = tail.getBoundingClientRect();
        tailTopNum = br.height > 0 ? ((tr.top + tr.height / 2 - br.top) / br.height) * 100 : 0;
      }
      const bf = bubbleSt ? bubbleSt.backdropFilter || bubbleSt.webkitBackdropFilter || "" : "";
      const boxShadow = bubbleSt ? bubbleSt.boxShadow || "" : "";
      const bg = bubbleSt ? bubbleSt.background || bubbleSt.backgroundColor || "" : "";
      const borderW = bubbleSt ? parseFloat(bubbleSt.borderTopWidth || "0") : 0;
      const speechSt = speech ? getComputedStyle(speech) : null;
      const speechColor = speechSt ? speechSt.color || "" : "";
      let speechLum = 0;
      const lumM = String(speechColor).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (lumM) {
        speechLum = (0.299 * Number(lumM[1]) + 0.587 * Number(lumM[2]) + 0.114 * Number(lumM[3])) / 255;
      }
      const bubble_neon_ok =
        borderW >= 1.5 &&
        boxShadow.indexOf("139") >= 0 &&
        bg.indexOf("255,255,255,.94") < 0 &&
        speechLum >= 0.82;
      const speechText = speech ? String(speech.textContent || "").trim() : "";
      const p1 = hero.querySelector("[data-iu-silver-privacy-line]");
      const p2 = hero.querySelector("[data-iu-silver-privacy-line-2]");
      const docEl = document.documentElement;
      const body = document.body;
      const overflowX =
        (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
        (body && body.scrollWidth > body.clientWidth + 1);
      return {
        hero_found: true,
        bubble_visible: isVisible(bubble),
        bubble_text_ok: speechText === bubbleText,
        bubble_glass_ok: bf.indexOf("blur") >= 0 || boxShadow.split(",").length >= 2,
        bubble_neon_ok: bubble_neon_ok,
        tail_lower_ok: tailTopNum >= tailMin || (String(tailTopRaw).indexOf("%") >= 0 && parseFloat(tailTopRaw) >= tailMin),
        privacy_line1_ok: !!(p1 && String(p1.textContent || "").trim() === privacy1),
        privacy_line2_ok: !!(p2 && String(p2.textContent || "").trim() === privacy2),
        privacy_visible_ok: isVisible(p1) && isVisible(p2),
        privacy_line_count: privacyLines.length,
        lock_count: lockCount,
        old_privacy_absent: allHeroText.indexOf(oldPrivacy) < 0,
        legacy_trust_absent: legacyTrust.length === 0,
        static_title_hidden: !isVisible(staticTitle),
        static_sub_hidden: !isVisible(staticSub),
        figure_height_ok: img ? Math.round(img.getBoundingClientRect().height) === figureH : false,
        inp_in_hero_ok: !!inp,
        ticker_intro_ok: !!(tickerText && String(tickerText.textContent || "").indexOf("Zeptej se Silvera:") >= 0),
        overflow_x: overflowX,
      };
    },
    {
      bubbleText: BUBBLE_TEXT,
      privacy1: PRIVACY_LINE1,
      privacy2: PRIVACY_LINE2,
      oldPrivacy: OLD_PRIVACY_SNIPPET,
      figureH: FIGURE_HEIGHT_PX,
      tailMin: TAIL_TOP_MIN_PCT,
    }
  );
}

async function collectDesktopCardChecks(page) {
  return page.evaluate(({ bubbleText }) => {
    const hero = document.getElementById("iuSilverHeroPremium");
    if (!hero) return { desktop_hero_ok: false };
    const speechRow = hero.querySelector(".silver-speech-row");
    const privacy = hero.querySelector(".silver-privacy-line");
    const speechSt = speechRow ? getComputedStyle(speechRow) : null;
    const privacySt = privacy ? getComputedStyle(privacy) : null;
    const staticTitle = hero.querySelector(".iu-hero-silverTitle--static");
    const stTitle = staticTitle ? getComputedStyle(staticTitle) : null;
    return {
      desktop_hero_ok: true,
      desktop_speech_hidden: speechSt ? speechSt.display === "none" : true,
      desktop_privacy_hidden: privacySt ? privacySt.display === "none" : true,
      desktop_static_title_unchanged: !!(staticTitle && String(staticTitle.textContent || "").indexOf("Jsem Silver") >= 0),
      desktop_bubble_text_in_dom: String(hero.querySelector("[data-iu-silver-speech-text]")?.textContent || "").trim() === bubbleText,
    };
  }, { bubbleText: BUBBLE_TEXT });
}

function applyReplayMode(card, ux, replayMode) {
  const checks = Object.assign({}, card, ux);
  delete checks._pass;
  let pass = !!ux._pass;
  if (replayMode === "privacy-cleanup") {
    pass =
      card.hero_found &&
      card.bubble_visible &&
      card.bubble_text_ok &&
      card.privacy_line1_ok &&
      card.privacy_line2_ok &&
      card.privacy_visible_ok &&
      card.privacy_line_count === 2 &&
      card.lock_count === 1 &&
      card.old_privacy_absent &&
      card.legacy_trust_absent &&
      card.static_title_hidden &&
      card.static_sub_hidden &&
      !card.overflow_x;
  } else if (replayMode === "bubble-style") {
    pass = card.bubble_visible && card.bubble_text_ok && card.bubble_neon_ok && !card.overflow_x;
  } else if (replayMode === "bubble-tail") {
    pass = card.bubble_visible && card.tail_lower_ok && card.bubble_text_ok && !card.overflow_x;
  } else if (replayMode === "no-duplicate-privacy") {
    pass =
      card.privacy_line_count === 2 &&
      card.lock_count === 1 &&
      card.old_privacy_absent &&
      card.legacy_trust_absent &&
      card.privacy_line1_ok &&
      card.privacy_line2_ok &&
      !card.overflow_x;
  } else if (replayMode === "no-input-ticker-regression") {
    pass =
      !!ux._pass &&
      card.figure_height_ok &&
      card.inp_in_hero_ok &&
      card.ticker_intro_ok &&
      card.bubble_text_ok &&
      !card.overflow_x;
  } else if (replayMode === "desktop-sanity") {
    pass = card.desktop_hero_ok && card.desktop_speech_hidden && card.desktop_privacy_hidden;
  } else {
    pass =
      card.hero_found &&
      card.bubble_visible &&
      card.bubble_text_ok &&
      card.bubble_glass_ok &&
      card.tail_lower_ok &&
      card.privacy_line1_ok &&
      card.privacy_line2_ok &&
      card.lock_count === 1 &&
      card.old_privacy_absent &&
      card.legacy_trust_absent &&
      card.figure_height_ok &&
      !!ux._pass &&
      !card.overflow_x;
  }
  checks._pass = pass;
  return checks;
}

async function runCardGuard(opts) {
  const replayMode = (opts && opts.replayMode) || "full";
  const viewports = (opts && opts.viewports) || [
    { w: 390, h: 844, mode: "mobile" },
    { w: 430, h: 932, mode: "mobile" },
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
        const coreMode = vp.mode === "tablet" ? "tablet" : "mobile";
        const ux = await uxBase.runViewport(p, vp.w, vp.h, { mode: coreMode });
        const card = await collectCardChecks(p);
        const merged = applyReplayMode(card, ux, replayMode);
        merged.viewport = vp.w + "x" + vp.h;
        merged.mode = vp.mode || coreMode;
        results.push(merged);
      } finally {
        await p.close();
      }
    }
    if (replayMode === "desktop-sanity" || replayMode === "full") {
      const p = await ctx.newPage();
      try {
        await installProofGuardNetworkStubs(p);
        await p.setViewportSize({ width: 1280, height: 900 });
        await p.goto(envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
        await p.waitForTimeout(2600);
        const desk = await collectDesktopCardChecks(p);
        desk.viewport = "1280x900";
        desk.mode = "desktop";
        desk._pass = applyReplayMode(desk, { _pass: true }, "desktop-sanity")._pass;
        results.push(desk);
      } finally {
        await p.close();
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  const pass = results.every((r) => r._pass);
  return { pass, results, url: envUrl(), ticker_intro: TICKER_INTRO };
}

function writeReport(reportPath, payload) {
  try {
    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch (_) {}
}

function emitGuardBanner(title, reportPath, out) {
  const pass = out.pass;
  process.stdout.write("=== " + title + " ===\n\n");
  for (let i = 0; i < out.results.length; i++) {
    const copy = Object.assign({}, out.results[i]);
    delete copy._pass;
    process.stdout.write(JSON.stringify(copy, null, 2) + "\n\n");
  }
  process.stdout.write("PASS_FAIL=" + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("report=" + reportPath + "\n");
  process.stdout.write("=== END_" + title + " ===\n");
  writeReport(reportPath, {
    pass,
    url: out.url,
    results: out.results.map((r) => {
      const c = Object.assign({}, r);
      delete c._pass;
      return c;
    }),
  });
  if (!pass) process.exitCode = 1;
}

module.exports = {
  runCardGuard,
  emitGuardBanner,
  BUBBLE_TEXT,
  PRIVACY_LINE1,
  PRIVACY_LINE2,
};
