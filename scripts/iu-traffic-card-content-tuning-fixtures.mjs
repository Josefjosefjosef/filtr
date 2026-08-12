#!/usr/bin/env node
/**
 * Traffic card content-tuning fixtures — pure, no NDIC network.
 */
import {
  pickRsdTimelineTimestamp,
  classifyRoadNumber,
  humanDirectionOrNull,
  chooseHumanLocality,
  scanTrafficUserTextRegressions,
  ROAD_CLASS,
} from "./ndic-datex-v1/traffic-card-content-v1.mjs";
import { feedItemToPublicationEvent } from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";
import {
  trafficProjectionToFeedItem,
  buildTrafficCardViewModel,
  trafficHistoryLines,
  scanTrafficUserTextRegressions as scanAssetRegressions,
  isTrafficFollowed,
  toggleTrafficFollow,
  listTrafficFollowed,
  appendTrafficFollowHistory,
  LS_TRAFFIC_FOLLOW,
} from "../assets/iu-traffic-overview-v1.js";
import { trafficEventIllustrationSvg, ROAD_BADGE_CLASS } from "../assets/iu-traffic-event-art-v1.js";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const PEID = "iu-te-" + "a".repeat(32);

if (typeof globalThis.localStorage === "undefined") {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
}

{
  const t = pickRsdTimelineTimestamp({
    versionTime: "2026-08-06T12:00:00.000Z",
    creationTime: "2026-08-06T10:00:00.000Z",
  });
  ok("pick_version", t.iso === "2026-08-06T12:00:00.000Z" && t.field === "situationRecordVersionTime");
}
{
  const t = pickRsdTimelineTimestamp({ creationTime: "2026-08-06T10:00:00.000Z" });
  ok("pick_creation", t.iso === "2026-08-06T10:00:00.000Z");
}
ok("road_d1", classifyRoadNumber("D1") === ROAD_CLASS.MOTORWAY);
ok("road_i", classifyRoadNumber("I/35") === ROAD_CLASS.CLASS_I);
ok("road_ii", classifyRoadNumber("II/230") === ROAD_CLASS.CLASS_II);
ok("dir_tech_null", humanDirectionOrNull("kladný směr") == null);
ok("dir_tech_pos", humanDirectionOrNull("positive") == null);
ok("dir_ok", humanDirectionOrNull("Praha") === "Praha");
ok(
  "locality_comment",
  chooseHumanLocality({ summary: "Uzavírka, Postřelmov, okr. Šumperk" }) === "Postřelmov"
);
ok("scan_bad", scanTrafficUserTextRegressions("Čerstvost: UNKNOWN").ok === false);
ok("scan_ok", scanTrafficUserTextRegressions("Nehoda na D1").ok === true);

{
  const pe = feedItemToPublicationEvent({
    id: PEID,
    title: "x",
    summary: "y",
    publishedAt: "2026-08-06T12:00:00.000Z",
    publishedAtSource: "2026-08-06T11:00:00.000Z",
    lastUpdatedBySource: "2026-08-06T12:30:00.000Z",
    versionTime: "2026-08-06T12:30:00.000Z",
    validFrom: "2026-08-10T08:00:00.000Z",
    startsAt: "2026-08-10T08:00:00.000Z",
  });
  const ts = pe && pe.fields && pe.fields.lastMeaningfulChangeAt && pe.fields.lastMeaningfulChangeAt.value;
  ok("timeline_not_future_validFrom", ts === "2026-08-06T12:30:00.000Z");
  ok(
    "timeline_ne_validFrom",
    ts !== "2026-08-10T08:00:00.000Z" &&
      pe.fields.validFrom.value === "2026-08-10T08:00:00.000Z"
  );
}

