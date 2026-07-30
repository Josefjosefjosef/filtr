#!/usr/bin/env node
/**
 * Guard: CHMI CAP active-day timeline rollover + AKTIVNÍ badge (display/sort only).
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
const CACHE_BUST = "info-system-v6-chmi-active-rollover-20260730";

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
      url: "https://vystrahy-cr.chmi.cz/",
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
  ok("core_active", /function isCurrentlyActiveChmiWarning/.test(core), "active");
  ok("core_prague", /Europe\/Prague/.test(core), "tz");
  ok("core_no_assign_timeline", !/item\.timelineAt\s*=/.test(core), "mutate");
  ok("ui_uses_presentation", /getEffectiveTimelinePresentation\(ev/.test(ui), "ui");
  ok("ui_active_pill", /AKTIVNÍ/.test(ui), "pill");
  ok("ui_issued", /iuPrehledDne__issued/.test(ui), "issued");
  ok("ui_midnight_timer", /scheduleTimelineBoundaryRefresh/.test(ui), "timer");
  ok("ui_visibility", /visibilitychange/.test(ui), "vis");
  ok("ui_url_unchanged", /chmiPublicDetailUrl\(ev\)/.test(ui) && /forced \|\| ev\.url/.test(ui), "url");
  ok("css_issued", /\.iuPrehledDne__issued/.test(css), "css issued");
  ok("css_active", /\.iuPdCard__pill--active/.test(css), "css active");
  ok("bust_ui", ui.includes(CACHE_BUST), "bust ui");
  ok("bust_index", index.includes("iu-prehled-dne-ui-v1.js?v=" + CACHE_BUST), "bust index");
}

function unitGate(IU) {
  const nowSameDay = Date.parse("2026-07-30T12:00:00+02:00");
  const nowMorning = Date.parse("2026-07-30T09:00:00+02:00");
  const nowDay3 = Date.parse("2026-07-31T11:00:00+02:00");
  const nowBefore = Date.parse("2026-07-30T12:00:00+02:00");

  // A: issued and active today
  const todayW = warning({
    publishedAtSource: "2026-07-30T10:54:00+02:00",
    publishedAt: "2026-07-30T10:54:00+02:00",
    validFrom: "2026-07-30T10:54:00+02:00",
    validTo: "2026-07-30T20:00:00+02:00",
  });
  const snapA = JSON.stringify(todayW);
  const a = IU.getEffectiveTimelinePresentation(todayW, nowSameDay);
  ok("A_active", a.isActiveWarning === true, String(a.isActiveWarning));
  ok("A_not_rolled", a.isRolledActiveWarning === false, String(a.isRolledActiveWarning));
  ok("A_primary", /30\.\s*7/.test(a.primaryDate), a.primaryDate);
  ok("A_time", !!a.primaryTime, a.primaryTime);
  ok("A_no_issued", !a.secondaryIssuedLabel, a.secondaryIssuedLabel);
  ok("A_nomutate", JSON.stringify(todayW) === snapA, "mutated");

  // B: issued yesterday, active today
  const yW = warning();
  const snapB = JSON.stringify(yW);
  const b = IU.getEffectiveTimelinePresentation(yW, nowMorning);
  ok("B_active", b.isActiveWarning === true, String(b.isActiveWarning));
  ok("B_rolled", b.isRolledActiveWarning === true, String(b.isRolledActiveWarning));
  ok("B_primary_today", /30\.\s*7/.test(b.primaryDate), b.primaryDate);
  ok("B_issued", /vydáno/.test(b.secondaryIssuedLabel) && /29\.\s*7/.test(b.secondaryIssuedLabel), b.secondaryIssuedLabel);
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
  ok("C_url", sorted[2].url === "https://vystrahy-cr.chmi.cz/", sorted[2] && sorted[2].url);

  // E: third day
  const longW = warning({
    validTo: "2026-07-31T22:00:00+02:00",
  });
  const e = IU.getEffectiveTimelinePresentation(longW, nowDay3);
  ok("E_rolled", e.isRolledActiveWarning === true, String(e.isRolledActiveWarning));
  ok("E_primary_31", /31\.\s*7/.test(e.primaryDate), e.primaryDate);
  ok("E_issued_29", /29\.\s*7/.test(e.secondaryIssuedLabel), e.secondaryIssuedLabel);

  // F: ended before midnight
  const ended = warning({
    status: "ukonceno",
    validTo: "2026-07-29T22:00:00+02:00",
  });
  const f = IU.getEffectiveTimelinePresentation(ended, nowMorning);
  ok("F_not_active", f.isActiveWarning === false, String(f.isActiveWarning));
  ok("F_not_rolled", f.isRolledActiveWarning === false, String(f.isRolledActiveWarning));

  // G: expires during day
  const mid = warning({ validTo: "2026-07-30T14:00:00+02:00" });
  const beforeExp = IU.getEffectiveTimelinePresentation(mid, Date.parse("2026-07-30T13:00:00+02:00"));
  const afterExp = IU.getEffectiveTimelinePresentation(mid, Date.parse("2026-07-30T15:00:00+02:00"));
  ok("G_before_active", beforeExp.isActiveWarning === true, String(beforeExp.isActiveWarning));
  ok("G_after_inactive", afterExp.isActiveWarning === false, String(afterExp.isActiveWarning));
  ok("G_after_not_rolled", afterExp.isRolledActiveWarning === false, String(afterExp.isRolledActiveWarning));

  // H: future warning
  const future = warning({
    publishedAtSource: "2026-07-30T08:00:00+02:00",
    publishedAt: "2026-07-30T08:00:00+02:00",
    validFrom: "2026-07-30T14:00:00+02:00",
    validTo: "2026-07-30T20:00:00+02:00",
  });
  const h12 = IU.getEffectiveTimelinePresentation(future, Date.parse("2026-07-30T12:00:00+02:00"));
  const h15 = IU.getEffectiveTimelinePresentation(future, Date.parse("2026-07-30T15:00:00+02:00"));
  ok("H_before_inactive", h12.isActiveWarning === false, String(h12.isActiveWarning));
  ok("H_before_not_rolled", h12.isRolledActiveWarning === false, String(h12.isRolledActiveWarning));
  ok("H_after_active", h15.isActiveWarning === true, String(h15.isActiveWarning));
  ok("H_same_id", future.id === "ie-chmi-v2-roll-1", future.id);

  // I: Cancel
  const cancel = warning({ status: "zruseno", capV2: { badgeActive: false, msgType: "Cancel", geo: { links: [] } } });
  const i = IU.getEffectiveTimelinePresentation(cancel, nowMorning);
  ok("I_inactive", i.isActiveWarning === false, String(i.isActiveWarning));
  ok("I_not_rolled", i.isRolledActiveWarning === false, String(i.isRolledActiveWarning));

  // N: ordinary article does not roll / no AKTIVNÍ
  const artOld = article();
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

  // boundary helper
  const nb = IU.nextTimelineBoundaryMs([yW], Date.parse("2026-07-30T10:00:00+02:00"));
  ok("boundary_future", nb > Date.parse("2026-07-30T10:00:00+02:00"), String(nb));
}

function main() {
  staticGate();
  const IU = loadIU();
  ok("iu_loaded", !!(IU && typeof IU.getEffectiveTimelinePresentation === "function"), "load");
  if (IU && typeof IU.getEffectiveTimelinePresentation === "function") unitGate(IU);
  if (fails.length) {
    console.error("[iu-chmi-cap-active-day-rollover-guard] FAIL");
    for (const f of fails) console.error(" - " + f);
    process.exit(1);
  }
  console.log("[iu-chmi-cap-active-day-rollover-guard] OK");
}

main();
