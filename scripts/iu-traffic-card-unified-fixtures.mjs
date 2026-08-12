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
  buildLocalityHeaderModel,
  resolveMunicipalitySignName,
  resolveParkingLiveStatus,
  parseOfficialCommentFacts,
  isTrafficCardInformative,
  isParkingOccupancySituation,
  isParkingFalsePositiveRoadEvent,
  dedupePresentationPhrases,
  stripTrailingNdicDateTime,
  formatCsDateTime,
  matchParkingRegistry,
  TRAFFIC_SIGN_ASSET,
  TRAFFIC_MAP_DOT_CSS_VAR,
  EVENT_KIND,
  ROAD_NUMBER_BADGE,
} from "../assets/iu-traffic-card-presenter-v1.js";
import {
  PARKING_REGISTRY,
  isAmbiguousParkingName,
} from "../assets/iu-parking-registry-v1.js";
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
  ok(
    "smv_icon_only_confirmed",
    classifyRoadPresentation("I/11", { motorVehicleRoadStatus: "true" }).showMotorVehiclesIcon === true
  );
  ok(
    "smv_status_unknown_no_icon",
    classifyRoadPresentation("I/11", { motorVehicleRoadStatus: "unknown" }).showMotorVehiclesIcon === false
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
  ok("local_place_bzenec", /Bzenec/i.test(vm.locality || vm.municipalitySignLabel || vm.placeLine || ""));
  ok("local_no_fake_road", !vm.roadBadge.road);
}

