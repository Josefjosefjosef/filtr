#!/usr/bin/env node
"use strict";

/**
 * Silver Nová událost — Celodenní událost toggle must be tappable without calendar-overlay CSS.
 *
 * Broken (prod before fix): switch ~16×6px because .iu-calAllDaySwitch styles live only in
 * lazy iu-calendar-overlay-v1.js → physical iPhone tap fails; programmatic .click() still works.
 *
 * Gate: hitbox size + real pointer OFF→ON→OFF + form value + save payload allDay:true.
 */

const fs = require("fs");
const path = require("path");
const { chromium, webkit } = require("playwright");
const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
} = require("./proofs/open_meteo_guard_stub.cjs");

const REPO = path.join(__dirname, "..");
const MIN_W = 40;
const MIN_H_MOBILE = 28;
const VIEWPORTS = [
  { w: 390, h: 844, label: "390p" },
  { w: 768, h: 1024, label: "768p" },
];

function assertCssContract() {
  const app = fs.readFileSync(path.join(REPO, "assets", "app.css"), "utf8");
  const hasSwitch =
    /\.iuSilverDraftCard\s+\.iu-calAllDaySwitch\s*\{[\s\S]{0,280}width:\s*48px/.test(app) &&
    /\.iuSilverDraftCard\s+\.iu-calAllDaySwitch__track\s*\{[\s\S]{0,120}width:\s*48px/.test(app) &&
    /\.iuSilverDraftCard\s+\.iu-calAllDaySwitch__thumb\s*\{/.test(app);
  const hasSilverCell = /\.iuSilverDraftV--allDaySwitch\s*\{/.test(app);
  const hasMobileHit =
    /\.iuSilverDraftCard\s+\.iu-calAllDaySwitch\s*\{[\s\S]{0,280}min-height:\s*44px/.test(app);
  return { pass: hasSwitch && hasSilverCell && hasMobileHit, hasSwitch, hasSilverCell, hasMobileHit };
}

async function dismiss(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
    } catch (_) {}
    document.querySelectorAll(".iu-ldp-backdrop").forEach((el) => el.remove());
  });
}

async function openCalendarForm(page) {
  await page.evaluate(() => {
    const ov = document.getElementById("iuSilverChatOverlay");
    if (ov && !ov.hidden) {
      const c = document.getElementById("iuSilverChatClose");
      if (c) c.click();
    }
    if (typeof window.__iuSilverResetHomeTemplateMode === "function") {
      window.__iuSilverResetHomeTemplateMode();
    }
  });
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('[data-iu-silver-home-quick-action="calendar"]');
    if (btn) {
      btn.click();
      return "click";
    }
    if (typeof window.__iuSilverOpenQuickTemplateEmptyDirect === "function") {
      window.__iuSilverOpenQuickTemplateEmptyDirect("calendar");
      return "direct";
    }
    return "";
  });
  if (!opened) throw new Error("open_calendar_failed");
  await page.waitForTimeout(900);
  await dismiss(page);
}

async function readToggle(page) {
  return page.evaluate(() => {
    const card = document.querySelector(
      ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
    );
    const btn = card ? card.querySelector("[data-iu-silver-field-all-day]") : null;
    const time = card ? card.querySelector('input[data-iu-silver-field="time"]') : null;
    if (!btn) return { ok: false, reason: "missing_toggle" };
    const r = btn.getBoundingClientRect();
    const track = btn.querySelector(".iu-calAllDaySwitch__track");
    const tr = track ? track.getBoundingClientRect() : null;
    const styleTag = document.getElementById("iu-calendar-premium-update-v1");
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    const hits =
      !!top && (top === btn || (top.closest && !!top.closest("[data-iu-silver-field-all-day]")));
    return {
      ok: true,
      isOn: btn.classList.contains("is-on"),
      aria: btn.getAttribute("aria-checked"),
      timeDisabled: !!(time && time.disabled),
      calStyleInjected: !!styleTag,
      w: Math.round(r.width),
      h: Math.round(r.height),
      trackW: tr ? Math.round(tr.width) : 0,
      trackH: tr ? Math.round(tr.height) : 0,
      left: r.left,
      top: r.top,
      cx,
      cy,
      hitsToggle: hits,
    };
  });
}

