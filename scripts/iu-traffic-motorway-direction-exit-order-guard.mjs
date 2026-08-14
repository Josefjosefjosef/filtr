#!/usr/bin/env node
/**
 * MOTORWAY_DIRECTION_EXIT_ORDER_GUARD
 * When primaryRoad + direction + exitNumber coexist, order must be:
 * motorway icon → motorway badge → direction → EXIT
 * (place line: road → směr → EXIT). General rules — no D1/354 hardcodes.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  extractExitAndRampFacts,
  buildPlaceAndDirectionLine,
  buildLocalityHeaderModel,
  buildTrafficCardPresentation,
  resolvePresentationRoadNumber,
  namedObjectDuplicatesExitNumber,
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

function placeOrderOk(place, road, dir, exit) {
  const p = String(place || "");
  const iRoad = p.search(new RegExp("\\b" + road + "\\b", "i"));
  const iDir = p.search(new RegExp("směr\\s+" + dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  const iExit = p.search(new RegExp("EXIT\\s+" + exit + "\\b", "i"));
  return iRoad >= 0 && iDir > iRoad && iExit > iDir;
}

function assertCase(id, raw, expect) {
  const input = {
    impact: raw,
    impactFull: raw,
    eventType: "nehoda",
    category: "nehoda",
    road: null,
  };
  const facts = parseOfficialCommentFacts(raw);
  const road = resolvePresentationRoadNumber(input, facts);
  const roadPres = classifyRoadPresentation(road || "", input);
  const hdr = buildLocalityHeaderModel(input);
  const place = buildPlaceAndDirectionLine(input);
  const card = buildTrafficCardPresentation(input);
  const vm = buildTrafficCardViewModel(input);
  const rows = rowMap(card);

  ok(id + "_PRIMARY_ROAD", road === expect.road, String(road));
  ok(id + "_EXIT", facts.exitNumber === expect.exit, String(facts.exitNumber));
  ok(id + "_DIR", facts.directionHuman === expect.dir, String(facts.directionHuman));
  ok(id + "_MOTORWAY_ICON", roadPres.showMotorwayIcon === true, String(roadPres.showMotorwayIcon));
  ok(id + "_MOTORWAY_BADGE", roadPres.numberBadge === "motorway", String(roadPres.numberBadge));
  ok(id + "_EXIT_HEADER", hdr.exitHeaderLabel === "EXIT " + expect.exit, String(hdr.exitHeaderLabel));
  ok(id + "_PLACE_ORDER", placeOrderOk(place, expect.road, expect.dir, expect.exit), place);
  ok(
    id + "_HEADER_MODEL_ORDER",
    !!(vm.roadBadge && vm.roadBadge.showMotorwayIcon) &&
      vm.roadBadge.road === expect.road &&
      vm.direction === expect.dir &&
      vm.exitHeaderLabel === "EXIT " + expect.exit &&
      // EXIT must not live in beside ahead of direction.
      !/^exit\s+/i.test(String(vm.besideLocality || "")),
    JSON.stringify({
      road: vm.roadBadge && vm.roadBadge.road,
      beside: vm.besideLocality,
      dir: vm.direction,
      exit: vm.exitHeaderLabel,
    })
  );
  ok(id + "_EXIT_VISIBLE_ROW", rows.exitNumber === expect.exit, String(rows.exitNumber));
  ok(id + "_ROAD_ROW", rows.road === expect.road, String(rows.road));
  ok(id + "_DIR_ROW", rows.direction === expect.dir, String(rows.direction));
  if (expect.suppressDupObject) {
    const dup = namedObjectDuplicatesExitNumber(facts.namedObject, facts.exitNumber);
    ok(id + "_NAMED_OBJECT_DUPLICATES_EXIT", dup === true, String(facts.namedObject));
    ok(id + "_DUPLICATE_OBJECT_SUPPRESSED", rows.namedObject == null, String(rows.namedObject));
  }
}

// --- Primary fixture: D1 výjezd EXIT 354 směr Ostrava + nájezd na Rudnou ---
{
  const raw =
    "D1 výjezd EXIT 354 směr Ostrava, nehoda, uzavřeno, požár; Nájezd z dálnice D1 na Rudnou.";
  assertCase("D1_EXIT354", raw, {
    road: "D1",
    dir: "Ostrava",
    exit: "354",
    suppressDupObject: true,
  });
  const ramp = extractExitAndRampFacts(raw);
  ok("D1_EXIT354_RAMP_SOURCE_ROAD", ramp.rampSourceRoad === "D1", ramp.rampSourceRoad);
  ok("D1_EXIT354_RAMP_TARGET_LOCATION", ramp.rampTargetLocation === "Rudnou", ramp.rampTargetLocation);
  ok("D1_EXIT354_RAMP_TYPE_STAYS_EXIT", ramp.rampType === "exit", ramp.rampType);
  ok("D1_EXIT354_RUDNA_NOT_CITY", (() => {
    const f = parseOfficialCommentFacts(raw);
    return !f.city || !/rudn/i.test(String(f.city));
  })(), "city");
  const rows = rowMap(
    buildTrafficCardPresentation({ impactFull: raw, impact: raw, eventType: "nehoda" })
  );
  ok(
    "D1_EXIT354_RAMP_ROW_NAJEZD",
    /nájezd z D1 na Rudnou/i.test(String(rows.rampRelation || "")),
    String(rows.rampRelation)
  );
}

// --- General: D5 + směr Německo + EXIT 34 ---
assertCase("D5_EXIT34", "D5 EXIT 34 směr Německo", {
  road: "D5",
  dir: "Německo",
  exit: "34",
  suppressDupObject: true,
});

// --- Protect D0 EXIT 76 (primary D0, not target D1) ---
{
  const raw = "D0 EXIT 76, sjezd na D1 ve směru Ostrava";
  assertCase("D0_EXIT76", raw, {
    road: "D0",
    dir: "Ostrava",
    exit: "76",
    suppressDupObject: true,
  });
  const facts = parseOfficialCommentFacts(raw);
  ok("D0_EXIT76_PRIMARY_NOT_D1", facts.roadNumber === "D0" && facts.exitRoad === "D0", facts.roadNumber);
  const place = buildPlaceAndDirectionLine({ impactFull: raw });
  ok("D0_EXIT76_PLACE_HAS_PRAZSKY", /Pražský okruh/i.test(place), place);
  ok("D0_EXIT76_PLACE_ORDER", placeOrderOk(place, "D0", "Ostrava", "76"), place);
}

// --- Whitespace EXIT variants still tokenize ---
{
  const variants = ["D5EXIT34 směr Německo", "D5EXIT 34 směr Německo", "D5 EXIT34 směr Německo", "D5 EXIT 34 směr Německo"];
  for (let i = 0; i < variants.length; i++) {
    const f = parseOfficialCommentFacts(variants[i]);
    ok("WS_EXIT_ROAD_" + i, f.roadNumber === "D5" || f.exitRoad === "D5", f.roadNumber + "/" + f.exitRoad);
    ok("WS_EXIT_NUM_" + i, f.exitNumber === "34", f.exitNumber);
    const place = buildPlaceAndDirectionLine({ impactFull: variants[i] });
    ok("WS_EXIT_PLACE_ORDER_" + i, placeOrderOk(place, "D5", "Německo", "34"), place);
  }
}

// --- on/near ramp semantics must not break ---
{
  const on = extractExitAndRampFacts("na sjezdu z D1 ve směru Ostrava");
  ok("ON_EXIT_KEEP", on.rampType === "exit" && on.rampRelation === "on", JSON.stringify(on));
  const near = extractExitAndRampFacts("u sjezdu z D1 ve směru Ostrava");
  ok("NEAR_EXIT_KEEP", near.rampType === "exit" && near.rampRelation === "near", JSON.stringify(near));
  const onIn = extractExitAndRampFacts("na nájezdu na D1");
  ok("ON_ENTRANCE_KEEP", onIn.rampType === "entrance" && onIn.rampRelation === "on", JSON.stringify(onIn));
  const nearIn = extractExitAndRampFacts("u nájezdu na D1");
  ok("NEAR_ENTRANCE_KEEP", nearIn.rampType === "entrance" && nearIn.rampRelation === "near", JSON.stringify(nearIn));
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "MOTORWAY_DIRECTION_EXIT_ORDER_GUARD",
      pass,
      MOTORWAY_DIRECTION_EXIT_ORDER_GUARD_PASS: pass,
      failCount: fails.length,
      fails,
      resultCount: results.length,
    },
    null,
    2
  )
);
if (!pass) process.exit(1);
console.log("MOTORWAY_DIRECTION_EXIT_ORDER_GUARD_PASS");
