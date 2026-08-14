#!/usr/bin/env node
/**
 * DIRECTION_PRESERVATION + MOTORWAY_KM_DIRECTION + CONGESTION_EXACTNESS guards.
 * - Foreign destinations keep country suffix: Katowice(PL) → Katowice (PL)
 * - Motorway + km range + direction must all appear on place line / header
 * - Exact "kolona 1 km" must not invent "přibližně"
 * Pure local, no network. No hardcodes for D1 / 353.8 / Katowice.
 */
import {
  parseOfficialCommentFacts,
  normalizeDirectionHuman,
  sanitizeExtractedValueToken,
  buildPlaceAndDirectionLine,
  buildTrafficCardPresentation,
  buildLocalityHeaderModel,
  queueLengthApproximationFromSource,
  classifyRoadPresentation,
  resolvePresentationRoadNumber,
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

// --- DIRECTION_PRESERVATION + COUNTRY_SUFFIX ---
{
  const raw = "D1, km 353.8 až 355.1, ve směru Katowice(PL), kolona 1 km";
  ok("SANITIZE_COUNTRY_SUFFIX", sanitizeExtractedValueToken("Katowice(PL)") === "Katowice (PL)");
  ok("NORM_COUNTRY_SUFFIX", normalizeDirectionHuman("Katowice(PL)") === "Katowice (PL)");
  ok("NORM_SPACED_COUNTRY", normalizeDirectionHuman("Katowice (PL)") === "Katowice (PL)");
  const facts = parseOfficialCommentFacts(raw);
  ok("DIR_EXTRACTED", facts.directionHuman === "Katowice (PL)", facts.directionHuman);
  ok("DIR_HAS_PL", /\(PL\)/.test(facts.directionHuman || ""), facts.directionHuman);
  ok("DIR_NOT_CITY", !facts.city || !/katowice/i.test(String(facts.city)), String(facts.city));
  ok("KM_RANGE", facts.kilometerLabel === "km 353,8–355,1", facts.kilometerLabel);
  ok("QKM", facts.queueLengthKm === 1, String(facts.queueLengthKm));
  ok("QKM_NOT_APPROX_FLAG", facts.queueLengthApproximate === false, String(facts.queueLengthApproximate));
}

// --- MOTORWAY + KM + DIRECTION place/header ---
{
  const raw = "D1, km 353.8 až 355.1, ve směru Katowice(PL), kolona 1 km";
  const input = {
    impact: raw,
    impactFull: raw,
    eventType: "kolona",
    category: "kolona",
    road: "D1",
    illustrationKey: "kolona",
  };
  const facts = parseOfficialCommentFacts(raw);
  const road = resolvePresentationRoadNumber(input, facts);
  const roadPres = classifyRoadPresentation(road, input);
  const place = buildPlaceAndDirectionLine(input);
  const card = buildTrafficCardPresentation(input);
  const vm = buildTrafficCardViewModel(input);
  const rows = rowMap(card);

  ok("ROAD_STRUCTURED", road === "D1", road);
  ok("MOTORWAY_ICON", roadPres.showMotorwayIcon === true);
  ok("MOTORWAY_BADGE", roadPres.numberBadge === "motorway");
  ok(
    "PLACE_HAS_ROAD_KM_DIR",
    /D1/.test(place) &&
      /km\s+353,8–355,1/.test(place) &&
      /směr\s+Katowice\s*\(PL\)/i.test(place),
    place
  );
  ok(
    "PLACE_ORDER_KM_BEFORE_DIR",
    (() => {
      const iKm = place.search(/km\s+353,8–355,1/i);
      const iDir = place.search(/směr\s+Katowice/i);
      return iKm >= 0 && iDir > iKm;
    })(),
    place
  );
  ok("HEADER_DIR", vm.direction === "Katowice (PL)", vm.direction);
  ok("HEADER_ARROW", /→ směr Katowice \(PL\)/.test(vm.directionArrow || ""), vm.directionArrow);
  ok("EXPANDED_DIR", rows.direction === "Katowice (PL)", rows.direction);
  ok("EXPANDED_KM", rows.kilometer === "km 353,8–355,1", rows.kilometer);
  ok("EXPANDED_QKM", rows.queueLength === "1 km", rows.queueLength);
  ok("SUMMARY_EXACT", card.situationSummary === "Kolona 1 km.", card.situationSummary);
  ok("SUMMARY_NO_APPROX", !/přibližně/i.test(card.situationSummary || ""), card.situationSummary);
  ok(
    "APPROX_HELPER_NO",
    queueLengthApproximationFromSource(raw, facts) === false,
    String(queueLengthApproximationFromSource(raw, facts))
  );
}

// --- CONGESTION_EXACTNESS: approximate source keeps přibližně ---
{
  const raw = "D5, km 10 až 12, ve směru Německo, kolona přibližně 1 km";
  const input = {
    impact: raw,
    impactFull: raw,
    eventType: "kolona",
    category: "kolona",
    road: "D5",
  };
  const facts = parseOfficialCommentFacts(raw);
  const card = buildTrafficCardPresentation(input);
  ok("APPROX_FLAG", facts.queueLengthApproximate === true, String(facts.queueLengthApproximate));
  ok(
    "APPROX_SUMMARY",
    card.situationSummary === "Kolona přibližně 1 km.",
    card.situationSummary
  );
  ok("APPROX_DIR_DE", facts.directionHuman === "Německo", facts.directionHuman);
  const place = buildPlaceAndDirectionLine(input);
  ok("APPROX_PLACE_DIR", /směr\s+Německo/i.test(place), place);
}

// --- Direction without km ---
{
  const raw = "D1 ve směru Praha, silný provoz";
  const input = { impact: raw, impactFull: raw, road: "D1", eventType: "kolona" };
  const place = buildPlaceAndDirectionLine(input);
  const vm = buildTrafficCardViewModel(input);
  ok("DIR_NO_KM_PLACE", /D1/.test(place) && /směr\s+Praha/i.test(place), place);
  ok("DIR_NO_KM_HEADER", vm.direction === "Praha", vm.direction);
}

// --- Protect D1 EXIT 354 ordering regression ---
{
  const raw =
    "D1 výjezd EXIT 354 směr Ostrava, nehoda, uzavřeno, požár; Nájezd z dálnice D1 na Rudnou.";
  const input = { impact: raw, impactFull: raw, eventType: "nehoda", road: null };
  const facts = parseOfficialCommentFacts(raw);
  const place = buildPlaceAndDirectionLine(input);
  const vm = buildTrafficCardViewModel(input);
  ok("EXIT354_ROAD", facts.roadNumber === "D1" || facts.exitRoad === "D1", facts.roadNumber);
  ok("EXIT354_DIR", facts.directionHuman === "Ostrava", facts.directionHuman);
  ok("EXIT354_EXIT", facts.exitNumber === "354", facts.exitNumber);
  ok(
    "EXIT354_PLACE_ORDER",
    (() => {
      const iDir = place.search(/směr\s+Ostrava/i);
      const iExit = place.search(/EXIT\s+354/i);
      return iDir >= 0 && iExit > iDir;
    })(),
    place
  );
  ok("EXIT354_HEADER_EXIT", vm.exitHeaderLabel === "EXIT 354", vm.exitHeaderLabel);
  ok("EXIT354_HEADER_DIR", vm.direction === "Ostrava", vm.direction);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-direction-congestion-exactness-guard",
      pass,
      DIRECTION_PRESERVATION_GUARD_PASS: !fails.some((f) =>
        /^(SANITIZE_|NORM_|DIR_)/.test(f)
      ),
      COUNTRY_SUFFIX_PRESERVATION_GUARD_PASS: !fails.some((f) =>
        /COUNTRY|HAS_PL|SANITIZE_|NORM_/.test(f)
      ),
      MOTORWAY_KM_DIRECTION_GUARD_PASS: !fails.some((f) =>
        /^(ROAD_|MOTORWAY_|PLACE_|HEADER_|EXPANDED_KM|EXPANDED_DIR)/.test(f)
      ),
      CONGESTION_EXACTNESS_GUARD_PASS: !fails.some((f) =>
        /SUMMARY_|APPROX_|QKM/.test(f)
      ),
      D1_EXIT_354_REGRESSION_PASS: !fails.some((f) => f.startsWith("EXIT354_")),
      KM_RANGE_REGRESSION_PASS: !fails.some((f) => f.startsWith("KM_")),
      failCount: fails.length,
      fails,
      resultCount: results.length,
    },
    null,
    2
  )
);
if (!pass) process.exit(1);
console.log("IU_TRAFFIC_DIRECTION_CONGESTION_EXACTNESS_GUARD_PASS");