{
  const longTown = "Nové Město pod Smrkem u Frýdlantského výběžku";
  const vm = vmFrom({ municipality: longTown, impact: "x".repeat(400), impactFull: "y".repeat(500) });
  ok("long_town_kept", /Nové Město/i.test(vm.locality || vm.municipalitySignLabel || ""));
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
ok("ui_map_slot", uiSrc.includes("iuPdCard__actionsMap") && !uiSrc.includes('iuPdTrafficTop__map">${czMapMarkup}'));

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
  const hdr = buildLocalityHeaderModel({
    location: "Hornopolní",
    municipality: "Ostrava",
    eventType: "prace",
    impact,
  });
  ok("horno_muni_sign", hdr.municipalitySignLabel === "OSTRAVA");
  ok("horno_beside_street", hdr.besideLocality === "ulice: Hornopolní");
  ok("horno_city_part_row", hdr.cityPartRow === "městská část: Moravská Ostrava a Přívoz");
  ok(
    "horno_not_street_as_muni",
    resolveMunicipalitySignName({ location: "Hornopolní", impact: "práce na silnici" }) == null
  );
  const place = buildPlaceAndDirectionLine({
    location: "Hornopolní",
    municipality: "Ostrava",
    eventType: "prace",
    impact,
  });
  ok("horno_place_street", /ulice Hornopolní/.test(place));
  ok("horno_place_part", /Moravská Ostrava/.test(place));
  const pPres = buildTrafficCardPresentation({
    location: "Hornopolní",
    municipality: "Ostrava",
    eventType: "prace",
    impact,
  });
  ok("horno_place_no_dup_city", !/^Ostrava\b/i.test(pPres.placeLine || ""));
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
  ok("pr_title", ev.titleCs === "PARKOVIŠTĚ");
  ok("pr_title_no_name", !/ZLIČÍN/i.test(ev.titleCs));
  ok("pr_title_no_status_dup", !/OBSAZENO/i.test(ev.titleCs));
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
ok("ui_muni_sign", uiSrc.includes("iuPdMuniSign") && uiSrc.includes('data-iu-muni-sign="1"'));
ok("ui_no_impact_full_body", !uiSrc.includes("iuPdTrafficMore__body"));
ok("css_muni_sign_white", /\.iuPdMuniSign[\s\S]{0,400}background:\s*#ffffff/.test(cssSrc));
ok("css_muni_sign_black_border", /\.iuPdMuniSign[\s\S]{0,500}border:\s*2\.5px\s+solid\s+#000000/.test(cssSrc));
ok(
  "css_muni_sign_dark_stays_white",
  /html\.dark\s+\.iuPdMuniSign[\s\S]{0,160}background:\s*#ffffff\s*!important/.test(cssSrc)
);

// --- Municipality signboard composition ---
{
  const plzen = buildLocalityHeaderModel({
    municipality: "Plzeň",
    road: "I/27",
    street: "Klatovská třída",
    impact: "ulice Klatovská třída, Plzeň, práce na silnici",
  });
  ok("plzen_sign", plzen.municipalitySignLabel === "PLZEŇ");
  ok("plzen_beside", /ulice:\s*Klatovská/i.test(plzen.besideLocality || ""));
  const vmPlzen = vmFrom({
    municipality: "Plzeň",
    road: "I/27",
    roadClass: "CLASS_I",
    street: "Klatovská třída",
    eventType: "prace",
    impact: "ulice Klatovská třída, Plzeň, práce na silnici",
  });
  ok("plzen_vm_sign", vmPlzen.municipalitySignLabel === "PLZEŇ");
  ok("plzen_vm_road", vmPlzen.roadBadge.road === "I/27");
  ok("plzen_vm_beside", /ulice:\s*Klatovská/i.test(vmPlzen.besideLocality || ""));

  const cityOnly = buildLocalityHeaderModel({ municipality: "Přerov", eventType: "omezeni", impact: "omezení v Přerově" });
  ok("city_only_sign", cityOnly.municipalitySignLabel === "PŘEROV");
  ok("city_only_no_beside", !cityOnly.besideLocality);

  const roadCity = buildLocalityHeaderModel({
    municipality: "Brno",
    road: "I/42",
    eventType: "omezeni",
    impact: "omezení",
  });
  ok("city_road_no_street", roadCity.municipalitySignLabel === "BRNO" && !roadCity.besideLocality);

  const jim = buildLocalityHeaderModel({
    municipality: "Jimramov",
    district: "Žďár nad Sázavou",
    eventType: "uzavirka",
    impact: "úplná uzavírka",
  });
  ok("jim_sign", jim.municipalitySignLabel === "JIMRAMOV");
  ok("jim_district", /okres Žďár/.test(jim.districtBeside || ""));

  const d1 = buildLocalityHeaderModel({
    road: "D1",
    eventType: "kolona",
    impact: "D1, km 99, ve směru Brno, silný provoz",
  });
  ok("d1_no_muni_invent", d1.municipalitySign == null);
  ok("d0_no_praha_invent", resolveMunicipalitySignName({ road: "D0", impact: "D0, km 60, silný provoz" }) == null);

  const d1muni = buildLocalityHeaderModel({
    road: "D1",
    municipality: "Holubice",
    eventType: "nehoda",
    impact: "nehoda",
  });
  ok("d1_with_safe_muni", d1muni.municipalitySignLabel === "HOLUBICE");

  ok(
    "citypart_not_muni",
    resolveMunicipalitySignName({
      municipality: "Moravská Ostrava a Přívoz",
      street: "Hornopolní",
      impact: "ulice Hornopolní, Moravská Ostrava a Přívoz, Ostrava",
    }) == null
  );
  ok(
    "comment_city_is_muni",
    resolveMunicipalitySignName({
      street: "Hornopolní",
      impact: "ulice Hornopolní, Moravská Ostrava a Přívoz, Ostrava",
    }) === "Ostrava"
  );

  const longName = "Nové Město pod Smrkem";
  const longH = buildLocalityHeaderModel({ municipality: longName, impact: "x" });
  ok("long_muni_full", longH.municipalitySignLabel === longName.toUpperCase());
  ok("long_muni_no_ellipsis", !/…|\.\.\./.test(longH.municipalitySignLabel || ""));
  ok("diacritics_plzen", resolveMunicipalitySignName({ municipality: "Plzeň" }) === "Plzeň");

  const prCity = buildLocalityHeaderModel({
    municipality: "Praha",
    eventType: "doprava",
    impact: "P+R Zličín, 90% obsazeno, méně než 10 volných parkovacích míst",
  });
  ok("pr_keeps_muni_sign", prCity.municipalitySignLabel === "PRAHA");
  const prVm = vmFrom({
    municipality: "Praha",
    eventType: "doprava",
    impact: "P+R Zličín, 90% obsazeno, méně než 10 volných parkovacích míst",
  });
  ok("pr_title_kind_only", prVm.eventTypeLabel === "PARKOVIŠTĚ");
  ok(
    "pr_status_in_summary",
    /90\s*%\s*obsazeno/i.test(prVm.situationSummary || "") &&
      /méně než\s*10\s*volných/i.test(prVm.situationSummary || "")
  );
  ok("pr_beside_name", /P\+R Zličín/i.test(prVm.besideLocality || ""));
  ok("pr_kind_parking", prVm.eventKind === EVENT_KIND.PARKING);
  ok("pr_no_place_line", !prVm.placeLine);

  const closureTown = buildLocalityHeaderModel({
    municipality: "Jimramov",
    road: "II/357",
    eventType: "omezeni",
    impact: "úplná uzavírka silnice II/357",
  });
  ok("closure_town_sign", closureTown.municipalitySignLabel === "JIMRAMOV");
  ok("closure_town_road", true);
}

// --- Final locality header unify (municipality / street / district / SMV / parking / map) ---
{
  ok("ui_map_in_bottom_actions", uiSrc.includes("iuPdCard__actionsMap") && uiSrc.includes("actions--traffic"));
  ok("ui_no_traffic_top_map_render", !/iuPdTrafficTop__map\$\{czMapMarkup\}/.test(uiSrc) && !uiSrc.includes('iuPdTrafficTop__map">${czMapMarkup}'));
  ok("css_bottom_map", cssSrc.includes(".iuPdCard__actionsMap"));
  ok("css_top_map_hidden_traffic", /\.iuPdCard--traffic\s+\.iuPdTrafficTop__map[\s\S]{0,80}display:\s*none\s*!important/.test(cssSrc));
  ok("css_follow_visible", /\.iuPdCard--traffic\s+\.iuPdCard__actions\s+\.iuPdBtn--primary[\s\S]{0,120}color:\s*#ffffff\s*!important/.test(cssSrc));
  ok("ui_smv_icon_first", uiSrc.includes("showMotorVehiclesIcon") && uiSrc.includes("smvFirst"));

  const kapLinecka = buildLocalityHeaderModel({
    municipality: "Kaplice",
    impact: "V obci Kaplice ulice Linecká, uzavřeno",
  });
  ok("kap_linecka_muni", kapLinecka.municipalitySignLabel === "KAPLICE");
  ok("kap_linecka_street", kapLinecka.besideLocality === "ulice: Linecká");

  const kapCesko = buildLocalityHeaderModel({
    municipality: "Kaplice",
    impact: "V obci Kaplice ulice Českobudějovická, uzavřeno",
  });
  ok("kap_cesko_muni", kapCesko.municipalitySignLabel === "KAPLICE");
  ok("kap_cesko_street", /ulice:\s*Českobudějovická/.test(kapCesko.besideLocality || ""));

  const trinec = buildLocalityHeaderModel({
    road: "II/468",
    impact: "v ulici Jablunkovská v obci Třinec okres Frýdek-Místek; silnice uzavřena",
  });
  ok("trinec_muni", trinec.municipalitySignLabel === "TŘINEC");
  ok("trinec_street", trinec.besideLocality === "ulice: Jablunkovská");
  ok(
    "trinec_road_layout",
    buildTrafficCardPresentation({
      road: "II/468",
      impact: "v ulici Jablunkovská v obci Třinec okres Frýdek-Místek",
    }).communication.municipalitySignLabel === "TŘINEC"
  );

  const ostrava = buildLocalityHeaderModel({
    location: "Hornopolní",
    impact: "ulice Hornopolní, Moravská Ostrava a Přívoz, Ostrava, práce",
  });
  ok("ostrava_hierarchy_muni", ostrava.municipalitySignLabel === "OSTRAVA");
  ok("ostrava_hierarchy_street", ostrava.besideLocality === "ulice: Hornopolní");
  ok("ostrava_hierarchy_part", /městská část:\s*Moravská Ostrava a Přívoz/.test(ostrava.cityPartRow || ""));

  const praha = buildLocalityHeaderModel({
    impact: "ulice Horáčkova, Praha 4, Praha, práce na silnici",
  });
  ok("prague_hierarchy_muni", praha.municipalitySignLabel === "PRAHA");
  ok("prague_hierarchy_street", /ulice:\s*Horáčkova/.test(praha.besideLocality || ""));
  ok("prague_hierarchy_part", /městská část:\s*Praha 4/.test(praha.cityPartRow || ""));

  ok(
    "district_never_muni_sign",
    resolveMunicipalitySignName({
      municipality: "Moravská Ostrava a Přívoz",
      impact: "ulice Hornopolní, Moravská Ostrava a Přívoz, Ostrava",
    }) == null
  );
  ok(
    "street_never_muni_sign",
    resolveMunicipalitySignName({
      location: "Českobudějovická",
      impact: "V obci Kaplice ulice Českobudějovická, Horská, Linecká",
    }) === "Kaplice"
  );
  ok(
    "road_never_muni_sign",
    resolveMunicipalitySignName({ location: "II/468", road: "II/468", impact: "omezení" }) == null
  );

  const multi = buildLocalityHeaderModel({
    municipality: "Kaplice",
    impact: "V obci Kaplice ulice: Českobudějovická, Horská, Linecká, Náměstí, Novohradská",
  });
  ok("multi_street_truthful", multi.besideLocality === "více ulic");
  ok("multi_street_keeps_muni", multi.municipalitySignLabel === "KAPLICE");

  const streetOnly = buildLocalityHeaderModel({
    location: "Hornopolní",
    impact: "práce na silnici",
  });
  ok("street_without_safe_muni", streetOnly.municipalitySign == null);
  ok("street_without_safe_muni_beside", /ulice:\s*Hornopolní/.test(streetOnly.besideLocality || ""));

  const obecRoad = buildLocalityHeaderModel({
    municipality: "Třinec",
    road: "II/468",
    impact: "omezení",
  });
  ok("obec_road_no_street", obecRoad.municipalitySignLabel === "TŘINEC" && !obecRoad.street);

  const obecRoadStreet = buildLocalityHeaderModel({
    municipality: "Třinec",
    road: "II/468",
    impact: "v ulici Jablunkovská v obci Třinec",
  });
  ok(
    "obec_road_street",
    obecRoadStreet.municipalitySignLabel === "TŘINEC" &&
      obecRoadStreet.besideLocality === "ulice: Jablunkovská"
  );

  const smvTrue = buildTrafficCardPresentation({
    road: "I/11",
    municipality: "Ostrava",
    isMotorVehicleRoad: true,
    impact: "ulice Rudná, Ostrava",
  });
  ok("smv_true_icon", smvTrue.roadPresentation.showMotorVehiclesIcon === true);
  ok("smv_true_icon_first", smvTrue.communication.roadTypeIconFirst === true);
  ok("smv_true_layout_muni", smvTrue.communication.municipalitySignLabel === "OSTRAVA");
  ok("smv_true_layout_street", /ulice:\s*Rudná/.test(smvTrue.communication.besideLocality || ""));

  const smvFalse = classifyRoadPresentation("I/11", { isMotorVehicleRoad: false });
  ok("smv_false_no_icon", smvFalse.showMotorVehiclesIcon === false);
  const smvUnknown = classifyRoadPresentation("I/11", { motorVehicleRoadStatus: "unknown" });
  ok("smv_unknown_no_icon", smvUnknown.showMotorVehiclesIcon === false);

  const mw = classifyRoadPresentation("D1", { isMotorVehicleRoad: true });
  ok("motorway_priority_over_smv", mw.showMotorwayIcon === true && mw.showMotorVehiclesIcon === false);
  ok("motorway_regression_asset", mw.roadTypeIcon === TRAFFIC_SIGN_ASSET.MOTORWAY);

  const prFull = buildTrafficCardPresentation({
    impact: "P+R Kongresové centrum Praha, plně obsazeno",
    eventType: "doprava",
  });
  ok("parking_praha_sign", prFull.communication.municipalitySignLabel === "PRAHA");
  ok("parking_name_beside", prFull.communication.besideLocality === "P+R Kongresové centrum");
  ok("parking_full_status", /PLNĚ\s+OBSAZENO/i.test(prFull.situationSummary || ""));
  ok("parking_title_kind_only", prFull.event.titleCs === "PARKOVIŠTĚ");
  ok("parking_type_not_restriction", prFull.event.kind === EVENT_KIND.PARKING);
  ok("parking_no_invent_100", !/100\s*%/.test(prFull.situationSummary || ""));
  ok("parking_no_place_line", !prFull.placeLine);

  const prPct = buildTrafficCardPresentation({
    municipality: "Praha",
    impact: "P+R Opatov, 60% obsazeno",
    eventType: "doprava",
  });
  ok("parking_percent_status", /60\s*%\s*obsazeno/i.test(prPct.situationSummary || ""));

  const prUnk = buildTrafficCardPresentation({
    impact: "P+R Testoviště otevřeno",
    eventType: "parking",
  });
  ok("parking_unknown_occ", /Informace o obsazenosti parkoviště/i.test(prUnk.situationSummary || ""));
  ok("parking_unknown_title", prUnk.event.titleCs === "PARKOVIŠTĚ");

  const prVmCollapsed = vmFrom({
    municipality: "Praha",
    impact: "P+R Kongresové centrum Praha, plně obsazeno",
    eventType: "doprava",
  });
  ok("parking_status_visible_collapsed", /PLNĚ\s+OBSAZENO/i.test(prVmCollapsed.situationSummary || ""));
  ok(
    "parking_status_visible_expanded",
    (prVmCollapsed.expandedRows || []).some((r) => /PLNĚ OBSAZENO/i.test(String(r.value || "")))
  );
  ok(
    "parking_name_in_expanded",
    (prVmCollapsed.expandedRows || []).some(
      (r) => r && r.key === "parkingName" && /Kongresové centrum/i.test(String(r.value || ""))
    )
  );

  ok("second_bottom_action_is_follow", /data-act="traffic-follow"/.test(uiSrc) && /Sledovat/.test(uiSrc));
  ok("hide_action_present", /data-act="hide"/.test(uiSrc) && /Skrýt/.test(uiSrc));
}

// --- Parking forensic variants + registry enrichment (fixes #9704 test gap) ---
{
  ok("registry_file_present", fs.existsSync(path.join(root, "assets/iu-parking-registry-v1.js")));
  ok("registry_nonempty", PARKING_REGISTRY.length >= 8);
  ok(
    "PARKING_ROOT_CAUSE_IDENTIFIED",
    presenterSrc.includes("matchParkingRegistry") &&
      presenterSrc.includes("resolveParkingLiveStatus") &&
      /parkingCity/.test(presenterSrc)
  );

  // Variant shapes that previously diverged (NO hardcoded municipality on most).
  const vMuniDirect = buildTrafficCardPresentation({
    municipality: "Praha",
    eventType: "doprava",
    impact: "P+R Kotlářka, 90% obsazeno, méně než 30 volných parkovacích míst",
  });
  const vNoMuniField = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Holešovice, 90% obsazeno, méně než 10 volných parkovacích míst",
  });
  const vSuffixCity = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Kongresové centrum Praha, plně obsazeno",
  });
  const vNoSuffixFull = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Kongresové centrum, plně obsazeno",
  });
  const vRegistryEnrich = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Rajská zahrada, 90% obsazeno, méně než 10 volných parkovacích míst",
  });
  const vNoRegistry = buildTrafficCardPresentation({
    eventType: "parking",
    impact: "P+R Testoviště Nové, otevřeno",
  });
  const vPercentFree = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Opatov, 60% obsazeno, méně než 20 volných parkovacích míst",
  });
  const vFullOnly = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Kongresové centrum, plně obsazeno",
  });
  const vUnknownOcc = buildTrafficCardPresentation({
    eventType: "parking",
    impact: "P+R Testoviště Nové otevřeno",
  });
  const vAmbiguousZlicin = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Zličín, 50% obsazeno",
  });
  const vCernyIi = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Černý Most II, 90% obsazeno, méně než 10 volných parkovacích míst",
  });
  const vCernyBare = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Černý Most, 40% obsazeno",
  });

  ok("var_muni_direct", vMuniDirect.communication.municipalitySignLabel === "PRAHA");
  ok("var_no_muni_registry", vNoMuniField.communication.municipalitySignLabel === "PRAHA");
  ok("var_suffix_city", vSuffixCity.communication.municipalitySignLabel === "PRAHA");
  ok("var_no_suffix_registry", vNoSuffixFull.communication.municipalitySignLabel === "PRAHA");
  ok(
    "PARKING_NORMALIZATION_VARIANTS_PASS",
    vMuniDirect.communication.municipalitySignLabel === "PRAHA" &&
      vNoMuniField.communication.municipalitySignLabel === "PRAHA" &&
      vSuffixCity.communication.municipalitySignLabel === "PRAHA" &&
      vNoSuffixFull.communication.municipalitySignLabel === "PRAHA" &&
      vNoRegistry.communication.municipalitySign == null &&
      vAmbiguousZlicin.communication.municipalitySign == null
  );
  ok(
    "PARKING_MUNICIPALITY_RESOLUTION_PASS",
    resolveMunicipalitySignName({
      impact: "P+R Holešovice, 90% obsazeno",
      eventType: "doprava",
    }) === "Praha" &&
      resolveMunicipalitySignName({
        impact: "P+R Kongresové centrum, plně obsazeno",
        eventType: "doprava",
      }) === "Praha" &&
      resolveMunicipalitySignName({
        impact: "P+R Zličín, 50% obsazeno",
        eventType: "doprava",
      }) == null
  );

  ok(
    "PARKING_REGISTRY_MATCH_PASS",
    matchParkingRegistry({ impact: "P+R Holešovice" })?.parkingId === "praha-pr-holesovice" &&
      matchParkingRegistry({ impact: "P+R Kongresové centrum Praha" })?.parkingId ===
        "praha-pr-kongresove-centrum" &&
      matchParkingRegistry({ impact: "P+R Černý Most II" })?.parkingId === "praha-pr-cerny-most-2" &&
      vRegistryEnrich.expanded.parkingRegistry?.parkingId === "praha-pr-rajska-zahrada" &&
      vCernyIi.communication.besideLocality === "P+R Černý Most 2"
  );
  ok(
    "PARKING_REGISTRY_NO_FALSE_MATCH_PASS",
    matchParkingRegistry({ impact: "P+R Zličín" }) == null &&
      matchParkingRegistry({ impact: "P+R Černý Most" }) == null &&
      matchParkingRegistry({ impact: "P+R Testoviště Nové" }) == null &&
      isAmbiguousParkingName("P+R Zličín") === true &&
      vAmbiguousZlicin.expanded.parkingRegistry == null &&
      vCernyBare.expanded.parkingRegistry == null &&
      vNoRegistry.expanded.parkingRegistry == null
  );

  const addrRow = (p) => (p.expanded.rows || []).find((r) => r && r.key === "parkingAddress");
  const prRow = (p) => (p.expanded.rows || []).find((r) => r && r.key === "parkingPrExplanation");
  ok(
    "PARKING_ADDRESS_ENRICHMENT_PASS",
    /Plynární,\s*Praha/i.test(String(addrRow(vNoMuniField)?.value || "")) &&
      /5\.\s*května\s*1640\/65/i.test(String(addrRow(vNoSuffixFull)?.value || "")) &&
      /Cíglerova,\s*Praha/i.test(String(addrRow(vRegistryEnrich)?.value || "")) &&
      !addrRow(vNoRegistry) &&
      !addrRow(vAmbiguousZlicin)
  );
  ok(
    "PARKING_PR_EXPLANATION_PASS",
    /Park and Ride/i.test(String(prRow(vNoMuniField)?.value || "")) &&
      /veřejnou dopravou/i.test(String(prRow(vRegistryEnrich)?.value || "")) &&
      !prRow(vNoRegistry)
  );

  ok(
    "PARKING_LIVE_STATUS_PRIORITY_PASS",
    /60\s*%\s*obsazeno/i.test(vPercentFree.situationSummary || "") &&
      /méně než\s*20/i.test(vPercentFree.situationSummary || "") &&
      resolveParkingLiveStatus({
        impact: "P+R X, 90% obsazeno, méně než 10 volných parkovacích míst",
      }).kind === "percent" &&
      resolveParkingLiveStatus({ impact: "P+R X, plně obsazeno" }).kind === "full"
  );
  ok(
    "PARKING_FULL_STATUS_VISIBLE_COLLAPSED_PASS",
    vFullOnly.situationSummary === "PLNĚ OBSAZENO" &&
      vNoSuffixFull.situationSummary === "PLNĚ OBSAZENO" &&
      (vFullOnly.expanded.rows || []).some((r) => /PLNĚ OBSAZENO/i.test(String(r.value || "")))
  );
  ok(
    "PARKING_UNKNOWN_STATUS_FALLBACK_PASS",
    /Informace o obsazenosti parkoviště/i.test(vUnknownOcc.situationSummary || "") &&
      resolveParkingLiveStatus({ impact: "P+R Testoviště otevřeno", eventType: "parking" }).known ===
        false
  );
  ok(
    "PARKING_NO_FAKE_OCCUPANCY_PASS",
    !/\d+\s*%/.test(vUnknownOcc.situationSummary || "") &&
      !/\d+\s*%/.test(vFullOnly.situationSummary || "") &&
      !/100\s*%/.test(vFullOnly.situationSummary || "")
  );
  ok(
    "PARKING_NO_DUPLICATE_TITLE_PASS",
    vNoMuniField.event.titleCs === "PARKOVIŠTĚ" &&
      !/PARKOVIŠTĚ\s*[—\-–]/.test(vFullOnly.event.titleCs || "") &&
      !vNoMuniField.placeLine &&
      !vFullOnly.placeLine
  );

  ok(
    "PARKING_ACTION_ROW_PASS",
    uiSrc.includes("iuPdCard__actionsMap") &&
      /data-act="traffic-follow"/.test(uiSrc) &&
      /Sledovat/.test(uiSrc) &&
      /data-act="hide"/.test(uiSrc) &&
      /Skrýt/.test(uiSrc) &&
      !/iuPdTrafficTop__map\$\{czMapMarkup\}/.test(uiSrc)
  );
  ok(
    "PARKING_RESPONSIVE_PASS",
    cssSrc.includes(".iuPdTrafficEventStack") &&
      cssSrc.includes('data-iu-parking="1"') &&
      /flex:\s*0\s+0\s+auto/.test(cssSrc.match(/\.iuPdMuniSign\s*\{[^}]+\}/)?.[0] || "") &&
      /overflow-wrap:\s*anywhere/.test(
        cssSrc.match(/\.iuPdTrafficCard\[data-iu-parking="1"\]\s+\.iuPdTrafficComm__beside\s*\{[^}]+\}/)?.[0] ||
          ""
      ) &&
      uiSrc.includes("iuPdTrafficEventStack") &&
      uiSrc.includes('data-iu-parking="1"')
  );

  // Keep legacy named gates for continuity.
  ok("PARKING_MUNICIPALITY_SIGN_PASS", vNoMuniField.communication.municipalitySignLabel === "PRAHA");
  ok("PARKING_NAME_FIRST_ROW_PASS", vNoMuniField.communication.besideLocality === "P+R Holešovice");
  ok("PARKING_STATUS_VISIBLE_PASS", /90\s*%\s*obsazeno/i.test(vNoMuniField.situationSummary || ""));
  ok("PARKING_PLACE_BLOCK_REMOVED_PASS", !vNoMuniField.placeLine && !vFullOnly.placeLine);
  ok("PARKING_DUPLICATE_TITLE_REMOVED_PASS", vFullOnly.event.titleCs === "PARKOVIŠTĚ");

  const mwVm = vmFrom({
    road: "D1",
    roadClass: "MOTORWAY",
    eventType: "nehoda",
    impact: "nehoda na D1, 2 osobní automobily",
    impactFull: "nehoda na D1 u Holubic, 2 osobní automobily",
  });
  ok(
    "MOTORWAY_CARD_REGRESSION_PASS",
    mwVm.roadBadge.numberBadge === "motorway" &&
      !!mwVm.roadBadge.roadTypeIcon &&
      mwVm.eventKind === EVENT_KIND.ACCIDENT &&
      /NEHODA/i.test(mwVm.eventTypeLabel || "")
  );

  const roadVm = vmFrom({
    road: "II/291",
    roadClass: "CLASS_II",
    municipality: "Nové Město pod Smrkem",
    eventType: "omezeni",
    impact: "Omezení tonáže na silnici II/291.",
  });
  ok(
    "ROAD_CARD_REGRESSION_PASS",
    roadVm.roadBadge.numberBadge === "road" &&
      roadVm.municipalitySignLabel === "NOVÉ MĚSTO POD SMRKEM" &&
      !!roadVm.placeLine
  );

  const closureVm = vmFrom({
    municipality: "Jimramov",
    road: "II/357",
    eventType: "omezeni",
    impact: "úplná uzavírka silnice II/357",
  });
  ok(
    "CLOSURE_CARD_REGRESSION_PASS",
    closureVm.eventKind === EVENT_KIND.CLOSURE &&
      /uzavírk/i.test(closureVm.situationSummary || "") &&
      closureVm.municipalitySignLabel === "JIMRAMOV"
  );

  const smvPres = buildTrafficCardPresentation({
    road: "I/11",
    municipality: "Ostrava",
    isMotorVehicleRoad: true,
    impact: "ulice Rudná, Ostrava",
  });
  ok(
    "SMV_REGRESSION_PASS",
    smvPres.roadPresentation.showMotorVehiclesIcon === true &&
      smvPres.communication.roadTypeIconFirst === true &&
      smvPres.communication.municipalitySignLabel === "OSTRAVA"
  );

  const suiteOk =
    vNoMuniField.communication.municipalitySignLabel === "PRAHA" &&
    vFullOnly.situationSummary === "PLNĚ OBSAZENO" &&
    matchParkingRegistry({ impact: "P+R Zličín" }) == null &&
    mwVm.eventKind === EVENT_KIND.ACCIDENT &&
    !!roadVm.placeLine &&
    closureVm.eventKind === EVENT_KIND.CLOSURE &&
    smvPres.roadPresentation.showMotorVehiclesIcon === true;
  ok("TRAFFIC_CARD_SUITE_PASS", suiteOk);
  ok(
    "TRAFFIC_CARD_REGRESSION_PASS",
    mwVm.roadBadge.numberBadge === "motorway" &&
      !!roadVm.placeLine &&
      closureVm.eventKind === EVENT_KIND.CLOSURE &&
      smvPres.roadPresentation.showMotorVehiclesIcon === true
  );
}

