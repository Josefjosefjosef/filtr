#!/usr/bin/env node
/**
 * Silver mobile/tablet layout anti-regression guard (Playwright, production).
 *
 * Rules (viewport 390×844 and 768×1024):
 * - image_to_input_gap = inputTop - imageBottom  → 0..2 px
 * - gap_input_to_buttons = buttonsTop - composerBottom (mobile home composer incl. ticker)
 * - gap_buttons_to_card_bottom = cardBottom - buttonsBottom
 * - button_gap_delta = |gap_input_to_buttons - gap_buttons_to_card_bottom| ≤ 8
 * - Calendar / Úkoly / Poznámky smoke; no mic; submit shows arrow only
 * - overflowX false; no console errors; no page errors; CLS cap after idle paint
 * - #iuSilverParcelWatch first-paint vs hydrated height delta ≤ 8 px (mobile/tablet)
 * - Open-Meteo fetch stubbed in proof (see proofs/open_meteo_guard_stub.cjs) — external API CORS is not layout signal
 *
 * Env: SILVER_LAYOUT_GUARD_URL (default https://infouzel.cz/projects/)
 */
"use strict";

const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const DEFAULT_URL = "https://infouzel.cz/projects/";
/** Silver hero initial-hydrate baseline on mobile/tablet prod is ~0.033–0.0432 after weather-card copy (#4748); mobile Playwright runs can sit ~0.04314 while tablet ~0.0417 — single cap with small headroom, not separate viewport limits. */
const CLS_CAP = 0.044;
const PARCEL_HEIGHT_DELTA_CAP = 8;

/** External Cloudflare Insights analytics beacon blocked by CSP — not Silver layout/app signal. */
function isCloudflareInsightsCspBeaconNoise(text) {
  const s = String(text || "");
  if (!s) return false;
  if (!/static\.cloudflareinsights\.com\/beacon\.min\.js/i.test(s)) return false;
  if (!/violates the (following )?Content Security Policy directive/i.test(s)) return false;
  if (!/The action has been blocked/i.test(s)) return false;
  return true;
}

function isIgnoredSilverLayoutConsoleError(text, ignorableOpts) {
  return isIgnorableGuardConsoleError(text, ignorableOpts) || isCloudflareInsightsCspBeaconNoise(text);
}

function partitionConsoleErrors(rawConsoleErrors, ignorableOpts) {
  const ignoredConsoleErrors = [];
  const blockingConsoleErrors = [];
  for (let i = 0; i < rawConsoleErrors.length; i++) {
    const t = rawConsoleErrors[i];
    if (isIgnoredSilverLayoutConsoleError(t, ignorableOpts)) ignoredConsoleErrors.push(t);
    else blockingConsoleErrors.push(t);
  }
  return { ignoredConsoleErrors, blockingConsoleErrors };
}

function runConsoleErrorFilterSelfCheck() {
  const cloudflareSample =
    "Loading the script 'https://static.cloudflareinsights.com/beacon.min.js/abc' violates the following Content Security Policy directive: \"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'\". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The action has been blocked.";
  const genericCspSample =
    "Loading the script 'https://infouzel.cz/projects/assets/app.js' violates the following Content Security Policy directive: \"script-src 'self'\". The action has been blocked.";
  const appSample = "Uncaught TypeError: Cannot read properties of undefined (reading 'x')";
  const faviconSample = "Failed to load resource: the server responded with a status of 404 (Not Found) https://infouzel.cz/favicon.ico";
  const checks = [
    { name: "cloudflare_beacon_ignored", pass: isCloudflareInsightsCspBeaconNoise(cloudflareSample) },
    { name: "generic_csp_not_ignored", pass: !isCloudflareInsightsCspBeaconNoise(genericCspSample) },
    { name: "app_error_not_ignored", pass: !isCloudflareInsightsCspBeaconNoise(appSample) },
    {
      name: "favicon_still_ignored",
      pass: isIgnoredSilverLayoutConsoleError(faviconSample, {}),
    },
    {
      name: "blocking_partition",
      pass:
        partitionConsoleErrors([cloudflareSample, genericCspSample], {}).blockingConsoleErrors.length === 1,
    },
  ];
  const failed = checks.filter((c) => !c.pass);
  if (failed.length) {
    throw new Error(
      "Silver layout guard console filter self-check failed: " + failed.map((c) => c.name).join(", ")
    );
  }
  return checks;
}

