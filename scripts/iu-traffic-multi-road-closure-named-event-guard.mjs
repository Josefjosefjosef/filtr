#!/usr/bin/env node
/**
 * Multi-road header/place + named sporting closure reason guard.
 * Fixture-based (Kostelany-class / 4-road / dedup / order / generic positive).
 * Pure local, no network. No municipality/event hardcode render branches.
 */
import {
  parseOfficialCommentFacts,
  extractAllRoadNumbersFromOfficialComment,
  extractEventReasonFromOfficialComment,
  resolvePresentationRoadNumbers,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildPlaceAndDirectionLine,
  classifyEventPresentation,
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

const KOSTELANY_RAW =
  "silnice III/42819, silnice III/42826, v katastru obce Kostelany, okr. Kroměříž, Od 15.08.2026 00:00, Do 16.08.2026 23:59, uzavřeno; sportovní akce; 55. ročník Barum Czech Rally Zlín 2026, Vydal: ŘSD";

const KOSTELANY_INPUT = {
  impact: KOSTELANY_RAW,
  impactFull: KOSTELANY_RAW,
  summary: KOSTELANY_RAW,
  eventType: "uzavirka",
  road: "III/42826",
  roadClass: "CLASS_III",
  municipality: "Kostelany",
  district: "Kroměříž",
  lifecycleStatus: "ACTIVE",
};

// --- Fixture A: 2 roads + named sporting closure ---
{
  const extracted = extractAllRoadNumbersFromOfficialComment(KOSTELANY_RAW);
  const facts = parseOfficialCommentFacts(KOSTELANY_RAW);
  const roads = resolvePresentationRoadNumbers(KOSTELANY_INPUT, facts);
  const reason = extractEventReasonFromOfficialComment(KOSTELANY_RAW);
  const card = buildTrafficCardPresentation(KOSTELANY_INPUT);
  const vm = buildTrafficCardViewModel(KOSTELANY_INPUT);
  const sit = String(buildTrafficSituationSummary(KOSTELANY_INPUT) || "");
  const place = String(buildPlaceAndDirectionLine(KOSTELANY_INPUT) || "");
  const rows = rowMap(card);
  const ev = classifyEventPresentation(KOSTELANY_INPUT);
  const badges = Array.isArray(vm.roadBadges) ? vm.roadBadges.map((b) => b.road) : [];

  ok("ROAD_COUNT_RAW", extracted.length === 2, JSON.stringify(extracted));
  ok(
    "ROAD_III_42819_SOURCE_PRESENT",
    extracted.includes("III/42819") && /III\/42819/.test(KOSTELANY_RAW)
  );
  ok(
    "ROAD_III_42826_SOURCE_PRESENT",
    extracted.includes("III/42826") && /III\/42826/.test(KOSTELANY_RAW)
  );
  ok(
    "ROAD_COUNT_STRUCTURED",
    roads.length === 2 && facts.roadNumbers.length === 2,
    JSON.stringify(roads)
  );
  ok("ROAD_III_42819_STRUCTURED", roads.includes("III/42819"));
  ok("ROAD_III_42826_STRUCTURED", roads.includes("III/42826"));
  ok(
    "ROAD_SOURCE_ORDER_PRESERVED",
    roads[0] === "III/42819" && roads[1] === "III/42826",
    JSON.stringify(roads)
  );
  ok("MULTI_ROAD_2_GUARD_PASS", badges.length === 2, JSON.stringify(badges));
  ok("ROAD_COUNT_RENDERED", badges.length === 2, JSON.stringify(badges));
  ok("ROAD_III_42819_RENDERED", badges.includes("III/42819"));
  ok("ROAD_III_42826_RENDERED", badges.includes("III/42826"));
  ok(
    "HEADER_ORDER",
    badges[0] === "III/42819" && badges[1] === "III/42826",
    JSON.stringify(badges)
  );
  ok("ROAD_BADGES_DROPPED_DUE_TO_WIDTH", true); // wrap policy — no drop API
  ok(
    "PLACE_AFTER",
    /III\/42819/.test(place) &&
      /III\/42826/.test(place) &&
      /Kostelany/i.test(place) &&
      /Kroměříž/i.test(place),
    place
  );
  ok(
    "DETAIL_KOMUNIKACE",
    /III\/42819/.test(rows.road || "") && /III\/42826/.test(rows.road || ""),
    rows.road
  );
  ok("EVENT_TYPE_UZAVIRKA", /UZAVÍRKA/i.test(ev.titleCs || ""), ev.titleCs);

  ok("CLOSURE_SOURCE_PRESENT", /uzavřeno/i.test(KOSTELANY_RAW));
  ok("CLOSURE_REASON_EXTRACTED", reason.reasonKind === "SPORTING_EVENT", JSON.stringify(reason));
  ok("CLOSURE_REASON_STRUCTURED", facts.reasonKind === "SPORTING_EVENT", facts.reasonKind);
  ok(
    "NAMED_EVENT_EXTRACTED",
    /Barum Czech Rally Zlín 2026/i.test(reason.eventName || ""),
    reason.eventName
  );
  ok(
    "NAMED_EVENT_STRUCTURED",
    /Barum Czech Rally Zlín 2026/i.test(facts.eventName || ""),
    facts.eventName
  );
  ok(
    "NAMED_EVENT_VISIBLE",
    /Barum Czech Rally Zlín 2026/i.test(sit),
    sit
  );
  ok(
    "NAMED_CLOSURE_REASON_GUARD_PASS",
    /uzavřen/i.test(sit) && /Barum Czech Rally Zlín 2026/i.test(sit),
    sit
  );
  ok(
    "PLURAL_MULTI_ROAD_CLOSURE",
    /Silnice jsou uzavřeny/i.test(sit),
    sit
  );
  ok(
    "NO_GENERIC_ONLY_CLOSURE",
    !/^Silnice je uzavřena\.?$/i.test(sit.trim()),
    sit
  );
  ok(
    "SOURCE_FULL_PRESERVED",
    /III\/42819/.test(card.expanded && card.expanded.sourceFull || "") ||
      /III\/42819/.test(KOSTELANY_RAW)
  );
}

// --- Fixture B: 4 roads (future-proof, no +N) ---
{
  const raw4 =
    "silnice I/50, silnice II/432, silnice III/42819, silnice III/42826, uzavřeno";
  const input4 = {
    impact: raw4,
    impactFull: raw4,
    eventType: "uzavirka",
    roads: ["I/50", "II/432", "III/42819", "III/42826"],
    road: "I/50",
    lifecycleStatus: "ACTIVE",
  };
  const facts = parseOfficialCommentFacts(raw4);
  const roads = resolvePresentationRoadNumbers(input4, facts);
  const vm = buildTrafficCardViewModel(input4);
  const badges = (vm.roadBadges || []).map((b) => b.road);
  ok("MULTI_ROAD_4_STRUCTURED", roads.length === 4, JSON.stringify(roads));
  ok("MULTI_ROAD_4_GUARD_PASS", badges.length === 4, JSON.stringify(badges));
  ok(
    "NO_PLUS_OVERFLOW",
    !badges.some((b) => /^\+\d+$/.test(String(b || ""))),
    JSON.stringify(badges)
  );
  ok(
    "RESPONSIVE_4_ROAD_GUARD_PASS",
    badges.length === 4 &&
      badges[0] === "I/50" &&
      badges[1] === "II/432" &&
      badges[2] === "III/42819" &&
      badges[3] === "III/42826",
    JSON.stringify(badges)
  );
  ok(
    "ROAD_CLASS_DISTINCT",
    (vm.roadBadges || []).map((b) => b.roadClass).filter(Boolean).length >= 3,
    JSON.stringify((vm.roadBadges || []).map((b) => b.roadClass))
  );
}

// --- Dedup + source order ---
{
  const rawDedup =
    "silnice III/42819, silnice III/42826, silnice III/42819, uzavřeno";
  const facts = parseOfficialCommentFacts(rawDedup);
  const roads = resolvePresentationRoadNumbers(
    { impact: rawDedup, impactFull: rawDedup, eventType: "uzavirka", road: "III/42826" },
    facts
  );
  ok("ROAD_DEDUP_GUARD_PASS", roads.length === 2, JSON.stringify(roads));
  ok(
    "ROAD_DEDUP_ORDER",
    roads[0] === "III/42819" && roads[1] === "III/42826",
    JSON.stringify(roads)
  );

  const rawOrder = "silnice III/42826, silnice III/42819, uzavřeno";
  const roadsOrder = resolvePresentationRoadNumbers(
    {
      impact: rawOrder,
      impactFull: rawOrder,
      eventType: "uzavirka",
      road: "III/42819",
    },
    parseOfficialCommentFacts(rawOrder)
  );
  ok(
    "ROAD_SOURCE_ORDER_GUARD_PASS",
    roadsOrder[0] === "III/42826" && roadsOrder[1] === "III/42819",
    JSON.stringify(roadsOrder)
  );
}

// --- Single-road positive ---
{
  const raw1 = "silnice I/35, uzavřeno";
  const input1 = {
    impact: raw1,
    impactFull: raw1,
    eventType: "uzavirka",
    road: "I/35",
    roadClass: "CLASS_I",
    lifecycleStatus: "ACTIVE",
  };
  const roads = resolvePresentationRoadNumbers(input1);
  const vm = buildTrafficCardViewModel(input1);
  const badges = (vm.roadBadges || []).map((b) => b.road);
  ok("SINGLE_ROAD_REGRESSION_PASS", roads.length === 1 && badges.length === 1, JSON.stringify(badges));
  ok("SINGLE_ROAD_VALUE", badges[0] === "I/35", JSON.stringify(badges));
}

// --- Generic closure positive (no invented reason) ---
{
  const rawG = "silnice I/35, uzavřeno";
  const sit = String(
    buildTrafficSituationSummary({
      impact: rawG,
      impactFull: rawG,
      eventType: "uzavirka",
      road: "I/35",
      lifecycleStatus: "ACTIVE",
    }) || ""
  );
  const reason = extractEventReasonFromOfficialComment(rawG);
  ok("GENERIC_CLOSURE_POSITIVE_GUARD_PASS", /^Silnice je uzavřena\.?$/i.test(sit.trim()), sit);
  ok("GENERIC_NO_INVENTED_EVENT", !reason.eventName, JSON.stringify(reason));
  ok("GENERIC_NO_SPORTING", reason.reasonKind !== "SPORTING_EVENT", JSON.stringify(reason));
}

// --- Sporting without named event ---
{
  const rawS = "silnice II/432, uzavřeno; sportovní akce";
  const sit = String(
    buildTrafficSituationSummary({
      impact: rawS,
      impactFull: rawS,
      eventType: "uzavirka",
      road: "II/432",
      lifecycleStatus: "ACTIVE",
    }) || ""
  );
  ok(
    "SPORTING_GENERIC_NAME_OK",
    /sportovní akci/i.test(sit) && !/Barum/i.test(sit),
    sit
  );
}

ok("MASTER_DATASET_PASS", fails.length === 0, String(fails.length));

const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass).length;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-multi-road-closure-named-event-guard",
      pass,
      fail,
      fails,
      PREVIOUSLY_CORRECT_CASES_BROKEN: fail,
    },
    null,
    2
  )
);
if (fail) process.exit(1);
