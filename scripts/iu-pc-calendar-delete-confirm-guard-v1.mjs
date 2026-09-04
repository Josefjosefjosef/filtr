#!/usr/bin/env node
/**
 * PC calendar: Odstranit on saved event must open #iuCalDeleteConfirm above calendar
 * (including body.iu-myinfouzel-open z-index 12100). Shared delete path unchanged.
 * Run: npm run iu-pc-calendar-delete-confirm-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-pc-calendar-delete-confirm-guard
 */
import { createRequire } from "module";
import path from "path";
import fs from "fs";
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8917", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const SOURCE_ONLY = process.env.IU_GUARD_SOURCE_ONLY === "1";

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      /* GET: some static servers answer slowly / oddly on HEAD under CI load. */
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
  if (isProdHost(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

function assertSourceContract() {
  const appJs = readAppRuntimeSrc(REPO);
  const checks = [
    { id: "zindex_12350", ok: /\.iu-calDeleteConfirm\{[^}]*z-index:12350/.test(appJs) },
    {
      id: "myinfouzel_override",
      ok: /body\.iu-myinfouzel-open #iuCalDeleteConfirm:not\(\[hidden\]\)[^\{]*\{z-index:12350!important\}/.test(appJs),
    },
    { id: "open_confirm", ok: /function openCalDeleteConfirm\(/.test(appJs) },
    { id: "request_delete", ok: /function requestDeleteInlineEditor\(/.test(appJs) },
    { id: "delete_inline", ok: /async function deleteInlineEditor\(/.test(appJs) },
    {
      id: "escape_closes_confirm",
      ok: /iuCalDeleteConfirm[\s\S]{0,180}restoreCalendarScrollGuard\(/.test(appJs),
    },
    {
      id: "delete_btn_wires_request",
      ok: /data-iu-cal-inline-delete[\s\S]{0,120}requestDeleteInlineEditor\(/.test(appJs),
    },
  ];
  const failures = checks.filter((c) => !c.ok).map((c) => c.id);
  return { pass: failures.length === 0, failures, checks: checks.map((c) => c.id) };
}

async function waitForCalendarReady(page) {
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureCalendarOverlay === "function") {
      await window.__iuEnsureCalendarOverlay();
    }
  });
  await page.waitForFunction(
    () =>
      window.iuCalendarService &&
      !window.iuCalendarService.__iuCalendarLazyStub &&
      typeof window.iuCalendarService.openOverlay === "function",
    { timeout: 90000 }
  );
}

async function openCalendarOverlay(page) {
  await waitForCalendarReady(page);
  await page.evaluate(async () => {
    document.body.classList.add("iu-myinfouzel-open");
    if (window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function") {
      await window.iuCalendarService.openOverlay();
    }
  });
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuCalendarOverlay");
    return !!(ov && !ov.hidden && ov.getAttribute("aria-hidden") !== "true");
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
}

async function seedAndOpenTimedEvent(page, title) {
  const created = await page.evaluate(async (eventTitle) => {
    const svc = window.iuCalendarService;
    if (!svc || typeof svc.calendarCreateEvent !== "function") throw new Error("calendarCreateEvent missing");
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const iso =
      today.getFullYear() + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
    const res = await svc.calendarCreateEvent({
      title: eventTitle,
      date: iso,
      time: "14:30",
      address: "Praha",
      note: "pc-delete-confirm-guard",
      allDay: false,
    });
    if (!res || !res.ok || !res.event || !res.event.id) throw new Error("create_failed");
    if (typeof svc.calendarOpenTodayDayView === "function") svc.calendarOpenTodayDayView();
    return { id: String(res.event.id), iso };
  }, title);
  await page.waitForFunction(
    (eventTitle) => {
      const nodes = Array.from(document.querySelectorAll("[data-iu-cal-open-event], .iu-calEvCard__title"));
      return nodes.some((el) => String(el.textContent || "").includes(eventTitle));
    },
    title,
    { timeout: 30000 }
  );
  await page.evaluate((payload) => {
    const openEl = document.querySelector('[data-iu-cal-open-event="' + payload.id + '"]');
    if (openEl && openEl.click) {
      openEl.click();
      return;
    }
    const wraps = Array.from(document.querySelectorAll("[data-iu-cal-open-event]"));
    for (const el of wraps) {
      const wrap = el.closest("[data-iu-cal-ev-wrap]") || el;
      const titleEl = wrap.querySelector(".iu-calEvCard__title") || el;
      if (String(titleEl.textContent || "").includes(payload.title)) {
        el.click();
        return;
      }
    }
    throw new Error("open_target_missing");
  }, { id: created.id, title });
  await waitForVisibleInlineDelete(page);
}

async function waitForVisibleInlineDelete(page, timeoutMs = 30000) {
  await page.waitForFunction(
    () => {
      const ov = document.getElementById("iuCalendarOverlay");
      if (!ov || ov.hidden || ov.getAttribute("aria-hidden") === "true") return false;
      const roots = [
        ov.querySelector("#iuCalendarSidePanelScroll [data-iu-cal-inline-delete]"),
        ov.querySelector("#iuCalendarViewRoot [data-iu-cal-inline-delete]"),
        ov.querySelector("[data-iu-cal-inline-delete]"),
      ].filter(Boolean);
      for (const btn of roots) {
        const r = btn.getBoundingClientRect();
        const cs = window.getComputedStyle(btn);
        if (r.width < 8 || r.height < 8) continue;
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
        let hiddenParent = false;
        let p = btn.parentElement;
        while (p && p !== document.body) {
          if (p.hidden || p.getAttribute("aria-hidden") === "true") {
            hiddenParent = true;
            break;
          }
          const pcs = window.getComputedStyle(p);
          if (pcs.display === "none" || pcs.visibility === "hidden") {
            hiddenParent = true;
            break;
          }
          p = p.parentElement;
        }
        if (!hiddenParent) return true;
      }
      return false;
    },
    null,
    { timeout: timeoutMs }
  );
}

function visibleInlineDeleteLocator(page) {
  return page
    .locator(
      "#iuCalendarOverlay:not([hidden]) #iuCalendarSidePanelScroll [data-iu-cal-inline-delete], " +
        "#iuCalendarOverlay:not([hidden]) #iuCalendarViewRoot [data-iu-cal-inline-delete]"
    )
    .first();
}

async function clickVisibleInlineDelete(page, attemptLabel) {
  await waitForVisibleInlineDelete(page);
  const btn = visibleInlineDeleteLocator(page);
  await btn.scrollIntoViewIfNeeded();
  await btn.click({ timeout: 10000 });
  return attemptLabel;
}

async function confirmVisibleAboveCalendar(page) {
  return page.evaluate(() => {
    const dc = document.getElementById("iuCalDeleteConfirm");
    const ov = document.getElementById("iuCalendarOverlay");
    if (!dc || dc.hidden) return { ok: false, reason: "confirm_hidden" };
    const dcZ = parseInt(window.getComputedStyle(dc).zIndex, 10) || 0;
    const ovZ = ov ? parseInt(window.getComputedStyle(ov).zIndex, 10) || 0 : 0;
    const rect = dc.getBoundingClientRect();
    const yes = dc.querySelector("[data-iu-cal-delete-confirm-yes]");
    const cancel = dc.querySelector("[data-iu-cal-delete-confirm-cancel]");
    return {
      ok: dcZ > ovZ && rect.width > 40 && rect.height > 40 && !!yes && !!cancel,
      dcZ,
      ovZ,
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      myinfouzel: document.body.classList.contains("iu-myinfouzel-open"),
    };
  });
}

async function countEventsByTitle(page, title) {
  return page.evaluate((eventTitle) => {
    const svc = window.iuCalendarService;
    if (svc && typeof svc.calendarGetEventsSnapshot === "function") {
      return svc.calendarGetEventsSnapshot().filter((e) => e && String(e.title || "") === eventTitle).length;
    }
    let raw = localStorage.getItem("iu.calendar.store.v1") || "{}";
    let data = {};
    try {
      data = JSON.parse(raw);
    } catch (_) {
      data = {};
    }
    const events = Array.isArray(data.events) ? data.events : [];
    return events.filter((e) => e && String(e.title || "") === eventTitle).length;
  }, title);
}

async function testPcDeleteConfirmFlow(page) {
  const title = "PC Delete Confirm " + Date.now();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await openCalendarOverlay(page);
  await seedAndOpenTimedEvent(page, title);

  await clickVisibleInlineDelete(page, "open_confirm");
  await page.waitForFunction(() => {
    const dc = document.getElementById("iuCalDeleteConfirm");
    return !!(dc && !dc.hidden);
  }, { timeout: 10000 });

  const stack = await confirmVisibleAboveCalendar(page);
  if (!stack.ok) throw new Error("confirm_not_above_calendar:" + JSON.stringify(stack));

  await page.locator("[data-iu-cal-delete-confirm-cancel]").click({ timeout: 10000 });
  await page.waitForFunction(() => {
    const dc = document.getElementById("iuCalDeleteConfirm");
    return !!(dc && dc.hidden);
  }, { timeout: 10000 });
  const afterCancel = await countEventsByTitle(page, title);
  if (afterCancel < 1) throw new Error("cancel_removed_event");

  await clickVisibleInlineDelete(page, "reopen_confirm");
  await page.waitForFunction(() => {
    const dc = document.getElementById("iuCalDeleteConfirm");
    return !!(dc && !dc.hidden);
  }, { timeout: 10000 });
  await page.locator("[data-iu-cal-delete-confirm-yes]").click({ timeout: 10000 });
  await page.waitForTimeout(600);
  const afterYes = await countEventsByTitle(page, title);
  if (afterYes !== 0) throw new Error("confirm_did_not_delete");

  const goneUi = await page.evaluate((eventTitle) => {
    const texts = Array.from(document.querySelectorAll(".iu-calEvCard__title, .iu-calAllDayChip__title"));
    return !texts.some((el) => String(el.textContent || "").trim() === eventTitle);
  }, title);
  if (!goneUi) throw new Error("event_still_visible_after_delete");

  return "pc-delete-confirm";
}

async function main() {
  const source = assertSourceContract();
  if (!source.pass) {
    console.log(JSON.stringify({ pass: false, stage: "source", ...source }, null, 2));
    process.exit(1);
  }
  if (SOURCE_ONLY) {
    console.log(JSON.stringify({ pass: true, stage: "source", ...source }, null, 2));
    process.exit(0);
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
    serverProc.on("exit", (code) => {
      if (code && code !== 0 && !serverErr) serverErr = `static server exit ${code}`;
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

  const passes = ["source"];
  const failures = [];

  try {
    try {
      passes.push(await testPcDeleteConfirmFlow(page));
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      if (/not visible|Timeout|open_target_missing|confirm_not_above/i.test(msg)) {
        try {
          passes.push(await testPcDeleteConfirmFlow(page));
        } catch (retryErr) {
          failures.push(`pc-delete-confirm: ${retryErr && retryErr.message ? retryErr.message : String(retryErr)}`);
        }
      } else {
        failures.push(`pc-delete-confirm: ${msg}`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  console.log(
    JSON.stringify(
      {
        pass: failures.length === 0,
        base: BASE,
        source,
        passes,
        failures,
      },
      null,
      2
    )
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
