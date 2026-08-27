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

async function measureSpeechLayoutVariants(page, variants) {
  // Atomic multi-variant measure: avoids CI flakes where unrelated async layout
  // (fonts/images/feed) shifts the whole hero between separate Playwright turns.
  // Contract still checked: privacy must stay fixed across speech text variants.
  return page.evaluate(
    async ({ variantsIn, privacy1, privacy2 }) => {
      function rect(el) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          height: r.height,
          width: r.width,
        };
      }

      function forceReflow(el) {
        try {
          void el.offsetHeight;
        } catch (_) {}
      }

      async function waitStablePrivacyTop(privacyEl, samples) {
        let last = null;
        let stable = 0;
        for (let i = 0; i < 45; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          const t = privacyEl.getBoundingClientRect().top;
          if (last != null && Math.abs(t - last) <= 0.75) {
            stable += 1;
            if (stable >= samples) return t;
          } else {
            stable = 0;
          }
          last = t;
        }
        return last;
      }

      async function waitStableSpeechBubble(speechEl, bubbleEl, expectedText, minBubbleHeight) {
        let lastH = null;
        let lastT = null;
        let stable = 0;
        for (let frame = 0; frame < 60; frame++) {
          await new Promise((r) => requestAnimationFrame(r));
          if (String(speechEl.textContent || "").trim() !== expectedText) {
            stable = 0;
            continue;
          }
          const br = bubbleEl.getBoundingClientRect();
          if (minBubbleHeight != null && br.height + 0.5 < minBubbleHeight) {
            stable = 0;
            lastH = br.height;
            lastT = br.top;
            continue;
          }
          if (
            lastH != null &&
            Math.abs(br.height - lastH) <= 0.75 &&
            Math.abs(br.top - lastT) <= 0.75
          ) {
            stable += 1;
            if (stable >= 3) return;
          } else {
            stable = 0;
          }
          lastH = br.height;
          lastT = br.top;
        }
      }

      function detachSilverSpeechRotator(heroEl) {
        const speechEl = heroEl.querySelector("[data-iu-silver-speech-text]");
        if (!speechEl || speechEl.dataset.iuGuardSpeechDetached === "1") return speechEl;
        const fresh = speechEl.cloneNode(true);
        fresh.dataset.iuGuardSpeechDetached = "1";
        speechEl.parentNode.replaceChild(fresh, speechEl);
        return fresh;
      }

      try {
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
      } catch (_) {}

      const hero = document.getElementById("iuSilverHeroPremium");
      if (!hero) return [{ hero_found: false }];

      const imgs = Array.from(hero.querySelectorAll("img"));
      await Promise.all(
        imgs.map((img) => {
          if (img.complete) return Promise.resolve();
          return new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
            setTimeout(done, 2500);
          });
        })
      );

      const privacy1El = hero.querySelector("[data-iu-silver-privacy-line]");
      if (privacy1El) await waitStablePrivacyTop(privacy1El, 3);

      detachSilverSpeechRotator(hero);

      const out = [];
      let oneLineBubbleHeight = null;
      for (let i = 0; i < variantsIn.length; i++) {
        const variant = variantsIn[i];
        const speech = hero.querySelector("[data-iu-silver-speech-text]");
        if (!speech) {
          out.push({ id: variant.id, hero_found: false });
          continue;
        }
        speech.textContent = variant.text;
        speech.style.display = "-webkit-box";
        speech.style.webkitLineClamp = "2";
        speech.style.webkitBoxOrient = "vertical";
        speech.style.overflow = "hidden";
        forceReflow(speech);
        const bubble = hero.querySelector("[data-iu-silver-speech-bubble]");
        if (!bubble) {
          out.push({ id: variant.id, hero_found: false });
          continue;
        }
        const minHeight =
          variant.id === "two_line" && oneLineBubbleHeight != null ? oneLineBubbleHeight : null;
        await waitStableSpeechBubble(speech, bubble, variant.text, minHeight);
        if (variant.id === "one_line") {
          oneLineBubbleHeight = bubble.getBoundingClientRect().height;
        }

        const badge = hero.querySelector("[data-iu-silver-ai-badge]");
        const p1El = hero.querySelector("[data-iu-silver-privacy-line]");
        const p2El = hero.querySelector("[data-iu-silver-privacy-line-2]");
        const figure = hero.querySelector(".iu-hero-figureImg");
        const speechRow = hero.querySelector(".silver-speech-row");
        const bubbleSt = bubble ? getComputedStyle(bubble) : null;
        const speechSt = speech ? getComputedStyle(speech) : null;
        const rowSt = speechRow ? getComputedStyle(speechRow) : null;
        const br = rect(bubble);
        const badgeR = rect(badge);
        const rowR = rect(speechRow);
        const p1 = rect(p1El);
        const p2 = rect(p2El);
        const fr = rect(figure);
        const docEl = document.documentElement;
        const body = document.body;
        const overflowX =
          (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
          (body && body.scrollWidth > body.clientWidth + 1);
        let overlapFigure = false;
        if (br && fr) {
          overlapFigure =
            br.bottom > fr.top + 2 && br.left < fr.right && br.right > fr.left && br.top < fr.bottom;
        }
        let translateY = 0;
        if (bubbleSt) {
          const t = String(bubbleSt.transform || "");
          if (t && t !== "none") {
            const m = t.match(/matrix\(([^)]+)\)/);
            if (m) {
              const parts = m[1].split(",").map((x) => parseFloat(String(x).trim()));
              if (Number.isFinite(parts[5])) translateY = parts[5];
            } else {
              const ty = t.match(/translateY\(([-\d.]+)px\)/);
              if (ty) translateY = parseFloat(ty[1]);
            }
          }
        }
        const badgeGap = badgeR && br ? Number((br.top - badgeR.bottom).toFixed(2)) : null;
        const designedBadgeGap =
          badgeR && rowR ? Number((rowR.top + translateY - badgeR.bottom).toFixed(2)) : null;
        out.push({
          id: variant.id,
          hero_found: true,
          bubble_rect: br,
          badge_rect: badgeR,
          speech_row_rect: rowR,
          badge_bubble_gap_px: badgeGap,
          designed_badge_gap_px: designedBadgeGap,
          privacy1_rect: p1,
          privacy2_rect: p2,
          privacy1_text_ok: p1El ? String(p1El.textContent || "").trim() === privacy1 : false,
          privacy2_text_ok: p2El ? String(p2El.textContent || "").trim() === privacy2 : false,
          bubble_bg: bubbleSt ? bubbleSt.background || bubbleSt.backgroundColor || "" : "",
          bubble_border_width: bubbleSt ? parseFloat(bubbleSt.borderTopWidth || "0") : 0,
          bubble_box_shadow: bubbleSt ? bubbleSt.boxShadow || "" : "",
          speech_color: speechSt ? speechSt.color || "" : "",
          speech_row_margin_top_px: rowSt ? parseFloat(rowSt.marginTop || "0") : null,
          bubble_translate_y_px: translateY,
          overflow_x: overflowX,
          overlap_figure: overlapFigure,
          overlap_ai_badge:
            badgeR && br
              ? br.top < badgeR.bottom - 0.5 && br.right > badgeR.left && br.left < badgeR.right
              : false,
        });
      }
      return out;
    },
    { variantsIn: variants, privacy1: PRIVACY_LINE1, privacy2: PRIVACY_LINE2 }
  );
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

  const twoLine = measurements.find((m) => m.id === "two_line") || measurements[measurements.length - 1];
  const designedGaps = measurements
    .map((m) => m.designed_badge_gap_px)
    .filter((v) => typeof v === "number");
  const badgeGapOk =
    designedGaps.length > 0 &&
    designedGaps.every((v) => v >= 0.5) &&
    measurements.every((m) => m.overlap_ai_badge !== true);
  const translateYs = measurements
    .map((m) => m.bubble_translate_y_px)
    .filter((v) => typeof v === "number");
  const translateYOk =
    translateYs.length > 0 && translateYs.every((v) => Math.abs(v - 4) <= 0.5);
  // Speech-row margins stay at legacy values; only bubble is shifted via transform.
  const marginTops = measurements
    .map((m) => m.speech_row_margin_top_px)
    .filter((v) => typeof v === "number");
  const marginUnchangedOk =
    marginTops.length > 0 &&
    marginTops.every((v) => Math.abs(v - 10) <= 0.5 || Math.abs(v - 8) <= 0.5);

  const checks = {
    privacy_text_position_fixed: privacyFixed,
    bubble_grows_upward_only: bubbleBottomFixed && bubbleGrowsUpward,
    bubble_neon_ok: bubbleStyle.bubble_neon_ok,
    bubble_white_text_ok: bubbleStyle.bubble_white_text_ok,
    privacy_line1_ok: measurements.every((m) => m.privacy1_text_ok),
    privacy_line2_ok: measurements.every((m) => m.privacy2_text_ok),
    ai_badge_gap_ok: badgeGapOk,
    speech_bubble_translate_y_4px: translateYOk,
    speech_row_margin_unchanged: marginUnchangedOk,
    overflow_x: measurements.some((m) => m.overflow_x),
    overlap_figure: measurements.some((m) => m.overlap_figure),
    privacy_top_delta_px: Number(privacyTopDelta.toFixed(2)),
    bubble_bottom_delta_px: Number(bubbleBottomDelta.toFixed(2)),
    two_line_badge_gap_px: twoLine && typeof twoLine.badge_bubble_gap_px === "number" ? twoLine.badge_bubble_gap_px : null,
    designed_badge_gap_px: designedGaps.length ? designedGaps[0] : null,
    speech_row_margin_top_px: marginTops.length ? marginTops[0] : null,
    bubble_translate_y_px: translateYs.length ? translateYs[0] : null,
    variant_measurements: measurements.map((m) => ({
      id: m.id,
      privacy_top: m.privacy1_rect ? Number(m.privacy1_rect.top.toFixed(2)) : null,
      privacy_bottom: m.privacy2_rect ? Number(m.privacy2_rect.bottom.toFixed(2)) : null,
      bubble_top: m.bubble_rect ? Number(m.bubble_rect.top.toFixed(2)) : null,
      bubble_bottom: m.bubble_rect ? Number(m.bubble_rect.bottom.toFixed(2)) : null,
      bubble_height: m.bubble_rect ? Number(m.bubble_rect.height.toFixed(2)) : null,
      badge_gap: typeof m.badge_bubble_gap_px === "number" ? m.badge_bubble_gap_px : null,
      designed_badge_gap: typeof m.designed_badge_gap_px === "number" ? m.designed_badge_gap_px : null,
      translate_y: typeof m.bubble_translate_y_px === "number" ? m.bubble_translate_y_px : null,
    })),
  };
  checks._pass =
    checks.privacy_text_position_fixed &&
    checks.bubble_grows_upward_only &&
    checks.bubble_neon_ok &&
    checks.bubble_white_text_ok &&
    checks.privacy_line1_ok &&
    checks.privacy_line2_ok &&
    checks.ai_badge_gap_ok &&
    checks.speech_bubble_translate_y_4px &&
    checks.speech_row_margin_unchanged &&
    !checks.overflow_x &&
    !checks.overlap_figure;
  return checks;
}

