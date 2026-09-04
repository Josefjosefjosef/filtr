#!/usr/bin/env node
/**
 * Calendar: pinned all-day block + max 3 all-day events per day.
 * Run: npm run iu-calendar-allday-pinned-limit-guard
 *
 * Contracts:
 *  - Functional: at the all-day limit, a real user click on the toggle must NOT
 *    turn the toggle on; a non-empty limit notice must appear; form fields stay;
 *    no 4th all-day event is created; a second click must not bypass the limit.
 *  - Timing: notice is awaited via DOM state (not a fixed 150ms sleep). Soft
 *    diagnostic threshold records "too late"; hard wait timeout fails as
 *    notice_missing.
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  installLocalDataProtectionAccepted,
} from "./proofs/open_meteo_guard_stub.cjs";
import { readAppRuntimeSrc } from "./guards/iu-app-runtime-src.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8906", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const LIMIT_MSG = "Pro jeden den lze ulo┼żit maxim├íln─Ť 3 celodenn├ş ud├ílosti.";

/** Soft UX diagnostic: notice usually appears well under this (measured p90Ôëł90ms). */
const NOTICE_SOFT_MS = 750;
/** Hard wait for notice DOM after a real Playwright click. */
const NOTICE_WAIT_MS = 2500;
const VIEWPORT = { width: 1280, height: 720 };
const ARTIFACT_DIR =
  process.env.IU_CAL_ALLDAY_LIMIT_ARTIFACT_DIR ||
  path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu-calendar-allday-limit-guard");

function readStaticChecks() {
  const appJs = readAppRuntimeSrc(REPO);
  const indexHtml = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const appCss = fs.readFileSync(path.join(REPO, "assets", "app.css"), "utf8");
  const checks = [
    { id: "max_per_date", pass: /CAL_ALL_DAY_MAX_PER_DATE\s*=\s*3/.test(appJs) },
    { id: "limit_msg", pass: appJs.includes(LIMIT_MSG) },
    { id: "pinned_block", pass: /renderDayPinnedBlockHTML/.test(appJs) && /data-iu-cal-day-pinned-host/.test(appJs) },
    { id: "can_add_helper", pass: /function canAddAllDayForDate/.test(appJs) },
    { id: "mobile_pinned_host", pass: indexHtml.includes('data-iu-cal-day-pinned-host="1"') },
    { id: "desktop_pinned_host", pass: indexHtml.includes("iuCalendarSidePanelPinned") },
    { id: "css_pinned", pass: appCss.includes(".iu-calendar-day-pinned") },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, checks, fails };
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "GET", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("timeout", () => {
        try { req.destroy(); } catch {}
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.end();
    };
    tryOnce();
  });
}

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function ensureArtifactDir() {
  try {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  } catch (_) {}
}

async function saveFailArtifact(page, label, diag) {
  ensureArtifactDir();
  const stamp = Date.now();
  const base = path.join(ARTIFACT_DIR, "fail-" + label + "-" + stamp);
  const shot = base + ".png";
  const json = base + ".json";
  try {
    await page.screenshot({ path: shot, fullPage: true });
  } catch (_) {}
  try {
    fs.writeFileSync(json, JSON.stringify(diag, null, 2));
  } catch (_) {}
  return { screenshot: shot, diagPath: json };
}

function failError(code, detail, diag) {
  const err = new Error(code + (detail ? ": " + detail : ""));
  err.code = code;
  err.diag = diag || {};
  return err;
}

async function readToggleState(page) {
  return page.evaluate(() => {
    const t = document.querySelector("[data-iu-cal-inline-all-day]");
    if (!t) return { found: false, on: false, visible: false, disabled: true };
    const r = t.getBoundingClientRect();
    const style = window.getComputedStyle(t);
    return {
      found: true,
      on: t.classList.contains("is-on"),
      ariaChecked: t.getAttribute("aria-checked"),
      visible: r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none",
      disabled: !!(t.disabled || t.getAttribute("aria-disabled") === "true"),
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= (window.innerHeight || 0) + 1 && r.right <= (window.innerWidth || 0) + 1,
      box: { top: r.top, left: r.left, width: r.width, height: r.height },
    };
  });
}