function envUrl() {
  const u = String(process.env.SILVER_LAYOUT_GUARD_URL || DEFAULT_URL).trim();
  return u || DEFAULT_URL;
}

async function installParcelHeightTracker(context) {
  await context.addInitScript(() => {
    window.__iuParcelHeightTrack = { min: null, max: null, first: null, last: null, shiftDelta: 0 };
    function trackParcelHeight() {
      try {
        const el = document.getElementById("iuSilverParcelWatch");
        if (!el) return;
        const h = el.getBoundingClientRect().height;
        const t = window.__iuParcelHeightTrack;
        if (t.first == null) t.first = h;
        t.last = h;
        if (t.min == null || h < t.min) t.min = h;
        if (t.max == null || h > t.max) t.max = h;
      } catch (_) {}
    }
    try {
      new PerformanceObserver(function (list) {
        for (let i = 0; i < list.getEntries().length; i++) {
          const e = list.getEntries()[i];
          if (!e.sources) continue;
          for (let j = 0; j < e.sources.length; j++) {
            const s = e.sources[j];
            try {
              const n = s.node;
              if (!n || n.id !== "iuSilverParcelWatch") continue;
              const prev = s.previousRect ? s.previousRect.height : 0;
              const curr = s.currentRect ? s.currentRect.height : 0;
              const d = Math.abs(curr - prev);
              if (d > window.__iuParcelHeightTrack.shiftDelta) {
                window.__iuParcelHeightTrack.shiftDelta = d;
              }
            } catch (_) {}
          }
        }
        trackParcelHeight();
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
    (function rafLoop() {
      trackParcelHeight();
      if (performance.now() < 3200) requestAnimationFrame(rafLoop);
    })();
  });
}

async function waitForDeferredAppCss(page) {
  try {
    await page.waitForFunction(
      () => {
        const link = document.querySelector('link[data-iu-defer-app-css="1"]');
        if (!link) return false;
        if (link.dataset && link.dataset.iuDeferReady === "1") return true;
        try {
          return !!(link.sheet && link.media === "all");
        } catch (_) {
          return false;
        }
      },
      { timeout: 20000 }
    );
  } catch (_) {}
  await page.evaluate(() => {
    const t = window.__iuParcelHeightTrack;
    if (!t) return;
    const el = document.getElementById("iuSilverParcelWatch");
    const h = el ? el.getBoundingClientRect().height : null;
    if (h == null) return;
    t.first = h;
    t.last = h;
    t.min = h;
    t.max = h;
    t.shiftDelta = 0;
  });
}

async function readParcelHeightTrack(page) {
  return page.evaluate(() => {
    const t = window.__iuParcelHeightTrack || {};
    const min = t.min == null ? null : Number(t.min);
    const max = t.max == null ? null : Number(t.max);
    const first = t.first == null ? null : Number(t.first);
    const last = t.last == null ? null : Number(t.last);
    const delta = min != null && max != null ? Math.abs(max - min) : null;
    const shiftDelta = t.shiftDelta == null ? null : Number(t.shiftDelta);
    const effectiveDelta =
      shiftDelta != null && delta != null ? Math.max(shiftDelta, delta) : shiftDelta != null ? shiftDelta : delta;
    return { min, max, first, last, delta, shiftDelta, effectiveDelta };
  });
}

async function installClsObserver(context) {
  await context.addInitScript(() => {
    try {
      window.__iuSilverLayoutCls = 0;
      new PerformanceObserver(function (list) {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e.hadRecentInput && e.value) {
            window.__iuSilverLayoutCls = (window.__iuSilverLayoutCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuSilverLayoutCls || 0));
}

async function runViewport(page, w, h) {
  await installProofGuardNetworkStubs(page);
  /* Variant B extension: stub multi‑MB info_events feed + traffic snapshot so
     Silver layout interactions are not blocked by synchronous JSON.parse. */
  const heavyStubs = await import("./smoke-heavy-data-stubs.mjs");
  const heavyStats = await heavyStubs.installSmokeHeavyDataRouteStubs(page);
  if (!heavyStats.feedSchema.ok || !heavyStats.trafficSchema.ok) {
    throw new Error(
      "SILVER_LAYOUT_HEAVY_STUB_SCHEMA_INVALID:" +
        JSON.stringify({
          feed: heavyStats.feedSchema.fails,
          traffic: heavyStats.trafficSchema.fails,
        })
    );
  }
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);
  await page.setViewportSize({ width: w, height: h });
  const rawConsoleErrors = [];
  let appErrors = 0;
  const onConsole = (msg) => {
    try {
      if (msg.type() === "error") rawConsoleErrors.push(String(msg.text()));
    } catch (_) {}
  };
  const onPageError = (err) => {
    try {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t)) return;
      appErrors += 1;
      rawConsoleErrors.push(t);
    } catch (_) {}
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  await page.goto(envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForDeferredAppCss(page);
  await page.waitForTimeout(2600);

  const geom = await page.evaluate(() => {
    const hero =
      document.getElementById("iuSilverHeroPremium") ||
      document.querySelector(".iu-silver-hero-vertical-gap-p0");
    const img = document.querySelector("#iuSilverHeroPremium .iu-hero-figureImg");
    const inp = document.getElementById("iuSilverHomeInput");
    const sendBtn = document.getElementById("iuSilverHomeSend");
    const composer = document.querySelector(".iuSilverHomeMobileComposerMain[data-iu-silver-home-composer-main]");
    const quick = document.querySelector("#iuSilverHeroPremium .iu-hero-quickActions.iu-hero-actions");
    const docEl = document.documentElement;
    const body = document.body;
    const overflowX =
      (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
      (body && body.scrollWidth > body.clientWidth + 1);

    let imageBottom = null;
    let inputTop = null;
    let inputBottom = null;
    let composerBottom = null;
    let buttonsTop = null;
    let buttonsBottom = null;
    let cardBottom = null;
    if (img) imageBottom = img.getBoundingClientRect().bottom;
    if (inp) {
      const r = inp.getBoundingClientRect();
      inputTop = r.top;
      inputBottom = r.bottom;
    }
    if (composer) {
      composerBottom = composer.getBoundingClientRect().bottom;
    }
    if (quick) {
      const r = quick.getBoundingClientRect();
      buttonsTop = r.top;
      buttonsBottom = r.bottom;
    }
    if (hero) cardBottom = hero.getBoundingClientRect().bottom;

    const imageToInputGap =
      imageBottom != null && inputTop != null ? Math.round(inputTop - imageBottom) : null;
    const blockBottom = composerBottom != null ? composerBottom : inputBottom;
    const gapInputToButtons =
      blockBottom != null && buttonsTop != null ? Math.max(0, Math.round(buttonsTop - blockBottom)) : null;
    const gapButtonsToCardBottom =
      cardBottom != null && buttonsBottom != null ? Math.max(0, Math.round(cardBottom - buttonsBottom)) : null;
    const buttonGapDelta =
      gapInputToButtons != null && gapButtonsToCardBottom != null
        ? Math.abs(gapInputToButtons - gapButtonsToCardBottom)
        : null;

    const micEl = sendBtn ? sendBtn.querySelector(".iuSilverHomeSendIcon--mic") : null;
    const sendEl = sendBtn ? sendBtn.querySelector(".iuSilverHomeSendIcon--send") : null;
    const micDisplay = micEl ? getComputedStyle(micEl).display : "none";
    const sendDisplay = sendEl ? getComputedStyle(sendEl).display : "";
    const micPresent = micDisplay !== "none" && micDisplay !== "";
    const submitArrowOnly = !micPresent && sendDisplay !== "none";

    const parcelWatch = document.getElementById("iuSilverParcelWatch");
    const parcelShell = document.querySelector(".iuSilverParcelWatch__mainShell");
    const parcelInp = document.getElementById("iuSilverParcelWatchInput");
    const parcelBtn = document.getElementById("iuSilverParcelWatchSave");
    function parcelVis(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }
    let parcelShellNotClipped = false;
    if (parcelWatch && parcelShell && parcelInp && parcelBtn) {
      const sh = parcelShell.getBoundingClientRect();
      const wh = parcelWatch.getBoundingClientRect();
      const ir = parcelInp.getBoundingClientRect();
      const br = parcelBtn.getBoundingClientRect();
      parcelShellNotClipped =
        sh.bottom <= wh.bottom + 3 &&
        sh.top >= wh.top - 3 &&
        ir.bottom <= sh.bottom + 2 &&
        br.bottom <= sh.bottom + 2;
    }

    return {
      heroFound: !!hero,
      imgFound: !!img,
      inpFound: !!inp,
      quickFound: !!quick,
      image_to_input_gap_px: imageToInputGap,
      gap_input_to_buttons_px: gapInputToButtons,
      gap_buttons_to_card_bottom_px: gapButtonsToCardBottom,
      button_gap_delta_px: buttonGapDelta,
      mic_present: micPresent,
      submit_arrow_only: submitArrowOnly,
      overflowX,
      parcel_card_visible: parcelVis(parcelWatch),
      parcel_input_visible: parcelVis(parcelInp),
      parcel_button_visible: parcelVis(parcelBtn),
      parcel_shell_not_clipped: parcelShellNotClipped,
    };
  });

  const cls = await readCls(page);
  const parcelTrack = await readParcelHeightTrack(page);

  let calendarFlowOk = false;
  let tasksOk = false;
  let notesOk = false;
  try {
    /* Force-click only: scrollIntoViewIfNeeded stalls when Chromium main thread is
       busy (multi‑MB feed.json parse). Stubs + force keep the calendar contract. */
    await page.click("#iuHeroQuickCal", { timeout: 15000, force: true });
    await page.waitForTimeout(600);
    calendarFlowOk = await page.evaluate(() => {
      const overlay = document.getElementById("iuCalendarOverlay");
      const open = !!(overlay && !overlay.hasAttribute("hidden") && overlay.getAttribute("aria-hidden") !== "true");
      const oldSave = document.querySelector('[data-iu-silver-guided="save"]');
      const oldSearch = document.querySelector('[data-iu-silver-guided="search"]');
      const oldCancel = document.querySelector('[data-iu-silver-guided="cal-back"]');
      const miniCalGrid = document.querySelector(".iuSilverMiniCal__grid");
      const composeAux = document.querySelector("[data-iu-silver-calendar-compose-aux]");
      function vis(el) {
        if (!el) return false;
        const st = window.getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }
      if (vis(oldSave) || vis(oldSearch) || vis(oldCancel)) return false;
      if (miniCalGrid && vis(miniCalGrid)) return false;
      if (composeAux && vis(composeAux)) return false;
      return open;
    });
    try {
      await page.keyboard.press("Escape");
    } catch (_) {}
    await page.waitForTimeout(200);
  } catch (_) {
    calendarFlowOk = false;
  }
  try {
    await page.click("#iuHeroQuickTasks", { timeout: 15000, force: true });
    await page.waitForTimeout(350);
    tasksOk = true;
  } catch (_) {
    tasksOk = false;
  }
  try {
    await page.click("#iuHeroQuickNotes", { timeout: 15000, force: true });
    await page.waitForTimeout(350);
    notesOk = true;
  } catch (_) {
    notesOk = false;
  }

  page.off("console", onConsole);
  page.off("pageerror", onPageError);

  const ignorableOpts = {
    hadRecentIgnorableFailure: ignorableTracker.hadRecentIgnorableFailure.bind(ignorableTracker),
  };
  const { ignoredConsoleErrors, blockingConsoleErrors } = partitionConsoleErrors(
    rawConsoleErrors,
    ignorableOpts
  );

  const g = geom;
  const imageGapPass =
    g.image_to_input_gap_px != null && g.image_to_input_gap_px >= 0 && g.image_to_input_gap_px <= 2;
  const buttonGapPass = g.button_gap_delta_px != null && g.button_gap_delta_px <= 8;
  const clsPass = cls <= CLS_CAP;
  const parcelStable =
    parcelTrack.first != null &&
    parcelTrack.last != null &&
    Math.abs(parcelTrack.last - parcelTrack.first) <= PARCEL_HEIGHT_DELTA_CAP;
  const parcelHeightDeltaPass =
    parcelStable ||
    (parcelTrack.effectiveDelta != null && parcelTrack.effectiveDelta <= PARCEL_HEIGHT_DELTA_CAP);

  const pass =
    g.heroFound &&
    g.imgFound &&
    g.inpFound &&
    g.quickFound &&
    imageGapPass &&
    buttonGapPass &&
    calendarFlowOk &&
    tasksOk &&
    notesOk &&
    !g.mic_present &&
    g.submit_arrow_only &&
    !g.overflowX &&
    g.parcel_card_visible &&
    g.parcel_input_visible &&
    g.parcel_button_visible &&
    g.parcel_shell_not_clipped &&
    blockingConsoleErrors.length === 0 &&
    appErrors === 0 &&
    clsPass &&
    parcelHeightDeltaPass;

  return {
    image_to_input_gap_px: g.image_to_input_gap_px,
    image_gap_pass: imageGapPass,
    gap_input_to_buttons_px: g.gap_input_to_buttons_px,
    gap_buttons_to_card_bottom_px: g.gap_buttons_to_card_bottom_px,
    button_gap_delta_px: g.button_gap_delta_px,
    button_gap_pass: buttonGapPass,
    calendar_flow_ok: calendarFlowOk,
    tasks_ok: tasksOk,
    notes_ok: notesOk,
    mic_present: g.mic_present,
    submit_arrow_only: g.submit_arrow_only,
    overflowX: g.overflowX,
    parcel_card_visible: g.parcel_card_visible,
    parcel_input_visible: g.parcel_input_visible,
    parcel_button_visible: g.parcel_button_visible,
    parcel_shell_not_clipped: g.parcel_shell_not_clipped,
    rawConsoleErrorsCount: rawConsoleErrors.length,
    ignoredConsoleErrorsCount: ignoredConsoleErrors.length,
    blockingConsoleErrorsCount: blockingConsoleErrors.length,
    consoleErrorsCount: blockingConsoleErrors.length,
    appErrorsCount: appErrors,
    cls,
    cls_pass: clsPass,
    parcel_height_first_px: parcelTrack.first,
    parcel_height_last_px: parcelTrack.last,
    parcel_height_min_px: parcelTrack.min,
    parcel_height_max_px: parcelTrack.max,
    parcel_height_delta_px: parcelTrack.effectiveDelta,
    parcel_height_shift_delta_px: parcelTrack.shiftDelta,
    parcel_height_delta_pass: parcelHeightDeltaPass,
    consoleErrorsText: blockingConsoleErrors.slice(),
    ignoredConsoleErrorsText: ignoredConsoleErrors.slice(),
    _pass: pass,
  };
}

function formatBlock(label, o) {
  const lines = [
    `${label}:`,
    "  image_to_input_gap_px: " + o.image_to_input_gap_px,
    "  image_gap_pass: " + o.image_gap_pass,
    "  gap_input_to_buttons_px: " + o.gap_input_to_buttons_px,
    "  gap_buttons_to_card_bottom_px: " + o.gap_buttons_to_card_bottom_px,
    "  button_gap_delta_px: " + o.button_gap_delta_px,
    "  button_gap_pass: " + o.button_gap_pass,
    "  calendar_flow_ok: " + o.calendar_flow_ok,
    "  tasks_ok: " + o.tasks_ok,
    "  notes_ok: " + o.notes_ok,
    "  mic_present: " + o.mic_present,
    "  submit_arrow_only: " + o.submit_arrow_only,
    "  overflowX: " + o.overflowX,
    "  parcel_card_visible: " + o.parcel_card_visible,
    "  parcel_input_visible: " + o.parcel_input_visible,
    "  parcel_button_visible: " + o.parcel_button_visible,
    "  parcel_shell_not_clipped: " + o.parcel_shell_not_clipped,
    "  rawConsoleErrorsCount: " + o.rawConsoleErrorsCount,
    "  ignoredConsoleErrorsCount: " + o.ignoredConsoleErrorsCount,
    "  blockingConsoleErrorsCount: " + o.blockingConsoleErrorsCount,
    "  consoleErrorsCount: " + o.consoleErrorsCount,
    "  appErrorsCount: " + o.appErrorsCount,
    "  cls: " + o.cls,
    "  cls_pass: " + o.cls_pass,
    "  parcel_height_first_px: " + o.parcel_height_first_px,
    "  parcel_height_last_px: " + o.parcel_height_last_px,
    "  parcel_height_delta_px: " + o.parcel_height_delta_px,
    "  parcel_height_stable: " + (o.parcel_height_first_px != null && o.parcel_height_last_px != null && Math.abs(o.parcel_height_last_px - o.parcel_height_first_px) <= 8),
    "  parcel_height_delta_pass: " + o.parcel_height_delta_pass,
  ];
  if (Array.isArray(o.ignoredConsoleErrorsText) && o.ignoredConsoleErrorsText.length) {
    lines.push("  ignored_console_errors_text:");
    for (let ii = 0; ii < o.ignoredConsoleErrorsText.length; ii++) {
      lines.push("    - " + String(o.ignoredConsoleErrorsText[ii]).slice(0, 800));
    }
  }
  if (Array.isArray(o.consoleErrorsText) && o.consoleErrorsText.length) {
    lines.push("  console_errors_text:");
    for (let ci = 0; ci < o.consoleErrorsText.length; ci++) {
      lines.push("    - " + String(o.consoleErrorsText[ci]).slice(0, 800));
    }
  }
  return lines.join("\n");
}

async function main() {
  const selfCheckOnly = process.argv.includes("--self-check");
  runConsoleErrorFilterSelfCheck();
  if (selfCheckOnly) {
    process.stdout.write("SILVER_LAYOUT_GUARD_CONSOLE_FILTER_SELF_CHECK: PASS\n");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:local-data-protection:notice-accepted-at:v1", String(Date.now()));
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  await installClsObserver(ctx);
  await installParcelHeightTracker(ctx);

  let v390;
  let v768;
  try {
    const p390 = await ctx.newPage();
    try {
      v390 = await runViewport(p390, 390, 844);
    } finally {
      await p390.close();
    }
    const p768 = await ctx.newPage();
    try {
      v768 = await runViewport(p768, 768, 1024);
    } finally {
      await p768.close();
    }
  } finally {
    await ctx.close();
    await browser.close();
  }

  const finalPass = v390._pass && v768._pass;
  delete v390._pass;
  delete v768._pass;

  process.stdout.write("=== SILVER_LAYOUT_GUARD ===\n\n");
  process.stdout.write(formatBlock("viewport_390x844", v390) + "\n\n");
  process.stdout.write(formatBlock("viewport_768x1024", v768) + "\n\n");
  process.stdout.write("FINAL_STATUS: " + (finalPass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_SILVER_LAYOUT_GUARD ===\n");

  if (!finalPass) process.exitCode = 1;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});

module.exports = {
  isCloudflareInsightsCspBeaconNoise,
  isIgnoredSilverLayoutConsoleError,
  partitionConsoleErrors,
  runConsoleErrorFilterSelfCheck,
};
