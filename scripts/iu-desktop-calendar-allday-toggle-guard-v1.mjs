#!/usr/bin/env node
/**
 * PC calendar: all-day toggle must keep inline event form open (day slot + month add).
 * Deterministic ready/click/isolation/cleanup contracts (test infra only).
 * Run: npm run iu-desktop-calendar-allday-toggle-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-desktop-calendar-allday-toggle-guard
 * Target: IU_CAL_ONLY=day-slot|month-fab
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  installLocalDataProtectionAccepted,
} from "./proofs/open_meteo_guard_stub.cjs";
import {
  INLINE_WAIT_MS,
  OVERLAY_WAIT_MS,
  CAL_SERVICE_WAIT_MS,
  SERVER_READY_WAIT_MS,
  FAIL,
  failError,
  allocateEphemeralPort,
  startOwnedStaticServer,
  waitForOwnedServerReady,
  closeOwnedServer,
} from "./guards/iu-desktop-cal-allday-toggle-ready.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const TOGGLE_CYCLES = parseInt(process.env.IU_CAL_ALLDAY_TOGGLE_CYCLES || "5", 10);
const ONLY = String(process.env.IU_CAL_ONLY || "").trim().toLowerCase();
const DELAY_READY_MS = Math.max(0, parseInt(process.env.IU_CAL_DELAY_READY_MS || "0", 10) || 0);

let BASE = "";
let OWNER_TOKEN = "";
let BOUND_PORT = 0;

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
}

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  if (isProdHost(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

function trackPageErrors(page) {
  const errors = [];
  const onPage = (err) => {
    errors.push({ kind: "page", message: String(err && err.message ? err.message : err).slice(0, 200) });
  };
  const onReq = (req) => {
    const f = req.failure();
    if (f) {
      errors.push({
        kind: "request",
        message: String(f.errorText || "request_failed").slice(0, 120),
      });
    }
  };
  page.on("pageerror", onPage);
  page.on("requestfailed", onReq);
  return {
    errors,
    first() {
      return errors[0] || null;
    },
    dispose() {
      try {
        page.off("pageerror", onPage);
        page.off("requestfailed", onReq);
      } catch (_) {}
    },
  };
}

async function waitForCalendarReady(page) {
  await page.waitForFunction(
    () => window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function",
    { timeout: CAL_SERVICE_WAIT_MS }
  );
}

async function openCalendarOverlay(page) {
  await waitForCalendarReady(page);
  if (DELAY_READY_MS > 0) {
    await page.evaluate((ms) => {
      const svc = window.iuCalendarService;
      if (!svc || svc.__iuCalToggleDelayWrapped) return;
      const orig = svc.openOverlay.bind(svc);
      let readyAt = 0;
      svc.__iuCalToggleDelayWrapped = true;
      svc.openOverlay = function delayedOpen() {
        readyAt = Date.now() + ms;
        const args = arguments;
        const self = this;
        return new Promise((resolve) => {
          const tick = () => {
            if (Date.now() >= readyAt) resolve(orig.apply(self, args));
            else setTimeout(tick, 20);
          };
          tick();
        });
      };
    }, DELAY_READY_MS);
  }
  await page.evaluate(() => {
    if (window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function") {
      return window.iuCalendarService.openOverlay();
    }
  });
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuCalendarOverlay");
    const view = document.getElementById("iuCalendarViewRoot");
    return !!(ov && !ov.hidden && ov.getAttribute("aria-hidden") !== "true" && view);
  }, { timeout: OVERLAY_WAIT_MS });
}

async function fillInlineTestFields(page, title, address) {
  await page.evaluate(
    ({ titleVal, addressVal }) => {
      const root = document.querySelector("[data-iu-cal-inline-root]");
      if (!root) throw new Error("inline root missing");
      const titleIn = root.querySelector('[data-iu-cal-inline-field="title"]');
      const addressIn = root.querySelector('[data-iu-cal-inline-field="address"]');
      if (!titleIn || !addressIn) throw new Error("inline fields missing");
      titleIn.value = titleVal;
      addressIn.value = addressVal;
      titleIn.dispatchEvent(new Event("input", { bubbles: true }));
      addressIn.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { titleVal: title, addressVal: address }
  );
  await page.waitForFunction(
    ({ titleVal, addressVal }) => {
      const root = document.querySelector("[data-iu-cal-inline-root]");
      if (!root) return false;
      const titleIn = root.querySelector('[data-iu-cal-inline-field="title"]');
      const addressIn = root.querySelector('[data-iu-cal-inline-field="address"]');
      return !!(titleIn && addressIn && titleIn.value === titleVal && addressIn.value === addressVal);
    },
    { titleVal: title, addressVal: address },
    { timeout: 10000 }
  );
}

async function readInlineFormState(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-iu-cal-inline-root]");
    const title = root ? root.querySelector('[data-iu-cal-inline-field="title"]') : null;
    const address = root ? root.querySelector('[data-iu-cal-inline-field="address"]') : null;
    const toggle = root ? root.querySelector("[data-iu-cal-inline-all-day]") : null;
    const dateIn = root ? root.querySelector('[data-iu-cal-inline-field="date"]') : null;
    const side = document.getElementById("iuCalendarSidePanelScroll");
    const sideOpen = !!(side && side.innerHTML.trim());
    const style = root ? window.getComputedStyle(root) : null;
    const visible = !!(
      root &&
      style &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || "1") > 0
    );
    return {
      hasRoot: !!root,
      visible,
      title: title ? String(title.value || "") : "",
      address: address ? String(address.value || "") : "",
      date: dateIn ? String(dateIn.value || "") : "",
      allDayOn: !!(toggle && toggle.classList.contains("is-on")),
      sideOpen,
    };
  });
}

async function waitToggleClass(page, expectOn) {
  await page.waitForFunction(
    (on) => {
      const toggle = document.querySelector("[data-iu-cal-inline-all-day]");
      if (!toggle) return false;
      return toggle.classList.contains("is-on") === !!on;
    },
    expectOn,
    { timeout: 10000 }
  );
}

async function assertDocumentReady(page) {
  const st = await page.evaluate(() => ({
    ready: document.readyState,
    href: location.href,
  }));
  if (st.ready !== "complete" && st.ready !== "interactive") {
    throw failError(FAIL.DOCUMENT_NOT_COMPLETE, st.ready);
  }
  if (!String(st.href || "").startsWith(BASE.replace(/\?.*$/, ""))) {
    throw failError(FAIL.PAGE_URL_MISMATCH, "unexpected href");
  }
}

async function assertDaySlotReady(page, tracker) {
  if (tracker.first()) {
    throw failError(FAIL.PAGE_ERROR_BEFORE_CLICK, tracker.first().message);
  }
  await assertDocumentReady(page);

  const probe = await page.evaluate(() => {
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    const slot = scroll ? scroll.querySelector("[data-iu-cal-slot-empty]") : null;
    const inline = document.querySelector("[data-iu-cal-inline-root]");
    if (!scroll) return { ok: false, code: "CALENDAR_ROOT_MISSING" };
    if (!slot) return { ok: false, code: "DAY_SLOT_MISSING" };
    if (inline) return { ok: false, code: "INLINE_ALREADY_OPEN" };
    try {
      slot.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (_) {}
    const r = slot.getBoundingClientRect();
    const visible = r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    if (!visible) return { ok: false, code: "DAY_SLOT_NOT_VISIBLE" };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    const covered = !(topEl === slot || (topEl && slot.contains(topEl)));
    if (covered) return { ok: false, code: "DAY_SLOT_COVERED" };
    const listenersOk = slot.getAttribute("data-iu-cal-slot-empty") != null;
    if (!listenersOk) return { ok: false, code: "LISTENER_NOT_READY" };
    const hour = parseInt(String(slot.getAttribute("data-iu-cal-slot-empty") || ""), 10);
    return {
      ok: true,
      hour: Number.isFinite(hour) ? hour : null,
      slotCount: scroll.querySelectorAll("[data-iu-cal-slot-empty]").length,
    };
  });

  if (!probe.ok) {
    const map = {
      CALENDAR_ROOT_MISSING: FAIL.CALENDAR_ROOT_MISSING,
      DAY_SLOT_MISSING: FAIL.DAY_SLOT_MISSING,
      DAY_SLOT_NOT_VISIBLE: FAIL.DAY_SLOT_NOT_VISIBLE,
      DAY_SLOT_COVERED: FAIL.DAY_SLOT_COVERED,
      LISTENER_NOT_READY: FAIL.LISTENER_NOT_READY,
      INLINE_ALREADY_OPEN: FAIL.INLINE_ALREADY_OPEN,
    };
    throw failError(map[probe.code] || FAIL.DAY_SLOT_MISSING, probe.code);
  }

  // Stable slot count (re-render finished) — state poll, no sleep.
  await page.waitForFunction((n) => {
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    if (!scroll) return false;
    return scroll.querySelectorAll("[data-iu-cal-slot-empty]").length === n;
  }, probe.slotCount, { timeout: OVERLAY_WAIT_MS });

  return probe;
}

async function singleRealClickDaySlot(page) {
  const slot = page.locator("#iuCalendarSidePanelScroll [data-iu-cal-slot-empty]").first();
  await slot.waitFor({ state: "visible", timeout: INLINE_WAIT_MS });
  try {
    await slot.click({ timeout: INLINE_WAIT_MS, force: false });
  } catch (err) {
    throw failError(FAIL.CLICK_FAILED, err && err.message ? err.message.slice(0, 160) : "click");
  }
}

async function waitInlineRootVisible(page, expectedHour) {
  try {
    await page.waitForFunction(
      (hour) => {
        const root = document.querySelector("[data-iu-cal-inline-root]");
        if (!root) return false;
        const style = window.getComputedStyle(root);
        if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity || "1") === 0) {
          return false;
        }
        const title = root.querySelector('[data-iu-cal-inline-field="title"]');
        const toggle = root.querySelector("[data-iu-cal-inline-all-day]");
        if (!title || !toggle) return false;
        if (hour != null) {
          const timeBtn = root.querySelector("[data-iu-cal-inline-time-open]");
          const txt = timeBtn ? String(timeBtn.textContent || "") : "";
          const hh = String(hour).padStart(2, "0") + ":";
          if (txt && txt.indexOf(hh) < 0) return false;
        }
        return true;
      },
      expectedHour,
      { timeout: INLINE_WAIT_MS }
    );
  } catch (err) {
    const snap = await page.evaluate(() => {
      const root = document.querySelector("[data-iu-cal-inline-root]");
      if (!root) return { present: false, visible: false };
      const style = window.getComputedStyle(root);
      return {
        present: true,
        visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0,
      };
    }).catch(() => ({ present: false, visible: false }));
    if (snap.present && !snap.visible) throw failError(FAIL.INLINE_ROOT_HIDDEN, "present but hidden");
    throw failError(FAIL.INLINE_ROOT_MISSING, err && err.message ? err.message.slice(0, 120) : "timeout");
  }

  const after = await readInlineFormState(page);
  if (!after.hasRoot) throw failError(FAIL.INLINE_ROOT_MISSING, "post-wait");
  if (!after.visible) throw failError(FAIL.INLINE_ROOT_HIDDEN, "post-wait");
  if (!after.sideOpen) throw failError(FAIL.WRONG_DAY_OR_FORM, "side panel empty");
}

async function runAllDayToggleCycles(page, title, address, label) {
  await fillInlineTestFields(page, title, address);
  let prevOn = (await readInlineFormState(page)).allDayOn;
  for (let i = 0; i < TOGGLE_CYCLES; i++) {
    const expectOn = !prevOn;
    await page.locator("[data-iu-cal-inline-all-day]").click({ timeout: 10000, force: false });
    try {
      await waitToggleClass(page, expectOn);
    } catch (_) {
      throw failError(FAIL.ALL_DAY_TOGGLE_FAIL, label + " cycle " + (i + 1));
    }
    const st = await readInlineFormState(page);
    if (!st.hasRoot || !st.visible) throw failError(FAIL.INLINE_ROOT_MISSING, label + " cycle " + (i + 1));
    if (!st.sideOpen) throw failError(FAIL.WRONG_DAY_OR_FORM, label + " side empty");
    if (st.title !== title) throw failError(FAIL.WRONG_DAY_OR_FORM, label + " title lost");
    if (st.address !== address) throw failError(FAIL.WRONG_DAY_OR_FORM, label + " address lost");
    if (st.allDayOn !== expectOn) throw failError(FAIL.ALL_DAY_TOGGLE_FAIL, label + " state mismatch");
    prevOn = st.allDayOn;
  }
}

async function testDaySlotAllDayToggle(page) {
  const tracker = trackPageErrors(page);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(buildUrl(), { waitUntil: "load", timeout: 120000 });
    await assertDocumentReady(page);
    await openCalendarOverlay(page);
    await page.evaluate(() => {
      if (window.iuCalendarService && typeof window.iuCalendarService.calendarOpenTodayDayView === "function") {
        window.iuCalendarService.calendarOpenTodayDayView();
      }
    });
    await page.waitForFunction(() => {
      const scroll = document.getElementById("iuCalendarSidePanelScroll");
      return !!(scroll && scroll.querySelector("[data-iu-cal-slot-empty]"));
    }, { timeout: OVERLAY_WAIT_MS });

    const probe = await assertDaySlotReady(page, tracker);
    await singleRealClickDaySlot(page);
    if (tracker.first() && tracker.first().kind === "page") {
      throw failError(FAIL.PAGE_ERROR_AFTER_CLICK, tracker.first().message);
    }
    await waitInlineRootVisible(page, probe.hour);
    await runAllDayToggleCycles(page, "Test celodenni A", "Praha 1", "day-slot");

    const final = await readInlineFormState(page);
    if (!final.allDayOn) {
      await page.locator("[data-iu-cal-inline-all-day]").click({ timeout: 10000, force: false });
      await waitToggleClass(page, true);
    }
    await page.locator("[data-iu-cal-inline-save]").click({ timeout: 10000, force: false });
    await page.waitForFunction(() => {
      let found = false;
      document.querySelectorAll(".iu-calAllDayChip__title, [data-iu-cal-ev-wrap] .iu-calEvCard__title").forEach((el) => {
        if (String(el.textContent || "").trim() === "Test celodenni A") found = true;
      });
      return found;
    }, { timeout: INLINE_WAIT_MS });
    return "day-slot";
  } finally {
    tracker.dispose();
  }
}

async function assertMonthFabReady(page, tracker) {
  if (tracker.first()) {
    throw failError(FAIL.PAGE_ERROR_BEFORE_CLICK, tracker.first().message);
  }
  await assertDocumentReady(page);
  const probe = await page.evaluate(() => {
    const bar = document.getElementById("iuCalMonthActionBar");
    const fab = bar ? bar.querySelector("[data-iu-cal-month-fab]") : null;
    const inline = document.querySelector("[data-iu-cal-inline-root]");
    if (!bar || bar.hidden || !fab || fab.hidden) return { ok: false, code: "CALENDAR_ROOT_MISSING" };
    if (inline) return { ok: false, code: "INLINE_ALREADY_OPEN" };
    try {
      fab.scrollIntoView({ block: "center", inline: "nearest" });
    } catch (_) {}
    const r = fab.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight)) {
      return { ok: false, code: "DAY_SLOT_NOT_VISIBLE" };
    }
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    const covered = !(topEl === fab || (topEl && fab.contains(topEl)));
    if (covered) return { ok: false, code: "DAY_SLOT_COVERED" };
    return { ok: true };
  });
  if (!probe.ok) {
    const map = {
      CALENDAR_ROOT_MISSING: FAIL.CALENDAR_ROOT_MISSING,
      INLINE_ALREADY_OPEN: FAIL.INLINE_ALREADY_OPEN,
      DAY_SLOT_NOT_VISIBLE: FAIL.DAY_SLOT_NOT_VISIBLE,
      DAY_SLOT_COVERED: FAIL.DAY_SLOT_COVERED,
    };
    throw failError(map[probe.code] || FAIL.CALENDAR_ROOT_MISSING, probe.code);
  }
}

async function testMonthFabAllDayToggle(page) {
  const tracker = trackPageErrors(page);
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(buildUrl(), { waitUntil: "load", timeout: 120000 });
    await assertDocumentReady(page);
    await openCalendarOverlay(page);
    await page.evaluate(() => {
      const btn = document.querySelector('#iuCalendarOverlay [data-iu-cal-view="month"]');
      if (btn && typeof btn.click === "function") btn.click();
    });
    await page.waitForFunction(() => {
      const bar = document.getElementById("iuCalMonthActionBar");
      const fab = bar ? bar.querySelector("[data-iu-cal-month-fab]") : null;
      return !!(bar && !bar.hidden && fab && !fab.hidden);
    }, { timeout: OVERLAY_WAIT_MS });

    await assertMonthFabReady(page, tracker);
    try {
      await page.locator("#iuCalMonthActionBar [data-iu-cal-month-fab]").click({ timeout: 10000, force: false });
    } catch (err) {
      throw failError(FAIL.CLICK_FAILED, err && err.message ? err.message.slice(0, 160) : "fab click");
    }
    if (tracker.first() && tracker.first().kind === "page") {
      throw failError(FAIL.PAGE_ERROR_AFTER_CLICK, tracker.first().message);
    }
    await waitInlineRootVisible(page, null);
    await runAllDayToggleCycles(page, "Test celodenni B", "Brno 2", "month-fab");
    return "month-fab";
  } finally {
    tracker.dispose();
  }
}

async function runScenario(browser, ignorable, name, fn) {
  const context = await browser.newContext();
  let page = null;
  try {
    await installProofGuardNetworkStubs(context, ignorable);
    await installLocalDataProtectionAccepted(context);
    page = await context.newPage();
    return await fn(page);
  } finally {
    if (page) await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function main() {
  let server = null;
  let browser = null;
  let cleanupOk = true;
  const cleanupNotes = [];

  try {
    if (USE_LOCAL_SERVER) {
      const envPort = process.env.IU_GUARD_PORT ? parseInt(process.env.IU_GUARD_PORT, 10) : 0;
      BOUND_PORT = envPort > 0 ? envPort : await allocateEphemeralPort();
      const owned = startOwnedStaticServer(REPO, BOUND_PORT);
      server = owned.server;
      OWNER_TOKEN = owned.token;
      await owned.listenPromise;
      await waitForOwnedServerReady("127.0.0.1", BOUND_PORT, OWNER_TOKEN, SERVER_READY_WAIT_MS);
      BASE = `http://127.0.0.1:${BOUND_PORT}/projects/`;
    } else {
      BASE = String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/");
    }

    const ignorable = createIgnorableResourceTracker();
    browser = await chromium.launch({ headless: true });

    const passes = [];
    const failures = [];
    const runDay = !ONLY || ONLY === "day-slot";
    const runMonth = !ONLY || ONLY === "month-fab";

    if (runDay) {
      try {
        passes.push(await runScenario(browser, ignorable, "day-slot", testDaySlotAllDayToggle));
      } catch (err) {
        const code = err && err.code ? err.code : "UNKNOWN";
        failures.push(`day-slot: ${code}: ${err && err.message ? err.message : String(err)}`);
      }
    }
    if (runMonth) {
      try {
        passes.push(await runScenario(browser, ignorable, "month-fab", testMonthFabAllDayToggle));
      } catch (err) {
        const code = err && err.code ? err.code : "UNKNOWN";
        failures.push(`month-fab: ${code}: ${err && err.message ? err.message : String(err)}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          pass: failures.length === 0,
          base: BASE,
          port: BOUND_PORT || null,
          ownedServer: USE_LOCAL_SERVER,
          toggleCycles: TOGGLE_CYCLES,
          only: ONLY || null,
          delayReadyMs: DELAY_READY_MS,
          timeoutMs: INLINE_WAIT_MS,
          passes,
          failures,
          cleanupOk,
        },
        null,
        2
      )
    );
    process.exitCode = failures.length === 0 ? 0 : 1;
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          pass: false,
          base: BASE,
          port: BOUND_PORT || null,
          failures: [err && err.code ? err.code + ": " + err.message : String(err && err.message ? err.message : err)],
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  } finally {
    try {
      if (browser) await browser.close();
    } catch (e) {
      cleanupOk = false;
      cleanupNotes.push("browser_close");
    }
    try {
      await closeOwnedServer(server);
    } catch (e) {
      cleanupOk = false;
      cleanupNotes.push("server_close");
    }
    if (!cleanupOk) {
      console.error(JSON.stringify({ cleanupOk: false, codes: [FAIL.CLEANUP_FAILED], notes: cleanupNotes }));
    }
  }
}

main().catch((err) => {
  console.error(err && err.code ? err.code : "BROWSER_ERROR", err && err.message ? err.message : String(err));
  process.exit(1);
});