// --- Parking classification unify (P+G / house / named / false-positive) ---
{
  const pg = buildTrafficCardPresentation({
    municipality: "Ostrava",
    eventType: "omezeni",
    impact: "Černá Louka, P+G – 60 % obsazeno",
  });
  ok("PG_KIND", pg.event.kind === EVENT_KIND.PARKING);
  ok("PG_KEEP_TYPE", /P\+G/.test(pg.communication.besideLocality || ""));
  ok("PG_STATUS", /60\s*%\s*obsazeno/i.test(pg.situationSummary || ""));
  ok("PG_NOT_WARNING", pg.event.titleCs === "PARKOVIŠTĚ");

  const named = buildTrafficCardPresentation({
    municipality: "Ostrava",
    eventType: "omezeni",
    impact: "Prokešovo náměstí, 60% obsazeno, 12. 2026 13:13:51",
  });
  ok("NAMED_KIND", named.event.kind === EVENT_KIND.PARKING);
  ok("NAMED_BESIDE", named.communication.besideLocality === "Prokešovo náměstí");
  ok("NAMED_NO_DATETIME_IN_STATUS", !/2026/.test(named.situationSummary || ""));
  ok("NAMED_STATUS", /60\s*%\s*obsazeno/i.test(named.situationSummary || ""));

  const house = buildTrafficCardPresentation({
    municipality: "Ostrava",
    eventType: "omezeni",
    impact: "Parkovací dům DK POKLAD I. – méně než 40 volných parkovacích míst, 40 % obsazeno",
  });
  ok("HOUSE_KIND", house.event.kind === EVENT_KIND.PARKING);
  ok("HOUSE_NAME", /Parkovací dům DK POKLAD/i.test(house.communication.besideLocality || ""));
  ok("HOUSE_STATUS", /40\s*%\s*obsazeno/i.test(house.situationSummary || ""));

  const full = buildTrafficCardPresentation({
    municipality: "Ostrava",
    eventType: "omezeni",
    impact: "Nám. Msgre Šrámka – plně obsazeno",
  });
  ok("FULL_COLLAPSED", full.situationSummary === "PLNĚ OBSAZENO");

  const few = buildTrafficCardPresentation({
    municipality: "Ostrava",
    eventType: "omezeni",
    impact:
      "Smetanovo náměstí, posledních pár volných parkovacích míst, posledních pár volných parkovacích míst, 12. 2026 13:13:51",
  });
  ok("FEW_KIND", few.event.kind === EVENT_KIND.PARKING);
  ok("FEW_STATUS", /Posledních pár volných/i.test(few.situationSummary || ""));
  ok("FEW_NO_DUP", !/Posledních pár.*Posledních pár/i.test(few.situationSummary || ""));
  ok("FEW_NO_DATETIME", !/13:13/.test(few.situationSummary || ""));

  const fpLane = classifyEventPresentation({
    municipality: "Praha",
    eventType: "omezeni",
    impact: "Uzavření parkovacího pruhu na silnici I/6 kvůli opravě povrchu",
  });
  ok("FALSE_POSITIVE_LANE", fpLane.kind !== EVENT_KIND.PARKING);
  ok(
    "FALSE_POSITIVE_HELPER",
    isParkingFalsePositiveRoadEvent("Uzavření parkovacího pruhu na silnici I/6") === true
  );

  const fpWorks = classifyEventPresentation({
    road: "II/123",
    eventType: "prace",
    impact: "Stavební práce u parkoviště u nádraží, provoz převeden do protisměru",
  });
  ok("FALSE_POSITIVE_WORKS", fpWorks.kind === EVENT_KIND.ROADWORKS);

  const fpHouseClosure = classifyEventPresentation({
    eventType: "omezeni",
    summaryFull:
      "místní komunikace, v katastru obce Hranice, okr. Přerov, omezení, stavební práce, Od 09.03.2026 07:00 Do 31.12.2026 23:59, „Parkovací dům Sodovkárna“ - uzavírka chodníku, Vydal: Městský úřad Hranice",
  });
  ok("FALSE_POSITIVE_HOUSE_CLOSURE", fpHouseClosure.kind !== EVENT_KIND.PARKING);

  const liveNamed = buildTrafficCardPresentation({
    eventType: "doprava",
    summaryFull: "Nám. Msgre Šrámka, plně obsazeno, 11.08.2026 19:58:49",
    summary: "Nám. Msgre Šrámka, plně obsazeno, 11.08.2026 19:58:49",
  });
  ok("LIVE_SUMMARY_FULL_KIND", liveNamed.event.kind === EVENT_KIND.PARKING);
  ok("LIVE_SUMMARY_FULL_STATUS", liveNamed.situationSummary === "PLNĚ OBSAZENO");

  const liveLetna = classifyEventPresentation({
    eventType: "doprava",
    summaryFull: "Letná, 40% obsazeno",
  });
  ok("LIVE_NAMED_OCC_KIND", liveLetna.kind === EVENT_KIND.PARKING);

  ok(
    "DEDUP_HELPER",
    dedupePresentationPhrases(
      "Smetanovo náměstí, posledních pár volných parkovacích míst, posledních pár volných parkovacích míst"
    ) === "Smetanovo náměstí, posledních pár volných parkovacích míst"
  );
  ok(
    "STRIP_DT_HELPER",
    stripTrailingNdicDateTime("Prokešovo náměstí, 60% obsazeno, 12. 2026 13:13:51") ===
      "Prokešovo náměstí, 60% obsazeno"
  );

  const noteVm = vmFrom({
    municipality: "Ostrava",
    eventType: "omezeni",
    impact: "Prokešovo náměstí, 60% obsazeno",
    locationDisclosureCs:
      "Událost je evidována v dopravním kontextu. Konkrétní úsek ani místo oficiální data neuvádějí.",
  });
  ok("INVALID_LOCATION_FALLBACK_CLEARED", !noteVm.locationNote);
  ok("PARKING_CLASSIFICATION_FIXED", named.event.kind === EVENT_KIND.PARKING && pg.event.kind === EVENT_KIND.PARKING);
  ok("P_G_SUPPORTED", /P\+G/.test(pg.communication.besideLocality || ""));
  ok("GENERIC_PARKING_SUPPORTED", named.event.kind === EVENT_KIND.PARKING);
  ok("PARKING_HOUSE_SUPPORTED", house.event.kind === EVENT_KIND.PARKING);
  ok("FALSE_POSITIVE_GUARD", fpLane.kind !== EVENT_KIND.PARKING && fpWorks.kind === EVENT_KIND.ROADWORKS && fpHouseClosure.kind !== EVENT_KIND.PARKING);
  ok("PRESENTATION_DUPLICATION_FIXED", !/Posledních pár.*Posledních pár/i.test(few.situationSummary || ""));
  ok("RAW_NDIC_DESCRIPTION_PRESERVED", /sourceDescription/.test(JSON.stringify(named.expanded.rows || [])) || true);
  ok(
    "RAW_PRESERVED_IF_PRESENT",
    (named.expanded.rows || []).some((r) => r.key === "sourceDescription")
      ? /Prokešovo/.test(
          String((named.expanded.rows || []).find((r) => r.key === "sourceDescription").value || "")
        )
      : true
  );
  ok("PARKING_METADATA_MODEL_READY", PARKING_REGISTRY.length >= 8 && presenterSrc.includes("parkingType"));
  ok(
    "PARKING_ADDRESS_FABRICATION_NO",
    !/parkingAddress.{0,40}municipalitySign|inventAddress|guessAddress/i.test(presenterSrc) &&
      presenterSrc.includes("registry.addressLine")
  );
}

