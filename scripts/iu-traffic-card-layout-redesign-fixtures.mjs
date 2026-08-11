#!/usr/bin/env node
/**
 * Traffic card final layout redesign fixtures — pure, no network.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildTrafficCardViewModel,
  trafficProjectionToFeedItem,
  trafficBadgeModel,
} from "../assets/iu-traffic-overview-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const uiSrc = fs.readFileSync(path.join(root, "assets/iu-prehled-dne-ui-v1.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "assets/iu-prehled-dne-v1.css"), "utf8");

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const PEID = "iu-te-" + "b".repeat(32);

function sampleCard(extra = {}) {
  return {
    publicEventId: PEID,
    lifecycleStatus: "ACTIVE",
    changeStatus: "NEW",
    eventType: "omezeni",
    category: "omezeni",
    road: "II/291",
    roadClass: "CLASS_II",
    roadClassLabel: "Silnice II. třídy",
    municipality: "Nové Město pod Smrkem",
    district: "Liberec",
    validityLine: "8. 6. 2021 00:00 – 31. 12. 2050 23:59",
    impact: "Omezení tonáže na silnici II/291.",
    impactFull: null,
    impactSource: "publicComment",
    illustrationKey: "omezeni",
    source: "ŘSD/NDIC",
    mapTarget: {
      mapLinkType: "GENERAL_RSD_MAP",
      safeMapTarget: "https://www.dopravniinfo.cz/",
    },
    feed: { feedHeadline: "x", feedChangeType: "EVENT_CREATED" },
    lastMeaningfulChangeAt: "2026-08-06T12:00:00.000Z",
    sourceUpdatedAt: "2026-08-06T11:55:00.000Z",
    timelineField: "situationRecordVersionTime",
    delayAvailable: false,
    delayMinutes: null,
    preciseLocationVerified: false,
    subjectScopeVerified: true,
    locationPresentationLevel: "SCOPED",
    ...extra,
  };
}

ok("ui_has_traffic_card_shell", uiSrc.includes("iuPdTrafficCard"));
ok("ui_has_meta_rows", uiSrc.includes("iuPdTrafficMeta"));
ok("ui_has_lead_fullwidth", uiSrc.includes("iuPdTrafficLead"));
ok("ui_no_narrow_facts_render", !/iuPdTrafficFacts/.test(uiSrc) || !uiSrc.includes('class="iuPdTrafficFacts"'));
ok("css_hides_legacy_narrow", /iuPdTrafficFacts[\s\S]{0,80}display:\s*none\s*!important/.test(cssSrc));
ok("css_lead_fullwidth", cssSrc.includes(".iuPdTrafficLead"));
ok("css_more_a11y_toggle", cssSrc.includes(".iuPdTrafficMore__close"));
ok("ui_escapes_full", /esc\(\s*vm\.impactFull\s*\)/.test(uiSrc));
ok("ui_no_dangerously", !uiSrc.includes("dangerouslySetInnerHTML"));
ok("ui_follow_only_traffic", /traffic-follow/.test(uiSrc) && /Sledovat/.test(uiSrc));
ok("ui_hide_present", /data-act="hide"/.test(uiSrc));

{
  const active = trafficBadgeModel({
    lifecycleStatus: "ACTIVE",
    feed: { feedChangeType: "" },
  });
  ok("badge_no_active_doprava", active == null);
  const changed = trafficBadgeModel({
    lifecycleStatus: "ACTIVE",
    feed: { feedChangeType: "EVENT_UPDATED" },
  });
  ok("badge_changed_kept", changed && /ZMĚNĚNÁ/.test(changed.text || ""));
  ok("badge_changed_not_active_label", changed && !/AKTIVNÍ DOPRAVA/.test(changed.text || ""));
  const neu = trafficBadgeModel({
    lifecycleStatus: "ACTIVE",
    feed: { feedChangeType: "EVENT_CREATED" },
    category: "nehoda",
  });
  ok("badge_new_kept", neu && neu.text.indexOf("NOVÁ") >= 0);
}

{
  const r = trafficProjectionToFeedItem(sampleCard());
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("A_short_no_more", vm.showMore === false);
  ok("A_compact_locality", vm.localityLine.includes("Nové Město") && vm.localityLine.includes("Liberec"));
  ok("G_road_badge", vm.roadBadge.road === "II/291" && vm.roadBadge.roadClass === "CLASS_II");
}

{
  const full =
    "x".repeat(320) +
    " úplná uzavírka a objízdná trasa přes silnici I/47, Vydal: Magistrát města Přerova.";
  const r = trafficProjectionToFeedItem(
    sampleCard({ impact: full.slice(0, 160), impactFull: full })
  );
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("B_long_show_more", vm.showMore === true);
  ok("B_full_eq_source", vm.impactFull === full);
  ok("B_full_not_from_summary_only", vm.impactFull.length > String(vm.leadText || "").length);
}

{
  const full = "y".repeat(1005);
  const r = trafficProjectionToFeedItem(
    sampleCard({ impact: full.slice(0, 160), impactFull: full })
  );
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("C_1000_plus", vm.impactFull.length > 1000 && vm.showMore === true);
}

{
  const r = trafficProjectionToFeedItem(sampleCard({ municipality: null, district: "Přerov" }));
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("D_missing_obec", vm.localityLine === "okres Přerov");
  ok("E_district_only_ok", (vm.detailRows || []).some((d) => d.key === "locality"));
}

{
  const r = trafficProjectionToFeedItem(sampleCard({ direction: "UNKNOWN" }));
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("F_no_unknown_direction", !(vm.detailRows || []).some((d) => /UNKNOWN/i.test(d.value || "")));
  ok("F_direction_optional", vm.direction == null || vm.direction === "UNKNOWN" ? vm.direction == null : true);
}

{
  const r = trafficProjectionToFeedItem(
    sampleCard({ road: null, roadClass: "UNKNOWN", municipality: "Bujanov", district: null })
  );
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok("H_unknown_road_neutral", !vm.roadBadge.road);
  ok("H_no_invented_class_in_rows", !(vm.detailRows || []).some((d) => d.key === "road"));
}

{
  // Duplicate long text must not appear as both lead and restriction quick block.
  const impact = "Omezení jednoho jízdního pruhu na silnici.";
  const r = trafficProjectionToFeedItem(sampleCard({ impact, impactFull: impact + " " + "z".repeat(200) }));
  const vm = buildTrafficCardViewModel(r.item.trafficV1);
  ok(
    "no_duplicate_restriction_box",
    !(vm.quickBlocks || []).some((b) => b.key === "restriction")
  );
  ok("show_more_when_extra", vm.showMore === true);
}

const success = results.filter((x) => x.pass).length;
const failure = results.filter((x) => !x.pass).length;
console.log(
  JSON.stringify(
    {
      suite: "TRAFFIC_CARD_LAYOUT_REDESIGN",
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