function sampleCard(extra = {}) {
  return {
    publicEventId: PEID,
    lifecycleStatus: "ACTIVE",
    changeStatus: "NEW",
    eventType: "nehoda",
    category: "nehoda",
    severity: null,
    road: "D1",
    roadClass: "MOTORWAY",
    roadClassLabel: "Dálnice",
    municipality: "Mirošovice",
    district: "Praha-východ",
    location: "D1",
    validity: {
      validFrom: "2026-08-06T08:00:00.000Z",
      expectedEnd: "2026-08-06T20:00:00.000Z",
      actualEnd: null,
    },
    validityLine: "6. 8. 2026 od 10:00 do 22:00",
    impact: "Na místě je evidována nehoda.",
    impactFull: null,
    impactSource: "publicComment",
    illustrationKey: "nehoda",
    freshness: "UNKNOWN",
    source: "ŘSD/NDIC",
    mapTarget: {
      mapLinkType: "GENERAL_RSD_MAP",
      safeMapTarget: "https://www.dopravniinfo.cz/",
    },
    feed: {
      feedHeadline: "Nová nehoda na D1",
      feedChangeType: "EVENT_CREATED",
    },
    fieldProvenance: {},
    lastMeaningfulChangeAt: "2026-08-06T12:00:00.000Z",
    sourceUpdatedAt: "2026-08-06T11:55:00.000Z",
    timelineField: "situationRecordVersionTime",
    delayAvailable: false,
    delayMinutes: null,
    stableSituationId: "sit-1",
    stableRecordId: "rec-1",
    preciseLocationVerified: false,
    subjectScopeVerified: true,
    locationPresentationLevel: "SCOPED",
    subjectScopeLabel: "D1",
    ...extra,
  };
}

{
  const r = trafficProjectionToFeedItem(sampleCard());
  ok("proj_ok", r.ok === true);
  ok("proj_fresh_null", r.item.trafficV1.freshness == null);
  ok("proj_importance_0", r.item.importance === 0);
  ok("proj_publishedAt", r.item.publishedAt === "2026-08-06T12:00:00.000Z");
  ok("proj_publishedAtSource", r.item.publishedAtSource === "2026-08-06T11:55:00.000Z");
  ok("proj_illustration", r.item.trafficV1.illustrationKey === "nehoda");
  ok("proj_roadClass", r.item.trafficV1.roadClass === "MOTORWAY");
  ok("hist_empty", trafficHistoryLines(r.item.trafficV1).length === 0);

  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("vm_locality", vm.locality === "Mirošovice");
  ok("vm_event_label", vm.eventTypeLabel === "NEHODA");
  ok("vm_no_delay", !(vm.quickBlocks || []).some((b) => b.key === "delay"));
  ok("vm_muni_block", (vm.quickBlocks || []).some((b) => b.key === "municipality"));
  ok("vm_locality_compact", vm.localityLine === "Mirošovice · okres Praha-východ");
  ok("vm_no_active_traffic_badge", !(vm.badge && /AKTIVNÍ DOPRAVA/i.test(vm.badge.text || "")));
  ok("vm_follow_id", vm.followId === PEID);

  const html =
    JSON.stringify(vm) +
    trafficEventIllustrationSvg(vm.illustrationKey) +
    (vm.communicationLine || "") +
    (vm.eventLine || "");
  const reg = scanAssetRegressions(html);
  ok("vm_no_regress", reg.ok === true, (reg.hits || []).join(","));
}

{
  const r = trafficProjectionToFeedItem(
    sampleCard({
      delayAvailable: false,
      delayMinutes: 12,
      impact: "Omezení jednoho jízdního pruhu.",
    })
  );
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("delay_absent_no_block", !(vm.quickBlocks || []).some((b) => b.key === "delay"));
  // Restriction must not re-clone the same lead text into a second "Omezení" box.
  ok(
    "restriction_no_duplicate_lead",
    !(vm.quickBlocks || []).some((b) => b.key === "restriction" && b.body === vm.leadText)
  );
  ok(
    "lead_uses_short_comment",
    /Omezení jednoho jízdního pruhu/.test(vm.leadText || vm.situationSummary || "")
  );
}

{
  const r = trafficProjectionToFeedItem(
    sampleCard({
      preciseLocationVerified: true,
      locationPresentationLevel: "PRECISE",
      direction: "kladný směr",
      kilometer: 12,
    })
  );
  ok("dir_null_tech", r.item.trafficV1.direction == null);
}

{
  try {
    localStorage.removeItem(LS_TRAFFIC_FOLLOW);
  } catch (_) {}
  ok("follow_off", isTrafficFollowed(PEID) === false);
  const on = toggleTrafficFollow(PEID, { road: "D1", eventType: "nehoda" });
  ok("follow_on", on.ok && on.followed === true && isTrafficFollowed(PEID) === true);
  ok("follow_list", listTrafficFollowed().includes(PEID));
  const hist = appendTrafficFollowHistory(PEID, { at: "2026-08-06T13:00:00.000Z", label: "změna dopadu" });
  ok("follow_hist", hist.ok === true);
  const off = toggleTrafficFollow(PEID, {});
  ok("follow_toggle_off", off.followed === false && isTrafficFollowed(PEID) === false);
}

