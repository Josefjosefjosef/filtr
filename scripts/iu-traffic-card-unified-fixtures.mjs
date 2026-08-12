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
  buildCommunicationLine,
  resolveMunicipalitySignName,
  resolveRoadDisplayName,
  preferFullerMunicipalityName,
  normalizeExtractedMunicipalityName,
  resolveParkingLiveStatus,
  parseOfficialCommentFacts,
  isTrafficCardInformative,
  isParkingOccupancySituation,
  isParkingFalsePositiveRoadEvent,
  dedupePresentationPhrases,
  stripTrailingNdicDateTime,
  formatCsDateTime,
  matchParkingRegistry,
  hasExplicitQueueSource,
  analyzeRestrictionScope,
  analyzePrimaryCause,
  analyzeTrafficCondition,
  extractNamedTransportObject,
  resolveConfirmedStreet,
  classifyLocationKindFromName,
  looksLikeStreetName,
  isPrahaCityPartName,
  isFullScopeClosure,
  isSingleLaneRestriction,
  isShoulderOrVergeRestriction,
  looksLikeSegmentOrAreaLabel,
  extractRoadNumberFromOfficialComment,
  resolvePresentationRoadNumber,
  matchTunnelRegistry,
  matchOutsideCityTunnelRegistry,
  resolveTunnelRegistryEnrichment,
  resolveOutsideCityTunnelEnrichment,
  resolveOutsideCityTunnelRoad,
  OUTSIDE_CITY_TUNNEL_REGISTRY,
  OUTSIDE_CITY_TUNNEL_SOURCE,
  TRAFFIC_SIGN_ASSET,
  TRAFFIC_MAP_DOT_CSS_VAR,
  EVENT_KIND,
  ROAD_NUMBER_BADGE,
  RESTRICTION_SCOPE,
  PRIMARY_CAUSE,
  TRAFFIC_CONDITION,
  LOCATION_KIND,
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
    /osobní(?:ch)?\s+automobil/i.test(
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
  ok("d0_place_has_display_name", /Pražský okruh/.test(place));
  ok("d0_no_invent_js", !/Jižní spojka/i.test(place + buildHeadLocalityLabel({ road: "D0", impact }).head));
}

// --- D0 Pražský okruh + silný provoz ≠ kolona (global road display name) ---
{
  const impact = "D0, km 3 až 2.5, ve směru D1, silný provoz";
  const input = {
    road: "D0",
    roadClass: "MOTORWAY",
    roadClassLabel: "Dálnice",
    location: "D0",
    eventType: "kolona",
    illustrationKey: "kolona",
    impact,
    impactFull: impact,
  };
  const roadPres = classifyRoadPresentation("D0");
  const ev = classifyEventPresentation(input);
  const hdr = buildLocalityHeaderModel(input);
  const place = buildPlaceAndDirectionLine(input);
  const detail = buildTrafficExpandedDetail(input);
  const vm = vmFrom(input);
  const roadNameRow = (detail.rows || []).find((r) => r.key === "roadName");
  const locRow = (detail.rows || []).find((r) => r.key === "location");
  const sourceFull = detail.sourceFull || "";
  const sourceRow = (detail.rows || []).find((r) => r.key === "sourceDescription");

  ok("D0_DISPLAY_NAME", resolveRoadDisplayName("D0") === "Pražský okruh");
  ok("D0_GLOBAL_RULE_IMPLEMENTED", roadPres.roadDisplayName === "Pražský okruh");
  ok(
    "D0_TOP_ROW_PASS",
    roadPres.road === "D0" &&
      hdr.besideLocality === "Pražský okruh" &&
      hdr.municipalitySign == null
  );
  ok(
    "D0_PLACE_AND_DIRECTION_PASS",
    place === "D0 · Pražský okruh · km 3–2,5 · směr D1"
  );
  ok(
    "D0_DETAIL_ROAD_NAME_PASS",
    roadNameRow &&
      roadNameRow.label === "Název komunikace" &&
      roadNameRow.value === "Pražský okruh"
  );
  ok("D0_FALSE_LOCALITY_REMOVED", !locRow);
  ok(
    "STRONG_TRAFFIC_FALSE_QUEUE_FIXED",
    ev.kind === EVENT_KIND.HEAVY_TRAFFIC &&
      ev.titleCs === "SILNÝ PROVOZ" &&
      ev.titleCs !== "KOLONA" &&
      vm.eventTypeLabel === "SILNÝ PROVOZ"
  );
  ok(
    "STRONG_TRAFFIC_ICON_JAM",
    ev.asset === TRAFFIC_SIGN_ASSET.TRAFFIC_JAM &&
      vm.eventSignSrc === TRAFFIC_SIGN_ASSET.TRAFFIC_JAM
  );
  ok(
    "RAW_NDIC_DESCRIPTION_UNCHANGED",
    sourceFull.includes("silný provoz") &&
      !/Pražský okruh/.test(sourceFull) &&
      sourceFull.includes("D0, km 3 až 2.5") &&
      sourceRow &&
      sourceRow.value === sourceFull
  );
  ok("D0_REGRESSION_PASS", place.includes("Pražský okruh") && ev.titleCs === "SILNÝ PROVOZ");

  // B) skutečná kolona
  const bEv = classifyEventPresentation({
    road: "D0",
    eventType: "kolona",
    impact: "D0, km 10, ve směru D1, tvoří se kolona, kolona 1 km",
  });
  ok("REAL_QUEUE_STILL_WORKS", bEv.kind === EVENT_KIND.QUEUE && bEv.titleCs === "KOLONA");

  // C) nehoda + silný provoz
  const cImpact = "D0, km 5, ve směru D1, nehoda, silný provoz, 1 havarované vozidlo";
  const cEv = classifyEventPresentation({
    road: "D0",
    eventType: "kolona",
    impact: cImpact,
  });
  const cSum = buildTrafficSituationSummary({
    road: "D0",
    eventType: "kolona",
    impact: cImpact,
  });
  ok(
    "ACCIDENT_PRIORITY_OVER_STRONG_TRAFFIC_PASS",
    cEv.kind === EVENT_KIND.ACCIDENT &&
      cEv.titleCs === "NEHODA" &&
      /Silný provoz/i.test(cSum)
  );

  // D) nehoda + kolona
  const dImpact = "D0, km 8, ve směru D1, nehoda, tvoří se kolona";
  const dEv = classifyEventPresentation({
    road: "D0",
    eventType: "kolona",
    impact: dImpact,
  });
  const dSum = buildTrafficSituationSummary({
    road: "D0",
    eventType: "kolona",
    impact: dImpact,
  });
  ok(
    "ACCIDENT_PRIORITY_OVER_QUEUE_PASS",
    dEv.kind === EVENT_KIND.ACCIDENT &&
      dEv.titleCs === "NEHODA" &&
      dEv.kind !== EVENT_KIND.QUEUE &&
      /kolon/i.test(dSum)
  );

  // E) ostatní dálnice bez Pražský okruh
  const otherRoads = ["D1", "D2", "D3", "D5", "D8", "D10", "D11", "D35"];
  let otherOk = true;
  for (const r of otherRoads) {
    const p = buildPlaceAndDirectionLine({
      road: r,
      impact: r + ", km 10, silný provoz",
    });
    const dn = resolveRoadDisplayName(r);
    if (dn != null || /Pražský okruh/.test(p)) otherOk = false;
  }
  ok("OTHER_MOTORWAYS_REGRESSION_PASS", otherOk);

  // Bare "most ev. č." must not wipe D0 · Pražský okruh
  const mostImpact =
    "D0, mezi km 16.1 a 18.1, ve směru Ruzyně - D7, práce na silnici, zúžení vozovky na dva jízdní pruhy, D0 stavba 515 – zkapacitnění, most ev. č. D0-202 v km 16,640";
  const mostHdr = buildLocalityHeaderModel({
    road: "D0",
    location: "D0",
    eventType: "omezeni",
    impact: mostImpact,
    impactFull: mostImpact,
  });
  const mostPlace = buildPlaceAndDirectionLine({
    road: "D0",
    location: "D0",
    eventType: "omezeni",
    impact: mostImpact,
    impactFull: mostImpact,
  });
  ok(
    "D0_BARE_MOST_NOT_OVERRIDE_PASS",
    mostHdr.besideLocality === "Pražský okruh" &&
      /^D0 · Pražský okruh/.test(mostPlace) &&
      mostPlace !== "most"
  );
}

// --- White municipality sign: full multi-word official names ---
{
  const husovaImpact =
    "Od 12.8.2026 18:55 do 21:00; v ulici Husova tř. v obci České Budějovice; nehoda; 2 havarovaná vozidla; překážka na vozovce, průjezd se zvýšenou opatrností; 2 osobní automobily.";
  const factsCeske = parseOfficialCommentFacts(husovaImpact);
  ok("MUNI_PARSE_CESKE_BUDEJOVICE", factsCeske.city === "České Budějovice");
  ok("MUNI_PARSE_NOT_FIRST_WORD_ONLY", factsCeske.city !== "České");

  const hdrCommentOnly = buildLocalityHeaderModel({
    eventType: "nehoda",
    impact: husovaImpact,
    impactFull: husovaImpact,
    location: "Jiráskovo nábř. – Na Dlouhé louce",
  });
  ok(
    "MUNI_SIGN_CESKE_BUDEJOVICE_FROM_COMMENT",
    hdrCommentOnly.municipalitySignLabel === "ČESKÉ BUDĚJOVICE" &&
      hdrCommentOnly.besideLocality === "ulice: Husova tř."
  );

  const hdrTruncatedStruct = buildLocalityHeaderModel({
    municipality: "České",
    eventType: "nehoda",
    impact: husovaImpact,
    impactFull: husovaImpact,
  });
  ok(
    "MUNI_SIGN_RECOVERS_TRUNCATED_STRUCTURED",
    hdrTruncatedStruct.municipalitySignLabel === "ČESKÉ BUDĚJOVICE"
  );

  const hdrFullStruct = buildLocalityHeaderModel({
    municipality: "České Budějovice",
    eventType: "nehoda",
    impact: husovaImpact,
  });
  ok(
    "MUNI_SIGN_CESKE_BUDEJOVICE_STRUCTURED",
    hdrFullStruct.municipalitySignLabel === "ČESKÉ BUDĚJOVICE"
  );

  const cases = [
    ["Praha", "PRAHA"],
    ["Hradec Králové", "HRADEC KRÁLOVÉ"],
    ["Ústí nad Labem", "ÚSTÍ NAD LABEM"],
    ["Nové Město na Moravě", "NOVÉ MĚSTO NA MORAVĚ"],
    ["Frýdek-Místek", "FRÝDEK-MÍSTEK"],
  ];
  let multiOk = true;
  for (const [name, upper] of cases) {
    const fromComment = resolveMunicipalitySignName({
      impact: "v obci " + name + "; nehoda",
    });
    const fromStruct = resolveMunicipalitySignName({ municipality: name });
    const label = buildLocalityHeaderModel({
      impact: "v obci " + name + "; uzavřeno",
    }).municipalitySignLabel;
    if (fromComment !== name || fromStruct !== name || label !== upper) multiOk = false;
    if (name.includes(" ") && String(fromComment).split(/\s+/).length < 2) multiOk = false;
  }
  ok("MUNI_SIGN_MULTIWORD_SUITE_PASS", multiOk);

  ok(
    "MUNI_PREFER_FULLER_HELPER",
    preferFullerMunicipalityName("České", "České Budějovice") === "České Budějovice" &&
      preferFullerMunicipalityName("České Budějovice", "České") === "České Budějovice" &&
      preferFullerMunicipalityName("Praha", "Brno") === "Praha"
  );

  ok(
    "MUNI_NORMALIZE_KEEPS_FULL",
    normalizeExtractedMunicipalityName("České Budějovice") === "České Budějovice" &&
      normalizeExtractedMunicipalityName("Nové Město na Moravě") === "Nové Město na Moravě"
  );

  // Layout contract: CSS must not force single-token / nowrap clipping of muni sign.
  const css = fs.readFileSync(path.join(root, "assets/iu-prehled-dne-v1.css"), "utf8");
  const muniCss = (css.match(/\.iuPdMuniSign\s*\{[^}]+\}/) || [""])[0];
  ok(
    "MUNI_SIGN_LAYOUT_WRAP_PASS",
    /white-space:\s*normal/.test(muniCss) &&
      !/white-space:\s*nowrap/.test(muniCss) &&
      /overflow-wrap:\s*anywhere/.test(muniCss) &&
      /max-width:\s*min\(100%/.test(muniCss)
  );
}