async function readNotice(page) {
  return page.evaluate(() => {
    const n = document.querySelector("[data-iu-cal-inline-notice]");
    if (!n) return { found: false, text: "", visible: false };
    const r = n.getBoundingClientRect();
    const style = window.getComputedStyle(n);
    return {
      found: true,
      text: String(n.textContent || "").trim(),
      visible: r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none",
    };
  });
}

async function readFormTitle(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-iu-cal-inline-root]");
    const titleIn = root ? root.querySelector('[data-iu-cal-inline-field="title"]') : null;
    return titleIn ? String(titleIn.value || "") : "";
  });
}

async function countAllDay(page, dateIso) {
  return page.evaluate((iso) => {
    const svc = window.iuCalendarService;
    if (!svc) return -1;
    return svc.calendarGetEventsSnapshot().filter((ev) => ev.date === iso && ev.allDay).length;
  }, dateIso);
}

async function waitForVaultBootReady(page) {
  await page
    .waitForFunction(
      () => {
        const phase = window.__iuVaultBootPhase;
        if (phase === "locked" || phase === "unlocked") return true;
        if (document.documentElement.classList.contains("iu-vault-app-locked")) return true;
        return !document.documentElement.classList.contains("iu-vault-app-init");
      },
      { timeout: 30000 }
    )
    .catch(() => {});
  await page
    .waitForFunction(() => window.__iuVaultHydrationComplete === true, { timeout: 60000 })
    .catch(() => {});
  await page
    .waitForFunction(
      () =>
        window.__iuVaultKeyPathDurableReady === true &&
        window.iuVault &&
        typeof window.iuVault.durableSet === "function",
      { timeout: 60000 }
    )
    .catch(() => {});
}

async function clickReal(locator, label) {
  try {
    await locator.waitFor({ state: "attached", timeout: 15000 });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    throw failError("toggle_not_found", label + " ÔÇö " + msg, { label, error: msg });
  }
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await locator.page().waitForTimeout(300);
    }
    try {
      await locator.scrollIntoViewIfNeeded();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      lastErr = failError("click_not_performed", label + " scroll failed ÔÇö " + msg, { label, error: msg });
      continue;
    }
    let box = null;
    try {
      box = await locator.boundingBox();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      lastErr = failError("click_target_not_visible", label + " ÔÇö " + msg, { label, error: msg });
      continue;
    }
    if (!box || box.width < 1 || box.height < 1) {
      lastErr = failError("click_target_not_visible", label + " has no bounding box", { label, box });
      continue;
    }
    try {
      await locator.click({ timeout: 10000 });
      return { force: false, attempts: attempt + 1 };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      lastErr = failError("click_not_performed", label + " ÔÇö " + msg, { label, error: msg, forceAttempted: false });
    }
  }
  throw lastErr || failError("click_not_performed", label + " ÔÇö unknown click failure", { label });
}

/**
 * Open day view with 3 seeded all-day events and open inline form for a new timed event.
 */