ok("art_svg", /viewBox="0 0 64 64"/.test(trafficEventIllustrationSvg("nehoda")));
ok("art_neutral", /viewBox="0 0 64 64"/.test(trafficEventIllustrationSvg("nope")));
ok("badge_map", ROAD_BADGE_CLASS.MOTORWAY === "motorway" && ROAD_BADGE_CLASS.CLASS_I === "road");

{
  const r = trafficProjectionToFeedItem(sampleCard({ severity: "high" }));
  ok("sev_importance", r.item.importance === 5);
}

{
  const r = trafficProjectionToFeedItem(
    sampleCard({
      feed: { feedHeadline: "x", feedChangeType: "" },
      lifecycleStatus: "ACTIVE",
      changeStatus: "UNCHANGED",
    })
  );
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("no_active_doprava_badge", vm.badge == null);
  ok(
    "no_active_doprava_text",
    !JSON.stringify(vm.badge || {}).includes("AKTIVNÍ DOPRAVA")
  );
}

{
  const short = trafficProjectionToFeedItem(
    sampleCard({
      impact: "Krátký popis události.",
      impactFull: null,
      municipality: "Solnice",
      district: null,
      direction: null,
    })
  );
  const vm = buildTrafficCardViewModel(short.item.trafficV1);
  ok("short_has_summary", !!(vm.situationSummary || vm.leadText));
  ok("short_locality_no_district", vm.localityLine === "Solnice");
  ok("short_no_direction_row", !(vm.detailRows || []).some((d) => d.key === "direction"));
  ok("short_expanded_rows", Array.isArray(vm.expandedRows));
}

{
  const longBody =
    "silnice III/43327, v katastru obce Kojetín, okr. Přerov, uzavřeno, stavební práce, " +
    "Od 01.10.2025 7:00 Do 31.12.2026 23:59, úplná uzavírka krajské silnice III/43327 Kojetín " +
    "v rámci stavby Modernizace trati. Objížďka přes silnici I/47. Vydal: Magistrát města Přerova. " +
    "Další upřesnění trasy a omezení provozu pro nákladní dopravu je uvedeno v oficiálním textu ŘSD.";
  ok("long_body_gt_280", longBody.length > 280);
  const long = trafficProjectionToFeedItem(
    sampleCard({
      impact: longBody.slice(0, 160),
      impactFull: longBody,
      road: "III/43327",
      roadClass: "CLASS_III",
      municipality: "Kojetín",
      district: "Přerov",
      eventType: "uzavirka",
      category: "uzavirka",
    })
  );
  const vm = buildTrafficCardViewModel(long.item.trafficV1);
  ok("long_show_more", vm.showMore === true);
  ok("long_full_preserved", vm.impactFull === longBody && vm.impactFull.length === longBody.length);
  ok("long_full_ne_short", vm.impactFull !== vm.leadText);
  ok("long_no_unknown_dir", JSON.stringify(vm.detailRows || []).indexOf("UNKNOWN") < 0);
  ok("road_badge_class_iii", vm.roadBadge.roadClass === "CLASS_III");
}

{
  const unknownRoad = trafficProjectionToFeedItem(
    sampleCard({
      road: null,
      roadClass: "UNKNOWN",
      roadClassLabel: "Komunikace",
      municipality: null,
      district: null,
    })
  );
  const vm = buildTrafficCardViewModel(unknownRoad.item.trafficV1);
  ok("unknown_road_neutral", !vm.roadBadge.road);
  ok("missing_muni_no_empty_locality_row", !(vm.detailRows || []).some((d) => d.key === "locality" && !d.value));
}

const success = results.filter((r) => r.pass).length;
const failure = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify(
    {
      suite: "TRAFFIC_CARD_CONTENT_TUNING",
      PASS: failure === 0,
      TEST_COUNT: results.length,
      SUCCESS_COUNT: success,
      FAILURE_COUNT: failure,
      fails,
    },
    null,
    2
  )
);
process.exitCode = failure === 0 && success === results.length ? 0 : 1;