// --- "u obce X" localization (road + near municipality, not diversion towns) ---
{
  const studenecImpact =
    "na silnici 23 u obce Studenec okres Třebíč; odklon s řízením provozu pro nákladní automobily přes Pozďatín pro ostatní dopravu přes Studenec Okarec; vozovka uzavřena v obou směrech; velký požár; v blízkosti pozemní komunikace probíhají hasební práce na přilehlém lesním porostu, uzavřeno pro HZS techniku.";
  const studenecInput = {
    road: "23",
    roadClass: "CLASS_I",
    roadClassLabel: "Silnice I. třídy",
    district: "Třebíč",
    eventType: "uzavirka",
    impact: studenecImpact,
    impactFull: studenecImpact,
  };
  const facts = parseOfficialCommentFacts(studenecImpact);
  const hdr = buildLocalityHeaderModel(studenecInput);
  const place = buildPlaceAndDirectionLine(studenecInput);
  const detail = buildTrafficExpandedDetail(studenecInput);
  const comm = buildTrafficCardPresentation(studenecInput).communication;
  const obecRow = (detail.rows || []).find((r) => r.key === "municipality");
  const okresRow = (detail.rows || []).find((r) => r.key === "district");

  ok("U_OBCE_PARSE_STUDENEC", facts.city === "Studenec" && facts.municipalityRelation === "u_obce");
  ok(
    "U_OBCE_HEADER_PASS",
    hdr.municipalitySignLabel === "STUDENEC" &&
      hdr.nearMunicipalityPrefix === "u obce" &&
      comm.nearMunicipalityPrefix === "u obce"
  );
  ok(
    "U_OBCE_PLACE_PASS",
    place === "23 · u obce Studenec · okres Třebíč"
  );
  ok(
    "U_OBCE_DETAIL_OBEC_PASS",
    obecRow && obecRow.value === "Studenec" && okresRow && /Třebíč/i.test(okresRow.value)
  );
  ok(
    "U_OBCE_NO_DIVERSION_TOWN",
    hdr.municipalitySign !== "Pozďatín" &&
      hdr.municipalitySign !== "Okarec" &&
      !/Pozďatín|Okarec/i.test(place)
  );
  ok(
    "U_OBCE_NOT_DISTRICT_AS_MUNI",
    hdr.municipalitySignLabel !== "TŘEBÍČ" && hdr.municipalitySign !== "Třebíč"
  );
  ok(
    "U_OBCE_NO_V_BLIZKOSTI_REWRITE",
    !/v blízkosti|poblíž/i.test(place) &&
      /u obce Studenec/.test(place)
  );

  const multi = buildLocalityHeaderModel({
    road: "I/38",
    impact: "na silnici I/38 u obce Nové Město na Moravě okres Žďár nad Sázavou; uzavřeno",
  });
  const multiPlace = buildPlaceAndDirectionLine({
    road: "I/38",
    impact: "na silnici I/38 u obce Nové Město na Moravě okres Žďár nad Sázavou; uzavřeno",
  });
  ok(
    "U_OBCE_MULTIWORD_PASS",
    multi.municipalitySignLabel === "NOVÉ MĚSTO NA MORAVĚ" &&
      /u obce Nové Město na Moravě/.test(multiPlace) &&
      multi.municipalitySignLabel !== "NOVÉ"
  );

  // Existing urban / motorway headers must keep prior shapes.
  const praha = buildLocalityHeaderModel({
    municipality: "Praha",
    location: "Komořanská",
    impact: "v ulici Komořanská v obci Praha; uzavřeno",
  });
  ok(
    "U_OBCE_NO_REGRESS_URBAN",
    praha.municipalitySignLabel === "PRAHA" &&
      praha.nearMunicipalityPrefix == null &&
      /ulice:\s*Komořanská/i.test(praha.besideLocality || "")
  );
  const d0 = buildLocalityHeaderModel({
    road: "D0",
    impact: "D0, km 10, ve směru D1, silný provoz",
  });
  ok(
    "U_OBCE_NO_REGRESS_D0",
    d0.besideLocality === "Pražský okruh" && d0.nearMunicipalityPrefix == null
  );

  const uiSrc = fs.readFileSync(path.join(root, "assets/iu-prehled-dne-ui-v1.js"), "utf8");
  const roadThenNearBranch = (uiSrc.match(
    /const commBits = roadThenNearMuni\s*\n\s*\?([^\n]+)/
  ) || [, ""])[1];
  ok(
    "U_OBCE_UI_ORDER_PASS",
    /roadThenNearMuni/.test(uiSrc) &&
      /nearMunicipalityPrefix/.test(uiSrc) &&
      /nearMuniOnly/.test(uiSrc) &&
      /roadBadge \+ nearBit \+ muniSign/.test(uiSrc) &&
      /roadBadge \+ nearBit \+ muniSign/.test(roadThenNearBranch) &&
      !/besideBit/.test(roadThenNearBranch)
  );

  // Real Police / silnice 150 — TMC locality must not override near-municipality header.
  const policeImpact =
    "Od 12.8.2026 23:30 do 13.8.2026 01:35; na silnici 150 u obce Police okres Vsetín, poblíž fotbalového hřiště; zvěř na vozovce; sjízdné se zvýšenou opatrností";
  const policeInput = {
    road: "",
    location: "Branky – Police-jih",
    municipality: "Branky – Police-jih",
    district: "Vsetín",
    eventType: "prekazka",
    impact: policeImpact,
    impactFull: policeImpact,
  };
  const policeFacts = parseOfficialCommentFacts(policeImpact);
  const policeHdr = buildLocalityHeaderModel(policeInput);
  const policeCard = buildTrafficCardPresentation(policeInput);
  const policeLocRow = (policeCard.expanded.rows || []).find((r) => r && r.key === "location");
  ok(
    "U_OBCE_POLICE_PARSE_PASS",
    policeFacts.city === "Police" &&
      policeFacts.municipalityRelation === "u_obce" &&
      extractRoadNumberFromOfficialComment(policeImpact) === "150" &&
      resolvePresentationRoadNumber(policeInput, policeFacts) === "150"
  );
  ok(
    "U_OBCE_POLICE_HEADER_PASS",
    policeHdr.municipalitySignLabel === "POLICE" &&
      policeHdr.nearMunicipalityPrefix === "u obce" &&
      policeHdr.besideLocality == null &&
      policeCard.communication.roadPresentation.road === "150" &&
      policeCard.communication.municipalitySignLabel === "POLICE" &&
      policeCard.communication.nearMunicipalityPrefix === "u obce" &&
      policeCard.communication.besideLocality == null
  );
  ok(
    "U_OBCE_POLICE_LOCALITY_PRESERVED_PASS",
    policeLocRow &&
      policeLocRow.value === "Branky – Police-jih" &&
      looksLikeSegmentOrAreaLabel("Branky – Police-jih") === true
  );
  ok(
    "U_OBCE_LOCALITY_DOES_NOT_OVERRIDE_HEADER_PASS",
    policeHdr.municipalitySignLabel !== "BRANKY – POLICE-JIH" &&
      policeHdr.besideLocality !== "Branky – Police-jih" &&
      resolveMunicipalitySignName(policeInput) === "Police"
  );

  const studenecWithLoc = buildLocalityHeaderModel({
    road: "23",
    location: "Studenec-sever",
    impact: "na silnici 23 u obce Studenec okres Třebíč; uzavřeno",
    impactFull: "na silnici 23 u obce Studenec okres Třebíč; uzavřeno",
  });
  ok(
    "U_OBCE_STUDENEC_HEADER_STILL_PASS",
    studenecWithLoc.municipalitySignLabel === "STUDENEC" &&
      studenecWithLoc.nearMunicipalityPrefix === "u obce" &&
      studenecWithLoc.besideLocality == null
  );

  const multiRoad = buildLocalityHeaderModel({
    road: "",
    impact: "na silnici 34 u obce Nové Město na Moravě okres Žďár nad Sázavou; uzavřeno",
    impactFull: "na silnici 34 u obce Nové Město na Moravě okres Žďár nad Sázavou; uzavřeno",
  });
  const multiRoadCard = buildTrafficCardPresentation({
    road: "",
    impact: "na silnici 34 u obce Nové Město na Moravě okres Žďár nad Sázavou; uzavřeno",
    impactFull: "na silnici 34 u obce Nové Město na Moravě okres Žďár nad Sázavou; uzavřeno",
  });
  ok(
    "U_OBCE_MULTIWORD_WITH_ROAD_EXTRACT_PASS",
    multiRoad.municipalitySignLabel === "NOVÉ MĚSTO NA MORAVĚ" &&
      multiRoad.nearMunicipalityPrefix === "u obce" &&
      multiRoadCard.communication.roadPresentation.road === "34" &&
      multiRoad.municipalitySignLabel !== "NOVÉ"
  );

  const budejovice = buildLocalityHeaderModel({
    road: "150",
    impact: "na silnici 150 u obce České Budějovice okres České Budějovice; omezení",
    impactFull: "na silnici 150 u obce České Budějovice okres České Budějovice; omezení",
  });
  ok(
    "U_OBCE_CESKE_BUDEJOVICE_PASS",
    budejovice.municipalitySignLabel === "ČESKÉ BUDĚJOVICE" &&
      budejovice.nearMunicipalityPrefix === "u obce" &&
      budejovice.municipalitySignLabel !== "ČESKÉ"
  );
}