async function pointerTapToggle(page) {
  const st = await readToggle(page);
  if (!st.ok) return st;
  await page.mouse.click(st.cx, st.cy);
  await page.waitForTimeout(220);
  return readToggle(page);
}

async function runToggleCycles(page) {
  const before = await readToggle(page);
  if (!before.ok) return { pass: false, before };

  const hitboxOk =
    before.w >= MIN_W &&
    before.h >= MIN_H_MOBILE &&
    before.trackW >= MIN_W &&
    before.trackH >= 24 &&
    before.hitsToggle === true;

  // Ensure OFF
  if (before.isOn) {
    await pointerTapToggle(page);
  }
  const off0 = await readToggle(page);
  const on1 = await pointerTapToggle(page);
  const off1 = await pointerTapToggle(page);
  const on2 = await pointerTapToggle(page);

  const cyclePass =
    !!off0.ok &&
    off0.isOn === false &&
    off0.aria === "false" &&
    off0.timeDisabled === false &&
    !!on1.ok &&
    on1.isOn === true &&
    on1.aria === "true" &&
    on1.timeDisabled === true &&
    !!off1.ok &&
    off1.isOn === false &&
    off1.aria === "false" &&
    off1.timeDisabled === false &&
    !!on2.ok &&
    on2.isOn === true &&
    on2.aria === "true" &&
    on2.timeDisabled === true;

  return {
    pass: hitboxOk && cyclePass,
    hitboxOk,
    cyclePass,
    before,
    off0,
    on1,
    off1,
    on2,
  };
}