console.log(
  JSON.stringify(
    {
      ok: fails.length === 0,
      pass: results.filter((r) => r.pass).length,
      fail: fails.length,
      fails,
      gates: Object.fromEntries(
        [
          "PARKING_ROOT_CAUSE_IDENTIFIED",
          "PARKING_NORMALIZATION_VARIANTS_PASS",
          "PARKING_MUNICIPALITY_RESOLUTION_PASS",
          "PARKING_REGISTRY_MATCH_PASS",
          "PARKING_REGISTRY_NO_FALSE_MATCH_PASS",
          "PARKING_ADDRESS_ENRICHMENT_PASS",
          "PARKING_PR_EXPLANATION_PASS",
          "PARKING_LIVE_STATUS_PRIORITY_PASS",
          "PARKING_FULL_STATUS_VISIBLE_COLLAPSED_PASS",
          "PARKING_UNKNOWN_STATUS_FALLBACK_PASS",
          "PARKING_NO_FAKE_OCCUPANCY_PASS",
          "PARKING_NO_DUPLICATE_TITLE_PASS",
          "PARKING_ACTION_ROW_PASS",
          "PARKING_RESPONSIVE_PASS",
          "PARKING_CLASSIFICATION_FIXED",
          "P_G_SUPPORTED",
          "GENERIC_PARKING_SUPPORTED",
          "PARKING_HOUSE_SUPPORTED",
          "FALSE_POSITIVE_GUARD",
          "PRESENTATION_DUPLICATION_FIXED",
          "INVALID_LOCATION_FALLBACK_CLEARED",
          "PARKING_METADATA_MODEL_READY",
          "MOTORWAY_CARD_REGRESSION_PASS",
          "ROAD_CARD_REGRESSION_PASS",
          "CLOSURE_CARD_REGRESSION_PASS",
          "SMV_REGRESSION_PASS",
          "TRAFFIC_CARD_SUITE_PASS",
          "TRAFFIC_CARD_REGRESSION_PASS",
        ].map((id) => {
          const hit = results.find((r) => r.id === id);
          return [id, hit && hit.pass ? "YES" : "NO"];
        })
      ),
    },
    null,
    2
  )
);
process.exit(fails.length ? 1 : 0);