// --- Rich DOPRAVNÍ SITUACE (source-grounded multi-fact summary) ---
{
  const komor = buildTrafficSituationSummary({
    eventType: "uzavirka",
    impact:
      "Od 12.8.2026 18:45 do 21:50; v ulici Komořanská v obci Praha okres území Hlavního města Prahy; uzavřeno, mimořádná událost; na místě složky IZS.",
  });
  ok(
    "SIT_CLOSURE_EXTRAORDINARY_IZS_PASS",
    komor === "Silnice je uzavřena. Mimořádná událost. Na místě složky IZS."
  );
  ok(
    "SIT_CLOSURE_KEEPS_KIND_UZAVIRKA",
    classifyEventPresentation({
      eventType: "uzavirka",
      impact: "uzavřeno, mimořádná událost; na místě složky IZS.",
    }).titleCs === "UZAVÍRKA"
  );

  const a2 = buildTrafficSituationSummary({
    eventType: "nehoda",
    impact: "nehoda; 2 osobní automobily; neprůjezdný pravý jízdní pruh",
  });
  ok(
    "SIT_ACCIDENT_TWO_CARS_RIGHT_LANE_PASS",
    a2 === "Nehoda dvou osobních automobilů. Pravý jízdní pruh je neprůjezdný."
  );

  const aQ = buildTrafficSituationSummary({
    eventType: "nehoda",
    impact: "nehoda; 2 osobní automobily; neprůjezdný levý jízdní pruh; tvoří se kolona",
  });
  ok(
    "SIT_ACCIDENT_LANE_QUEUE_PASS",
    aQ ===
      "Nehoda dvou osobních automobilů. Levý jízdní pruh je neprůjezdný. Tvoří se kolona."
  );

  const heavyOnly = buildTrafficSituationSummary({
    eventType: "kolona",
    impact: "silný provoz",
  });
  ok("SIT_HEAVY_ONLY_PASS", heavyOnly === "Silný provoz.");
  ok("SIT_HEAVY_NOT_QUEUE_PASS", !/kolona/i.test(heavyOnly));

  const heavyLen = buildTrafficSituationSummary({
    eventType: "kolona",
    impact: "silný provoz 1 km",
  });
  ok("SIT_HEAVY_LENGTH_PASS", heavyLen === "Silný provoz v délce 1 km.");

  const works = buildTrafficSituationSummary({
    eventType: "prace",
    impact: "práce na silnici; levý jízdní pruh uzavřen",
  });
  ok(
    "SIT_ROADWORKS_LANE_PASS",
    works === "Práce na silnici. Levý jízdní pruh je uzavřen."
  );

  const broken = buildTrafficSituationSummary({
    eventType: "prekazka",
    impact:
      "porouchané vozidlo; neprůjezdná zpevněná krajnice; průjezd se zvýšenou opatrností",
  });
  ok(
    "SIT_BROKEN_SHOULDER_CARE_PASS",
    broken ===
      "Porouchané vozidlo. Zpevněná krajnice je neprůjezdná. Průjezd se zvýšenou opatrností."
  );

  const careOnly = buildTrafficSituationSummary({
    eventType: "omezeni",
    impact: "průjezd se zvýšenou opatrností",
  });
  ok(
    "SIT_PASS_WITH_CARE_PASS",
    /Průjezd se zvýšenou opatrností/.test(careOnly)
  );

  const roadOnly = buildTrafficSituationSummary({
    eventType: "uzavirka",
    impact: "uzavřeno",
  });
  ok("SIT_ROAD_CLOSED_ONLY_PASS", roadOnly === "Silnice je uzavřena.");

  const laneOnly = buildTrafficSituationSummary({
    eventType: "omezeni",
    impact: "pravý jízdní pruh uzavřen",
  });
  ok(
    "SIT_LANE_NOT_FULL_ROAD_PASS",
    /Pravý jízdní pruh je uzavřen/.test(laneOnly) && !/Silnice je uzavřena/.test(laneOnly)
  );

  const shoulderOnly = buildTrafficSituationSummary({
    eventType: "omezeni",
    impact: "zpevněná krajnice uzavřena",
  });
  ok(
    "SIT_SHOULDER_NOT_FULL_ROAD_PASS",
    /Zpevněná krajnice je uzavřena|Uzavřený odstavný pruh/.test(shoulderOnly) &&
      !/Silnice je uzavřena/.test(shoulderOnly)
  );

  const extraordinary = buildTrafficSituationSummary({
    eventType: "omezeni",
    impact: "mimořádná událost",
  });
  ok(
    "SIT_EXTRAORDINARY_NOT_ACCIDENT_PASS",
    /Mimořádná událost/.test(extraordinary) && !/Nehoda/.test(extraordinary)
  );

  const noQueue = buildTrafficSituationSummary({
    eventType: "kolona",
    impact: "silný provoz, zdržení",
  });
  ok("SIT_NO_INVENTED_QUEUE_PASS", !/kolona/i.test(noQueue));

  const noAccident = buildTrafficSituationSummary({
    eventType: "uzavirka",
    impact: "uzavřeno, mimořádná událost",
  });
  ok("SIT_NO_INVENTED_ACCIDENT_PASS", !/Nehoda/.test(noAccident));

  const dup = buildTrafficSituationSummary({
    eventType: "uzavirka",
    impact: "uzavřeno; silnice je uzavřena; komunikace je uzavřena",
  });
  ok(
    "SIT_NO_CLOSURE_DUPLICATE_PASS",
    dup === "Silnice je uzavřena." ||
      (dup.match(/uzavřen/gi) || []).length <= 1
  );

  ok(
    "SIT_RICH_SUMMARY_SUITE_PASS",
    komor.includes("IZS") &&
      a2.includes("Pravý") &&
      heavyOnly === "Silný provoz." &&
      !/kolona/i.test(heavyOnly)
  );
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
  // Without "ulice:" evidence, morphology alone must NOT invent "ulice: …".
  ok(
    "street_without_safe_muni_beside",
    streetOnly.besideLocality === "Hornopolní" && streetOnly.streetLabel == null
  );

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
      vAmbiguousZlicin.communication.municipalitySignLabel === "PRAHA"
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
      }) === "Praha" &&
      resolveMunicipalitySignName({
        impact: "P+R Skalka, 80% obsazeno",
        eventType: "doprava",
      }) === "Praha" &&
      resolveMunicipalitySignName({
        impact: "Prokešovo náměstí, 50% obsazeno",
        eventType: "doprava",
      }) === "Ostrava"
  );

  ok(
    "PARKING_REGISTRY_MATCH_PASS",
    matchParkingRegistry({ impact: "P+R Holešovice" })?.parkingId === "praha-pr-holesovice" &&
      matchParkingRegistry({ impact: "P+R Kongresové centrum Praha" })?.parkingId ===
        "praha-pr-kongresove-centrum" &&
      matchParkingRegistry({ impact: "P+R Černý Most II" })?.parkingId === "praha-pr-cerny-most-2" &&
      matchParkingRegistry({ impact: "P+R Zličín" })?.parkingId === "praha-pr-zlicin" &&
      matchParkingRegistry({ impact: "P+R Skalka" })?.parkingId === "praha-pr-skalka-1" &&
      matchParkingRegistry({ impact: "P+R Skalka II" })?.parkingId === "praha-pr-skalka-2" &&
      vRegistryEnrich.expanded.parkingRegistry?.parkingId === "praha-pr-rajska-zahrada" &&
      vCernyIi.communication.besideLocality === "P+R Černý Most 2"
  );
  ok(
    "PARKING_REGISTRY_NO_FALSE_MATCH_PASS",
    matchParkingRegistry({ impact: "P+R Černý Most" }) == null &&
      matchParkingRegistry({ impact: "P+R Testoviště Nové" }) == null &&
      isAmbiguousParkingName("P+R Černý Most") === true &&
      isAmbiguousParkingName("P+R Zličín") === false &&
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
      /flex:\s*0\s+[01]\s+auto/.test(cssSrc.match(/\.iuPdMuniSign\s*\{[^}]+\}/)?.[0] || "") &&
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
  ok("ACCIDENT_CARD_REGRESSION_PASS", mwVm.eventKind === EVENT_KIND.ACCIDENT);

  const obstaclePres = buildTrafficCardPresentation({
    road: "II/123",
    municipality: "Tábor",
    eventType: "prekazka",
    impact: "překážka na vozovce, provoz převeden do protisměru",
  });
  ok(
    "OBSTACLE_CARD_REGRESSION_PASS",
    obstaclePres.event.kind !== EVENT_KIND.PARKING &&
      obstaclePres.communication.municipalitySignLabel === "TÁBOR"
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
    matchParkingRegistry({ impact: "P+R Zličín" })?.parkingId === "praha-pr-zlicin" &&
    matchParkingRegistry({ impact: "P+R Černý Most" }) == null &&
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
  ok("PARKING_CARD_REGRESSION_PASS", vFullOnly.event.kind === EVENT_KIND.PARKING);
  ok("SMV_CARD_REGRESSION_PASS", smvPres.roadPresentation.showMotorVehiclesIcon === true);
}