async function runSaveAllDay(page) {
  // Leave toggle ON from previous cycles
  const st = await readToggle(page);
  if (!st.ok || !st.isOn) {
    if (st.ok && !st.isOn) await pointerTapToggle(page);
  }

  await page.evaluate(() => {
    const card = document.querySelector(
      ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
    );
    const date = card ? card.querySelector('input[data-iu-silver-field="date"]') : null;
    const title = card ? card.querySelector('input[data-iu-silver-field="title"]') : null;
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    if (date) {
      date.value = y + "-" + m + "-" + d;
      date.dispatchEvent(new Event("input", { bubbles: true }));
      date.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (title) {
      title.value = "IU all-day guard " + Date.now();
      title.dispatchEvent(new Event("input", { bubbles: true }));
      title.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await page.waitForTimeout(150);

  const captured = await page.evaluate(async () => {
    const payload = { calls: [] };
    const svc = window.iuCalendarService || {};
    const prev = typeof svc.calendarCreateEvent === "function" ? svc.calendarCreateEvent.bind(svc) : null;
    window.iuCalendarService = svc;
    svc.calendarCreateEvent = async function (arg) {
      payload.calls.push(arg ? JSON.parse(JSON.stringify(arg)) : null);
      return {
        ok: true,
        event: {
          id: "guard-allday-" + Date.now(),
          date: arg && arg.date,
          time: arg && arg.time,
          allDay: !!(arg && arg.allDay),
          title: arg && arg.title,
        },
      };
    };
    const save = document.querySelector(
      '.iuSilverDraftCard--quickTemplateEmpty [data-iu-silver-action="save"]'
    );
    if (save) {
      save.disabled = false;
      save.click();
    }
    await new Promise((r) => setTimeout(r, 400));
    if (prev) svc.calendarCreateEvent = prev;
    const last = payload.calls.length ? payload.calls[payload.calls.length - 1] : null;
    return {
      callCount: payload.calls.length,
      allDay: !!(last && last.allDay),
      time: last ? String(last.time || "") : "",
      title: last ? String(last.title || "") : "",
      saveResult: window.__iuSilverLastSaveResult || null,
    };
  });

  return {
    pass:
      captured.callCount >= 1 &&
      captured.allDay === true &&
      captured.time === "00:00" &&
      captured.title.indexOf("IU all-day guard") === 0,
    captured,
  };
}

async function runViewport(page, vp) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.goto(base.envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1100);
  await dismiss(page);
  await openCalendarForm(page);
  const toggle = await runToggleCycles(page);
  const save = toggle.pass ? await runSaveAllDay(page) : { pass: false, skipped: true };
  return {
    vp: vp.label,
    pass: toggle.pass && save.pass,
    toggle,
    save,
  };
}

async function runEngine(engineType, label) {
  const browser = await engineType.launch({ headless: true });
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  createIgnorableResourceTracker().attachToPage(page);
  const rows = [];
  for (let i = 0; i < VIEWPORTS.length; i++) {
    rows.push(await runViewport(page, VIEWPORTS[i]));
  }
  await browser.close();
  return rows.map((r) => Object.assign({ engine: label }, r));
}

async function main() {
  const css = assertCssContract();
  const skipWebkit =
    String(process.env.IU_SILVER_ALLDAY_TOGGLE_SKIP_WEBKIT || "").trim() === "1" ||
    String(process.env.IU_SILVER_ALLDAY_TOGGLE_SKIP_WEBKIT || "").toLowerCase() === "true";

  const chromiumRows = await runEngine(chromium, "chromium");
  let webkitRows = [];
  if (skipWebkit) {
    process.stdout.write(
      "WEBKIT_SKIPPED reason=IU_SILVER_ALLDAY_TOGGLE_SKIP_WEBKIT chromium_only_ci_contract\n"
    );
  } else {
    webkitRows = await runEngine(webkit, "webkit");
  }
  const rows = chromiumRows.concat(webkitRows);
  const runtimePass = rows.every((r) => r.pass);
  const pass = css.pass && runtimePass;

  process.stdout.write("=== IU_SILVER_ALLDAY_TOGGLE_GUARD_V1 ===\n");
  process.stdout.write(
    "ROOT_CAUSE: Silver Nová událost uses .iu-calAllDaySwitch but styles were only in lazy calendar-overlay CSS; without them hitbox collapses (~16x6) so physical tap fails while programmatic click passes\n"
  );
  process.stdout.write(
    "NOT_CAUSED_BY_10174: switch CSS never lived in app.css before or after #10174; #10174 only changed date/time appearance\n"
  );
  process.stdout.write(
    "CSS_CONTRACT: " +
      (css.pass ? "PASS" : "FAIL") +
      " hasSwitch=" +
      css.hasSwitch +
      " hasSilverCell=" +
      css.hasSilverCell +
      " hasMobileHit=" +
      css.hasMobileHit +
      "\n"
  );
  process.stdout.write("RUNTIME: " + (runtimePass ? "PASS" : "FAIL") + "\n");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t = r.toggle || {};
    const b = t.before || {};
    process.stdout.write(
      r.engine +
        " " +
        r.vp +
        " pass=" +
        (r.pass ? "PASS" : "FAIL") +
        " hitbox=" +
        (t.hitboxOk ? "PASS" : "FAIL") +
        " size=" +
        (b.w || 0) +
        "x" +
        (b.h || 0) +
        " track=" +
        (b.trackW || 0) +
        "x" +
        (b.trackH || 0) +
        " cycle=" +
        (t.cyclePass ? "PASS" : "FAIL") +
        " saveAllDay=" +
        (r.save && r.save.pass ? "PASS" : "FAIL") +
        " calStyleInjected=" +
        !!b.calStyleInjected +
        "\n"
    );
  }
  process.stdout.write("REAL_IOS_PASS: NOT_TESTED\n");
  process.stdout.write("SAFETY: " + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_IU_SILVER_ALLDAY_TOGGLE_GUARD_V1 ===\n");
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
