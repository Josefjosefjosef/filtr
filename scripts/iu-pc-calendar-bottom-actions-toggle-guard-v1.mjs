/**
 * PC calendar: bottom «Vyhledat událost» + «+ Přidat událost» stay visible while the
 * right side panel is open, and each button toggles its panel open/closed.
 *
 * Root cause: syncMonthYearActionBar hid the bar on desktop when
 * isCalDesktopSideFormOnly() was true (Add panel). Search lacked a PC toggle.
 *
 * Scope: desktop (≥1025) only — mobile/tablet contracts unchanged.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  pickGuardPort,
  startGuardStaticServer,
  stopGuardProcess,
} from "./guards/guard-playwright-lifecycle.mjs";
import { waitForVaultReady } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const CAL = fs.readFileSync(path.join(REPO, "assets", "iu-calendar-overlay-v1.js"), "utf8");
const FAILS = [];

function fail(id) {
  FAILS.push(id);
}

// Static: desktop branch must NOT hide bar via isCalDesktopSideFormOnly
const syncFn = CAL.match(/function syncMonthYearActionBar\s*\(\s*\)\s*\{[\s\S]{0,2200}?function syncMonthQuickAddFab/);
if (!syncFn) fail("static_syncMonthYearActionBar_missing");
else {
  const body = syncFn[0];
  if (/else\s*\{[\s\S]{0,280}!isCalDesktopSideFormOnly\s*\(/.test(body)) {
    fail("static_desktop_still_hides_on_sideFormOnly");
  }
  if (!/PC: bottom Search\/Add stay visible/.test(body) && !/!state\.mobileDayOverlayOpen\s*;/.test(body)) {
    /* soft: presence of desktop show without sideFormOnly is enough if comment drifts */
  }
  if (!/Mobile\/tablet: keep prior contract/.test(body) && !/!state\.searchOpen/.test(body)) {
    fail("static_mobile_hide_contract_missing");
  }
}

// Static: PC toggle for Add + Search
if (!/isCalDesktopTwoPanel\(\)\s*&&\s*isCalDesktopSideFormOnly\(\)/.test(CAL) || !/monthFab[\s\S]{0,500}closeDesktopSidePanel\s*\(/.test(CAL)) {
  fail("static_add_toggle_missing");
}
if (!/isCalDesktopTwoPanel\(\)\s*&&\s*state\.searchOpen/.test(CAL) || !/searchBtn[\s\S]{0,400}closeEventSearch\s*\(/.test(CAL)) {
  fail("static_search_toggle_missing");
}
if (!/PC: second click on \+ Přidat událost/.test(CAL)) fail("static_add_toggle_comment_missing");
if (!/PC: second click on Vyhledat událost/.test(CAL)) fail("static_search_toggle_comment_missing");
if (!/PC: bottom Search\/Add stay visible/.test(CAL)) fail("static_desktop_keep_visible_missing");
if (!/Mobile\/tablet: keep prior contract/.test(CAL)) fail("static_mobile_contract_comment_missing");


function barState(page) {
  return page.evaluate(() => {
    const bar = document.getElementById("iuCalMonthActionBar");
    const add = document.querySelector("#iuCalMonthActionBar [data-iu-cal-month-fab]");
    const search = document.querySelector("#iuCalMonthActionBar [data-iu-cal-search-open]");
    const side = document.getElementById("iuCalendarBridgeAside");
    const ov = document.getElementById("iuCalendarOverlay");
    const barCs = bar ? getComputedStyle(bar) : null;
    const visible = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && !el.hidden && el.getClientRects().length > 0;
    };
    return {
      barHiddenAttr: !!(bar && bar.hidden),
      barDisplay: barCs ? barCs.display : null,
      barVisible: visible(bar),
      addVisible: visible(add),
      searchVisible: visible(search),
      sidePanelOpenClass: !!(ov && ov.classList.contains("iu-calendarOverlay--sidePanelOpen")),
      sideAriaHidden: side ? side.getAttribute("aria-hidden") : null,
      sideHasForm: !!(side && side.querySelector("[data-iu-cal-inline-root]")),
      sideHasSearch: !!(side && side.querySelector("[data-iu-cal-side-search-root]")),
    };
  });
}

async function openCalendar(page) {
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
    null,
    { timeout: 90000 }
  );
  await page.evaluate(() => {
    window.iuCalendarService.openOverlay();
  });
  await page.waitForSelector("#iuCalendarOverlay:not([hidden])", { timeout: 30000 });
  await page.waitForSelector("#iuCalMonthActionBar:not([hidden])", { timeout: 30000 });
}

