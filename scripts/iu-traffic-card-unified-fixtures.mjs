#!/usr/bin/env node
/**
 * Unified ŘSD/NDIC traffic card presentation fixtures — pure, no network.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildTrafficCardViewModel,
  trafficProjectionToFeedItem,
  filterOfflineTrafficCandidatesForOverview,
} from "../assets/iu-traffic-overview-v1.js";
import {
  classifyRoadPresentation,
  classifyEventPresentation,
  expandTrafficAbbreviationsCs,
  buildTrafficSituationSummary,
  buildTrafficExpandedDetail,
  buildTrafficCardPresentation,
  buildPlaceAndDirectionLine,
  buildHeadLocalityLabel,
  parseOfficialCommentFacts,
  isTrafficCardInformative,
  formatCsDateTime,
  TRAFFIC_SIGN_ASSET,
  TRAFFIC_MAP_DOT_CSS_VAR,
  EVENT_KIND,
  ROAD_NUMBER_BADGE,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { classifyRoadNumber, ROAD_CLASS } from "../scripts/ndic-datex-v1/traffic-card-content-v1.mjs";
import { ROAD_BADGE_CLASS } from "../assets/iu-traffic-event-art-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const uiSrc = fs.readFileSync(path.join(root, "assets/iu-prehled-dne-ui-v1.js"), "utf8");
const cssSrc = fs.readFileSync(path.join(root, "assets/iu-prehled-dne-v1.css"), "utf8");
const presenterSrc = fs.readFileSync(
  path.join(root, "assets/iu-traffic-card-presenter-v1.js"),
  "utf8"
);

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const PEID = "iu-te-" + "c".repeat(32);

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

function vmFrom(extra) {
  const r = trafficProjectionToFeedItem(sampleCard(extra));
  ok("feed_ok_" + Object.keys(extra || {}).join("_").slice(0, 24), r.ok === true, r.rejectCode);
  return buildTrafficCardViewModel(r.item.trafficV1);
}

// --- Assets present ---
for (const rel of [
  "assets/images/traffic-road-motorway.png",
  "assets/images/traffic-road-motor-vehicles.png",
  "assets/images/traffic-event-traffic-jam.png",
  "assets/images/traffic-event-accident.png",
  "assets/images/traffic-event-roadworks.png",
  "assets/images/traffic-event-closure.png",
  "assets/images/traffic-event-warning.png",
  "assets/images/traffic-parking.png",
]) {
  ok("asset_" + path.basename(rel), fs.existsSync(path.join(root, rel)));
}

// --- Road number colors / classification ---
{
  const d1 = classifyRoadPresentation("D1");
  ok("D1_red_badge", d1.numberBadge === ROAD_NUMBER_BADGE.MOTORWAY);
  ok("D1_motorway_icon", d1.roadTypeIcon === TRAFFIC_SIGN_ASSET.MOTORWAY);
  const d5 = classifyRoadPresentation("D5");
  ok("D5_red_badge", d5.numberBadge === ROAD_NUMBER_BADGE.MOTORWAY);
  const i11 = classifyRoadPresentation("I/11");
  ok("I11_blue_badge", i11.numberBadge === ROAD_NUMBER_BADGE.ROAD);
  ok("I11_no_smv_by_default", i11.showMotorVehiclesIcon === false);
  const i11smv = classifyRoadPresentation("I/11", { motorVehicleRoadConfirmed: true });
  ok("I11_smv_only_confirmed", i11smv.showMotorVehiclesIcon === true);
  ok("I11_smv_asset", i11smv.roadTypeIcon === TRAFFIC_SIGN_ASSET.MOTOR_VEHICLES);
  const ii = classifyRoadPresentation("II/347");
  ok("II347_blue", ii.numberBadge === ROAD_NUMBER_BADGE.ROAD);
  const iii = classifyRoadPresentation("III/12345");
  ok("III_blue", iii.numberBadge === ROAD_NUMBER_BADGE.ROAD);
  const e50 = classifyRoadPresentation("E50");
  ok("E50_green", e50.numberBadge === ROAD_NUMBER_BADGE.E_ROAD);
  ok("E50_content_class", classifyRoadNumber("E50") === ROAD_CLASS.E_ROAD);
  ok("badge_map_motorway_red_mod", ROAD_BADGE_CLASS.MOTORWAY === "motorway");
  ok("badge_map_class_i_blue_mod", ROAD_BADGE_CLASS.CLASS_I === "road");
  ok("badge_map_e_road", ROAD_BADGE_CLASS.E_ROAD === "e-road");
}

// --- Event classification ---
{
  ok(
    "ev_accident",
    classifyEventPresentation({ eventType: "nehoda" }).kind === EVENT_KIND.ACCIDENT
  );
  ok("ev_queue", classifyEventPresentation({ eventType: "kolona" }).kind === EVENT_KIND.QUEUE);
  ok(
    "ev_works",
    classifyEventPresentation({ eventType: "prace" }).kind === EVENT_KIND.ROADWORKS
  );
  ok(
    "ev_closure_type",
    classifyEventPresentation({ eventType: "uzavirka" }).kind === EVENT_KIND.CLOSURE
  );
  ok(
    "ev_closure_text",
    classifyEventPresentation({
      eventType: "omezeni",
      impact: "ÚPLNÁ UZAVÍRKA silnice II/347",
    }).kind === EVENT_KIND.CLOSURE
  );
  ok(
    "ev_warning_fallback",
    classifyEventPresentation({ eventType: "xyz_unknown" }).kind === EVENT_KIND.WARNING
  );
  ok(
    "ev_parking_fields",
    classifyEventPresentation({ parkingAvailableSpaces: 37 }).kind === EVENT_KIND.PARKING
  );
  ok(
    "ev_accident_asset",
    classifyEventPresentation({ eventType: "nehoda" }).asset === TRAFFIC_SIGN_ASSET.ACCIDENT
  );
}

// --- Abbreviations ---
{
  const s = expandTrafficAbbreviationsCs("nehoda; 2× OA; neprůjezdný levý jízdní pruh");
  ok("abbr_no_oa_token", !/\bOA\b/.test(s));
  ok("abbr_plural_2", /2 osobní automobily/.test(s));
  const s1 = expandTrafficAbbreviationsCs("1× OA");
  ok("abbr_singular", /1 osobní automobil/.test(s1) && !/automobily/.test(s1));
  const s5 = expandTrafficAbbreviationsCs("5× OA");
  ok("abbr_genitive_5", /5 osobních automobilů/.test(s5));
  const pro = expandTrafficAbbreviationsCs("Objížďka pro OA: ulice X");
  ok("abbr_pro_oa", /pro osobní automobily/.test(pro) && !/\bOA\b/.test(pro));
}

// --- Situation summaries (no invention) ---
{
  ok(
    "sum_accident_bare",
    buildTrafficSituationSummary({ eventType: "nehoda" }) === "Nehoda."
  );
  ok(
    "sum_accident_with_data",
    /osobní automobily/.test(
      buildTrafficSituationSummary({
        eventType: "nehoda",
        impact: "nehoda; 2× OA; neprůjezdný levý jízdní pruh",
      })
    )
  );
  ok(
    "sum_queue_no_length_invent",
    !/\d+\s*km/.test(buildTrafficSituationSummary({ eventType: "kolona", impact: "Silný provoz" }))
  );
  ok(
    "sum_queue_with_length",
    /1 km/.test(
      buildTrafficSituationSummary({ eventType: "kolona", queueLengthKm: 1, impact: "kolona" })
    )
  );
  ok(
    "sum_closure_unknown_scope",
    buildTrafficSituationSummary({ eventType: "uzavirka" }) === "Silnice je uzavřena."
  );
  ok(
    "sum_closure_both_only_if_said",
    /obou směrech/.test(
      buildTrafficSituationSummary({
        eventType: "uzavirka",
        impact: "uzavřeno, oba směry",
      })
    )
  );
  ok(
    "sum_parking_free",
    buildTrafficSituationSummary({ parkingAvailableSpaces: 37 }) === "Volných míst: 37"
  );
  ok(
    "sum_parking_no_invent",
    !/\d+/.test(buildTrafficSituationSummary({ eventType: "parking", impact: "Parkoviště otevřeno" })) ||
      /Parkoviště/.test(buildTrafficSituationSummary({ eventType: "parking", impact: "Parkoviště otevřeno" }))
  );
}

// --- Missing fields ---
{
  const vm = vmFrom({
    road: "D1",
    roadClass: "MOTORWAY",
    eventType: "nehoda",
    direction: null,
    kilometer: null,
    preciseLocationVerified: true,
    impact: "nehoda",
    impactFull: "nehoda na D1 u Holubic, zásah IZS",
  });
  ok("miss_dir_absent", !vm.direction);
  ok("miss_km_absent", !/km /.test(vm.placeLine || ""));
  ok("d1_vm_red", vm.roadBadge.numberBadge === "motorway");
  ok("d1_vm_icon", !!vm.roadBadge.roadTypeIcon);
  ok("summary_no_oa", !/\bOA\b/.test(vm.situationSummary || ""));
}

{
  const vm = vmFrom({
    road: null,
    roadClass: "UNKNOWN",
    municipality: "Bzenec",
    eventType: "omezeni",
    impact: "místní komunikace Bzenec",
  });
  ok("local_place_bzenec", /Bzenec/.test(vm.locality || vm.placeLine || ""));
  ok("local_no_fake_road", !vm.roadBadge.road);
}

{
  const longTown = "Nové Město pod Smrkem u Frýdlantského výběžku";
  const vm = vmFrom({ municipality: longTown, impact: "x".repeat(400), impactFull: "y".repeat(500) });
  ok("long_town_kept", (vm.locality || "").includes("Nové Město"));
  ok("long_show_more", vm.showMore === true);
  ok(
    "long_detail_keeps_source",
    (vm.impactFullRaw || "").length > 100 ||
      (vm.expandedRows || []).some((r) => r.key === "sourceDescription" && String(r.value || "").length > 100)
  );
}

// --- Expanded detail preserves source ---
{
  const full =
    "silnice II/347, Mladé Bříště – Staré Bříště, úplná uzavírka, Od 7.8.2026 21:52 Do 31.8.2026 23:59";
  const det = buildTrafficExpandedDetail({
    eventType: "omezeni",
    road: "II/347",
    municipality: "Mladé Bříště",
    impactFull: full,
  });
  ok("detail_has_source_row", det.rows.some((r) => r.key === "sourceDescription"));
  ok("detail_source_eq", det.sourceFull === full || det.rows.some((r) => r.value.includes("II/347")));
  ok("detail_not_only_summary", det.rows.length >= 2);
}

// --- UI wiring ---
ok("ui_unified_flag", uiSrc.includes('data-iu-traffic-unified="1"'));
ok("ui_zobrazit_vice", uiSrc.includes("Zobrazit více"));
ok("ui_skryt", uiSrc.includes(">Skrýt<") || uiSrc.includes("iuPdTrafficMore__close\">Skrýt"));
ok("ui_png_event_sign", uiSrc.includes("iuPdTrafficEventSign"));
ok("ui_png_road_sign", uiSrc.includes("iuPdTrafficRoadSign"));
ok("ui_no_svg_art_call", !uiSrc.includes("trafficEventIllustrationSvg("));
ok("ui_source_label", uiSrc.includes("Zdroj:"));
ok("ui_map_slot", uiSrc.includes("iuPdTrafficTop__map"));

// --- CSS: Czech colors + shared map/timeline token ---
ok("css_motorway_red", /iuPdRoadBadge--motorway[\s\S]{0,120}#c8102e/.test(cssSrc));
ok("css_road_blue", /iuPdRoadBadge--road[\s\S]{0,120}#003399/.test(cssSrc));
ok("css_e_green", /iuPdRoadBadge--e-road[\s\S]{0,160}#1b7a3d/.test(cssSrc));
ok("css_map_uses_pd_dot", cssSrc.includes("var(--iu-pd-dot"));
ok("css_timeline_dot_uses_pd_dot", /\.iuPrehledDne__dot[\s\S]{0,80}var\(--iu-pd-dot/.test(cssSrc));
ok("presenter_map_token", TRAFFIC_MAP_DOT_CSS_VAR === "--iu-pd-dot");
ok("css_dark_keeps_motorway_red", /html\.dark[\s\S]{0,200}iuPdRoadBadge--motorway[\s\S]{0,80}#c8102e/.test(cssSrc));
ok("css_event_sign_no_recolor", /iuPdTrafficEventSign[\s\S]{0,220}filter:\s*none/.test(cssSrc));
ok("css_mobile_wrap", /overflow-wrap:\s*anywhere/.test(cssSrc));
ok("css_responsive_blocks", cssSrc.includes(".iuPdTrafficBlock"));

// --- Clickable map allowlist still in overview ---
{
  const ov = fs.readFileSync(path.join(root, "assets/iu-traffic-overview-v1.js"), "utf8");
  ok("map_allowlist_dopravniinfo", ov.includes("dopravniinfo.cz"));
  ok("map_no_fake_coord_url", !ov.includes("lat=") || ov.includes("resolveSafeTrafficMapUrl"));
}

// --- Presentation regression: public OA leak flag ---
{
  const p = buildTrafficCardPresentation({
    eventType: "nehoda",
    impact: "2× OA na vozovce",
  });
  ok("pres_oa_cleaned", p.regression.publicSummaryHasOa === false);
}

// --- One-side vs both-side closure wording ---
{
  const one = buildTrafficSituationSummary({
    eventType: "uzavirka",
    impact: "komunikace uzavřena ve směru Brno",
  });
  ok("closure_one_way_keeps_brno", /Brno/i.test(one));
  ok("closure_one_way_no_both", !/obou směrech/i.test(one));
}

// --- Info-logic: D1 queue with km + direction from comment ---
{
  const impact =
    "D1, km 187.9 až 189.5, ve směru Ostrava, silný provoz, kolona 1 km";
  const place = buildPlaceAndDirectionLine({
    road: "D1",
    eventType: "kolona",
    impact,
  });
  ok("d1_place_has_km", /km 187,9–189,5/.test(place) || /km 187\.9/.test(place));
  ok("d1_place_has_dir", /směr Ostrava/.test(place));
  const sum = buildTrafficSituationSummary({ eventType: "kolona", impact });
  ok("d1_sum_strong", /Silný provoz/.test(sum));
  ok("d1_sum_queue_km", /1 km/.test(sum));
  ok("d1_sum_no_ellipsis", !/…|\.\.\./.test(sum));
  const vm = vmFrom({
    road: "D1",
    roadClass: "MOTORWAY",
    eventType: "kolona",
    impact,
    impactFull: impact,
  });
  ok("d1_kind_queue", vm.eventKind === EVENT_KIND.QUEUE);
  ok("d1_sign_jam", vm.eventSignSrc === TRAFFIC_SIGN_ASSET.TRAFFIC_JAM);
}

// --- D0 km + direction (no invented Praha/Jižní spojka) ---
{
  const impact = "D0, mezi km 16.1 a 18.1, ve směru Ruzyně - D7, silný provoz";
  const place = buildPlaceAndDirectionLine({ road: "D0", eventType: "kolona", impact });
  ok("d0_place_km", /km 16,1–18,1/.test(place));
  ok("d0_place_dir", /Ruzyně/.test(place));
  ok("d0_no_invent_js", !/Jižní spojka/i.test(place + buildHeadLocalityLabel({ road: "D0", impact }).head));
}

// --- Hornopolní locality hierarchy ---
{
  const impact =
    "ulice Hornopolní, Moravská Ostrava a Přívoz, Ostrava, práce na inženýrských sítích, provoz převeden do protisměru, realizace části stavby mostního objektu a okolních komunikací";
  const head = buildHeadLocalityLabel({
    location: "Hornopolní",
    municipality: "Ostrava",
    eventType: "prace",
    impact,
  });
  ok("horno_head", /OSTRAVA\s*—\s*HORNOPOLNÍ/.test(head.head || ""));
  const place = buildPlaceAndDirectionLine({
    location: "Hornopolní",
    municipality: "Ostrava",
    eventType: "prace",
    impact,
  });
  ok("horno_place_street", /ulice Hornopolní/.test(place));
  ok("horno_place_part", /Moravská Ostrava/.test(place));
  const sum = buildTrafficSituationSummary({ eventType: "prace", impact });
  ok("horno_sum_complete", /Práce na inženýrských sítích/.test(sum));
  ok("horno_sum_protismer", /protisměru/.test(sum));
  ok("horno_sum_no_ellipsis", !/…|\.\.\./.test(sum));
  ok("horno_sum_no_trunc_rea", !/\bRea\b/i.test(sum) && !/Realizace části stavby/.test(sum));
}

// --- Parking P+R from comment ---
{
  const impact = "P+R Zličín, 90% obsazeno, méně než 10 volných parkovacích míst";
  const ev = classifyEventPresentation({ eventType: "doprava", impact });
  ok("pr_kind", ev.kind === EVENT_KIND.PARKING);
  ok("pr_asset", ev.asset === TRAFFIC_SIGN_ASSET.PARKING);
  ok("pr_title", /PARKOVIŠTĚ/.test(ev.titleCs) && /ZLIČÍN|Zličín/i.test(ev.titleCs));
  const sum = buildTrafficSituationSummary({ eventType: "doprava", impact });
  ok("pr_occ", /90\s*%/.test(sum));
  ok("pr_free_bound", /méně než 10/i.test(sum));
  ok("pr_no_invent_exact_free", !/\b9\b/.test(sum) && !/\b8\b/.test(sum));
}

// --- Empty template cards ---
{
  ok(
    "empty_not_informative",
    isTrafficCardInformative({
      eventType: "doprava",
      impact: "Dopravní událost je evidována.",
      impactSource: "categoryTemplate",
    }) === false
  );
  ok(
    "empty_filter_drops",
    filterOfflineTrafficCandidatesForOverview(
      [
        {
          trafficV1: {
            lifecycleStatus: "ACTIVE",
            eventType: "doprava",
            impact: "Dopravní událost je evidována.",
            validity: { validFrom: "2020-01-01T00:00:00.000Z" },
          },
        },
        {
          trafficV1: {
            lifecycleStatus: "ACTIVE",
            eventType: "kolona",
            road: "D1",
            impact: "D1, km 10, silný provoz",
            validity: { validFrom: "2020-01-01T00:00:00.000Z" },
          },
        },
      ],
      {},
      { nowMs: Date.parse("2026-08-12T10:00:00.000Z") }
    ).length === 1
  );
}

// --- Future badge stays separate from type ---
{
  const vm = vmFrom({
    lifecycleStatus: "FUTURE",
    eventType: "prace",
    road: null,
    municipality: "Ostrava",
    location: "Hornopolní",
    impact:
      "ulice Hornopolní, Moravská Ostrava a Přívoz, Ostrava, práce na inženýrských sítích",
    validity: { validFrom: "2026-08-20T05:00:00.000Z", expectedEnd: "2026-08-30T15:00:00.000Z" },
  });
  ok("future_badge", vm.badge && /BUDOUCÍ|NAPLAN/i.test(vm.badge.text + vm.badge.aria));
  ok("future_type_works", vm.eventKind === EVENT_KIND.ROADWORKS);
}

// --- Deduped source description + Czech times ---
{
  const full =
    "D1, km 99, ve směru Brno, nehoda; 2× OA; neprůjezdný levý jízdní pruh";
  const det = buildTrafficExpandedDetail({
    eventType: "nehoda",
    road: "D1",
    impact: full,
    impactFull: full,
    validity: {
      validFrom: "2026-08-12T05:04:18.000Z",
      expectedEnd: "2026-08-12T05:38:16.000Z",
    },
    lastMeaningfulChangeAt: "2026-08-12T05:08:00.000Z",
  });
  const srcRows = det.rows.filter((r) => r.key === "sourceDescription");
  ok("dedupe_one_source", srcRows.length === 1);
  ok("dedupe_no_type_zdroj", !det.rows.some((r) => /typ\s*\(zdroj\)/i.test(r.label)));
  ok("dedupe_no_triple_platnost", det.rows.filter((r) => r.label === "Platnost").length <= 1);
  const from = det.rows.find((r) => r.key === "validityFrom");
  ok("cs_time_from", from && /12\.\s*8\.\s*2026/.test(from.value) && /0?7:04/.test(from.value));
  ok("cs_time_no_iso_z", !det.rows.some((r) => /T\d{2}:\d{2}:\d{2}.*Z/.test(r.value)));
  const formatted = formatCsDateTime("2026-08-12T05:04:18.000Z");
  ok("format_cs_helper", /12\.\s*8\.\s*2026/.test(formatted) && /07:04/.test(formatted));

  const vm = vmFrom({
    eventType: "nehoda",
    road: "D1",
    roadClass: "MOTORWAY",
    impact: full,
    impactFull: full,
  });
  ok("vm_no_dup_body", vm.sourceAlreadyInExpanded === true && vm.renderImpactFullBody === false);
  ok("ui_no_more_body_dup", !uiSrc.includes("iuPdTrafficMore__body"));
}

// --- Class I / II / closure ---
{
  ok(
    "class_i_road",
    classifyRoadPresentation("I/38").numberBadge === ROAD_NUMBER_BADGE.ROAD
  );
  ok(
    "class_ii_closure",
    classifyEventPresentation({
      eventType: "omezeni",
      road: "II/357",
      impact: "úplná uzavírka silnice II/357, Jimramov",
    }).kind === EVENT_KIND.CLOSURE
  );
  const sum = buildTrafficSituationSummary({
    eventType: "omezeni",
    road: "II/357",
    impact: "úplná uzavírka silnice II/357",
  });
  ok("closure_sum_full", /Úplná uzavírka/.test(sum) && /II\/357/.test(sum));
}

// --- Obec + okres ---
{
  const place = buildPlaceAndDirectionLine({
    municipality: "Jimramov",
    district: "Žďár nad Sázavou",
    road: null,
    impact: "místní omezení",
  });
  ok("obec_okres", /Jimramov/.test(place) && /Žďár/.test(place));
}

// --- No substring truncation helper in presenter ---
ok("no_substring_trunc", !/substring\s*\(\s*0\s*,/.test(presenterSrc));
ok("ui_head_locality", uiSrc.includes("iuPdTrafficComm__head"));
ok("ui_no_impact_full_body", !uiSrc.includes("iuPdTrafficMore__body"));

console.log(
  JSON.stringify(
    {
      ok: fails.length === 0,
      pass: results.filter((r) => r.pass).length,
      fail: fails.length,
      fails,
    },
    null,
    2
  )
);
process.exit(fails.length ? 1 : 0);