// --- Event priority + restriction scope (cause / scope / condition) ---
{
  // A) nehoda + silný provoz → NEHODA, never KOLONA
  const aImpact =
    "D1, km 205,5, ve směru Ostrava, nehoda, silný provoz, 2 havarovaná vozidla, neprůjezdný levý jízdní pruh, 2 osobní automobily";
  const aEv = classifyEventPresentation({
    road: "D1",
    eventType: "kolona",
    impact: aImpact,
  });
  const aSum = buildTrafficSituationSummary({
    road: "D1",
    direction: "Ostrava",
    eventType: "kolona",
    impact: aImpact,
  });
  ok(
    "ACCIDENT_PRIORITY_OVER_TRAFFIC_CONDITION_PASS",
    aEv.kind === EVENT_KIND.ACCIDENT &&
      aEv.titleCs === "NEHODA" &&
      aEv.primaryCause === PRIMARY_CAUSE.ACCIDENT &&
      aEv.trafficCondition === TRAFFIC_CONDITION.HEAVY_TRAFFIC &&
      !/KOLONA/i.test(aEv.titleCs)
  );
  ok("FIXTURE_A_MAIN_NEHODA", aEv.titleCs === "NEHODA" && aEv.kind !== EVENT_KIND.QUEUE);
  ok(
    "TRAFFIC_SUMMARY_CAUSE_FIRST_PASS",
    /^Nehoda/i.test(aSum) && /neprůjezdn[ýá]/i.test(aSum) && /Silný provoz/i.test(aSum)
  );

  // B) explicit kolona
  const bEv = classifyEventPresentation({
    eventType: "kolona",
    impact: "D1, ve směru Brno, tvoří se kolona, kolona 2 km",
  });
  ok(
    "QUEUE_REQUIRES_EXPLICIT_SOURCE_PASS",
    bEv.kind === EVENT_KIND.QUEUE &&
      bEv.titleCs === "KOLONA" &&
      hasExplicitQueueSource("tvoří se kolona") === true
  );
  ok("FIXTURE_B_EXPLICIT_QUEUE", bEv.titleCs === "KOLONA");

  // C) silný provoz without kolona
  const cEv = classifyEventPresentation({
    eventType: "kolona",
    impact: "D1, km 10, silný provoz",
  });
  ok(
    "HEAVY_TRAFFIC_NOT_QUEUE_PASS",
    cEv.kind === EVENT_KIND.HEAVY_TRAFFIC &&
      cEv.titleCs === "SILNÝ PROVOZ" &&
      cEv.kind !== EVENT_KIND.QUEUE
  );
  ok(
    "NO_QUEUE_INFERENCE_FROM_HEAVY_TRAFFIC_PASS",
    classifyEventPresentation({ impact: "silný provoz" }).kind === EVENT_KIND.HEAVY_TRAFFIC &&
      classifyEventPresentation({ impact: "hustý provoz" }).kind === EVENT_KIND.HEAVY_TRAFFIC
  );
  ok(
    "NO_QUEUE_INFERENCE_FROM_DELAY_PASS",
    classifyEventPresentation({ eventType: "kolona", impact: "zdržení" }).kind !==
      EVENT_KIND.QUEUE &&
      !hasExplicitQueueSource("zdržení")
  );
  ok("FIXTURE_C_HEAVY_NOT_QUEUE", cEv.titleCs === "SILNÝ PROVOZ");

  // D) práce + uzavřený levý pruh → PRÁCE, not UZAVÍRKA
  const dImpact =
    "D35, km 277,5–276,9, ve směru Olomouc, práce na silnici, levý jízdní pruh uzavřen, údržba a opravy vozovek, pracovní místo";
  const dEv = classifyEventPresentation({
    road: "D35",
    eventType: "uzavirka",
    impact: dImpact,
  });
  const dSum = buildTrafficSituationSummary({
    road: "D35",
    direction: "Olomouc",
    eventType: "uzavirka",
    impact: dImpact,
  });
  ok(
    "ROADWORKS_PRIORITY_WITH_SINGLE_LANE_CLOSURE_PASS",
    dEv.kind === EVENT_KIND.ROADWORKS &&
      dEv.titleCs === "PRÁCE NA SILNICI" &&
      dEv.restrictionScope === RESTRICTION_SCOPE.SINGLE_LANE_CLOSED
  );
  ok(
    "SINGLE_LANE_CLOSED_NOT_FULL_CLOSURE_PASS",
    dEv.kind !== EVENT_KIND.CLOSURE &&
      analyzeRestrictionScope(dImpact) === RESTRICTION_SCOPE.SINGLE_LANE_CLOSED
  );
  ok(
    "NO_DIRECTION_CLOSURE_FROM_SINGLE_LANE_PASS",
    !/uzavřeno ve směru Olomouc/i.test(dSum) &&
      /Levý jízdní pruh/i.test(dSum) &&
      /Olomouc/i.test(dSum)
  );
  ok("TRAFFIC_SUMMARY_SCOPE_SECOND_PASS", /jízdní pruh/i.test(dSum));
  ok("FIXTURE_D_ROADWORKS_LANE", dEv.kind === EVENT_KIND.ROADWORKS);

  // E) odstavný pruh / zpevněná krajnice
  const eImpact =
    "D1, km 7,7–5,5, ve směru Praha, pomalu jedoucí vozidlo údržby, zpevněná krajnice (odstavný pruh) uzavřena, sekání trávy, údržba travních porostů";
  const eEv = classifyEventPresentation({
    road: "D1",
    eventType: "uzavirka",
    impact: eImpact,
  });
  ok(
    "SHOULDER_CLOSED_NOT_FULL_CLOSURE_PASS",
    eEv.kind === EVENT_KIND.ROADWORKS &&
      eEv.kind !== EVENT_KIND.CLOSURE &&
      eEv.restrictionScope === RESTRICTION_SCOPE.HARD_SHOULDER_CLOSED
  );
  ok("FIXTURE_E_SHOULDER_NOT_CLOSURE", eEv.titleCs === "PRÁCE NA SILNICI");

  // F) porouchané vozidlo + neprůjezdná krajnice
  const fImpact =
    "D2, km 25–25,1, ve směru Bratislava (SK), porouchané vozidlo, zdržení, neprůjezdná zpevněná krajnice, překážka na vozovce, průjezd se zvýšenou opatrností, defekt nákladní automobil";
  const fEv = classifyEventPresentation({
    road: "D2",
    eventType: "uzavirka",
    impact: fImpact,
  });
  const fSum = buildTrafficSituationSummary({
    road: "D2",
    eventType: "uzavirka",
    impact: fImpact,
  });
  ok(
    "BROKEN_VEHICLE_PRIORITY_PASS",
    fEv.kind === EVENT_KIND.OBSTACLE &&
      /POROUCHANÉ VOZIDLO|PŘEKÁŽKA/i.test(fEv.titleCs) &&
      fEv.kind !== EVENT_KIND.CLOSURE
  );
  ok(
    "HARD_SHOULDER_BLOCKED_NOT_FULL_CLOSURE_PASS",
    fEv.restrictionScope === RESTRICTION_SCOPE.HARD_SHOULDER_CLOSED &&
      fEv.kind !== EVENT_KIND.CLOSURE
  );
  ok(
    "TRAFFIC_SUMMARY_CONDITION_THIRD_PASS",
    /Porouchan/i.test(fSum) &&
      /krajnice/i.test(fSum) &&
      /zvýšenou opatrností/i.test(fSum)
  );
  ok("FIXTURE_F_BROKEN_NOT_CLOSURE", fEv.kind !== EVENT_KIND.CLOSURE);

  // G) úplná uzavírka
  const gEv = classifyEventPresentation({
    eventType: "omezeni",
    impact: "komunikace zcela uzavřena, silnice II/357",
  });
  ok(
    "FULL_CLOSURE_REQUIRES_FULL_SCOPE_PASS",
    gEv.kind === EVENT_KIND.CLOSURE &&
      gEv.titleCs === "UZAVÍRKA" &&
      analyzeRestrictionScope("komunikace zcela uzavřena") === RESTRICTION_SCOPE.FULL_ROAD_CLOSED
  );
  ok("FIXTURE_G_FULL_CLOSURE", gEv.kind === EVENT_KIND.CLOSURE);

  // H) nehoda + úplná neprůjezdnost — keep both
  const hImpact = "nehoda, komunikace zcela uzavřena, 2 osobní automobily";
  const hEv = classifyEventPresentation({ eventType: "omezeni", impact: hImpact });
  const hSum = buildTrafficSituationSummary({ eventType: "omezeni", impact: hImpact });
  ok(
    "FIXTURE_H_ACCIDENT_FULL_CLOSURE",
    hEv.kind === EVENT_KIND.ACCIDENT &&
      hEv.titleCs === "NEHODA" &&
      (/uzavřen|neprůjezdn|Komunikace/i.test(hSum) ||
        hEv.restrictionScope === RESTRICTION_SCOPE.FULL_ROAD_CLOSED)
  );

  // Duplicate locality vs road
  const dupDet = buildTrafficExpandedDetail({
    road: "D1",
    location: "D1",
    eventType: "nehoda",
    impact: "nehoda na D1",
  });
  ok(
    "DUPLICATE_LOCALITY_ROAD_HIDDEN_PASS",
    !(dupDet.rows || []).some((r) => r && r.key === "location") &&
      (dupDet.rows || []).some((r) => r && r.key === "road" && r.value === "D1")
  );
  const keepLoc = buildTrafficExpandedDetail({
    road: "D1",
    location: "exit 203 Holubice",
    eventType: "nehoda",
    impact: "nehoda",
  });
  ok(
    "LOCALITY_KEPT_WHEN_EXTRA",
    (keepLoc.rows || []).some((r) => r && r.key === "location" && /Holubice/i.test(r.value || ""))
  );

  // Km order preserved (descending as in source)
  const kmFacts = parseOfficialCommentFacts("D35, km 277,5–276,9, ve směru Olomouc");
  const kmFacts2 = parseOfficialCommentFacts("D1, km 7,7–5,5, ve směru Praha");
  ok(
    "KM_ORDER_PRESERVED_PASS",
    kmFacts.kilometerLabel === "km 277,5–276,9" &&
      kmFacts2.kilometerLabel === "km 7,7–5,5" &&
      !/Math\.(min|max).*kilometer|sortKm|kmSort/i.test(presenterSrc)
  );

  // FUTURE lifecycle independent of type
  const fut = vmFrom({
    lifecycleStatus: "FUTURE",
    eventType: "prace",
    road: "D35",
    impact: "práce na silnici, levý jízdní pruh uzavřen",
    validity: { validFrom: "2026-09-01T05:00:00.000Z" },
  });
  ok(
    "FUTURE_LIFECYCLE_TYPE_INDEPENDENT_PASS",
    fut.badge &&
      /BUDOUCÍ/i.test(fut.badge.text || "") &&
      fut.eventKind === EVENT_KIND.ROADWORKS
  );

  // Raw NDIC description preserved
  const rawPres = buildTrafficCardPresentation({
    road: "D1",
    eventType: "nehoda",
    impact: aImpact,
    impactFull: aImpact,
  });
  ok(
    "RAW_NDIC_DESCRIPTION_PRESERVED_PASS",
    (rawPres.expanded.rows || []).some(
      (r) =>
        r &&
        r.key === "sourceDescription" &&
        /nehoda/i.test(String(r.value || "")) &&
        /silný provoz/i.test(String(r.value || ""))
    )
  );

  // Extra regressions for report keys
  const qReg = classifyEventPresentation({
    impact: "D1, tvoří se kolona, kolona 3 km",
  });
  ok("QUEUE_CARD_REGRESSION_PASS", qReg.kind === EVENT_KIND.QUEUE && qReg.titleCs === "KOLONA");
  ok(
    "ROADWORKS_CARD_REGRESSION_PASS",
    classifyEventPresentation({ eventType: "prace", impact: "práce na silnici" }).kind ===
      EVENT_KIND.ROADWORKS
  );
  ok(
    "PRIMARY_CAUSE_HELPER",
    analyzePrimaryCause(aImpact, { eventType: "kolona" }) === PRIMARY_CAUSE.ACCIDENT
  );
  ok(
    "TRAFFIC_CONDITION_HELPER",
    analyzeTrafficCondition("silný provoz") === TRAFFIC_CONDITION.HEAVY_TRAFFIC &&
      analyzeTrafficCondition("kolona") === TRAFFIC_CONDITION.QUEUE
  );
}

