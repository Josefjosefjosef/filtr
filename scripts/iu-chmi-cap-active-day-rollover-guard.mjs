#!/usr/bin/env node
/**
 * Guard: CHMI CAP lifecycle (ACTIVE/FUTURE/INACTIVE/CANCELLED) + timeline rollover + AKTIVNÍ badge.
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
const INDEX = path.join(ROOT, "projects", "index.html");
const CACHE_BUST = "heavy-feed-shell-first-v1-20260809";

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
      id: "ie-chmi-v2-roll-1",
      title: "Vysoké teploty — Praha a dalších 191 oblastí",
      url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_roll.xml?hid=roll-1",
      sourceId: "chmi",
      sourceLabel: "ČHMÚ",
      status: "aktivni",
      eventType: "mimoradne",
      publishedAtSource: "2026-07-29T10:54:00+02:00",
      publishedAt: "2026-07-29T10:54:00+02:00",
      validFrom: "2026-07-29T10:54:00+02:00",
      validTo: "2026-07-30T20:00:00+02:00",
      timeConfidence: "high",
      sectionId: "pocasi",
      lane: "pocasi",
      region: { summary: "Praha a dalších 191 oblastí", name: "Praha" },
      capV2: {
        badgeActive: true,
        msgType: "Update",
        geo: {
          links: [
            { orpName: "Praha", okresName: "Hlavní město Praha", krajName: "Hlavní město Praha" },
            { orpName: "Hradec Králové", okresName: "Hradec Králové", krajName: "Královéhradecký kraj" },
          ],
        },
      },
    },
    overrides || {}
  );
}

function article(overrides) {
  return Object.assign(
    {
      id: "ie-article-1",
      title: "Běžný článek",
      url: "https://example.test/a",
      sourceId: "ctk",
      sourceLabel: "ČTK",
      status: "publikovano",
      publishedAtSource: "2026-07-29T18:00:00+02:00",
      publishedAt: "2026-07-29T18:00:00+02:00",
      timeConfidence: "high",
      sectionId: "cesko-svet",
      lane: "ostatni",
    },
    overrides || {}
  );
}

function staticGate() {
  const ui = fs.readFileSync(UI, "utf8");
  const core = fs.readFileSync(CORE, "utf8");
  const css = fs.readFileSync(CSS, "utf8");
  const index = fs.readFileSync(INDEX, "utf8");
  ok("core_fn", /function getEffectiveTimelinePresentation/.test(core), "fn");
  ok("core_lifecycle", /function getChmiWarningLifecycleStatus/.test(core), "lifecycle");
  ok("core_active", /function isCurrentlyActiveChmiWarning/.test(core), "active");
  ok("core_public", /function isPublicFeedChmiWarning/.test(core), "public");
  ok("core_prague", /Europe\/Prague/.test(core), "tz");
  ok(
    "core_public_active_future",
    /isChmiCapWarning\(ev\) && !isPublicFeedChmiWarning\(ev, now\)/.test(core),
    "filter"
  );
  ok("core_no_assign_timeline", !/item\.timelineAt\s*=/.test(core), "mutate");
  ok("ui_uses_presentation", /getEffectiveTimelinePresentation\(ev/.test(ui), "ui");
  ok("ui_active_pill", /AKTIVNÍ VÝSTRAHA/.test(ui), "pill");
  ok("ui_active_uses_isActive", /timeline\.isActiveWarning/.test(ui), "pill cond");
  ok("ui_source_prefix", /Zdroj:\s*"/.test(ui) || /"Zdroj: "/.test(ui), "source");
  ok("ui_region_dedupe", /regionPill/.test(ui) && /title\.indexOf\(region\)/.test(ui), "dedupe");
  ok("ui_issued", /iuPrehledDne__issued/.test(ui), "issued");
  ok("ui_issued_split", /iuPrehledDne__issuedWord/.test(ui) && /iuPrehledDne__issuedDate/.test(ui), "issued split");
  ok("ui_valid_from", /iuPrehledDne__validFrom/.test(ui), "validFrom ui");
  ok("ui_valid_from_word", /Platí od|platnost od/.test(ui) || /secondaryValidFromLabel/.test(ui), "validFrom label");
  ok("ui_future_class", /is-futureWarning/.test(ui) && /timeline\.isFutureWarning/.test(ui), "future class");
  ok("ui_issued_aktualizovano", /Aktualizováno|aktualizováno/i.test(ui), "aktualizovano parse");
  ok("ui_midnight_timer", /scheduleTimelineBoundaryRefresh/.test(ui), "timer");
  ok("ui_visibility", /visibilitychange/.test(ui), "vis");
  ok("ui_url_prefers_public_web", /vystrahy-cr\.chmi\.cz/.test(ui) && /chmiPublicDetailUrl\(ev\)/.test(ui), "url");
  ok("ui_rejects_cap_xml_click", /Never open CAP XML/.test(ui), "xml");
  ok("css_issued", /\.iuPrehledDne__issued/.test(css), "css issued");
  ok("css_valid_from", /\.iuPrehledDne__validFrom/.test(css), "css validFrom");
  ok("css_future_red", /\.is-futureWarning\s+\.iuPrehledDne__validFrom/.test(css) && /#dc2626/.test(css), "future red");
  ok("css_future_red_parts", /\.is-futureWarning\s+\.iuPrehledDne__validFromWord/.test(css) && /\.is-futureWarning\s+\.iuPrehledDne__validFromDate/.test(css) && /\.is-futureWarning\s+\.iuPrehledDne__validFromTime/.test(css), "future red parts");
  ok("css_evening_timeline", /html\.iu-time-evening\s+\.iuPrehledDne__axis::before/.test(css), "evening axis");
  ok("css_evening_toggle", /html\.iu-time-evening\s+\.iuPdToggle/.test(css), "evening toggle");
  ok("css_evening_card", /html\.iu-time-evening\s+\.iuPrehledDne__card/.test(css), "evening card");
  ok("css_active", /\.iuPdCard__pill--active/.test(css), "css active");
  ok("bust_ui", ui.includes(CACHE_BUST), "bust ui");
  ok("bust_index", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "bust index");
  ok("bust_css", index.includes("iu-prehled-dne-v1.css?v=" + CACHE_BUST), "bust css");
}

function unitGate(IU) {
  const nowSameDay = Date.parse("2026-07-30T12:00:00+02:00");
  const nowMorning = Date.parse("2026-07-30T09:00:00+02:00");
  const nowDay3 = Date.parse("2026-07-31T11:00:00+02:00");

  // A: issued and active today — green badge
  const todayW = warning({
    publishedAtSource: "2026-07-30T10:54:00+02:00",
    publishedAt: "2026-07-30T10:54:00+02:00",
    validFrom: "2026-07-30T10:54:00+02:00",
    validTo: "2026-07-30T20:00:00+02:00",
  });
  const snapA = JSON.stringify(todayW);
  const a = IU.getEffectiveTimelinePresentation(todayW, nowSameDay);
  ok("A_lifecycle", IU.getChmiWarningLifecycleStatus(todayW, nowSameDay) === "ACTIVE", "status");
  ok("A_active", a.isActiveWarning === true, String(a.isActiveWarning));
  ok("A_not_future", a.isFutureWarning === false, String(a.isFutureWarning));
  ok("A_not_rolled", a.isRolledActiveWarning === false, String(a.isRolledActiveWarning));
  ok("A_primary", /30\.\s*7/.test(a.primaryDate), a.primaryDate);
  ok("A_time", !!a.primaryTime, a.primaryTime);
  ok("A_no_issued", !a.secondaryIssuedLabel, a.secondaryIssuedLabel);
  ok("A_no_valid_from_label", !a.secondaryValidFromLabel, String(a.secondaryValidFromLabel));
  ok("A_nomutate", JSON.stringify(todayW) === snapA, "mutated");
  ok(
    "A_filter_kept",
    IU.filterEvents([todayW], {}, { skipMemo: true, nowMs: nowSameDay }).length === 1,
    "dropped"
  );

  // B: issued yesterday, active today — rolled + green badge
  const yW = warning();
  const snapB = JSON.stringify(yW);
  const b = IU.getEffectiveTimelinePresentation(yW, nowMorning);
  ok("B_lifecycle", IU.getChmiWarningLifecycleStatus(yW, nowMorning) === "ACTIVE", "status");
  ok("B_active", b.isActiveWarning === true, String(b.isActiveWarning));
  ok("B_rolled", b.isRolledActiveWarning === true, String(b.isRolledActiveWarning));
  ok("B_primary_today", /30\.\s*7/.test(b.primaryDate), b.primaryDate);
  ok(
    "B_issued",
    /Aktualizováno/.test(b.secondaryIssuedLabel) && /29\.\s*7/.test(b.secondaryIssuedLabel),
    b.secondaryIssuedLabel
  );
  ok("B_issued_no_time", !/\d{1,2}:\d{2}/.test(b.secondaryIssuedLabel || ""), b.secondaryIssuedLabel);
  ok("B_no_fake_midnight_time", !b.primaryTime, String(b.primaryTime));
  const dayStart = IU.startOfPragueDayMs(nowMorning);
  ok("B_timeline_sod", Math.abs(b.timelineMs - dayStart) < 1000, String(b.timelineMs));
  ok("B_nomutate", JSON.stringify(yW) === snapB, "mutated");

  // C/D: article above rolled warning
  const art715 = article({
    id: "art-715",
    publishedAtSource: "2026-07-30T07:15:00+02:00",
    publishedAt: "2026-07-30T07:15:00+02:00",
  });
  const art940 = article({
    id: "art-940",
    publishedAtSource: "2026-07-30T09:40:00+02:00",
    publishedAt: "2026-07-30T09:40:00+02:00",
  });
  const sorted = IU.filterEvents([yW, art715, art940], {}, { skipMemo: true, nowMs: nowMorning });
  ok("C_order_len", sorted.length === 3, String(sorted.length));
  ok("C_first_940", sorted[0].id === "art-940", sorted[0] && sorted[0].id);
  ok("C_second_715", sorted[1].id === "art-715", sorted[1] && sorted[1].id);
  ok("C_warn_last", sorted[2].id === yW.id, sorted[2] && sorted[2].id);
  ok("C_url", sorted[2].url === "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_roll.xml?hid=roll-1", sorted[2] && sorted[2].url);

  // Open-ended until revoked stays ACTIVE without inventing validTo
  const openEnded = warning({
    id: "ie-chmi-v2-open-1",
    validTo: "",
    untilRevoked: true,
    publicUrl: "https://vystrahy-cr.chmi.cz/",
    url: "https://vystrahy-cr.chmi.cz/",
    capV2: { badgeActive: true, msgType: "Update", untilRevoked: true, openEnded: true, publicUrl: "https://vystrahy-cr.chmi.cz/", geo: { links: [] } },
  });
  ok(
    "open_ended_active",
    IU.getChmiWarningLifecycleStatus(openEnded, nowMorning) === "ACTIVE",
    "status"
  );
  ok(
    "open_ended_public_kept",
    IU.filterEvents([openEnded], {}, { skipMemo: true, nowMs: nowMorning }).length === 1,
    "dropped"
  );

  // E: third day
  const longW = warning({
    validTo: "2026-07-31T22:00:00+02:00",
  });
  const e = IU.getEffectiveTimelinePresentation(longW, nowDay3);
  ok("E_rolled", e.isRolledActiveWarning === true, String(e.isRolledActiveWarning));
  ok("E_primary_31", /31\.\s*7/.test(e.primaryDate), e.primaryDate);
  ok("E_issued_29", /29\.\s*7/.test(e.secondaryIssuedLabel), e.secondaryIssuedLabel);
  ok("E_issued_no_time", !/\d{1,2}:\d{2}/.test(e.secondaryIssuedLabel || ""), e.secondaryIssuedLabel);

  // F: ended before midnight
  const ended = warning({
    status: "ukonceno",
    validTo: "2026-07-29T22:00:00+02:00",
  });
  const f = IU.getEffectiveTimelinePresentation(ended, nowMorning);
  ok("F_lifecycle", IU.getChmiWarningLifecycleStatus(ended, nowMorning) === "INACTIVE", "status");
  ok("F_not_active", f.isActiveWarning === false, String(f.isActiveWarning));
  ok("F_not_rolled", f.isRolledActiveWarning === false, String(f.isRolledActiveWarning));

  // G: expires during day
  const mid = warning({ validTo: "2026-07-30T14:00:00+02:00" });
  const beforeExp = IU.getEffectiveTimelinePresentation(mid, Date.parse("2026-07-30T13:00:00+02:00"));
  const afterExp = IU.getEffectiveTimelinePresentation(mid, Date.parse("2026-07-30T15:00:00+02:00"));
  ok("G_before_active", beforeExp.isActiveWarning === true, String(beforeExp.isActiveWarning));
  ok("G_after_inactive", afterExp.isActiveWarning === false, String(afterExp.isActiveWarning));
  ok("G_after_lifecycle", IU.getChmiWarningLifecycleStatus(mid, Date.parse("2026-07-30T15:00:00+02:00")) === "INACTIVE", "status");
  ok("G_after_not_rolled", afterExp.isRolledActiveWarning === false, String(afterExp.isRolledActiveWarning));

  // H: future warning — stays in feed, no green badge, platnost od from canonical validFrom
  const future = warning({
    publishedAtSource: "2026-07-30T08:00:00+02:00",
    publishedAt: "2026-07-30T08:00:00+02:00",
    validFrom: "2026-07-30T14:00:00+02:00",
    validTo: "2026-07-30T20:00:00+02:00",
  });
  const h12 = IU.getEffectiveTimelinePresentation(future, Date.parse("2026-07-30T12:00:00+02:00"));
  const h15 = IU.getEffectiveTimelinePresentation(future, Date.parse("2026-07-30T15:00:00+02:00"));
  ok("H_lifecycle_future", IU.getChmiWarningLifecycleStatus(future, Date.parse("2026-07-30T12:00:00+02:00")) === "FUTURE", "status");
  ok("H_before_inactive", h12.isActiveWarning === false, String(h12.isActiveWarning));
  ok("H_before_future", h12.isFutureWarning === true, String(h12.isFutureWarning));
  ok("H_before_not_rolled", h12.isRolledActiveWarning === false, String(h12.isRolledActiveWarning));
  ok("H_valid_from_label", h12.secondaryValidFromLabel === "Výstraha ČHMÚ platí od 30. 7. 14:00 hod.", String(h12.secondaryValidFromLabel));
  ok("H_valid_from_same_day_date", h12.secondaryValidFromDate == null, String(h12.secondaryValidFromDate));
  ok("H_valid_from_same_day_time", h12.secondaryValidFromTime == null, String(h12.secondaryValidFromTime));
  ok("H_after_active", h15.isActiveWarning === true, String(h15.isActiveWarning));
  ok("H_after_not_future", h15.isFutureWarning === false, String(h15.isFutureWarning));
  // ACTIVE primary clock = official validFrom (14:00), not CAP sent (08:00).
  ok("H_after_primary_validFrom", h15.primaryTime === "14:00", String(h15.primaryTime));
  ok(
    "H_after_issued_label",
    /Aktualizováno\s*8:00|Aktualizováno\s*08:00/.test(String(h15.secondaryIssuedLabel || "")),
    String(h15.secondaryIssuedLabel)
  );
  ok("H_same_id", future.id === "ie-chmi-v2-roll-1", future.id);

  // H1b: 11:25 onset vs 11:29 CAP sent — public primary must be 11:25
  const heatSent = warning({
    id: "ie-chmi-v2-heat-1125",
    publishedAtSource: "2026-07-31T11:29:00+02:00",
    publishedAt: "2026-07-31T11:29:00+02:00",
    validFrom: "2026-07-31T11:25:00+02:00",
    validTo: "2026-08-01T00:00:00+02:00",
    firstSeenByInfoUzel: "2026-07-31T12:00:00.000Z",
    sortAt: "2026-07-31T11:29:00+02:00",
  });
  const heatT = IU.getEffectiveTimelinePresentation(heatSent, Date.parse("2026-07-31T12:00:00+02:00"));
  ok("H1b_active", heatT.isActiveWarning === true, String(heatT.isActiveWarning));
  ok("H1b_primary_1125", heatT.primaryTime === "11:25", String(heatT.primaryTime));
  ok("H1b_not_1129", heatT.primaryTime !== "11:29", String(heatT.primaryTime));
  ok(
    "H1b_issued_1129",
    /Aktualizováno\s*11:29/.test(String(heatT.secondaryIssuedLabel || "")),
    String(heatT.secondaryIssuedLabel)
  );
  ok("H1b_no_ingest_clock", !/12:00/.test(String(heatT.primaryTime || "") + String(heatT.secondaryIssuedLabel || "")), "ingest");

  // H2: future next day — date + time under platnost od
  const futureNext = warning({
    id: "ie-chmi-v2-future-next",
    publishedAtSource: "2026-07-30T13:16:00+02:00",
    publishedAt: "2026-07-30T13:16:00+02:00",
    validFrom: "2026-07-31T12:00:00+02:00",
    validTo: "2026-08-01T00:00:00+02:00",
  });
  const hn = IU.getEffectiveTimelinePresentation(futureNext, Date.parse("2026-07-30T14:00:00+02:00"));
  ok("H2_future", hn.isFutureWarning === true && hn.isActiveWarning === false, "flags");
  ok("H2_valid_from_label", hn.secondaryValidFromLabel === "Výstraha ČHMÚ platí od 31. 7. 12:00 hod.", String(hn.secondaryValidFromLabel));
  ok("H2_valid_from_date", hn.secondaryValidFromDate == null, String(hn.secondaryValidFromDate));
  ok("H2_valid_from_time", hn.secondaryValidFromTime == null, String(hn.secondaryValidFromTime));

  // H3: future with date-only validFrom — default clock to 00:00 hod. in the sentence
  const futureDateOnly = warning({
    id: "ie-chmi-v2-future-date",
    publishedAtSource: "2026-07-30T08:00:00+02:00",
    publishedAt: "2026-07-30T08:00:00+02:00",
    validFrom: "2026-07-31",
    validTo: "2026-08-02T00:00:00+02:00",
  });
  const hd = IU.getEffectiveTimelinePresentation(futureDateOnly, Date.parse("2026-07-30T12:00:00+02:00"));
  ok("H3_future", hd.isFutureWarning === true, String(hd.isFutureWarning));
  ok("H3_label", hd.secondaryValidFromLabel === "Výstraha ČHMÚ platí od 31. 7. 00:00 hod.", String(hd.secondaryValidFromLabel));
  ok("H3_date", hd.secondaryValidFromDate == null, String(hd.secondaryValidFromDate));
  ok("H3_no_time", hd.secondaryValidFromTime == null, String(hd.secondaryValidFromTime));

  // H4: future without reliable validFrom — may stay in feed, no platnost od
  const futureNoVf = warning({
    id: "ie-chmi-v2-future-novf",
    publishedAtSource: "2026-07-30T08:00:00+02:00",
    publishedAt: "2026-07-30T08:00:00+02:00",
    validFrom: "",
    validTo: "2026-07-30T20:00:00+02:00",
  });
  // Missing validFrom + validTo in future window ⇒ ACTIVE (already started unknown onset)
  ok(
    "H4_missing_vf_is_active",
    IU.getChmiWarningLifecycleStatus(futureNoVf, Date.parse("2026-07-30T12:00:00+02:00")) === "ACTIVE",
    "status"
  );

  // I: Cancel
  const cancel = warning({ status: "zruseno", capV2: { badgeActive: false, msgType: "Cancel", geo: { links: [] } } });
  const i = IU.getEffectiveTimelinePresentation(cancel, nowMorning);
  ok("I_lifecycle", IU.getChmiWarningLifecycleStatus(cancel, nowMorning) === "CANCELLED", "status");
  ok("I_inactive", i.isActiveWarning === false, String(i.isActiveWarning));
  ok("I_not_rolled", i.isRolledActiveWarning === false, String(i.isRolledActiveWarning));
  ok(
    "I_filter_hides_cancel",
    IU.filterEvents([cancel], {}, { skipMemo: true, nowMs: nowMorning }).length === 0,
    "cancel visible"
  );

  // Public feed: ACTIVE + FUTURE
  ok(
    "F_filter_hides_ended",
    IU.filterEvents([ended], {}, { skipMemo: true, nowMs: nowMorning }).length === 0,
    "ended visible"
  );
  ok(
    "G_filter_hides_after_expiry",
    IU.filterEvents([mid], {}, { skipMemo: true, nowMs: Date.parse("2026-07-30T15:00:00+02:00") }).length === 0,
    "expired visible"
  );
  ok(
    "G_filter_keeps_before_expiry",
    IU.filterEvents([mid], {}, { skipMemo: true, nowMs: Date.parse("2026-07-30T13:00:00+02:00") }).length === 1,
    "active hidden"
  );
  ok(
    "H_filter_keeps_future",
    IU.filterEvents([future], {}, { skipMemo: true, nowMs: Date.parse("2026-07-30T12:00:00+02:00") }).length === 1,
    "future hidden"
  );
  ok(
    "H_filter_keeps_after_onset",
    IU.filterEvents([future], {}, { skipMemo: true, nowMs: Date.parse("2026-07-30T15:00:00+02:00") }).length === 1,
    "onset hidden"
  );
  ok(
    "H2_filter_keeps",
    IU.filterEvents([futureNext], {}, { skipMemo: true, nowMs: Date.parse("2026-07-30T14:00:00+02:00") }).length === 1,
    "next-day future"
  );

  // N: ordinary article does not roll / no AKTIVNÍ
  const artOld = article();
  ok(
    "N_article_kept",
    IU.filterEvents([artOld], {}, { skipMemo: true, nowMs: nowMorning }).length === 1,
    "article dropped"
  );
  const n = IU.getEffectiveTimelinePresentation(artOld, nowMorning);
  ok("N_not_active", n.isActiveWarning === false, String(n.isActiveWarning));
  ok("N_not_rolled", n.isRolledActiveWarning === false, String(n.isRolledActiveWarning));
  ok("N_primary_29", /29\.\s*7/.test(n.primaryDate), n.primaryDate);

  // L: active older than 96h still kept by filter
  const oldActive = warning({
    publishedAtSource: "2026-07-20T10:00:00+02:00",
    publishedAt: "2026-07-20T10:00:00+02:00",
    validFrom: "2026-07-20T10:00:00+02:00",
    validTo: "2026-07-30T20:00:00+02:00",
  });
  const kept = IU.filterEvents([oldActive], {}, { skipMemo: true, nowMs: nowMorning });
  ok("L_kept", kept.length === 1, String(kept.length));

  // locality still works
  const loc = IU.getFilteredWarningLocationLabel(yW, {
    localities: [{ name: "Hradec Králové", level: "mesto" }],
  });
  ok("loc_hk", loc.startsWith("Hradec Králové"), loc);

  // boundary helper — future onset is a refresh boundary
  const nb = IU.nextTimelineBoundaryMs([future], Date.parse("2026-07-30T12:00:00+02:00"));
  ok("boundary_onset", nb === Date.parse("2026-07-30T14:00:00+02:00"), String(nb));
}

function main() {
  staticGate();
  const IU = loadIU();
  ok("iu_loaded", !!(IU && typeof IU.getEffectiveTimelinePresentation === "function"), "load");
  ok("iu_lifecycle", !!(IU && typeof IU.getChmiWarningLifecycleStatus === "function"), "lifecycle export");
  if (IU && typeof IU.getEffectiveTimelinePresentation === "function") unitGate(IU);
  if (fails.length) {
    console.error("[iu-chmi-cap-active-day-rollover-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-chmi-cap-active-day-rollover-guard] OK");
}

main();