async function main() {
  const started = await startGuardStaticServer(pickGuardPort(9520, 400));
  const base = `http://127.0.0.1:${started.port}/projects/`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`${base}?nosw=1&cb=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitForVaultReady(page, 120000);
    await page.waitForFunction(() => window.__iuVaultHydrationComplete === true, null, { timeout: 90000 });
    await openCalendar(page);

    // A: both buttons visible
    let st = await barState(page);
    if (!st.addVisible || !st.searchVisible) fail(`A_buttons_missing add=${st.addVisible} search=${st.searchVisible}`);

    // B: open Add → side form + buttons still visible
    await page.locator("#iuCalMonthActionBar [data-iu-cal-month-fab]").click({ force: true });
    await page.waitForTimeout(250);
    st = await barState(page);
    if (!st.sideHasForm) fail("B_add_panel_missing");
    if (!st.sidePanelOpenClass) fail("B_sidePanelOpen_class_missing");
    if (!st.addVisible || !st.searchVisible) fail(`B_buttons_hidden add=${st.addVisible} search=${st.searchVisible}`);

    // C: toggle Add closed
    await page.locator("#iuCalMonthActionBar [data-iu-cal-month-fab]").click({ force: true });
    await page.waitForTimeout(250);
    st = await barState(page);
    if (st.sideHasForm) fail("C_add_panel_still_open");
    if (st.sidePanelOpenClass) fail("C_sidePanelOpen_still_on");
    if (!st.addVisible || !st.searchVisible) fail(`C_buttons_hidden add=${st.addVisible} search=${st.searchVisible}`);

    // D: open Search
    await page.locator("#iuCalMonthActionBar [data-iu-cal-search-open]").click({ force: true });
    await page.waitForTimeout(250);
    st = await barState(page);
    if (!st.sideHasSearch) fail("D_search_panel_missing");
    if (!st.addVisible || !st.searchVisible) fail(`D_buttons_hidden add=${st.addVisible} search=${st.searchVisible}`);

    // E: toggle Search closed
    await page.locator("#iuCalMonthActionBar [data-iu-cal-search-open]").click({ force: true });
    await page.waitForTimeout(250);
    st = await barState(page);
    if (st.sideHasSearch) fail("E_search_panel_still_open");
    if (!st.addVisible || !st.searchVisible) fail(`E_buttons_hidden add=${st.addVisible} search=${st.searchVisible}`);

    // F: Add → Search switch
    await page.locator("#iuCalMonthActionBar [data-iu-cal-month-fab]").click({ force: true });
    await page.waitForTimeout(200);
    await page.locator("#iuCalMonthActionBar [data-iu-cal-search-open]").click({ force: true });
    await page.waitForTimeout(250);
    st = await barState(page);
    if (st.sideHasForm) fail("F_form_still_open_after_search");
    if (!st.sideHasSearch) fail("F_search_not_open");
    if (!st.addVisible || !st.searchVisible) fail(`F_buttons_hidden add=${st.addVisible} search=${st.searchVisible}`);

    // G: close via X
    await page.locator("#iuCalendarOverlay [data-iu-cal-side-close]").first().click({ force: true });
    await page.waitForTimeout(250);
    st = await barState(page);
    if (st.sideHasSearch || st.sideHasForm) fail("G_panel_still_open_after_x");
    if (st.sidePanelOpenClass) fail("G_sidePanelOpen_after_x");
    if (!st.addVisible || !st.searchVisible) fail(`G_buttons_hidden add=${st.addVisible} search=${st.searchVisible}`);

    console.log(
      "IU_PC_CAL_BOTTOM_ACTIONS=" +
        JSON.stringify({
          addVisible: st.addVisible,
          searchVisible: st.searchVisible,
          sidePanelOpenClass: st.sidePanelOpenClass,
        })
    );
  } finally {
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
    await stopGuardProcess(started.proc);
  }

  if (FAILS.length) {
    console.error("IU_PC_CAL_BOTTOM_ACTIONS_FAIL=" + FAILS.join(","));
    process.exitCode = 1;
    return;
  }
  console.log("IU_PC_CAL_BOTTOM_ACTIONS_PASS=true");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