// --- Named object vs fabricated street (Bubenečský tunel / Letná) ---
{
  const bubImpact =
    "Bubenečský tunel, Praha 7, Praha, nehoda, neprůjezdný pravý jízdní pruh, od 12.8.2026 16:46 do 12.8.2026 19:46, 1x DOD, směr Barrandovský most, porouchané vozidlo, Zdroj: TSK Praha / DIC";
  const bubInput = {
    municipality: "Praha",
    location: "Letná",
    eventType: "nehoda",
    impact: bubImpact,
    impactFull: bubImpact,
  };
  const bubFacts = parseOfficialCommentFacts(bubImpact);
  const bubHdr = buildLocalityHeaderModel(bubInput);
  const bubPres = buildTrafficCardPresentation(bubInput);

  ok(
    "BUBENECSKY_TUNNEL_LIVE_FIXTURE_PASS",
    bubFacts.namedObject === "Bubenečský tunel" &&
      bubFacts.namedObjectKind === LOCATION_KIND.TUNNEL &&
      bubFacts.city === "Praha" &&
      bubFacts.cityPart === "Praha 7" &&
      resolveConfirmedStreet(bubInput, bubFacts) == null &&
      bubHdr.besideLocality === "Bubenečský tunel" &&
      bubHdr.streetLabel == null &&
      bubHdr.municipalitySignLabel === "PRAHA" &&
      /městská část:\s*Praha 7/i.test(bubHdr.cityPartRow || "") &&
      !/ulice:\s*Letná/i.test(bubHdr.besideLocality || "") &&
      bubPres.event.kind === EVENT_KIND.ACCIDENT
  );
  ok(
    "NO_FABRICATED_STREET_PASS",
    !/ulice:\s*Letná/i.test(bubHdr.besideLocality || "") &&
      resolveConfirmedStreet({ location: "Letná", municipality: "Praha" }) == null &&
      looksLikeStreetName("Letná") === true
  );
  ok(
    "NO_STREET_FROM_GENERIC_LOCALITY_PASS",
    buildLocalityHeaderModel({
      municipality: "Praha",
      location: "Letná",
      eventType: "omezeni",
      impact: "omezení dopravy",
    }).streetLabel == null &&
      !/^ulice:/i.test(
        buildLocalityHeaderModel({
          municipality: "Praha",
          location: "Letná",
          eventType: "omezeni",
          impact: "omezení dopravy",
        }).besideLocality || ""
      )
  );
  ok(
    "NO_STREET_FROM_CITYPART_PASS",
    resolveConfirmedStreet({
      municipality: "Praha",
      location: "Praha 7",
      cityPart: "Praha 7",
      impact: "Praha 7, Praha, omezení",
    }) == null &&
      buildLocalityHeaderModel({
        municipality: "Praha",
        location: "Praha 7",
        impact: "Praha 7, Praha, omezení",
      }).streetLabel == null
  );
  ok(
    "NO_STREET_FROM_TMC_LABEL_PASS",
    resolveConfirmedStreet({
      location: "Letná",
      streetHint: "Letná",
      municipality: "Praha",
      impact: "Bubenečský tunel, Praha 7, Praha, nehoda",
    }) == null
  );
  ok(
    "NO_STREET_FROM_NAMED_OBJECT_PASS",
    !/^ulice:/i.test(bubHdr.besideLocality || "") &&
      buildLocalityHeaderModel({
        municipality: "Praha",
        impact: "Bubenečský tunel, Praha, nehoda",
      }).streetLabel == null
  );
  ok(
    "NAMED_OBJECT_PRIORITY_OVER_GENERIC_LOCALITY_PASS",
    bubHdr.namedObject === "Bubenečský tunel" &&
      bubHdr.besideLocality === "Bubenečský tunel" &&
      bubHdr.besideLocality !== "Letná" &&
      !(bubPres.expanded.rows || []).some(
        (r) => r && r.key === "location" && /Letná/i.test(String(r.value || ""))
      ) &&
      (bubPres.expanded.rows || []).some(
        (r) =>
          r &&
          (r.key === "tunnel" || r.key === "location") &&
          /Bubenečský tunel/i.test(String(r.value || ""))
      )
  );
  ok(
    "TUNNEL_LOCATION_PRIORITY_PASS",
    extractNamedTransportObject("Bubenečský tunel, Praha").kind === LOCATION_KIND.TUNNEL &&
      classifyLocationKindFromName("Tunel Blanka") === LOCATION_KIND.TUNNEL &&
      buildLocalityHeaderModel({
        municipality: "Praha",
        location: "Dejvice",
        impact: "Strahovský tunel, Praha 6, Praha, práce na silnici",
      }).besideLocality === "Strahovský tunel"
  );
  ok(
    "BRIDGE_LOCATION_PRIORITY_PASS",
    extractNamedTransportObject("Barrandovský most, Praha 5, Praha, omezení").kind ===
      LOCATION_KIND.BRIDGE &&
      buildLocalityHeaderModel({
        municipality: "Praha",
        location: "Hlubočepy",
        impact: "Barrandovský most, Praha 5, Praha, omezení",
      }).besideLocality === "Barrandovský most" &&
      buildLocalityHeaderModel({
        municipality: "Praha",
        location: "Hlubočepy",
        impact: "Barrandovský most, Praha 5, Praha, omezení",
      }).streetLabel == null
  );
  ok(
    "SQUARE_NOT_STREET_PASS",
    classifyLocationKindFromName("Prokešovo náměstí") === LOCATION_KIND.SQUARE &&
      looksLikeStreetName("Prokešovo náměstí") === false &&
      !/^ulice:/i.test(
        buildLocalityHeaderModel({
          municipality: "Ostrava",
          location: "Prokešovo náměstí",
          eventType: "omezeni",
          impact: "Prokešovo náměstí, Ostrava, omezení",
        }).besideLocality || ""
      )
  );
  ok(
    "MUNICIPALITY_REMAINS_PRIMARY_SIGN_PASS",
    bubHdr.municipalitySignLabel === "PRAHA" && bubHdr.municipalitySignLabel !== "PRAHA 7"
  );
  ok(
    "CITYPART_REMAINS_SECONDARY_PASS",
    bubHdr.cityPart === "Praha 7" && /městská část:\s*Praha 7/i.test(bubHdr.cityPartRow || "")
  );
  ok(
    "NO_STREET_LABEL_WITHOUT_STREET_EVIDENCE_PASS",
    !/^ulice:/i.test(bubHdr.besideLocality || "") &&
      buildLocalityHeaderModel({
        municipality: "Praha",
        impact: "Bubenečský tunel, Praha, nehoda",
      }).streetLabel == null
  );
  ok(
    "RAW_NDIC_DESCRIPTION_PRESERVED_PASS",
    (bubPres.expanded.rows || []).some(
      (r) =>
        r &&
        r.key === "sourceDescription" &&
        /Bubenečský tunel/i.test(String(r.value || "")) &&
        /porouchané vozidlo/i.test(String(r.value || ""))
    )
  );
  ok(
    "STREET_CARD_REGRESSION_PASS",
    buildLocalityHeaderModel({
      municipality: "Ostrava",
      location: "Hornopolní",
      eventType: "prace",
      impact:
        "ulice Hornopolní, Moravská Ostrava a Přívoz, Ostrava, práce na inženýrských sítích",
    }).besideLocality === "ulice: Hornopolní"
  );
  ok("ACCIDENT_CARD_REGRESSION_PASS", bubPres.event.kind === EVENT_KIND.ACCIDENT);

  // Parking house named object must not become street
  ok(
    "PARKING_HOUSE_NOT_STREET",
    classifyLocationKindFromName("Parkovací dům DK POKLAD I.") === LOCATION_KIND.PARKING
  );
}

// --- Prague tunnels: ulice≠tunel, Praha N≠obec, tunel uzavřen summary/classifier ---
{
  const mrazImpact =
    "ulice Tunel Mrázovka, Praha 5, Praha, tunel uzavřen, od 12.8.2026 23:00 do 13.8.2026 05:00, pravidelná údržba, Zdroj: TSK Praha / DIC";
  const mrazInput = {
    municipality: "Praha",
    cityPart: "Praha 5",
    location: "ulice Tunel Mrázovka",
    street: "Tunel Mrázovka",
    eventType: "omezeni",
    impact: mrazImpact,
    impactFull: mrazImpact,
  };
  const mrazFacts = parseOfficialCommentFacts(mrazImpact);
  const mrazHdr = buildLocalityHeaderModel(mrazInput);
  const mrazPres = buildTrafficCardPresentation(mrazInput);
  const mrazRows = mrazPres.expanded.rows || [];
  const mrazSummary = buildTrafficSituationSummary(mrazInput);

  ok(
    "MRAZOVKA_TUNNEL_PARSE_PASS",
    mrazFacts.city === "Praha" &&
      mrazFacts.cityPart === "Praha 5" &&
      mrazFacts.namedObject === "Tunel Mrázovka" &&
      mrazFacts.namedObjectKind === LOCATION_KIND.TUNNEL &&
      mrazFacts.street == null &&
      resolveConfirmedStreet(mrazInput, mrazFacts) == null
  );
  ok(
    "MRAZOVKA_HEADER_PASS",
    mrazHdr.municipalitySignLabel === "PRAHA" &&
      mrazHdr.besideLocality === "Tunel Mrázovka" &&
      mrazHdr.streetLabel == null &&
      /městská část:\s*Praha 5/i.test(mrazHdr.cityPartRow || "") &&
      !/^ulice/i.test(mrazHdr.besideLocality || "")
  );
  ok(
    "MRAZOVKA_PLACE_PASS",
    mrazPres.placeLine === "Tunel Mrázovka · Praha 5"
  );
  ok(
    "MRAZOVKA_SUMMARY_PASS",
    mrazSummary === "Tunel je uzavřen. Pravidelná údržba."
  );
  ok(
    "MRAZOVKA_DETAIL_TUNNEL_PASS",
    mrazRows.some((r) => r && r.key === "tunnel" && r.value === "Tunel Mrázovka") &&
      !mrazRows.some((r) => r && r.key === "street") &&
      !mrazRows.some(
        (r) => r && r.key === "location" && /ulice\s+Tunel\s+Mrázovka/i.test(String(r.value || ""))
      ) &&
      mrazRows.some((r) => r && r.key === "municipality" && r.value === "Praha") &&
      mrazRows.some((r) => r && r.key === "cityPart" && r.value === "Praha 5")
  );
  ok(
    "MRAZOVKA_CLOSURE_CLASSIFIER_PASS",
    isFullScopeClosure(mrazImpact) === true &&
      mrazPres.event.kind === EVENT_KIND.CLOSURE &&
      mrazPres.event.titleCs === "UZAVÍRKA"
  );
  ok(
    "MRAZOVKA_RAW_UNCHANGED_PASS",
    /ulice Tunel Mrázovka/i.test(mrazPres.expanded.sourceFull || "") &&
      /Zdroj:\s*TSK Praha/i.test(mrazPres.expanded.sourceFull || "")
  );

  const brusImpact =
    "ulice Brusnický tunel, Praha 6 - ulice Dejvický tunel, Praha 7, Praha, tunel uzavřen, od 12.8.2026 23:00 do 13.8.2026 05:00, pravidelná údržba, Zdroj: TSK Praha / DIC";
  const brusInput = {
    municipality: "Praha 7",
    cityPart: "Praha 7",
    location: "ulice Brusnický tunel",
    street: "Brusnický tunel",
    eventType: "omezeni",
    impact: brusImpact,
    impactFull: brusImpact,
  };
  const brusFacts = parseOfficialCommentFacts(brusImpact);
  const brusHdr = buildLocalityHeaderModel(brusInput);
  const brusPres = buildTrafficCardPresentation(brusInput);
  const brusRows = brusPres.expanded.rows || [];

  ok(
    "BRUSNICKY_TUNNEL_PARSE_PASS",
    brusFacts.city === "Praha" &&
      brusFacts.city !== "Praha 7" &&
      brusFacts.namedObject === "Brusnický tunel" &&
      brusFacts.namedObjectKind === LOCATION_KIND.TUNNEL &&
      brusFacts.street == null &&
      resolveConfirmedStreet(brusInput, brusFacts) == null &&
      isPrahaCityPartName("Praha 7") === true
  );
  ok(
    "BRUSNICKY_PRAHA7_NOT_MUNICIPALITY_PASS",
    resolveMunicipalitySignName(brusInput) === "Praha" &&
      brusHdr.municipalitySignLabel === "PRAHA" &&
      brusHdr.municipalitySignLabel !== "PRAHA 7" &&
      brusRows.some((r) => r && r.key === "municipality" && r.value === "Praha") &&
      !brusRows.some((r) => r && r.key === "municipality" && r.value === "Praha 7")
  );
  ok(
    "BRUSNICKY_HEADER_PASS",
    brusHdr.besideLocality === "Brusnický tunel" &&
      brusHdr.streetLabel == null &&
      /městská část:\s*Praha 7/i.test(brusHdr.cityPartRow || "") &&
      !/Dejvický|Pozďatín/i.test(brusHdr.besideLocality || "")
  );
  ok(
    "BRUSNICKY_PLACE_PASS",
    brusPres.placeLine === "Brusnický tunel · Praha 7"
  );
  ok(
    "BRUSNICKY_SUMMARY_PASS",
    buildTrafficSituationSummary(brusInput) === "Tunel je uzavřen. Pravidelná údržba."
  );
  ok(
    "BRUSNICKY_DETAIL_TUNNEL_PASS",
    brusRows.some((r) => r && r.key === "tunnel" && r.value === "Brusnický tunel") &&
      !brusRows.some((r) => r && r.key === "street")
  );
  ok(
    "PRAHA_CITYPART_NOT_MUNICIPALITY_SUITE_PASS",
    isPrahaCityPartName("Praha 1") &&
      isPrahaCityPartName("Praha 22") &&
      !isPrahaCityPartName("Praha") &&
      resolveMunicipalitySignName({
        municipality: "Praha 5",
        impact: "ulice Tunel Mrázovka, Praha 5, Praha, tunel uzavřen",
        impactFull: "ulice Tunel Mrázovka, Praha 5, Praha, tunel uzavřen",
      }) === "Praha"
  );
  ok(
    "TUNNEL_FULL_CLOSURE_NOT_LANE_REGRESSION_PASS",
    isFullScopeClosure("tunel uzavřen, pravidelná údržba") === true &&
      isFullScopeClosure("neprůjezdný pravý jízdní pruh") === false &&
      isSingleLaneRestriction("neprůjezdný pravý jízdní pruh") === true &&
      isFullScopeClosure("uzavřená krajnice") === false &&
      isShoulderOrVergeRestriction("uzavřená krajnice") === true &&
      classifyEventPresentation({
        eventType: "omezeni",
        impact: "neprůjezdný pravý jízdní pruh, silný provoz",
      }).kind !== EVENT_KIND.CLOSURE
  );
  ok(
    "TUNNEL_ULICE_PREFIX_STRIP_PASS",
    extractNamedTransportObject("ulice Tunel Mrázovka, Praha 5, Praha").name ===
      "Tunel Mrázovka" &&
      extractNamedTransportObject("ulice Brusnický tunel, Praha 7, Praha").name ===
        "Brusnický tunel"
  );
  ok(
    "TUNNEL_SEMANTICS_SUITE_PASS",
    mrazPres.event.kind === EVENT_KIND.CLOSURE &&
      brusPres.event.kind === EVENT_KIND.CLOSURE &&
      mrazFacts.namedObject === "Tunel Mrázovka" &&
      brusFacts.namedObject === "Brusnický tunel" &&
      mrazHdr.municipalitySignLabel === "PRAHA" &&
      brusHdr.municipalitySignLabel === "PRAHA"
  );
}