function staticCssGate() {
  const indexPath = path.join(__dirname, "..", "projects", "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const fails = [];
  if (!/\.silver-speech-row\{[^}]*margin:10px 0 0/.test(html)) {
    fails.push("speech_row_margin_10_missing");
  }
  if (!/\.silver-speech-row\{margin-top:8px!important\}/.test(html)) {
    fails.push("speech_row_margin_8_narrow_missing");
  }
  if (!/\.silver-speech-bubble\{[^}]*transform:translateY\(4px\)/.test(html)) {
    fails.push("speech_bubble_translateY_4px_missing");
  }
  // Must not "fix" via speech-row margin (that would shift privacy + actions).
  if (/\.silver-speech-row\{[^}]*margin:14px 0 0/.test(html)) {
    fails.push("speech_row_margin_14_forbidden");
  }
  if (/\.silver-speech-row\{margin-top:12px!important\}/.test(html)) {
    fails.push("speech_row_margin_12_forbidden");
  }
  // Desktop must keep speech hidden (PC unchanged).
  if (!/#iuSilverHeroPremium \.silver-speech-row[\s\S]{0,120}display:none!important/.test(html)) {
    fails.push("desktop_speech_hide_missing");
  }
  return { pass: fails.length === 0, fails };
}

async function runGuard() {
  const staticGate = staticCssGate();
  if (!staticGate.pass) {
    return { pass: false, results: [{ mode: "static", _pass: false, static_fails: staticGate.fails }], url: envUrl(), static: staticGate };
  }
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
        await p.waitForSelector("#iuSilverHeroPremium [data-iu-silver-speech-text]", { timeout: 60000 });
        await p.evaluate(async () => {
          try {
            if (document.fonts && document.fonts.ready) await document.fonts.ready;
          } catch (_) {}
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        });
        await p.waitForTimeout(2800);
        let measurements = await measureSpeechLayoutVariants(p, SPEECH_VARIANTS);
        let mergedProbe = evaluateVariantPass(measurements, {
          bubble_neon_ok: false,
          bubble_white_text_ok: false,
        });
        // One bounded retry when speech contract layout is not stable yet.
        if (!mergedProbe.privacy_text_position_fixed || !mergedProbe.bubble_grows_upward_only) {
          await p.evaluate(async () => {
            try {
              if (document.fonts && document.fonts.ready) await document.fonts.ready;
            } catch (_) {}
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          });
          measurements = await measureSpeechLayoutVariants(p, SPEECH_VARIANTS);
        }
        const styleSample = measurements[measurements.length - 1] || {};
        const shadow = String(styleSample.bubble_box_shadow || "");
        const bubbleStyle = {
          bubble_neon_ok:
            styleSample.bubble_border_width >= 1.5 &&
            (shadow.indexOf("37, 99, 235") >= 0 ||
              shadow.indexOf("37,99,235") >= 0 ||
              shadow.indexOf("59, 130, 246") >= 0 ||
              shadow.indexOf("59,130,246") >= 0) &&
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
  const reportPath = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "silver-mobile-tablet-bubble-stable-privacy-guard-v1-report.json");
  process.stdout.write("=== SILVER_MOBILE_TABLET_BUBBLE_STABLE_PRIVACY_GUARD_V1 ===\n\n");
  if (out.static && !out.static.pass) {
    process.stdout.write("STATIC_FAIL=" + (out.static.fails || []).join(",") + "\n");
  }
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
  process.stdout.write("AI_BADGE_GAP_OK=" + (out.results.some((r) => r.ai_badge_gap_ok) ? "YES" : "NO") + "\n");
  process.stdout.write("BUBBLE_TRANSLATE_Y_4PX=" + (out.results.some((r) => r.speech_bubble_translate_y_4px) ? "YES" : "NO") + "\n");
  process.stdout.write("SPEECH_ROW_MARGIN_UNCHANGED=" + (out.results.some((r) => r.speech_row_margin_unchanged) ? "YES" : "NO") + "\n");
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
        static: out.static || null,
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
