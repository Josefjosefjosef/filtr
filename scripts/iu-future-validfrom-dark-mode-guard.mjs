#!/usr/bin/env node
/**
 * Guard: FUTURE „Platí od“ red highlight + mobile/tablet evening Dark Mode
 * for Přehled dne timeline, filter toggles, info cards, and parcel results.
 *
 * - FUTURE items get .is-futureWarning; whole Platí od block is red
 * - ACTIVE items never keep the future class / red Platí od
 * - Onset boundary auto-refresh removes red without manual toggle
 * - Evening dark styles scoped to html.iu-time-evening (PC remaps away)
 * - Light CSS tokens (--iu-pd-card white etc.) remain the default
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "assets", "iu-info-system-core-v1.js");
const UI = path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js");
const CSS = path.join(ROOT, "assets", "iu-prehled-dne-v1.css");
const PARCEL_CSS = path.join(ROOT, "assets", "iu-silver-parcel-dashboard.css");
const APP_JS = path.join(ROOT, "assets", "app.js");
const INDEX = path.join(ROOT, "projects", "index.html");
const CACHE_BUST = "evening-theme-settings-v1-20260818";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function loadIU() {
  const sandbox = {
    console,
    localStorage: {
      _m: new Map(),
      getItem(k) {
        return this._m.has(k) ? this._m.get(k) : null;
      },
      setItem(k, v) {
        this._m.set(k, String(v));
      },
      removeItem(k) {
        this._m.delete(k);
      },
    },
    document: { documentElement: { classList: { toggle() {} } } },
    location: { pathname: "/projects/" },
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Math,
    Set,
    Map,
    Intl,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const src = fs.readFileSync(CORE, "utf8");
  const stripped = src.replace(/export \{[\s\S]*\}\s*;?\s*$/m, "").replace(/export default[\s\S]*$/m, "");
  vm.runInNewContext(stripped + "\nthis.__IU = IUInfoSystem;\n", sandbox, { filename: "core.js" });
  return sandbox.__IU;
}

function warning(overrides) {
  return Object.assign(
    {
      id: "ie-chmi-v2-future-red-1",
      title: "Vysoké teploty — Praha",
      url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_future.xml",
      sourceId: "chmi",
      sourceLabel: "ČHMÚ",
      status: "aktivni",
      eventType: "mimoradne",
      publishedAtSource: "2026-08-02T08:00:00+02:00",
      publishedAt: "2026-08-02T08:00:00+02:00",
      validFrom: "2026-08-02T16:00:00+02:00",
      validTo: "2026-08-02T22:00:00+02:00",
      timeConfidence: "high",
      sectionId: "pocasi",
      lane: "pocasi",
      region: { summary: "Praha", name: "Praha" },
      capV2: { badgeActive: true, msgType: "Alert", geo: { links: [] } },
    },
    overrides || {}
  );
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const core = fs.readFileSync(path.join(ROOT, "assets", "iu-info-system-core-v1.js"), "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const parcel = fs.readFileSync(PARCEL_CSS, "utf8");
  const app = fs.readFileSync(APP_JS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");

  ok("ui_future_class_bind", /is-futureWarning/.test(ui) && /timeline\.isFutureWarning/.test(ui), "bind");
  ok("ui_future_sentence_markup", /validFrom--futureSentence/.test(ui) && /Výstraha ČHMÚ platí od/.test(core), "sentence");
  ok("ui_boundary_refresh", /scheduleTimelineBoundaryRefresh/.test(ui) && /visibilitychange/.test(ui) && /pageshow/.test(ui), "auto");
  ok("ui_timer_clears_before_reschedule", /clearTimeout\(state\.timelineBoundaryTimer\)/.test(ui) && /state\.timelineBoundaryTimer\s*=\s*setTimeout/.test(ui), "timer clear");
  ok("ui_no_timeline_setInterval", !/setInterval\s*\(\s*\(\)\s*=>\s*\{[\s\S]{0,80}paint\(/.test(ui), "no interval paint");
  ok("ui_listeners_once", /if\s*\(\s*state\.timelineListenersBound\s*\)\s*return/.test(ui), "listeners once");
  ok("ui_no_manual_theme_toggle", !/toggleFuture|manualFuture|forceFutureRed/.test(ui), "manual");
  ok("freeze_manifest_bumped", /evening-theme-settings-v1-20260818/.test(fs.readFileSync(path.join(ROOT, "docs", "pre-aggregator-stable", "freeze-manifest.json"), "utf8")), "freeze");

  ok("css_future_red_block", /\.iuPrehledDne__item\.is-futureWarning\s+\.iuPrehledDne__validFrom/.test(css), "red block");
  ok("css_future_red_word", /\.is-futureWarning\s+\.iuPrehledDne__validFromWord/.test(css), "red word");
  ok("css_future_red_date", /\.is-futureWarning\s+\.iuPrehledDne__validFromDate/.test(css), "red date");
  ok("css_future_red_time", /\.is-futureWarning\s+\.iuPrehledDne__validFromTime/.test(css), "red time");
  ok("css_future_red_hex", /#dc2626/.test(css), "red hex");
  ok("css_evening_future_red", /html\.iu-time-evening[\s\S]{0,400}\.is-futureWarning[\s\S]{0,120}#f87171/.test(css) || /html\.iu-time-evening\s+\.iuPrehledDne__item\.is-futureWarning/.test(css), "evening red");

  ok("css_evening_vars", /html\.iu-time-evening\s*\{[\s\S]*--iu-pd-card:\s*#182235/.test(css), "vars");
  ok("css_evening_axis", /html\.iu-time-evening\s+\.iuPrehledDne__axis::before/.test(css), "axis");
  ok("css_evening_card", /html\.iu-time-evening\s+\.iuPrehledDne__card/.test(css), "card");
  ok("css_evening_toggle", /html\.iu-time-evening\s+\.iuPrehledDne\s+\.iuPdToggle/.test(css), "toggle");
  ok("css_evening_toggle_active", /html\.iu-time-evening\s+\.iuPrehledDne\s+\.iuPdToggle\.is-active/.test(css), "toggle active");
  ok("css_light_card_default", /:root\s*\{[\s\S]*--iu-pd-card:\s*#ffffff/.test(css), "light card");

  ok("index_info_cards_evening", /html\.iu-time-evening[\s\S]{0,200}iu-info-cards-mobile-tablet[\s\S]{0,120}#iuSilverCalendarSummaryCard/.test(index), "info cards");
  ok("index_no_inverted_evening_selector", !/\.iu-info-cards-mobile-tablet\s+\.silver-welcome-stack--evening/.test(index), "inverted");
  ok("app_paint_sync", /setAttribute\(\s*["']data-iu-silver-welcome-paint["']/.test(app) && /syncHtmlSilverTimeClass/.test(app), "paint sync");

  ok("parcel_evening_detail", /html\.iu-time-evening[\s\S]{0,120}iuSilverParcelWatch__detailLine/.test(parcel), "parcel detail");
  ok("parcel_evening_raw", /html\.iu-time-evening[\s\S]{0,120}iuSilverParcelWatch__detailRaw/.test(parcel), "parcel raw");
  ok("parcel_evening_btn", /html\.iu-time-evening[\s\S]{0,120}iuSilverParcelWatch__btnPrimary/.test(parcel), "parcel btn");

  ok("bust_ui", ui.includes(CACHE_BUST), "bust ui");
  ok("bust_index_js", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "bust js");
  ok("bust_index_css", index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "bust css");
}

function unitGate(IU) {
  const before = Date.parse("2026-08-02T12:00:00+02:00");
  const after = Date.parse("2026-08-02T16:05:00+02:00");
  const future = warning();

  const pre = IU.getEffectiveTimelinePresentation(future, before);
  ok("unit_pre_future", pre.isFutureWarning === true && pre.isActiveWarning === false, "flags");
  ok(
    "unit_pre_sentence",
    pre.secondaryValidFromLabel === "Výstraha ČHMÚ platí od 2. 8. 16:00 hod.",
    String(pre.secondaryValidFromLabel)
  );
  ok("unit_pre_no_split_date", pre.secondaryValidFromDate == null, String(pre.secondaryValidFromDate));
  ok("unit_pre_no_split_time", pre.secondaryValidFromTime == null, String(pre.secondaryValidFromTime));

  const post = IU.getEffectiveTimelinePresentation(future, after);
  ok("unit_post_active", post.isActiveWarning === true && post.isFutureWarning === false, "after onset");
  ok("unit_post_no_valid_from_label", !post.secondaryValidFromLabel, String(post.secondaryValidFromLabel));

  const boundary = IU.nextTimelineBoundaryMs([future], before);
  ok("unit_boundary_onset", boundary === Date.parse("2026-08-02T16:00:00+02:00"), String(boundary));

  // Deterministic class decision mirrors UI template (no real wait).
  const clsBefore = pre.isFutureWarning ? " is-futureWarning" : "";
  const clsAfter = post.isFutureWarning ? " is-futureWarning" : "";
  ok("unit_class_before", clsBefore === " is-futureWarning", clsBefore);
  ok("unit_class_after_cleared", clsAfter === "", JSON.stringify(clsAfter));
  ok("unit_at_onset_active", IU.getChmiWarningLifecycleStatus(future, Date.parse("2026-08-02T16:00:00+02:00")) === "ACTIVE", "onset");
  ok(
    "unit_at_onset_not_future",
    IU.getEffectiveTimelinePresentation(future, Date.parse("2026-08-02T16:00:00+02:00")).isFutureWarning === false,
    "onset future flag"
  );

  // Rolled ACTIVE must NEVER show the future-only sentence.
  const rolled = warning({
    id: "ie-chmi-v2-rolled",
    publishedAtSource: "2026-08-01T10:00:00+02:00",
    publishedAt: "2026-08-01T10:00:00+02:00",
    validFrom: "2026-08-01T10:00:00+02:00",
    validTo: "2026-08-02T22:00:00+02:00",
  });
  const rolledSnap = IU.getEffectiveTimelinePresentation(rolled, before);
  ok("unit_rolled_active", rolledSnap.isActiveWarning === true, "rolled active");
  ok("unit_rolled_not_future", rolledSnap.isFutureWarning === false, "rolled not future");
  ok("unit_rolled_no_future_sentence", !rolledSnap.secondaryValidFromLabel, String(rolledSnap.secondaryValidFromLabel));
}

function main() {
  staticGate();
  const IU = loadIU();
  ok("iu_loaded", !!(IU && typeof IU.getEffectiveTimelinePresentation === "function"), "load");
  if (IU && typeof IU.getEffectiveTimelinePresentation === "function") unitGate(IU);
  if (fails.length) {
    console.error("[iu-future-validfrom-dark-mode-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-future-validfrom-dark-mode-guard] OK");
}

main();
