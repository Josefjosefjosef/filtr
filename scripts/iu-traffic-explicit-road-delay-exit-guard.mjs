#!/usr/bin/env node
/**
 * EXPLICIT_ROAD_PRECEDENCE + DELAY_DURATION + EXIT_OBJECT_DUP guards.
 * - Explicit comment motorway (D48 EXIT 46) beats conflicting structured/enriched D56
 * - EXIT number alone must not imply a road
 * - "očekávejte zdržení do 1 hodiny" keeps duration in collapsed summary
 * - Bare "očekávejte zdržení" must not invent a duration
 * - Duplicate OBJEKT exit N suppressed when EXIT structured
 * Pure local, no hardcodes for D48/46 as the only pass path.
 */
import {
  parseOfficialCommentFacts,
  preferClassedRoadNumber,
  resolvePresentationRoadNumber,
  buildPlaceAndDirectionLine,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  namedObjectDuplicatesExitNumber,
  formatExpectedDelaySituationBit,
  extractExpectedDelayDurationFacts,
  classifyRoadPresentation,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { buildTrafficCardViewModel } from "../assets/iu-traffic-overview-v1.js";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

function rowMap(card) {
  return Object.fromEntries(((card.expanded && card.expanded.rows) || []).map((r) => [r.key, r.value]));
}

const REF_RAW =
  "D48 EXIT 46, Od 14.08.2026 15:10 Do 14.08.2026 17:15, porouchané vozidlo, očekávejte zdržení do 1 hodiny; zpevněná krajnice uzavřena; odstavené vozidlo.";

// --- EXPLICIT_ROAD_PRECEDENCE: structured enrichment must not override comment motorway ---
{
  ok("PREFER_COMMENT_MW", preferClassedRoadNumber("D56", "D48") === "D48");
  ok("PREFER_SAME_MW", preferClassedRoadNumber("D48", "D48") === "D48");
  ok("PREFER_LEGIT_D56", preferClassedRoadNumber("D56", "D56") === "D56");
  ok("PREFER_BARE_VS_COMMENT", preferClassedRoadNumber("56", "D48") === "D48");

  const facts = parseOfficialCommentFacts(REF_RAW);
  ok("EXIT_ROAD_D48", facts.exitRoad === "D48", facts.exitRoad);
  ok("EXIT_NUM_46", facts.exitNumber === "46", facts.exitNumber);

  const wrongStructured = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "prekazka",
    category: "prekazka",
    road: "D56",
    illustrationKey: "porucha",
  };
  const road = resolvePresentationRoadNumber(wrongStructured, facts);
  const roadPres = classifyRoadPresentation(road, wrongStructured);
  const place = buildPlaceAndDirectionLine(wrongStructured);
  const card = buildTrafficCardPresentation(wrongStructured);
  const vm = buildTrafficCardViewModel(wrongStructured);
  const rows = rowMap(card);

  ok("PRIMARY_ROAD_D48", road === "D48", road);
  ok("NOT_D56", road !== "D56", road);
  ok("MOTORWAY_ICON", roadPres.showMotorwayIcon === true);
  ok("MOTORWAY_BADGE", roadPres.numberBadge === "motorway" && road === "D48", road);
  ok("PLACE_D48_EXIT", /D48/.test(place) && /EXIT\s+46/i.test(place), place);
  ok("PLACE_NOT_D56", !/\bD56\b/.test(place), place);
  ok("HEADER_ROAD", vm.roadBadge.road === "D48", vm.roadBadge.road);
  ok("HEADER_EXIT", vm.exitHeaderLabel === "EXIT 46", vm.exitHeaderLabel);
  ok("ROW_ROAD", rows.road === "D48", rows.road);
  ok("ROW_EXIT", rows.exitNumber === "46", rows.exitNumber);
}

// --- CROSS_ROAD: explicit D56 stays D56; exit alone does not invent road ---
{
  const d56raw = "D56 EXIT 12, porouchané vozidlo, očekávejte zdržení";
  const f56 = parseOfficialCommentFacts(d56raw);
  ok("CROSS_D56_EXIT_ROAD", f56.exitRoad === "D56", f56.exitRoad);
  const road56 = resolvePresentationRoadNumber(
    { impactFull: d56raw, road: "D56" },
    f56
  );
  ok("CROSS_D56_KEPT", road56 === "D56", road56);

  const conflict = resolvePresentationRoadNumber(
    { impactFull: d56raw, road: "D48" },
    f56
  );
  ok("CROSS_COMMENT_WINS_D56", conflict === "D56", conflict);

  const bareExit = parseOfficialCommentFacts("EXIT 46, porouchané vozidlo");
  ok("EXIT_ALONE_NO_ROAD", !bareExit.exitRoad, bareExit.exitRoad);
  ok("EXIT_ALONE_HAS_NUM", bareExit.exitNumber === "46", bareExit.exitNumber);
}