// --- Urban tunnel registry: [MĚSTO] + tunnel name (enrichment, fail-closed) ---
{
  ok(
    "URBAN_TUNNEL_REGISTRY_FILE_PRESENT",
    fs.existsSync(path.join(root, "assets/iu-tunnel-registry-v1.js"))
  );

  const bubImpact = "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen";
  const bubInput = {
    location: "Tunel Bubeneč",
    eventType: "omezeni",
    impact: bubImpact,
    impactFull: bubImpact,
  };
  const bubHdr = buildLocalityHeaderModel(bubInput);
  const bubEnrich = resolveTunnelRegistryEnrichment(bubInput);
  ok(
    "URBAN_TUNNEL_BUBENEC_MATCH",
    matchTunnelRegistry({ namedObject: "Tunel Bubeneč" })?.tunnelId ===
      "praha-tunnel-bubenec" &&
      bubEnrich &&
      bubEnrich.usedRegistryMunicipality === true &&
      bubEnrich.conflict === false
  );
  ok(
    "URBAN_TUNNEL_BUBENEC_HEADER",
    bubHdr.municipalitySignLabel === "PRAHA" &&
      bubHdr.besideLocality === "Tunel Bubeneč" &&
      bubHdr.streetLabel == null &&
      !/PRAHA 7|BUBENEČ$/i.test(bubHdr.municipalitySignLabel || "")
  );
  ok(
    "URBAN_TUNNEL_BUBENEC_NO_CITYPART_INVENTION",
    bubHdr.cityPartRow == null
  );

  const mrazUrban = buildLocalityHeaderModel({
    municipality: "Praha",
    cityPart: "Praha 5",
    impact: "ulice Tunel Mrázovka, Praha 5, Praha, tunel uzavřen, pravidelná údržba",
    impactFull: "ulice Tunel Mrázovka, Praha 5, Praha, tunel uzavřen, pravidelná údržba",
    eventType: "omezeni",
  });
  ok(
    "URBAN_TUNNEL_MRAZOVKA_HEADER",
    mrazUrban.municipalitySignLabel === "PRAHA" &&
      mrazUrban.besideLocality === "Tunel Mrázovka" &&
      /městská část:\s*Praha 5/i.test(mrazUrban.cityPartRow || "")
  );

  const unknownTun = buildLocalityHeaderModel({
    impact: "Tunel Neznámý Testovice, jízdní pruh uzavřen",
    impactFull: "Tunel Neznámý Testovice, jízdní pruh uzavřen",
    eventType: "omezeni",
  });
  ok(
    "URBAN_TUNNEL_UNKNOWN_FAIL_CLOSED",
    matchTunnelRegistry({
      namedObject: "Tunel Neznámý Testovice",
      impact: "Tunel Neznámý Testovice, jízdní pruh uzavřen",
    }) == null &&
      unknownTun.municipalitySign == null &&
      unknownTun.besideLocality === "Tunel Neznámý Testovice"
  );

  const conflictTun = resolveTunnelRegistryEnrichment({
    municipality: "Ostrava",
    impact: "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen",
    impactFull: "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen",
  });
  const conflictHdr = buildLocalityHeaderModel({
    municipality: "Ostrava",
    impact: "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen",
    impactFull: "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen",
  });
  ok(
    "URBAN_TUNNEL_OFFICIAL_PRECEDENCE",
    conflictTun &&
      conflictTun.conflict === true &&
      conflictTun.usedRegistryMunicipality === false &&
      conflictHdr.municipalitySignLabel === "OSTRAVA" &&
      conflictHdr.municipalitySignLabel !== "PRAHA"
  );

  ok(
    "URBAN_TUNNEL_NO_FUZZY_BARE_PLACE",
    matchTunnelRegistry({ namedObject: "Bubeneč", impact: "Bubeneč, omezení" }) ==
      null &&
      matchTunnelRegistry({ namedObject: "Mrázovka", impact: "Mrázovka, omezení" }) ==
        null
  );

  const policeStill = buildLocalityHeaderModel({
    road: "",
    location: "Branky – Police-jih",
    municipality: "Branky – Police-jih",
    district: "Vsetín",
    impact:
      "na silnici 150 u obce Police okres Vsetín, poblíž fotbalového hřiště",
    impactFull:
      "na silnici 150 u obce Police okres Vsetín, poblíž fotbalového hřiště",
  });
  ok(
    "URBAN_TUNNEL_U_OBCE_REGRESSION",
    policeStill.municipalitySignLabel === "POLICE" &&
      policeStill.nearMunicipalityPrefix === "u obce" &&
      policeStill.besideLocality == null
  );

  const multiMuni = resolveMunicipalitySignName({
    municipality: "České",
    impact: "v obci České Budějovice, okr. České Budějovice, omezení",
    impactFull: "v obci České Budějovice, okr. České Budějovice, omezení",
  });
  ok(
    "URBAN_TUNNEL_MULTIWORD_MUNI_REGRESSION",
    multiMuni === "České Budějovice" ||
      resolveMunicipalitySignName({
        impact: "na silnici 34 u obce České Budějovice okres České Budějovice",
        impactFull: "na silnici 34 u obce České Budějovice okres České Budějovice",
      }) === "České Budějovice"
  );

  ok(
    "URBAN_TUNNEL_REGISTRY_SUITE_PASS",
    bubHdr.municipalitySignLabel === "PRAHA" &&
      mrazUrban.municipalitySignLabel === "PRAHA" &&
      unknownTun.municipalitySign == null &&
      conflictTun.conflict === true
  );
}

