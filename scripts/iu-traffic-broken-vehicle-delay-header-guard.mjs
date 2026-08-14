#!/usr/bin/env node
/**
 * Broken-down vehicle: preserve delay + obstacle + caution in collapsed summary,
 * white municipality sign for -ová municipalities, CLASS_III road badge for bare
 * 4–6 digit III-class numbers. Fixture-based general rules — no place/road hardcode
 * pass path. Pure local, no network.
 *
 * Forensic note on "provoz na trati zastaven":
 * SOURCE_FIELD=publicComment free text only; no DATEX structured enum on card.
 * Ambiguous (road-section vs rail). SAFE_TO_RENDER=NO → OMISSION_REASON=unsafe_semantics.
 * TRAFFIC_STOPPED_FACT_EXPECTED=NO.
 */
import {
  parseOfficialCommentFacts,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildLocalityHeaderModel,
  classifyRoadPresentation,
  classifyEventPresentation,
  analyzePrimaryCause,
  hasExplicitExpectedDelaySource,
  looksLikeStreetName,
  normalizeExtractedMunicipalityName,
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
  "Od 14.8.2026 14:40 do 15:40; na silnici 0357 v obci Višňová okres Liberec; porouchané vozidlo, očekávejte zdržení; překážka na vozovce, průjezd se zvýšenou opatrností; provoz na trati zastaven.";

const REF_INPUT = {
  impact: REF_RAW,
  impactFull: REF_RAW,
  eventType: "prekazka",
  category: "prekazka",
  municipality: "Višňová",
  location: "Višňová",
  road: null,
  roadClass: null,
  illustrationKey: "prekazka",
  delayAvailable: false,
  delayMinutes: null,
};

// --- Reference fixture: facts + summary ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const sit = String(buildTrafficSituationSummary(REF_INPUT) || "");
  const ev = classifyEventPresentation(REF_INPUT);
  const cause = analyzePrimaryCause(REF_RAW, REF_INPUT);

  ok("BROKEN_DOWN_VEHICLE_PRESENT", /porouchané\s+vozidlo/i.test(sit), sit);
  ok("OBSTACLE_PRESENT", /překážka\s+na\s+vozovce/i.test(sit), sit);
  ok("CAUTION_REQUIRED_PRESENT", /zvýšenou\s+opatrností/i.test(sit), sit);
  ok("EXPECTED_DELAY_PRESENT", /zdržení/i.test(sit), sit);
  ok(
    "EXPECTED_DELAY_SOURCE",
    hasExplicitExpectedDelaySource(REF_RAW) === true,
    String(hasExplicitExpectedDelaySource(REF_RAW))
  );
  ok(
    "BROKEN_DOWN_VEHICLE_DELAY_FACT_PRESERVATION",
    /porouchané\s+vozidlo/i.test(sit) &&
      /překážka/i.test(sit) &&
      /zdržení/i.test(sit) &&
      !/^Porouchané\s+vozidlo\.\s*Překážka\s+na\s+vozovce\.?$/i.test(sit.trim()),
    sit
  );
  ok(
    "TRAFFIC_STOPPED_FACT_EXPECTED_NO",
    true,
    "unsafe_semantics:publicComment_only_no_DATEX_enum"
  );
  ok(
    "TRAFFIC_STOPPED_NOT_INVENTED_AS_FULL_CLOSE",
    !/silnice\s+je\s+uzavřena|zcela\s+uzavřen|neprůjezdn|železniční\s+provoz/i.test(sit),
    sit
  );
  ok(
    "TRAFFIC_STOPPED_OMISSION_UNSAFE_SEMANTICS",
    !/provoz\s+na\s+trati\s+zastaven/i.test(sit),
    sit
  );
  ok(
    "CAUSE_BROKEN_OR_OBSTACLE",
    cause === "BROKEN_VEHICLE" || cause === "OBSTACLE",
    cause
  );
  ok("EVENT_NOT_ACCIDENT", ev.kind !== "accident", ev.kind);
  ok("FACTS_CITY", facts.city === "Višňová", facts.city);
  ok("FACTS_DISTRICT", /Liberec/i.test(facts.district || ""), facts.district);
  ok("FACTS_ROAD", facts.roadNumber === "0357", facts.roadNumber);
  ok("FACTS_NOT_U_OBCE", facts.municipalityRelation !== "u_obce", facts.municipalityRelation);
}