// --- DELAY_DURATION ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const dur = extractExpectedDelayDurationFacts(REF_RAW);
  ok("DELAY_EXPECTED", facts.delayExpected === true);
  ok("DELAY_VALUE", facts.delayDurationValue === 1, String(facts.delayDurationValue));
  ok("DELAY_UNIT", facts.delayDurationUnit === "hour", facts.delayDurationUnit);
  ok("DELAY_QUALIFIER", facts.delayDurationQualifier === "do", facts.delayDurationQualifier);
  ok(
    "DELAY_BIT",
    formatExpectedDelaySituationBit(REF_RAW, facts) === "Očekávejte zdržení do 1 hodiny",
    formatExpectedDelaySituationBit(REF_RAW, facts)
  );

  const sit = buildTrafficSituationSummary({
    impactFull: REF_RAW,
    eventType: "prekazka",
    road: "D56",
  });
  ok("SUMMARY_HAS_DURATION", /do\s+1\s+hodiny/i.test(sit), sit);
  ok("SUMMARY_NOT_BARE_DELAY", !/^.*Zdržení\.\s*$/i.test(sit) && /do\s+1\s+hodiny/i.test(sit), sit);
  ok("SHOULDER_KEPT", /zpevněná\s+krajnice/i.test(sit), sit);
  ok("BROKEN_KEPT", /porouchané\s+vozidlo/i.test(sit), sit);

  const bareDelay = "D1, porouchané vozidlo, očekávejte zdržení; zpevněná krajnice uzavřena.";
  const bareFacts = parseOfficialCommentFacts(bareDelay);
  ok("BARE_DELAY_NO_DURATION", bareFacts.delayDurationValue == null, String(bareFacts.delayDurationValue));
  const bareBit = formatExpectedDelaySituationBit(bareDelay, bareFacts);
  ok("BARE_DELAY_BIT", bareBit === "Očekávejte zdržení", bareBit);
  ok("BARE_DELAY_NO_INVENT", !/hodin/i.test(bareBit || ""), bareBit);
}

// --- STRANDED vehicle forensic ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  ok("STRANDED_SOURCE_EXTRACTED", facts.strandedVehiclePresent === true);
  const sit = buildTrafficSituationSummary({
    impactFull: REF_RAW,
    eventType: "prekazka",
    road: "D48",
  });
  // Stronger "porouchané vozidlo" already leads — odstavené is same object.
  ok(
    "STRANDED_OMISSION_BY_STRONGER",
    /porouchané\s+vozidlo/i.test(sit) && !/odstavené\s+vozidlo/i.test(sit),
    sit
  );

  const onlyStranded =
    "D1, km 10, odstavené vozidlo, zpevněná krajnice uzavřena.";
  const sit2 = buildTrafficSituationSummary({
    impactFull: onlyStranded,
    eventType: "prekazka",
    road: "D1",
  });
  ok("STRANDED_ALONE_KEPT", /odstavené\s+vozidlo/i.test(sit2), sit2);
}

// --- EXIT object duplication ---
{
  const card = buildTrafficCardPresentation({
    impactFull: REF_RAW,
    eventType: "prekazka",
    road: "D56",
  });
  const facts = parseOfficialCommentFacts(REF_RAW);
  const rows = rowMap(card);
  ok(
    "NAMED_DUP_EXIT",
    namedObjectDuplicatesExitNumber(facts.namedObject, facts.exitNumber) === true
  );
  ok("DUP_OBJECT_SUPPRESSED", rows.namedObject == null, String(rows.namedObject));
  ok("EXIT_ROW_KEPT", rows.exitNumber === "46", rows.exitNumber);
}

// --- Non-regression anchors ---
{
  const e354 =
    "D1 výjezd EXIT 354 směr Ostrava, nehoda; Nájezd z dálnice D1 na Rudnou.";
  const f354 = parseOfficialCommentFacts(e354);
  const p354 = buildPlaceAndDirectionLine({ impactFull: e354 });
  ok("D1_EXIT354_ROAD", f354.exitRoad === "D1" || f354.roadNumber === "D1");
  ok("D1_EXIT354_PLACE", /D1/.test(p354) && /EXIT\s+354/i.test(p354) && /Ostrava/i.test(p354), p354);

  const e76 = "D0 EXIT 76, sjezd na D1 ve směru Ostrava";
  const f76 = parseOfficialCommentFacts(e76);
  ok("D0_EXIT76_PRIMARY", f76.exitRoad === "D0" && f76.exitNumber === "76");
  const p76 = buildPlaceAndDirectionLine({ impactFull: e76 });
  ok("D0_EXIT76_NOT_D1_PRIMARY", /^D0\b/.test(p76), p76);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-explicit-road-delay-exit-guard",
      pass,
      EXPLICIT_ROAD_PRECEDENCE_PASS: !fails.some((f) =>
        /PREFER_|PRIMARY_|NOT_D56|PLACE_D48|HEADER_ROAD|ROW_ROAD|EXIT_ROAD/.test(f)
      ),
      EXIT_ROAD_CONTEXT_GUARD_PASS: !fails.some((f) => /EXIT_ALONE|CROSS_/.test(f)),
      CROSS_ROAD_REGRESSION_PASS: !fails.some((f) => f.startsWith("CROSS_")),
      DELAY_DURATION_GUARD_PASS: !fails.some((f) => f.startsWith("DELAY_") || f.startsWith("BARE_DELAY") || f.startsWith("SUMMARY_")),
      EXIT_OBJECT_DUPLICATION_GUARD_PASS: !fails.some((f) => /DUP_|NAMED_DUP|EXIT_ROW/.test(f)),
      D1_EXIT_354_REGRESSION_PASS: !fails.some((f) => f.startsWith("D1_EXIT354")),
      D0_EXIT_76_REGRESSION_PASS: !fails.some((f) => f.startsWith("D0_EXIT76")),
      D56_LEGITIMATE_REGRESSION_PASS: !fails.some((f) => /LEGIT_D56|CROSS_D56_KEPT/.test(f)),
      failCount: fails.length,
      fails,
      resultCount: results.length,
    },
    null,
    2
  )
);
if (!pass) process.exit(1);
console.log("IU_TRAFFIC_EXPLICIT_ROAD_DELAY_EXIT_GUARD_PASS");