async function prepareLimitScenario(page, opts) {
  const options = opts || {};
  await page.setViewportSize(VIEWPORT);
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("iu.calendar.store.v1");
      localStorage.removeItem("iu:vault:app-lock-active:v1");
    } catch (_) {}
    try {
      indexedDB.deleteDatabase("iu.calendar.idb");
    } catch (_) {}
  });
  const slowMs = parseInt(process.env.IU_GUARD_SLOW_MS || "0", 10);
  if (slowMs > 0) {
    await page.addInitScript((delay) => {
      const origRAF = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) =>
        origRAF((t) => {
          setTimeout(() => cb(t), Math.min(delay, 40));
        });
    }, slowMs);
    await page.context().route("**/*", async (route) => {
      await new Promise((r) => setTimeout(r, Math.min(slowMs, 25)));
      await route.continue();
    });
  }
  if (typeof options.afterInitScript === "function") {
    await options.afterInitScript(page);
  }
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureCalendarOverlay === "function") {
      await window.__iuEnsureCalendarOverlay();
    }
  });
  await page.waitForFunction(
    () =>
      window.iuCalendarService &&
      !window.iuCalendarService.__iuCalendarLazyStub &&
      typeof window.iuCalendarService.calendarCreateEvent === "function",
    { timeout: 90000 }
  );
  await waitForVaultBootReady(page);
  if (typeof options.afterReady === "function") {
    await options.afterReady(page);
  }
  const iso = todayIso();
  const seeded = await page.evaluate(async (dateIso) => {
    const svc = window.iuCalendarService;
    const results = [];
    async function waitKeyReady(ms) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (window.__iuVaultKeyPathDurableReady === true) return true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return window.__iuVaultKeyPathDurableReady === true;
    }
    await waitKeyReady(15000);
    for (let j = 0; j < 3; j += 1) {
      let res = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt > 0) await waitKeyReady(5000);
        res = await svc.calendarCreateEvent({
          date: dateIso,
          time: "00:00",
          allDay: true,
          title: "Guard AD " + (j + 1),
          note: "",
          address: "",
          type: "personal",
        });
        if (res && res.ok) break;
        if (res && res.reason === "all_day_limit") break;
        await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
      }
      results.push(res);
      if (!res || !res.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (window.iuVault && typeof window.iuVault.flushPendingWrites === "function") {
      await window.iuVault.flushPendingWrites();
    }
    let allDayCount = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      allDayCount = svc
        .calendarGetEventsSnapshot()
        .filter((ev) => ev.date === dateIso && ev.allDay).length;
      if (allDayCount === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return {
      results,
      allDayCount,
      dateIso,
      keyReady: window.__iuVaultKeyPathDurableReady === true,
      bootPhase: window.__iuVaultBootPhase || null,
      hydrationComplete: window.__iuVaultHydrationComplete === true,
    };
  }, iso);
  if (!seeded || !Array.isArray(seeded.results) || seeded.results.length !== 3 || seeded.results.some((r) => !r || !r.ok)) {
    throw failError("seed_failed", "create_results:" + JSON.stringify(seeded && seeded.results), { seeded });
  }
  await page
    .waitForFunction(
      (dateIso) => {
        const svc = window.iuCalendarService;
        if (!svc) return false;
        return (
          svc
            .calendarGetEventsSnapshot()
            .filter((ev) => ev.date === dateIso && ev.allDay).length === 3
        );
      },
      iso,
      { timeout: 15000 }
    )
    .catch(() => {
      throw failError("seed_failed", JSON.stringify(seeded), { seeded });
    });
  if (seeded.allDayCount !== 3) {
    throw failError("seed_failed", JSON.stringify(seeded), { seeded });
  }
  if (!options.skipApiFourthReject) {
    const fourth = await page.evaluate(async (dateIso) => {
      return window.iuCalendarService.calendarCreateEvent({
        date: dateIso,
        time: "00:00",
        allDay: true,
        title: "Guard AD 4",
        note: "",
        address: "",
        type: "personal",
      });
    }, iso);
    if (!fourth || fourth.ok !== false || fourth.reason !== "all_day_limit") {
      throw failError("fourth_event_not_rejected", JSON.stringify(fourth), { fourth, allDayCount: seeded.allDayCount });
    }
  }
  await page.evaluate(() => {
    window.iuCalendarService.calendarOpenTodayDayView();
  });
  await page.waitForFunction(() => {
    const pinned = document.getElementById("iuCalendarSidePanelPinned");
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    return !!(
      pinned &&
      scroll &&
      pinned.querySelector("[data-iu-cal-all-day-section]") &&
      scroll.querySelector("[data-iu-cal-hour-anchor]")
    );
  }, { timeout: 30000 });
  const pinnedAfterScroll = await page.evaluate(() => {
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    const pinned = document.getElementById("iuCalendarSidePanelPinned");
    if (!scroll || !pinned) return { ok: false, reason: "hosts missing" };
    scroll.scrollTop = scroll.scrollHeight;
    const section = pinned.querySelector("[data-iu-cal-all-day-section]");
    if (!section) return { ok: false, reason: "all-day section missing in pinned host" };
    const pr = pinned.getBoundingClientRect();
    const sr = section.getBoundingClientRect();
    const scrollStillHasHours = !!scroll.querySelector('[data-iu-cal-hour-anchor="15"]');
    const sectionInPinned = pinned.contains(section);
    const visible = sr.height > 8 && sr.top >= pr.top - 2 && sr.bottom <= pr.bottom + 2;
    return { ok: sectionInPinned && visible && scrollStillHasHours, sectionInPinned, visible, scrollStillHasHours };
  });
  if (!pinnedAfterScroll.ok) {
    throw failError("pinned_unstable", JSON.stringify(pinnedAfterScroll), { pinnedAfterScroll });
  }

  // Prefer a mid-day empty slot so a real click stays in viewport (hour 1 is often under the pinned header).
  const slot = page.locator('[data-iu-cal-hour-anchor="10"] [data-iu-cal-slot-empty], [data-iu-cal-slot-empty="10"]').first();
  const slotCount = await page.locator("[data-iu-cal-slot-empty]").count();
  if (slotCount < 1) {
    throw failError("toggle_or_slot_missing", "no empty hour slots", { slotCount });
  }
  const slotTarget = (await slot.count()) > 0 ? slot : page.locator("[data-iu-cal-slot-empty]").nth(Math.min(8, slotCount - 1));
  await page.evaluate(() => {
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    const hour = document.querySelector('[data-iu-cal-hour-anchor="10"]') || document.querySelector("[data-iu-cal-slot-empty]");
    if (scroll && hour) {
      const sr = scroll.getBoundingClientRect();
      const hr = hour.getBoundingClientRect();
      scroll.scrollTop += hr.top - sr.top - 40;
    }
  });
  await clickReal(slotTarget, "empty_hour_slot");
  await page.waitForSelector("[data-iu-cal-inline-root]", { timeout: 30000 });
  await page.evaluate(() => {
    const root = document.querySelector("[data-iu-cal-inline-root]");
    const titleIn = root.querySelector('[data-iu-cal-inline-field="title"]');
    titleIn.value = "Guard AD form 4";
    titleIn.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { iso, allDayCount: seeded.allDayCount };
}

async function waitForLimitNotice(page, clickedAt) {
  const noticeLoc = page.locator("[data-iu-cal-inline-notice]");
  try {
    await noticeLoc.waitFor({ state: "attached", timeout: NOTICE_WAIT_MS });
  } catch (_) {
    const snap = await readNotice(page);
    throw failError("notice_missing", snap.text || "(absent)", {
      noticeMs: Date.now() - clickedAt,
      notice: snap,
    });
  }
  try {
    await page.waitForFunction(
      (expected) => {
        const n = document.querySelector("[data-iu-cal-inline-notice]");
        if (!n) return false;
        const text = String(n.textContent || "").trim();
        const r = n.getBoundingClientRect();
        const style = window.getComputedStyle(n);
        const visible = r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        return visible && text === expected && text.length > 0;
      },
      LIMIT_MSG,
      { timeout: NOTICE_WAIT_MS }
    );
  } catch (_) {
    const snap = await readNotice(page);
    if (snap.found && !snap.text) {
      throw failError("notice_empty", "(empty)", { noticeMs: Date.now() - clickedAt, notice: snap });
    }
    throw failError("notice_missing", snap.text || "(absent)", {
      noticeMs: Date.now() - clickedAt,
      notice: snap,
    });
  }
  const noticeMs = Date.now() - clickedAt;
  const notice = await readNotice(page);
  return { noticeMs, notice };
}

async function testPinnedAndLimit(page) {
  const prepared = await prepareLimitScenario(page, {});
  const toggle = page.locator("[data-iu-cal-inline-all-day]");
  const before = await readToggleState(page);
  if (!before.found) throw failError("toggle_not_found", "all-day toggle missing", { before });
  if (!before.visible) throw failError("toggle_not_visible", JSON.stringify(before), { before });
  if (before.disabled) throw failError("toggle_not_enabled", JSON.stringify(before), { before });
  if (before.on) throw failError("toggle_unexpectedly_on", "toggle already on before click", { before });

  const clickedAt = Date.now();
  await clickReal(toggle, "all_day_toggle");
  const { noticeMs, notice } = await waitForLimitNotice(page, clickedAt);
  const after = await readToggleState(page);
  if (after.on) {
    const art = await saveFailArtifact(page, "toggle-on", { before, after, notice, noticeMs, prepared });
    throw failError("toggle_activated_at_limit", "toggle turned on despite full all-day limit", {
      before,
      after,
      notice,
      noticeMs,
      artifact: art,
    });
  }

  const formTitle = await readFormTitle(page);
  if (formTitle !== "Guard AD form 4") {
    throw failError("form_reset", "title=" + formTitle, { formTitle, notice, noticeMs, after });
  }

  const countAfter = await countAllDay(page, prepared.iso);
  if (countAfter !== 3) {
    throw failError("fourth_event_created", "allDayCount=" + countAfter, { countAfter, prepared, noticeMs });
  }

  // Second click must still refuse / keep notice ÔÇö no double-action bypass.
  const secondClickedAt = Date.now();
  await clickReal(page.locator("[data-iu-cal-inline-all-day]"), "all_day_toggle_second");
  const second = await waitForLimitNotice(page, secondClickedAt);
  const after2 = await readToggleState(page);
  const notice2 = second.notice;
  if (after2.on) {
    throw failError("toggle_activated_at_limit", "second click turned toggle on", { after2, notice2 });
  }
  if (notice2.text !== LIMIT_MSG) {
    throw failError("notice_missing", "after second click: " + notice2.text, { after2, notice2 });
  }
  const countAfter2 = await countAllDay(page, prepared.iso);
  if (countAfter2 !== 3) {
    throw failError("fourth_event_created", "after second click allDayCount=" + countAfter2, { countAfter2 });
  }

  const timingClass = noticeMs > NOTICE_SOFT_MS ? "notice_too_late_soft" : "ok";
  return {
    case: "pinned-and-limit",
    viewport: VIEWPORT,
    allDayCount: countAfter2,
    toggleBefore: before,
    toggleAfter: after,
    noticeText: notice.text,
    noticeMs,
    noticeSoftMs: NOTICE_SOFT_MS,
    noticeWaitMs: NOTICE_WAIT_MS,
    timingClass,
    clickMode: "playwright_locator.click",
    formTitle,
  };
}

async function runNegativeSelftests(browser) {
  const probes = [];
  const out = { suite: "selftest", id: "negative_probes", pass: false, detail: "", probes };

  async function withPage(fn) {
    const context = await browser.newContext();
    await installProofGuardNetworkStubs(context, createIgnorableResourceTracker());
    await installLocalDataProtectionAccepted(context);
    const page = await context.newPage();
    try {
      return await fn(page);
    } finally {
      await context.close().catch(() => {});
    }
  }

  // 1) Notice never appears ÔÇö swallow setCalInlineNotice.
  {
    let code = null;
    try {
      await withPage(async (page) => {
        await prepareLimitScenario(page, {});
        await page.evaluate(() => {
          const obs = new MutationObserver(() => {
            document.querySelectorAll("[data-iu-cal-inline-notice]").forEach((n) => n.remove());
          });
          obs.observe(document.documentElement, { childList: true, subtree: true });
          window.__iuCalGuardBlockNoticeObs = obs;
          const btn = document.querySelector("[data-iu-cal-inline-all-day]");
          if (!btn) return;
          btn.addEventListener(
            "click",
            (ev) => {
              ev.stopImmediatePropagation();
              ev.preventDefault();
            },
            true
          );
        });
        const toggle = page.locator("[data-iu-cal-inline-all-day]");
        const t0 = Date.now();
        await clickReal(toggle, "selftest_block_notice");
        await waitForLimitNotice(page, t0);
      });
    } catch (err) {
      code = err && err.code ? err.code : "other";
    }
    probes.push({
      id: "notice_never_appears",
      expect: "notice_missing",
      got: code,
      pass: code === "notice_missing",
    });
  }

  // 2) Notice stays empty ÔÇö inject empty notice node and block real notice text.
  {
    let code = null;
    try {
      await withPage(async (page) => {
        await prepareLimitScenario(page, {});
        await page.evaluate(() => {
          const btn = document.querySelector("[data-iu-cal-inline-all-day]");
          if (!btn) return;
          btn.addEventListener(
            "click",
            (ev) => {
              ev.stopImmediatePropagation();
              ev.preventDefault();
              document.querySelectorAll("[data-iu-cal-inline-notice]").forEach((n) => n.remove());
              const root = document.querySelector("[data-iu-cal-inline-root]");
              if (!root) return;
              const n = document.createElement("div");
              n.className = "iu-calInline__notice";
              n.setAttribute("role", "alert");
              n.setAttribute("data-iu-cal-inline-notice", "1");
              n.textContent = "";
              root.insertBefore(n, root.firstChild);
            },
            true
          );
        });
        const toggle = page.locator("[data-iu-cal-inline-all-day]");
        const t0 = Date.now();
        await clickReal(toggle, "selftest_empty_notice");
        await waitForLimitNotice(page, t0);
      });
    } catch (err) {
      code = err && err.code ? err.code : "other";
    }
    probes.push({
      id: "notice_stays_empty",
      expect: "notice_empty|notice_missing",
      got: code,
      pass: code === "notice_empty" || code === "notice_missing",
    });
  }

  // 3) Toggle activates despite limit.
  {
    let code = null;
    try {
      await withPage(async (page) => {
        await prepareLimitScenario(page, {});
        await page.evaluate(() => {
          const btn = document.querySelector("[data-iu-cal-inline-all-day]");
          if (!btn) return;
          btn.addEventListener(
            "click",
            (ev) => {
              ev.stopImmediatePropagation();
              ev.preventDefault();
              btn.classList.add("is-on");
              btn.setAttribute("aria-checked", "true");
              const root = document.querySelector("[data-iu-cal-inline-root]");
              if (!root) return;
              let n = root.querySelector("[data-iu-cal-inline-notice]");
              if (!n) {
                n = document.createElement("div");
                n.setAttribute("data-iu-cal-inline-notice", "1");
                n.setAttribute("role", "alert");
                root.insertBefore(n, root.firstChild);
              }
              n.textContent = "Pro jeden den lze ulo┼żit maxim├íln─Ť 3 celodenn├ş ud├ílosti.";
            },
            true
          );
        });
        await testPinnedAndLimitFromPrepared(page);
      });
    } catch (err) {
      code = err && err.code ? err.code : String(err && err.message ? err.message : err);
    }
    probes.push({
      id: "toggle_activates_at_limit",
      expect: "toggle_activated_at_limit",
      got: code,
      pass: code === "toggle_activated_at_limit" || String(code).indexOf("toggle_activated_at_limit") === 0,
    });
  }

  // 4) Fourth all-day event created ÔÇö monkeypatch snapshot count after toggle path.
  {
    let code = null;
    try {
      await withPage(async (page) => {
        const prepared = await prepareLimitScenario(page, {});
        await page.evaluate(() => {
          const svc = window.iuCalendarService;
          const origSnap = svc.calendarGetEventsSnapshot.bind(svc);
          window.__iuCalGuardOrigSnap = origSnap;
          svc.calendarGetEventsSnapshot = () => {
            const list = origSnap().slice();
            const iso = new Date();
            const dateIso =
              iso.getFullYear() +
              "-" +
              String(iso.getMonth() + 1).padStart(2, "0") +
              "-" +
              String(iso.getDate()).padStart(2, "0");
            list.push({
              id: "guard-fake-4",
              date: dateIso,
              time: "00:00",
              allDay: true,
              title: "Forced AD 4",
              note: "",
              address: "",
              type: "personal",
            });
            return list;
          };
        });
        const toggle = page.locator("[data-iu-cal-inline-all-day]");
        const t0 = Date.now();
        await clickReal(toggle, "selftest_fourth");
        await waitForLimitNotice(page, t0);
        const countAfter = await page.evaluate((iso) => {
          const svc = window.iuCalendarService;
          const snap = window.__iuCalGuardOrigSnap || svc.calendarGetEventsSnapshot.bind(svc);
          return snap().filter((ev) => ev.date === iso && ev.allDay).length;
        }, prepared.iso);
        if (countAfter !== 3) {
          throw failError("fourth_event_created", "allDayCount=" + countAfter, { countAfter });
        }
        code = "limit_enforced";
      });
    } catch (err) {
      code = err && err.code ? err.code : "other";
    }
    probes.push({
      id: "fourth_allday_created",
      expect: "limit_enforced",
      got: code,
      pass: code === "limit_enforced",
    });
  }

  // 5) Click never performed ÔÇö collapse toggle so Playwright cannot click it.
  {
    let code = null;
    try {
      await withPage(async (page) => {
        await prepareLimitScenario(page, {});
        await page.evaluate(() => {
          const btn = document.querySelector("[data-iu-cal-inline-all-day]");
          if (!btn) return;
          btn.style.width = "0px";
          btn.style.height = "0px";
          btn.style.overflow = "hidden";
          btn.style.opacity = "0";
          btn.setAttribute("aria-hidden", "true");
        });
        const before = await readToggleState(page);
        if (!before.visible) {
          throw failError("toggle_not_visible", JSON.stringify(before), { before });
        }
        const toggle = page.locator("[data-iu-cal-inline-all-day]");
        await clickReal(toggle, "selftest_zero_size_toggle");
      });
    } catch (err) {
      code = err && err.code ? err.code : "other";
    }
    probes.push({
      id: "click_not_performed",
      expect: "click_not_performed|click_target_not_visible|toggle_not_visible",
      got: code,
      pass:
        code === "click_not_performed" ||
        code === "click_target_not_visible" ||
        code === "toggle_not_visible",
    });
  }

  out.pass = probes.every((p) => p.pass);
  out.detail = out.pass ? "ok" : "negative_probe_missed_bite";
  if (!out.pass) {
    out.failed = probes.filter((p) => !p.pass).map((p) => p.id + ":" + p.got);
  }
  return out;
}

/** Continue limit assertions when form is already prepared (selftest helper). */
async function testPinnedAndLimitFromPrepared(page) {
  const toggle = page.locator("[data-iu-cal-inline-all-day]");
  const before = await readToggleState(page);
  const clickedAt = Date.now();
  await clickReal(toggle, "all_day_toggle");
  const { noticeMs, notice } = await waitForLimitNotice(page, clickedAt);
  const after = await readToggleState(page);
  if (after.on) {
    throw failError("toggle_activated_at_limit", "toggle on", { before, after, notice, noticeMs });
  }
  return { noticeMs, notice, after };
}

async function main() {
  const staticResult = readStaticChecks();
  if (!staticResult.pass) {
    console.log(JSON.stringify({ pass: false, static: staticResult, playwright: null }, null, 2));
    process.exit(1);
  }

  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    const serverScript = path.join(REPO, "server", "projects-static.mjs");
    serverProc = spawn(process.execPath, [serverScript], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let serverErr = "";
    serverProc.stderr.on("data", (c) => {
      serverErr += String(c);
    });
    try {
      await waitForPort("127.0.0.1", PORT, 90000);
    } catch (err) {
      if (serverErr) console.error(serverErr.trim());
      throw err;
    }
  }

  const ignorable = createIgnorableResourceTracker();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await installProofGuardNetworkStubs(context, ignorable);
  await installLocalDataProtectionAccepted(context);
  const page = await context.newPage();

  let pwPass = null;
  let pwFail = null;
  let pwDiag = null;
  let selftest = null;
  try {
    pwPass = await testPinnedAndLimit(page);
  } catch (err) {
    pwFail = err && err.message ? err.message : String(err);
    pwDiag = err && err.diag ? err.diag : { code: err && err.code };
    try {
      const art = await saveFailArtifact(page, "main", {
        error: pwFail,
        code: err && err.code,
        diag: pwDiag,
        viewport: VIEWPORT,
      });
      pwDiag.artifact = art;
    } catch (_) {}
  } finally {
    await context.close().catch(() => {});
  }

  try {
    selftest = await runNegativeSelftests(browser);
  } catch (err) {
    selftest = {
      suite: "selftest",
      id: "negative_probes",
      pass: false,
      detail: err && err.message ? err.message : String(err),
      probes: [],
    };
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  const pass = !pwFail && !!(selftest && selftest.pass);
  console.log(
    JSON.stringify(
      {
        pass,
        guard: "IU_CALENDAR_ALLDAY_PINNED_LIMIT_GUARD_V1",
        static: staticResult,
        playwright: pwFail
          ? { pass: false, error: pwFail, diag: pwDiag }
          : { pass: true, case: pwPass },
        selftest,
        noticeSoftMs: NOTICE_SOFT_MS,
        noticeWaitMs: NOTICE_WAIT_MS,
        artifactDir: ARTIFACT_DIR,
        ts: new Date().toISOString(),
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
