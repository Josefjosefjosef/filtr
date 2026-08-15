#!/usr/bin/env node
/**
 * BROKEN_DOWN_VEHICLE_VS_GENERIC_ACCIDENT_WORKSITE_GUARD
 *
 * Explicit "porouchané vozidlo" + "Nepojízdný OA na krajnici" must beat generic DN
 * worksite metadata "nouze nebo nehoda" (disjunctive — must not invent ACCIDENT alone).
 *
 * Fixture may use D1 / km 22–22.1 / Brno as realistic sample values.
 * Implementation must not hardcode those as the only pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficSituationSummary,
  buildTrafficCardPresentation,
  classifyEventPresentation,
  analyzePrimaryCause,
  hasExplicitAccidentConfirmation,
  hasExplicitBrokenDownVehicle,
  stripGenericEmergencyOrAccidentWorksitePhrase,
  ACCIDENT_PARTICIPANT,
} from "../assets/iu-traffic-card-presenter-v1.js";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

const REF_RAW =
  "D1, mezi km 22 a 22.1, ve směru Brno, porouchané vozidlo, zdržení, zpevněná krajnice (odstavný pruh) uzavřená, Od 14.08.2026 20:37 Do 14.08.2026 22:35, * jiný důvod (Nepojízdný OA na krajnici), pracovní místo DN – nouze nebo nehoda, Vydal: SSÚD 01 - Mirošovice";

const REF_INPUT = {
  impact: REF_RAW,
  impactFull: REF_RAW,
  eventType: "omezeni",
  category: "omezeni",
  road: "D1",
  illustrationKey: "omezeni",
  delayAvailable: false,
  delayMinutes: null,
};

const GENERIC_RAW =
  "D11, mezi km 10 a 10.2, ve směru Praha, porouchané vozidlo, zdržení, zpevněná krajnice uzavřená, jiný důvod (Nepojízdný OA na krajnici), pracovní místo DN – nouze nebo nehoda";

// --- Primary fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const cause = analyzePrimaryCause(REF_RAW, REF_INPUT);
  const ev = classifyEventPresentation(REF_INPUT);
  const sit = String(buildTrafficSituationSummary(REF_INPUT) || "");
  const card = buildTrafficCardPresentation(REF_INPUT);
  const place = String(card.placeLine || "");
  const parts = facts.accidentParticipants || [];

  ok("BROKEN_DOWN_VEHICLE_SOURCE_PRESENT", /porouchan(?:é|ý|á)?\s+vozidlo/i.test(REF_RAW));
  ok(
    "BROKEN_DOWN_VEHICLE_EXTRACTED",
    hasExplicitBrokenDownVehicle(REF_RAW) === true,
    String(hasExplicitBrokenDownVehicle(REF_RAW))
  );
  ok(
    "BROKEN_DOWN_VEHICLE_STRUCTURED",
    facts.obstructionType === "BROKEN_VEHICLE" && cause === "BROKEN_VEHICLE",
    facts.obstructionType + "|" + cause
  );

  ok(
    "WORKSITE_STRIP_REMOVES_DISJUNCTION",
    !/\bnehoda\b/i.test(stripGenericEmergencyOrAccidentWorksitePhrase(REF_RAW)),
    stripGenericEmergencyOrAccidentWorksitePhrase(REF_RAW)
  );
  ok(
    "ACCIDENT_EXPLICITLY_CONFIRMED_NO",
    hasExplicitAccidentConfirmation(REF_RAW, REF_INPUT) === false,
    String(hasExplicitAccidentConfirmation(REF_RAW, REF_INPUT))
  );
  ok(
    "ACCIDENT_CONFIRMED_NO",
    hasExplicitAccidentConfirmation(REF_RAW, REF_INPUT) === false
  );
  ok("ACCIDENT_SUBTYPE_NOT_INVENTED", facts.accidentSubtype == null, facts.accidentSubtype);

  ok(
    "PRIMARY_EVENT_TYPE_BROKEN_DOWN_VEHICLE",
    cause === "BROKEN_VEHICLE",
    cause
  );
  ok(
    "AFTER_CARD_TYPE_POROUCHANE_VOZIDLO",
    ev.titleCs === "POROUCHANÉ VOZIDLO",
    ev.titleCs
  );
  ok("EVENT_NOT_ACCIDENT_KIND", ev.kind !== "accident", ev.kind);
  ok(
    "ACCIDENT_NEGATIVE_GUARD",
    ev.titleCs !== "NEHODA" && !/^Nehoda\b/i.test(sit),
    ev.titleCs + "|" + sit
  );

  ok(
    "PASSENGER_CAR_PRESENT",
    parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR),
    JSON.stringify(parts)
  );
  ok("IMMOBILE_VEHICLE_PRESENT", facts.immobileVehiclePresent === true);
  ok("SHOULDER_POSITION_PRESENT", facts.vehicleOnShoulder === true);
  ok(
    "VEHICLE_DETAIL_GUARD",
    parts.includes(ACCIDENT_PARTICIPANT.PASSENGER_CAR) &&
      facts.immobileVehiclePresent === true &&
      facts.vehicleOnShoulder === true
  );

  ok(
    "SIT_IMMOBILE_PASSENGER_SHOULDER",
    /nepojízdn[ýáé]\s+osobní(?:ho)?\s+automobil/i.test(sit) && /krajnici/i.test(sit),
    sit
  );
  ok("SHOULDER_CLOSURE_STRUCTURED", /zpevněná\s+krajnice/i.test(sit) && /uzavřen/i.test(sit), sit);
  ok(
    "NO_DUPLICATE_ODSTAVNY_PRUH",
    !(/zpevněná\s+krajnice/i.test(sit) && /odstavn/i.test(sit)),
    sit
  );
  ok("DELAY_STRUCTURED", /zdržení/i.test(sit), sit);
  ok("SIT_NO_NEHODA_LEAD", !/^Nehoda\b/i.test(sit.trim()), sit);

  ok("MOTORWAY_HEADER_AFTER_PASS", /D1/i.test(place), place);
  ok("KM_RANGE_AFTER_PASS", /km\s+22\s*[–-]\s*22[,.]1/i.test(place), place);
  ok("DIRECTION_AFTER_PASS", /Brno/i.test(place), place);

  ok(
    "BROKEN_DOWN_VEHICLE_VS_GENERIC_ACCIDENT_WORKSITE_GUARD",
    cause === "BROKEN_VEHICLE" &&
      ev.titleCs === "POROUCHANÉ VOZIDLO" &&
      hasExplicitAccidentConfirmation(REF_RAW, REF_INPUT) === false,
    cause + "|" + ev.titleCs
  );
}

// --- Generic road (no D1 hardcode pass path) ---
{
  const input = {
    impact: GENERIC_RAW,
    impactFull: GENERIC_RAW,
    eventType: "omezeni",
    category: "omezeni",
    road: "D11",
    illustrationKey: "omezeni",
  };
  const cause = analyzePrimaryCause(GENERIC_RAW, input);
  const ev = classifyEventPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok("GENERIC_ROAD_CAUSE_BROKEN", cause === "BROKEN_VEHICLE", cause);
  ok("GENERIC_ROAD_TITLE", ev.titleCs === "POROUCHANÉ VOZIDLO", ev.titleCs);
  ok(
    "GENERIC_ROAD_SIT",
    /nepojízdn|porouchan/i.test(sit) && /osobní/i.test(sit) && !/^Nehoda\b/i.test(sit),
    sit
  );
}

// --- Real accidents must stay NEHODA ---
{
  const accidents = [
    {
      id: "HORNI_POLICE",
      raw: "Od 14.8.2026 18:00 do 19:00; na silnici 263 u obce Horní Police okres Česká Lípa; nehoda; probíhá vyšetřování nehody; havárie OA.",
      type: "nehoda",
    },
    {
      id: "LIBEREC_OA_CYCLIST",
      raw: "Od 14.8.2026 16:50 do 17:50; v ulici Ještědská v obci Liberec; nehoda; probíhá vyšetřování nehody; Pozor! Lidé na vozovce; OA x cyklista, na místo jedou složky IZS.",
      type: "nehoda",
    },
    {
      id: "EXIT_FIREISH",
      raw: "D1 EXIT 354, nehoda, požár vozidla, probíhá vyšetřování nehody, havárie OA.",
      type: "nehoda",
    },
  ];
  let broken = 0;
  for (const a of accidents) {
    const input = {
      impact: a.raw,
      impactFull: a.raw,
      eventType: a.type,
      category: a.type,
      illustrationKey: a.type,
    };
    const cause = analyzePrimaryCause(a.raw, input);
    const ev = classifyEventPresentation(input);
    const pass = cause === "ACCIDENT" && ev.titleCs === "NEHODA";
    if (!pass) broken += 1;
    ok("REAL_ACCIDENT_" + a.id, pass, cause + "|" + ev.titleCs);
  }
  ok("REAL_ACCIDENT_REGRESSIONS_BROKEN_0", broken === 0, String(broken));
}

// --- Prior broken-down vehicles stay broken-down ---
{
  const brokenCases = [
    {
      id: "VISNOVA",
      raw: "Od 14.8.2026 14:40 do 15:40; na silnici 0357 v obci Višňová okres Liberec; porouchané vozidlo, očekávejte zdržení; překážka na vozovce, průjezd se zvýšenou opatrností; provoz na trati zastaven.",
      type: "prekazka",
    },
    {
      id: "D48_EXIT_46",
      raw: "D48 EXIT 46, Od 14.08.2026 15:10 Do 14.08.2026 17:15, porouchané vozidlo, očekávejte zdržení do 1 hodiny; zpevněná krajnice uzavřena; odstavené vozidlo.",
      type: "prekazka",
    },
  ];
  let broken = 0;
  for (const b of brokenCases) {
    const input = {
      impact: b.raw,
      impactFull: b.raw,
      eventType: b.type,
      category: b.type,
      illustrationKey: b.type,
    };
    const cause = analyzePrimaryCause(b.raw, input);
    const ev = classifyEventPresentation(input);
    const pass = cause === "BROKEN_VEHICLE" && ev.titleCs === "POROUCHANÉ VOZIDLO";
    if (!pass) broken += 1;
    ok("PRIOR_BROKEN_" + b.id, pass, cause + "|" + ev.titleCs);
  }
  ok("BROKEN_DOWN_VEHICLE_REGRESSIONS_BROKEN_0", broken === 0, String(broken));
}

// --- Explicit accident + OA must not flip to broken solely from OA ---
{
  const raw = "nehoda; havárie OA; probíhá vyšetřování nehody";
  const input = { impact: raw, impactFull: raw, eventType: "nehoda", category: "nehoda" };
  const cause = analyzePrimaryCause(raw, input);
  const ev = classifyEventPresentation(input);
  ok("OA_ALONE_NOT_BROKEN", cause === "ACCIDENT" && ev.titleCs === "NEHODA", cause + "|" + ev.titleCs);
}

const out = {
  guard: "iu-traffic-broken-down-vehicle-vs-generic-accident-worksite-guard",
  pass: fails.length === 0,
  failCount: fails.length,
  fails,
  results,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_BROKEN_DOWN_VS_GENERIC_ACCIDENT_WORKSITE_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_BROKEN_DOWN_VS_GENERIC_ACCIDENT_WORKSITE_PASS");
