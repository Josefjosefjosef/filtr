#!/usr/bin/env node
/**
 * Road place-segment + surface-repair / traffic-control information-value guard.
 * Fixture-based (I/49 Pozděchov–Prlov style) — no hardcode-only pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  extractRoadPlaceSegmentFromOfficialComment,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  buildPlaceAndDirectionLine,
  buildTrafficSituationSummary,
  looksLikeSegmentOrAreaLabel,
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
  "silnice I/49, Pozděchov - Prlov, okr. Vsetín, oprava povrchu vozovky, kyvadlový provoz jedním jízdním pruhem, Od 14.08.2026 06:30 Do 13.09.2026 23:59, I/49 Pozděchov - Prlov, frézování, pokládka povrchu, provoz řízen SSZ, v dopravní špičce usměrňován regulovčíky, Vydal: Krajský úřad Zlínského kraje";

const IMPACT_TRUNC = REF_RAW.slice(0, 159) + "…";

// --- ROAD_SEGMENT_GUARD ---
{
  const seg = extractRoadPlaceSegmentFromOfficialComment(REF_RAW);
  ok("SEG_FROM", seg && seg.segmentFrom === "Pozděchov", JSON.stringify(seg));
  ok("SEG_TO", seg && seg.segmentTo === "Prlov", JSON.stringify(seg));
  ok(
    "SEG_LABEL",
    seg && /Pozděchov/.test(seg.label) && /Prlov/.test(seg.label),
    seg && seg.label
  );

  const facts = parseOfficialCommentFacts(REF_RAW);
  ok("FACTS_SEG_FROM", facts.segmentFrom === "Pozděchov", facts.segmentFrom);
  ok("FACTS_SEG_TO", facts.segmentTo === "Prlov", facts.segmentTo);
  ok("FACTS_NO_CITY_SEGMENT", facts.city == null, facts.city);
  ok("FACTS_DISTRICT", facts.district === "Vsetín", facts.district);
  ok("FACTS_ROAD", facts.roadNumber === "I/49", facts.roadNumber);
  ok("FACTS_SURFACE", facts.roadworkDetail === "SURFACE_REPAIR", facts.roadworkDetail);
  ok("FACTS_MILLING", facts.milling === true);
  ok("FACTS_LAYING", facts.surfaceLaying === true);
  ok("FACTS_ALT", facts.alternatingTraffic === true);
  ok("FACTS_SSZ", facts.trafficControlSsz === true);
  ok("FACTS_FLAGGERS", facts.peakFlaggers === true);
  ok(
    "LOOKS_SEGMENT",
    looksLikeSegmentOrAreaLabel("Pozděchov - Prlov") === true
  );

  // General patterns (not the fixture towns).
  const genA = extractRoadPlaceSegmentFromOfficialComment(
    "silnice I/35, Alphaov - Betain, okr. Testov, oprava povrchu vozovky"
  );
  ok(
    "GEN_PATTERN_SILNICE_OKR",
    genA && genA.segmentFrom === "Alphaov" && genA.segmentTo === "Betain",
    JSON.stringify(genA)
  );
  const genB = extractRoadPlaceSegmentFromOfficialComment(
    "I/11 Gammín - Deltov, frézování, provoz řízen SSZ"
  );
  ok(
    "GEN_PATTERN_ROAD_PAIR",
    genB && genB.segmentFrom === "Gammín" && genB.segmentTo === "Deltov",
    JSON.stringify(genB)
  );
}

// --- Negatives: do not invent / do not steal street ranges ---
{
  const streetRange =
    "silnice III/03554 (ulice Olomoucká - ulice Lipenská), Velký Újezd, okr. Olomouc";
  const bad = extractRoadPlaceSegmentFromOfficialComment(streetRange);
  ok(
    "NEG_STREET_RANGE_NOT_SEGMENT",
    !bad || (!/Olomoucká/i.test(bad.segmentFrom || "") && !/Lipenská/i.test(bad.segmentTo || "")),
    JSON.stringify(bad)
  );

  const kmOnly = "silnice I/38, km 12 - 15, okr. Testov, práce na silnici";
  const kmSeg = extractRoadPlaceSegmentFromOfficialComment(kmOnly);
  ok("NEG_KM_NOT_SEGMENT", kmSeg == null, JSON.stringify(kmSeg));

  const noPair = "silnice I/3, okr. Benešov, práce na silnici, frézování";
  ok("NEG_NO_PAIR", extractRoadPlaceSegmentFromOfficialComment(noPair) == null);
}

// --- Card presentation / information value ---
{
  const liveShape = {
    impact: IMPACT_TRUNC,
    impactFull: REF_RAW,
    road: "49",
    roadClass: "CLASS_I",
    district: "Vsetín",
    location: "okres Vsetín",
    municipality: null,
    eventType: "prace",
  };
  const card = buildTrafficCardPresentation(liveShape);
  const hdr = buildLocalityHeaderModel(liveShape);
  const place = buildPlaceAndDirectionLine(liveShape);
  const sum = String(card.situationSummary || buildTrafficSituationSummary(liveShape));

  ok(
    "PLACE_HAS_SEGMENT",
    /I\/49/.test(place) && /Pozděchov/.test(place) && /Prlov/.test(place),
    place
  );
  ok("PLACE_HAS_DISTRICT", /Vsetín/.test(place), place);
  ok(
    "PLACE_NOT_DISTRICT_ONLY",
    !/^I\/49\s*·\s*okres\s+Vsetín\.?$/i.test(place.trim()),
    place
  );
  ok(
    "BESIDE_SEGMENT",
    /Pozděchov/.test(hdr.besideLocality || "") && /Prlov/.test(hdr.besideLocality || ""),
    hdr.besideLocality
  );
  ok("BESIDE_NOT_OKRES", !/^okres\b/i.test(hdr.besideLocality || ""), hdr.besideLocality);

  ok("SUM_SURFACE", /oprava\s+povrchu/i.test(sum), sum);
  ok("SUM_MILL_OR_LAY", /frézován/i.test(sum) || /pokládk/i.test(sum), sum);
  ok("SUM_ALT", /kyvadlov/i.test(sum), sum);
  ok("SUM_CONTROL", /semafor|SSZ/i.test(sum), sum);
  ok("SUM_PEAK", /regulovč/i.test(sum), sum);
  ok(
    "SUM_NOT_GENERIC_ONLY",
    !/^Práce\s+na\s+silnici\.?$/i.test(sum.trim()) &&
      !/^Práce\s+na\s+silnici\.\s*Kyvadlový\s+provoz[^.]+\.?$/i.test(sum.trim()),
    sum
  );
  ok("CARD_PLACE", /Pozděchov/.test(card.placeLine || ""), card.placeLine);
  ok(
    "RAW_PRESERVED",
    /Vydal:/i.test(
      ((card.expanded && card.expanded.rows) || []).find((r) => r.key === "sourceDescription")
        ?.value || ""
    )
  );
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  ROAD_SEGMENT_GUARD: results
    .filter((r) => r.id.startsWith("SEG_") || r.id.startsWith("FACTS_SEG") || r.id.startsWith("GEN_"))
    .every((r) => r.pass),
  INFORMATION_VALUE_GUARD: results.filter((r) => r.id.startsWith("SUM_")).every((r) => r.pass),
  GENERIC_SUMMARY_GUARD: results
    .filter((r) => r.id === "SUM_NOT_GENERIC_ONLY")
    .every((r) => r.pass),
  LOCATION_GUARD: results
    .filter((r) => r.id.startsWith("PLACE_") || r.id.startsWith("BESIDE_"))
    .every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_I49_ROAD_SEGMENT_SURFACE_CONTROL_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_I49_ROAD_SEGMENT_SURFACE_CONTROL_GUARD_PASS");