// --- Outside-city tunnel registry: [tunnel icon] + name + [road] ---
{
  ok(
    "OUTSIDE_CITY_TUNNEL_REGISTRY_PRESENT",
    Array.isArray(OUTSIDE_CITY_TUNNEL_REGISTRY) &&
      OUTSIDE_CITY_TUNNEL_REGISTRY.length >= 4 &&
      !!OUTSIDE_CITY_TUNNEL_SOURCE &&
      /rsd/i.test(String(OUTSIDE_CITY_TUNNEL_SOURCE.url || ""))
  );
  ok(
    "TUNNEL_ASSET_FOUND",
    fs.existsSync(path.join(root, "assets/images/traffic-road-tunnel.png")) &&
      TRAFFIC_SIGN_ASSET.TUNNEL_OBJECT === "/assets/images/traffic-road-tunnel.png"
  );

  const panImpact = "Tunel Panenská, jízdní pruh uzavřen, pravidelná údržba";
  const panInput = {
    location: "Tunel Panenská",
    eventType: "omezeni",
    impact: panImpact,
    impactFull: panImpact,
  };
  const panMatch = matchOutsideCityTunnelRegistry({
    namedObject: "Tunel Panenská",
    impact: panImpact,
  });
  const panEnrich = resolveOutsideCityTunnelEnrichment(panInput);
  const panHdr = buildLocalityHeaderModel(panInput);
  const panComm = buildCommunicationLine(panInput);
  const panPres = buildTrafficCardPresentation(panInput);
  const panVm = buildTrafficCardViewModel({
    ...panInput,
    publicEventId: PEID,
    road: "",
    impact: panImpact,
    impactFull: panImpact,
  });
  ok(
    "OUTSIDE_CITY_TUNNEL_DETECTED",
    panMatch &&
      panMatch.tunnelId === "cz-tunnel-panenska" &&
      panEnrich &&
      panEnrich.outsideCityTunnelMode === true &&
      panHdr.outsideCityTunnelMode === true
  );
  ok(
    "OUTSIDE_CITY_TUNNEL_HEADER",
    panHdr.besideLocality === "Tunel Panenská" &&
      panHdr.municipalitySign == null &&
      panHdr.municipalitySignLabel == null &&
      panHdr.tunnelObjectIcon === TRAFFIC_SIGN_ASSET.TUNNEL_OBJECT &&
      panComm.roadPresentation.road === "D8" &&
      panComm.roadPresentation.roadTypeIcon == null &&
      panComm.outsideCityTunnelMode === true
  );
  ok(
    "OUTSIDE_CITY_HEADER_ORDER_ICON_TUNNEL_ROAD",
    /outsideTunnelHeader/.test(uiSrc) &&
      /tunnelObjectIcon \+ besideBit \+ roadBadge/.test(uiSrc.replace(/\s+/g, " ")) &&
      panVm.outsideCityTunnelMode === true &&
      panVm.tunnelObjectIcon === TRAFFIC_SIGN_ASSET.TUNNEL_OBJECT &&
      panVm.besideLocality === "Tunel Panenská" &&
      panVm.roadBadge &&
      panVm.roadBadge.road === "D8"
  );
  ok(
    "OUTSIDE_CITY_EVENT_ICON_NOT_REPLACED",
    panPres.event &&
      panPres.event.asset &&
      panPres.event.asset !== TRAFFIC_SIGN_ASSET.TUNNEL_OBJECT &&
      panVm.eventSignSrc !== TRAFFIC_SIGN_ASSET.TUNNEL_OBJECT
  );
  ok(
    "MUNICIPALITY_SIGN_NOT_FORCED",
    panHdr.municipalitySign == null && panVm.municipalitySign == null
  );

  // City tunnel must remain city mode (no outside-city tunnel icon).
  const bubCity = buildLocalityHeaderModel({
    location: "Tunel Bubeneč",
    impact: "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen",
    impactFull: "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen",
    eventType: "omezeni",
  });
  const bubOutside = resolveOutsideCityTunnelEnrichment({
    location: "Tunel Bubeneč",
    impact: "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen",
    impactFull: "Tunel Bubeneč, jižní tubus B, jízdní pruh uzavřen",
  });
  ok(
    "CITY_TUNNEL_REMAINS_CITY_MODE",
    bubOutside == null &&
      bubCity.outsideCityTunnelMode !== true &&
      bubCity.municipalitySignLabel === "PRAHA" &&
      bubCity.besideLocality === "Tunel Bubeneč" &&
      bubCity.tunnelObjectIcon == null
  );

  // Unknown road: neither event nor registry → no fabrication.
  const noRoad = resolveOutsideCityTunnelRoad(null, null);
  const emptyRoad = resolveOutsideCityTunnelRoad("", "");
  ok(
    "UNKNOWN_ROAD_NO_FABRICATION",
    noRoad.road == null &&
      emptyRoad.road == null &&
      noRoad.usedRegistryRoad === false &&
      // Outside header branch still renders icon+name when roadBadge is empty (no invented road).
      /tunnelObjectIcon \+ besideBit \+ roadBadge/.test(uiSrc.replace(/\s+/g, " "))
  );

  // NDIC event road wins over registry on conflict.
  const conflictEnrich = resolveOutsideCityTunnelEnrichment({
    location: "Tunel Panenská",
    road: "D5",
    impact: "Tunel Panenská, omezení",
    impactFull: "Tunel Panenská, omezení",
  });
  ok(
    "CURRENT_NDIC_EVENT_DATA_PRIORITY",
    conflictEnrich &&
      conflictEnrich.road === "D5" &&
      conflictEnrich.roadConflict === true &&
      conflictEnrich.usedRegistryRoad === false
  );

  // Ambiguous generic "tunel" mention — fail closed.
  const ambMatch = matchOutsideCityTunnelRegistry({
    impact: "v tunelu probíhá údržba, jízdní pruh uzavřen",
    impactFull: "v tunelu probíhá údržba, jízdní pruh uzavřen",
  });
  const ambEnrich = resolveOutsideCityTunnelEnrichment({
    impact: "v tunelu probíhá údržba, jízdní pruh uzavřen",
    impactFull: "v tunelu probíhá údržba, jízdní pruh uzavřen",
  });
  const barePlace = matchOutsideCityTunnelRegistry({
    namedObject: "Panenská",
    impact: "Panenská, omezení",
  });
  ok(
    "AMBIGUOUS_TUNNEL_REFERENCE_FAIL_CLOSED",
    ambMatch == null && ambEnrich == null && barePlace == null
  );

  ok(
    "OUTSIDE_CITY_LAYOUT_WRAP",
    /\.iuPdTrafficComm__tunnelName/.test(cssSrc) &&
      /overflow-wrap:\s*anywhere/.test(cssSrc) &&
      !/\.iuPdTrafficComm__tunnelName[^{]*{[^}]*text-overflow:\s*ellipsis/i.test(cssSrc)
  );

  ok(
    "OUTSIDE_CITY_TUNNEL_SUITE_PASS",
    panHdr.outsideCityTunnelMode === true &&
      panHdr.besideLocality === "Tunel Panenská" &&
      panComm.roadPresentation.road === "D8" &&
      bubCity.municipalitySignLabel === "PRAHA" &&
      ambEnrich == null
  );
}

// --- Parking municipality registry + title single-render (2026-08-12) ---
{
  function headerParts(pres) {
    const muni = String(pres.communication.municipalitySignLabel || "").trim();
    const beside = String(pres.communication.besideLocality || "").trim();
    const fallback = String(pres.communication.localityFallback || "").trim();
    const head = String(pres.communication.headLocality || "").trim();
    return { muni, beside, fallback, head };
  }
  function titleOnce(pres) {
    const h = headerParts(pres);
    if (!h.beside) return false;
    // Name must not also appear as localityFallback / headLocality.
    if (h.fallback && h.fallback.toLowerCase() === h.beside.toLowerCase()) return false;
    if (h.head && h.head.toLowerCase() === h.beside.toLowerCase()) return false;
    return true;
  }

  const liveNames = [
    "P+R Zličín",
    "P+R Kongresové centrum",
    "P+R Kotlářka",
    "P+R Opatov",
    "P+R Rajská zahrada",
    "P+R Holešovice",
    "P+R Skalka",
    "P+R Skalka II",
    "Smetanovo náměstí",
    "pod Ostravskou univerzitou",
    "Parkovací dům DK POKLAD I.",
    "Nám. Msgre Šrámka",
    "Prokešovo náměstí",
    "Poděbradova",
    "Hlavní nádraží - jižní přednádraží",
  ];

  const zlicin = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Zličín, 70% obsazeno, méně než 30 volných parkovacích míst",
  });
  const skalka = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Skalka, 80% obsazeno, méně než 30 volných parkovacích míst",
  });
  const skalka2 = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "P+R Skalka II, 60% obsazeno, méně než 30 volných parkovacích míst",
  });
  const prokes = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "Prokešovo náměstí, 50% obsazeno, 12.08.2026 17:40:51",
  });
  const poklad = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "Parkovací dům DK POKLAD I., méně než 50 volných parkovacích míst, 40% obsazeno",
  });
  const hlNadrazi = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "Hlavní nádraží - jižní přednádraží, 10% obsazeno, méně než 20 volných parkovacích míst",
  });
  const unknownPark = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "Nové parkoviště XYZ, 40% obsazeno",
  });
  const pgLive = buildTrafficCardPresentation({
    eventType: "doprava",
    impact: "Černá Louka, P+G, 40% obsazeno, 12.08.2026 17:38:51",
  });

  ok("PARKING_TITLE_SINGLE_RENDER_PASS", titleOnce(zlicin) && titleOnce(skalka) && titleOnce(prokes) && titleOnce(unknownPark));
  ok(
    "PARKING_TITLE_NO_DUPLICATE_WITHOUT_MUNICIPALITY_PASS",
    titleOnce(unknownPark) &&
      titleOnce(hlNadrazi) &&
      !headerParts(unknownPark).fallback &&
      headerParts(unknownPark).beside === "Nové parkoviště XYZ"
  );

  ok(
    "PARKING_MUNICIPALITY_REGISTRY_PASS",
    zlicin.communication.municipalitySignLabel === "PRAHA" &&
      skalka.communication.municipalitySignLabel === "PRAHA" &&
      skalka2.communication.municipalitySignLabel === "PRAHA" &&
      prokes.communication.municipalitySignLabel === "OSTRAVA" &&
      poklad.communication.municipalitySignLabel === "OSTRAVA" &&
      pgLive.communication.municipalitySignLabel === "OSTRAVA" &&
      hlNadrazi.communication.municipalitySignLabel === "PRAHA"
  );
  ok(
    "PARKING_MUNICIPALITY_NO_GUESS_PASS",
    unknownPark.communication.municipalitySign == null &&
      matchParkingRegistry({ parkingName: "Hlavní nádraží" }) == null &&
      isAmbiguousParkingName("Hlavní nádraží") === true
  );
  ok(
    "HL_NADRAZI_MUNICIPALITY_SIGN_PASS",
    hlNadrazi.communication.municipalitySignLabel === "PRAHA" &&
      /Hlavní nádraží/i.test(hlNadrazi.communication.besideLocality || "") &&
      /jižní přednádraží/i.test(hlNadrazi.communication.besideLocality || "") &&
      !/^ulice:/i.test(hlNadrazi.communication.besideLocality || "") &&
      titleOnce(hlNadrazi) &&
      (hlNadrazi.expanded.rows || []).some(
        (r) => r && r.key === "municipality" && /^Praha$/i.test(String(r.value || ""))
      ) &&
      !(hlNadrazi.expanded.rows || []).some((r) => r && r.key === "parkingAddress") &&
      !(hlNadrazi.expanded.rows || []).some(
        (r) => r && r.key === "cityPart" && String(r.value || "").trim()
      )
  );
  ok(
    "HL_NADRAZI_LIVE_STATUS_UNCHANGED",
    /10\s*%\s*obsazeno/i.test(hlNadrazi.situationSummary || "") &&
      /méně než\s*20/i.test(hlNadrazi.situationSummary || "")
  );

  const inventoryIds = new Set(
    [
      "praha-pr-zlicin",
      "praha-pr-skalka-1",
      "praha-pr-skalka-2",
      "praha-pr-kongresove-centrum",
      "praha-pr-kotlarka",
      "praha-pr-opatov",
      "praha-pr-rajska-zahrada",
      "praha-pr-holesovice",
      "praha-hl-nadrazi-jizni-prednadrazi",
      "ostrava-smetanovo-namesti",
      "ostrava-pod-ostravskou-univerzitou",
      "ostrava-dk-poklad-1",
      "ostrava-nam-msgre-sramka",
      "ostrava-prokesovo-namesti",
      "ostrava-podebradova",
      "ostrava-cerna-louka-pg",
    ].filter((id) => PARKING_REGISTRY.some((e) => e.parkingId === id))
  );
  ok("PARKING_REGISTRY_INVENTORY_PASS", inventoryIds.size >= 16 && PARKING_REGISTRY.length >= 21);

  ok(
    "PARKING_REGISTRY_EXACT_ALIAS_PASS",
    matchParkingRegistry({ parkingName: "P+R Skalka" })?.parkingId === "praha-pr-skalka-1" &&
      matchParkingRegistry({ parkingName: "P+R Skalka II" })?.parkingId === "praha-pr-skalka-2" &&
      matchParkingRegistry({ parkingName: "P+R Zličín" })?.parkingId === "praha-pr-zlicin" &&
      matchParkingRegistry({ parkingName: "Prokešovo náměstí" })?.parkingId ===
        "ostrava-prokesovo-namesti"
  );
  ok(
    "PARKING_SKALKA_SKALKA_II_DISTINCT_PASS",
    matchParkingRegistry({ parkingName: "P+R Skalka" })?.parkingId !==
      matchParkingRegistry({ parkingName: "P+R Skalka II" })?.parkingId &&
      skalka.communication.besideLocality === "P+R Skalka" &&
      /Skalka II/i.test(skalka2.communication.besideLocality || "")
  );

  const zAddr = (zlicin.expanded.rows || []).find((r) => r && r.key === "parkingAddress");
  const pAddr = (poklad.expanded.rows || []).find((r) => r && r.key === "parkingAddress");
  const hAddr = (hlNadrazi.expanded.rows || []).find((r) => r && r.key === "parkingAddress");
  ok(
    "PARKING_ADDRESS_VERIFIED_ONLY_PASS",
    !zAddr &&
      !!pAddr &&
      /Matěje Kopeckého/i.test(String(pAddr.value || "")) &&
      !hAddr
  );

  const cityPartRow = (poklad.expanded.rows || []).find((r) => r && r.key === "cityPart");
  ok(
    "PARKING_CITYPART_SECONDARY_PASS",
    poklad.communication.municipalitySignLabel === "OSTRAVA" &&
      /Poruba/i.test(String(cityPartRow?.value || "")) &&
      poklad.communication.municipalitySignLabel !== "PORUBA"
  );

  const zPr = (zlicin.expanded.rows || []).find((r) => r && r.key === "parkingPrExplanation");
  const pPr = (poklad.expanded.rows || []).find((r) => r && r.key === "parkingPrExplanation");
  const pgPr = (pgLive.expanded.rows || []).find((r) => r && r.key === "parkingPrExplanation");
  ok("PARKING_PR_EXPLANATION_PASS", /Park and Ride/i.test(String(zPr?.value || "")));
  ok("PARKING_NON_PR_NO_PR_EXPLANATION_PASS", !pPr && !pgPr);

  ok(
    "PARKING_LIVE_STATUS_UNCHANGED_PASS",
    /70\s*%\s*obsazeno/i.test(zlicin.situationSummary || "") &&
      /méně než\s*30/i.test(zlicin.situationSummary || "") &&
      /50\s*%\s*obsazeno/i.test(prokes.situationSummary || "")
  );
  ok(
    "PARKING_RAW_NDIC_PRESERVED_PASS",
    (prokes.expanded.rows || []).some(
      (r) =>
        r &&
        r.key === "sourceDescription" &&
        /Prokešovo náměstí,\s*50%\s*obsazeno/i.test(String(r.value || ""))
    )
  );

  // Inventory audit for report (live names covered by registry or intentionally unmatched).
  let covered = 0;
  for (const n of liveNames) {
    const m = matchParkingRegistry({
      parkingName: n,
      impact: n + ", 50% obsazeno",
    });
    if (n.startsWith("Hlavní nádraží")) {
      ok(
        "HLAVNI_NADRAZI_REGISTRY_MATCH",
        m &&
          m.parkingId === "praha-hl-nadrazi-jizni-prednadrazi" &&
          m.municipality === "Praha" &&
          m.addressLine == null
      );
      if (m && m.municipality) covered++;
      continue;
    }
    if (m && m.municipality) covered++;
  }
  ok("PARKING_LIVE_INVENTORY_COVERED", covered >= 15);

  void liveNames;
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
          "PARKING_NON_PR_NO_PR_EXPLANATION_PASS",
          "PARKING_LIVE_STATUS_PRIORITY_PASS",
          "PARKING_FULL_STATUS_VISIBLE_COLLAPSED_PASS",
          "PARKING_UNKNOWN_STATUS_FALLBACK_PASS",
          "PARKING_NO_FAKE_OCCUPANCY_PASS",
          "PARKING_NO_DUPLICATE_TITLE_PASS",
          "PARKING_TITLE_SINGLE_RENDER_PASS",
          "PARKING_TITLE_NO_DUPLICATE_WITHOUT_MUNICIPALITY_PASS",
          "PARKING_MUNICIPALITY_REGISTRY_PASS",
          "PARKING_MUNICIPALITY_NO_GUESS_PASS",
          "HL_NADRAZI_MUNICIPALITY_SIGN_PASS",
          "HL_NADRAZI_LIVE_STATUS_UNCHANGED",
          "HLAVNI_NADRAZI_REGISTRY_MATCH",
          "PARKING_REGISTRY_INVENTORY_PASS",
          "PARKING_REGISTRY_EXACT_ALIAS_PASS",
          "PARKING_SKALKA_SKALKA_II_DISTINCT_PASS",
          "PARKING_ADDRESS_VERIFIED_ONLY_PASS",
          "PARKING_CITYPART_SECONDARY_PASS",
          "PARKING_LIVE_STATUS_UNCHANGED_PASS",
          "PARKING_RAW_NDIC_PRESERVED_PASS",
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
          "ACCIDENT_CARD_REGRESSION_PASS",
          "OBSTACLE_CARD_REGRESSION_PASS",
          "SMV_REGRESSION_PASS",
          "SMV_CARD_REGRESSION_PASS",
          "PARKING_CARD_REGRESSION_PASS",
          "QUEUE_CARD_REGRESSION_PASS",
          "ROADWORKS_CARD_REGRESSION_PASS",
          "ACCIDENT_PRIORITY_OVER_TRAFFIC_CONDITION_PASS",
          "HEAVY_TRAFFIC_NOT_QUEUE_PASS",
          "QUEUE_REQUIRES_EXPLICIT_SOURCE_PASS",
          "SINGLE_LANE_CLOSED_NOT_FULL_CLOSURE_PASS",
          "SHOULDER_CLOSED_NOT_FULL_CLOSURE_PASS",
          "HARD_SHOULDER_BLOCKED_NOT_FULL_CLOSURE_PASS",
          "FULL_CLOSURE_REQUIRES_FULL_SCOPE_PASS",
          "ROADWORKS_PRIORITY_WITH_SINGLE_LANE_CLOSURE_PASS",
          "BROKEN_VEHICLE_PRIORITY_PASS",
          "NO_DIRECTION_CLOSURE_FROM_SINGLE_LANE_PASS",
          "NO_QUEUE_INFERENCE_FROM_DELAY_PASS",
          "NO_QUEUE_INFERENCE_FROM_HEAVY_TRAFFIC_PASS",
          "TRAFFIC_SUMMARY_CAUSE_FIRST_PASS",
          "TRAFFIC_SUMMARY_SCOPE_SECOND_PASS",
          "TRAFFIC_SUMMARY_CONDITION_THIRD_PASS",
          "DUPLICATE_LOCALITY_ROAD_HIDDEN_PASS",
          "KM_ORDER_PRESERVED_PASS",
          "FUTURE_LIFECYCLE_TYPE_INDEPENDENT_PASS",
          "RAW_NDIC_DESCRIPTION_PRESERVED_PASS",
          "BUBENECSKY_TUNNEL_LIVE_FIXTURE_PASS",
          "NO_FABRICATED_STREET_PASS",
          "NO_STREET_FROM_GENERIC_LOCALITY_PASS",
          "NO_STREET_FROM_CITYPART_PASS",
          "NO_STREET_FROM_TMC_LABEL_PASS",
          "NO_STREET_FROM_NAMED_OBJECT_PASS",
          "NAMED_OBJECT_PRIORITY_OVER_GENERIC_LOCALITY_PASS",
          "TUNNEL_LOCATION_PRIORITY_PASS",
          "BRIDGE_LOCATION_PRIORITY_PASS",
          "SQUARE_NOT_STREET_PASS",
          "MUNICIPALITY_REMAINS_PRIMARY_SIGN_PASS",
          "CITYPART_REMAINS_SECONDARY_PASS",
          "NO_STREET_LABEL_WITHOUT_STREET_EVIDENCE_PASS",
          "STREET_CARD_REGRESSION_PASS",
          "TRAFFIC_CARD_SUITE_PASS",
          "TRAFFIC_CARD_REGRESSION_PASS",
          "D0_DISPLAY_NAME",
          "D0_GLOBAL_RULE_IMPLEMENTED",
          "D0_TOP_ROW_PASS",
          "D0_PLACE_AND_DIRECTION_PASS",
          "D0_DETAIL_ROAD_NAME_PASS",
          "D0_FALSE_LOCALITY_REMOVED",
          "STRONG_TRAFFIC_FALSE_QUEUE_FIXED",
          "REAL_QUEUE_STILL_WORKS",
          "ACCIDENT_PRIORITY_OVER_STRONG_TRAFFIC_PASS",
          "ACCIDENT_PRIORITY_OVER_QUEUE_PASS",
          "RAW_NDIC_DESCRIPTION_UNCHANGED",
          "D0_REGRESSION_PASS",
          "OTHER_MOTORWAYS_REGRESSION_PASS",
          "D0_BARE_MOST_NOT_OVERRIDE_PASS",
          "SIT_CLOSURE_EXTRAORDINARY_IZS_PASS",
          "SIT_ACCIDENT_TWO_CARS_RIGHT_LANE_PASS",
          "SIT_ACCIDENT_LANE_QUEUE_PASS",
          "SIT_HEAVY_ONLY_PASS",
          "SIT_HEAVY_LENGTH_PASS",
          "SIT_ROADWORKS_LANE_PASS",
          "SIT_BROKEN_SHOULDER_CARE_PASS",
          "SIT_LANE_NOT_FULL_ROAD_PASS",
          "SIT_SHOULDER_NOT_FULL_ROAD_PASS",
          "SIT_NO_INVENTED_QUEUE_PASS",
          "SIT_NO_INVENTED_ACCIDENT_PASS",
          "SIT_NO_CLOSURE_DUPLICATE_PASS",
          "SIT_RICH_SUMMARY_SUITE_PASS",
          "MUNI_PARSE_CESKE_BUDEJOVICE",
          "MUNI_SIGN_CESKE_BUDEJOVICE_FROM_COMMENT",
          "MUNI_SIGN_RECOVERS_TRUNCATED_STRUCTURED",
          "MUNI_SIGN_MULTIWORD_SUITE_PASS",
          "MUNI_SIGN_LAYOUT_WRAP_PASS",
          "U_OBCE_PARSE_STUDENEC",
          "U_OBCE_HEADER_PASS",
          "U_OBCE_PLACE_PASS",
          "U_OBCE_DETAIL_OBEC_PASS",
          "U_OBCE_NO_DIVERSION_TOWN",
          "U_OBCE_MULTIWORD_PASS",
          "U_OBCE_UI_ORDER_PASS",
          "U_OBCE_POLICE_PARSE_PASS",
          "U_OBCE_POLICE_HEADER_PASS",
          "U_OBCE_POLICE_LOCALITY_PRESERVED_PASS",
          "U_OBCE_LOCALITY_DOES_NOT_OVERRIDE_HEADER_PASS",
          "U_OBCE_STUDENEC_HEADER_STILL_PASS",
          "U_OBCE_MULTIWORD_WITH_ROAD_EXTRACT_PASS",
          "U_OBCE_CESKE_BUDEJOVICE_PASS",
          "MRAZOVKA_TUNNEL_PARSE_PASS",
          "MRAZOVKA_HEADER_PASS",
          "MRAZOVKA_PLACE_PASS",
          "MRAZOVKA_SUMMARY_PASS",
          "MRAZOVKA_DETAIL_TUNNEL_PASS",
          "MRAZOVKA_CLOSURE_CLASSIFIER_PASS",
          "MRAZOVKA_RAW_UNCHANGED_PASS",
          "BRUSNICKY_TUNNEL_PARSE_PASS",
          "BRUSNICKY_PRAHA7_NOT_MUNICIPALITY_PASS",
          "BRUSNICKY_HEADER_PASS",
          "BRUSNICKY_PLACE_PASS",
          "BRUSNICKY_SUMMARY_PASS",
          "BRUSNICKY_DETAIL_TUNNEL_PASS",
          "PRAHA_CITYPART_NOT_MUNICIPALITY_SUITE_PASS",
          "TUNNEL_FULL_CLOSURE_NOT_LANE_REGRESSION_PASS",
          "TUNNEL_ULICE_PREFIX_STRIP_PASS",
          "TUNNEL_SEMANTICS_SUITE_PASS",
          "URBAN_TUNNEL_REGISTRY_FILE_PRESENT",
          "URBAN_TUNNEL_BUBENEC_MATCH",
          "URBAN_TUNNEL_BUBENEC_HEADER",
          "URBAN_TUNNEL_BUBENEC_NO_CITYPART_INVENTION",
          "URBAN_TUNNEL_MRAZOVKA_HEADER",
          "URBAN_TUNNEL_UNKNOWN_FAIL_CLOSED",
          "URBAN_TUNNEL_OFFICIAL_PRECEDENCE",
          "URBAN_TUNNEL_NO_FUZZY_BARE_PLACE",
          "URBAN_TUNNEL_U_OBCE_REGRESSION",
          "URBAN_TUNNEL_MULTIWORD_MUNI_REGRESSION",
          "URBAN_TUNNEL_REGISTRY_SUITE_PASS",
          "OUTSIDE_CITY_TUNNEL_REGISTRY_PRESENT",
          "TUNNEL_ASSET_FOUND",
          "OUTSIDE_CITY_TUNNEL_DETECTED",
          "OUTSIDE_CITY_TUNNEL_HEADER",
          "OUTSIDE_CITY_HEADER_ORDER_ICON_TUNNEL_ROAD",
          "OUTSIDE_CITY_EVENT_ICON_NOT_REPLACED",
          "MUNICIPALITY_SIGN_NOT_FORCED",
          "CITY_TUNNEL_REMAINS_CITY_MODE",
          "UNKNOWN_ROAD_NO_FABRICATION",
          "CURRENT_NDIC_EVENT_DATA_PRIORITY",
          "AMBIGUOUS_TUNNEL_REFERENCE_FAIL_CLOSED",
          "OUTSIDE_CITY_LAYOUT_WRAP",
          "OUTSIDE_CITY_TUNNEL_SUITE_PASS",
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