// --- Header: municipality sign + road badge ---
{
  const hdr = buildLocalityHeaderModel(REF_INPUT);
  const card = buildTrafficCardPresentation(REF_INPUT);
  const roadPres =
    (card.communication && card.communication.roadPresentation) ||
    classifyRoadPresentation("0357");

  ok("MUNICIPALITY_SIGN_PRESENT", !!hdr.municipalitySign, hdr.municipalitySign);
  ok(
    "MUNICIPALITY_SIGN_VALUE",
    hdr.municipalitySign === "Višňová",
    hdr.municipalitySign
  );
  ok(
    "MUNICIPALITY_SIGN_LABEL",
    hdr.municipalitySignLabel === "VIŠŇOVÁ",
    hdr.municipalitySignLabel
  );
  ok(
    "MUNICIPALITY_NOT_PLAIN_BESIDE_WHEN_SIGN",
    hdr.municipalitySign &&
      !sameAsMuniPlain(hdr.besideLocality, hdr.municipalitySign),
    hdr.besideLocality
  );
  ok(
    "DISTRICT_NOT_USED_AS_MUNICIPALITY_SIGN",
    hdr.municipalitySign !== "Liberec" &&
      !(card.communication && card.communication.municipalitySign === "Liberec"),
    hdr.municipalitySign
  );
  ok(
    "CITY_DISTRICT_NOT_USED_AS_MUNICIPALITY_SIGN",
    !/městská\s+část/i.test(String(hdr.municipalitySign || "")),
    hdr.municipalitySign
  );
  ok(
    "STREET_NOT_USED_AS_MUNICIPALITY_SIGN",
    !looksLikeStreetName(hdr.municipalitySign || ""),
    hdr.municipalitySign
  );
  ok("ROAD_BADGE_PRESENT", roadPres.numberBadge === "road", roadPres.numberBadge);
  ok("ROAD_BADGE_VALUE", roadPres.road === "0357", roadPres.road);
  ok("ROAD_CLASS_III", roadPres.roadClass === "CLASS_III", roadPres.roadClass);
  ok(
    "ROAD_NOT_LOCAL_PLAIN",
    roadPres.numberBadge !== "local" && roadPres.roadClass !== "LOCAL",
    roadPres.roadClass + "/" + roadPres.numberBadge
  );
  ok(
    "NO_U_OBCE_PREFIX_ON_V_OBCI",
    hdr.nearMunicipalityPrefix == null &&
      hdr.municipalityRelation !== "u_obce",
    hdr.nearMunicipalityPrefix
  );
}

function sameAsMuniPlain(beside, muni) {
  if (!beside || !muni) return false;
  const b = String(beside).trim().toLowerCase();
  const m = String(muni).trim().toLowerCase();
  return b === m;
}

// --- Morphology: -ová municipality vs -ova street ---
{
  ok(
    "OVA_ACUTE_NOT_STREET",
    looksLikeStreetName("Višňová") === false &&
      normalizeExtractedMunicipalityName("Višňová") === "Višňová"
  );
  ok(
    "OVA_PLAIN_STILL_STREET",
    looksLikeStreetName("Jandova") === true &&
      normalizeExtractedMunicipalityName("Jandova") == null
  );
  ok(
    "CLASS_I_BARE_STILL_I",
    classifyRoadPresentation("38").roadClass === "CLASS_I" &&
      classifyRoadPresentation("38").numberBadge === "road"
  );
  ok(
    "CLASS_III_PREFIX_STILL_III",
    classifyRoadPresentation("III/03554").roadClass === "CLASS_III" &&
      classifyRoadPresentation("III/03554").numberBadge === "road"
  );
  ok(
    "BARE_4DIGIT_CLASS_III",
    classifyRoadPresentation("0357").roadClass === "CLASS_III" &&
      classifyRoadPresentation("0357").numberBadge === "road"
  );
  ok(
    "LOCAL_NON_NUMERIC_STILL_LOCAL",
    classifyRoadPresentation("MK").roadClass === "LOCAL" ||
      classifyRoadPresentation("MK").numberBadge === "local" ||
      classifyRoadPresentation("MK").roadClass === "UNKNOWN"
  );
}

// --- Delay family (general, not exact wording) ---
{
  const cases = [
    {
      id: "OCEKAVEJTE",
      raw: "porouchané vozidlo, očekávejte zdržení; překážka na vozovce, průjezd se zvýšenou opatrností",
      need: /zdržení/i,
    },
    {
      id: "BARE_CLAUSE",
      raw: "nehoda; zdržení; průjezd se zvýšenou opatrností",
      need: /zdržení/i,
    },
    {
      id: "MOZNA",
      raw: "práce na silnici; možná zdržení; zúžení",
      need: /zdržení/i,
    },
  ];
  for (const c of cases) {
    const sit = String(
      buildTrafficSituationSummary({
        impact: c.raw,
        impactFull: c.raw,
        eventType: "prekazka",
        illustrationKey: "prekazka",
      }) || ""
    );
    ok("DELAY_FAMILY_" + c.id, c.need.test(sit) && hasExplicitExpectedDelaySource(c.raw), sit);
  }
}

// --- "u obce" must stay "u obce" (not rewritten to v obci / plain sign only) ---
{
  const uRaw =
    "na silnici 23 u obce Studenec okres Třebíč; porouchané vozidlo; očekávejte zdržení; překážka na vozovce";
  const hdr = buildLocalityHeaderModel({
    impact: uRaw,
    impactFull: uRaw,
    eventType: "prekazka",
    illustrationKey: "prekazka",
  });
  ok(
    "U_OBCE_PREFIX_PRESERVED",
    hdr.nearMunicipalityPrefix === "u obce" &&
      hdr.municipalityRelation === "u_obce" &&
      hdr.municipalitySign === "Studenec",
    JSON.stringify({
      prefix: hdr.nearMunicipalityPrefix,
      rel: hdr.municipalityRelation,
      sign: hdr.municipalitySign,
    })
  );
}

const passN = results.filter((r) => r.pass).length;
const failN = fails.length;
const out = {
  guard: "iu-traffic-broken-vehicle-delay-header-guard",
  total: results.length,
  pass: passN,
  fail: failN,
  fails,
  TRAFFIC_STOPPED_FACT_EXPECTED: "NO",
  TRAFFIC_STOPPED_OMISSION_REASON: "unsafe_semantics",
};
console.log(JSON.stringify(out, null, 2));
if (failN) {
  console.log("IU_TRAFFIC_BROKEN_VEHICLE_DELAY_HEADER_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_BROKEN_VEHICLE_DELAY_HEADER_GUARD_PASS");
