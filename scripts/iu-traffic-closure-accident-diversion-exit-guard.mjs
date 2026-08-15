#!/usr/bin/env node
/**
 * Closure due to accident + investigation dedup + diversion EXIT role guard.
 * Fixture-based general rules — no D1/349.5/354 hardcode pass path.
 * Pure local, no network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseOfficialCommentFacts,
  expandTrafficAbbreviationsCs,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildPlaceAndDirectionLine,
  classifyEventPresentation,
  analyzePrimaryCause,
  isDiversionOnlyExitMention,
  hasExplicitAccidentConfirmation,
  ACCIDENT_PARTICIPANT,
  PRIMARY_CAUSE,
  EVENT_KIND,
} from "../assets/iu-traffic-card-presenter-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRESENTER = path.join(ROOT, "assets", "iu-traffic-card-presenter-v1.js");

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
  "D1, km 349.5, ve směru Brno, uzavřeno, probíhá vyšetřování nehody, Od 15.08.2026 11:52 Do 15.08.2026 15:52, DN 3 OA, probíhá vyšetřování nehody, odklon dopravy na EXITu 354";

const REF_INPUT = {
  impact: REF_RAW,
  impactFull: REF_RAW,
  summary: REF_RAW,
  eventType: "uzavirka",
  illustrationKey: "uzavirka",
  road: "D1",
  roadClass: "MOTORWAY",
  direction: "Brno",
  km: "349.5",
  lifecycleStatus: "ACTIVE",
};

const LOCAL_EXIT_354 =
  "D1 výjezd EXIT 354 směr Ostrava, nehoda, uzavřeno, požár; Nájezd z dálnice D1 na Rudnou.";

const LOCAL_EXIT_46 = "D48 EXIT 46; práce na silnici; údržba a opravy.";

const LOCAL_EXIT_76 = "D0 EXIT 76 směr Brno; kolona 1 km.";

const KOSTELANY_RAW =
  "silnice III/42819, silnice III/42826, v katastru obce Kostelany, okr. Kroměříž, Od 15.08.2026 00:00, Do 16.08.2026 23:59, uzavřeno; sportovní akce; 55. ročník Barum Czech Rally Zlín 2026, Vydal: ŘSD";

const WRONG_WAY_RAW =
  "D49, km 12, ve směru Zlín, nebezpečí, vozidlo v protisměru.";

const ANIMAL_RAW =
  "D10, km 20, ve směru Praha, nehoda, střet osobního automobilu se srnou.";

const OBSTACLE_RAW =
  "Heřmanovice, silnice I/57, překážka na vozovce, stojící vozidlo.";

const ROADWORK_RAW =
  "Řídky, práce na silnici, údržba a opravy, rozsah: zpevněná krajnice.";

// --- Abbreviation mapping audit ---
{
  const src = fs.readFileSync(PRESENTER, "utf8");
  ok("OA_MAPPING_FOUND", /OA:\s*ACCIDENT_PARTICIPANT\.PASSENGER_CAR/.test(src) || /PASSENGER_CAR[\s\S]{0,40}OA/.test(src));
  ok("OA_MAPPING_VALUE", /osobní automobil/.test(expandTrafficAbbreviationsCs("OA")), expandTrafficAbbreviationsCs("OA"));
  ok("DN_MAPPING_FOUND", /\\bDN\\b/.test(src) && /dopravní nehoda/.test(src));
  ok(
    "DN_MAPPING_VALUE",
    /dopravní\s+nehoda/.test(expandTrafficAbbreviationsCs("DN 3 OA")),
    expandTrafficAbbreviationsCs("DN 3 OA")
  );
  ok(
    "OA_COUNT_EXPAND",
    /3\s+osobní\s+automobily/.test(expandTrafficAbbreviationsCs("DN 3 OA")),
    expandTrafficAbbreviationsCs("DN 3 OA")
  );
}

// --- Reference fixture: closure + accident cause + diversion EXIT ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const ev = classifyEventPresentation(REF_INPUT);
  const cause = analyzePrimaryCause(REF_RAW, REF_INPUT);
  const sit = String(buildTrafficSituationSummary(REF_INPUT) || "");
  const place = String(buildPlaceAndDirectionLine(REF_INPUT) || "");
  const card = buildTrafficCardPresentation(REF_INPUT);
  const rows = rowMap(card);
  const invVisible = (sit.match(/Probíhá vyšetřování nehody/gi) || []).length;

  ok("CLOSURE_SOURCE_PRESENT", /uzavřeno/i.test(REF_RAW));
  ok("ACCIDENT_SOURCE_PRESENT", /\bDN\s+3\s+OA\b/.test(REF_RAW) || /nehod/i.test(REF_RAW));
  ok("INVESTIGATION_SOURCE_PRESENT", /vyšetřování/i.test(REF_RAW));
  ok("DIVERSION_SOURCE_PRESENT", /odklon\s+dopravy/i.test(REF_RAW));

  ok("CLOSURE_STRUCTURED", facts.closureAccidentCause === true || /uzavřeno/i.test(REF_RAW), String(facts.closureAccidentCause));
  ok("ACCIDENT_STRUCTURED", hasExplicitAccidentConfirmation(REF_RAW, REF_INPUT) === true);
  ok("PARTICIPANT_COUNT", facts.accidentParticipantCount === 3, String(facts.accidentParticipantCount));
  ok(
    "PARTICIPANT_TYPE",
    facts.accidentParticipantType === ACCIDENT_PARTICIPANT.PASSENGER_CAR,
    String(facts.accidentParticipantType)
  );
  ok("INVESTIGATION_STRUCTURED", facts.accidentInvestigationActive === true);
  ok("DIVERSION_STRUCTURED", facts.trafficDiversion === true && String(facts.diversionExit) === "354", JSON.stringify({ d: facts.trafficDiversion, e: facts.diversionExit }));
  ok("EXIT_NUMBER_EXTRACTED", String(facts.exitNumber) === "354", String(facts.exitNumber));
  ok("DIVERSION_ONLY_HELPER", isDiversionOnlyExitMention(REF_RAW, "354") === true);
  ok("EXIT_PRIMARY_AFTER", facts.exitPrimaryLocation === false, String(facts.exitPrimaryLocation));

  ok("EVENT_TYPE_UZAVIRKA", ev.kind === EVENT_KIND.CLOSURE || /UZAVÍRKA/i.test(ev.titleCs || ""), ev.kind + "/" + ev.titleCs);
  ok("PRIMARY_CAUSE_FULL_CLOSURE", cause === PRIMARY_CAUSE.FULL_CLOSURE, cause);
  ok("NOT_PRIMARY_ACCIDENT_TYPE", ev.kind !== EVENT_KIND.ACCIDENT && !/^NEHODA$/i.test(String(ev.titleCs || "").trim()), ev.titleCs);

  ok("PLACE_D1_KM", /D1/.test(place) && /349[,.]5/.test(place), place);
  ok("PLACE_DIR_BRNO", /Brno/i.test(place), place);
  ok("PLACE_NO_EXIT_PRIMARY", !/EXIT\s*354/i.test(place), place);

  ok("SIT_DALNICE_CLOSED", /Dálnice\s+je\s+uzavřena/i.test(sit), sit);
  ok("SIT_ACCIDENT_CAUSE", /kvůli\s+nehodě/i.test(sit), sit);
  ok("SIT_PARTICIPANT_COUNT", /3\s+osobních\s+automobilů/i.test(sit), sit);
  ok("SIT_INVESTIGATION", /Probíhá vyšetřování nehody/i.test(sit), sit);
  ok("VISIBLE_INVESTIGATION_SENTENCE_COUNT", invVisible === 1, String(invVisible));
  ok("SIT_DIVERSION", /Doprava\s+je\s+odkláněna\s+na\s+EXITu\s+354/i.test(sit), sit);
  ok("NO_GENERIC_ONLY", !/^Silnice\s+je\s+uzavřena\.\s*Uzavřeno\s+ve\s+směru/i.test(sit.trim()), sit);
  ok("NO_REDUNDANT_DIRECTION", !/Uzavřeno\s+ve\s+směru\s+Brno/i.test(sit), sit);
  ok("NO_RAW_DUMP", !/DN\s+3\s+OA/i.test(sit) && !/uzavřeno,\s*probíhá/i.test(sit), sit);
  ok("RAW_PRESERVED", /DN\s+3\s+OA/i.test(rows.sourceDescription || "") && /EXITu\s+354/i.test(rows.sourceDescription || ""), rows.sourceDescription);
}

// --- CLOSURE_ACCIDENT_CAUSE_GUARD ---
{
  const raw = "uzavřeno, DN 3 OA";
  const facts = parseOfficialCommentFacts(raw);
  ok("CLOSURE_ACCIDENT_CAUSE_GUARD", facts.closureAccidentCause === true && facts.accidentParticipantCount === 3, JSON.stringify({ c: facts.closureAccidentCause, n: facts.accidentParticipantCount }));
}

// --- PARTICIPANT_COUNT_GUARD ---
{
  const facts = parseOfficialCommentFacts("DN 3 OA, probíhá vyšetřování nehody");
  ok(
    "PARTICIPANT_COUNT_GUARD",
    facts.accidentParticipantCount === 3 &&
      facts.accidentParticipantType === ACCIDENT_PARTICIPANT.PASSENGER_CAR,
    JSON.stringify({ n: facts.accidentParticipantCount, t: facts.accidentParticipantType })
  );
}

// --- INVESTIGATION_DEDUP_GUARD ---
{
  const raw =
    "D1, km 10, ve směru Praha, uzavřeno, probíhá vyšetřování nehody, DN 2 OA, probíhá vyšetřování nehody, odklon dopravy na EXITu 12";
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "uzavirka",
      road: "D1",
      roadClass: "MOTORWAY",
      direction: "Praha",
    }) || ""
  );
  const n = (sit.match(/Probíhá vyšetřování nehody/gi) || []).length;
  ok("INVESTIGATION_DEDUP_GUARD", n === 1, sit);
}

// --- DIVERSION_FACT_GUARD ---
{
  const raw = "D1, km 100, ve směru Brno, uzavřeno, DN 1 OA, odklon dopravy na EXITu 210";
  const facts = parseOfficialCommentFacts(raw);
  const sit = String(
    buildTrafficSituationSummary({
      impact: raw,
      impactFull: raw,
      eventType: "uzavirka",
      road: "D1",
      roadClass: "MOTORWAY",
      direction: "Brno",
    }) || ""
  );
  ok("DIVERSION_FACT_GUARD", facts.trafficDiversion === true && facts.diversionExit === "210" && /EXITu\s+210/i.test(sit), sit);
}

// --- EXIT_ROLE_GUARD A/B ---
{
  const factsA = parseOfficialCommentFacts(REF_RAW);
  ok(
    "EXIT_ROLE_GUARD_A",
    factsA.exitPrimaryLocation === false &&
      factsA.diversionExit === "354" &&
      isDiversionOnlyExitMention(REF_RAW, "354"),
    JSON.stringify({ p: factsA.exitPrimaryLocation, d: factsA.diversionExit })
  );
  const factsB = parseOfficialCommentFacts(LOCAL_EXIT_354);
  ok(
    "EXIT_ROLE_GUARD_B",
    factsB.exitNumber === "354" && factsB.exitPrimaryLocation === true,
    JSON.stringify({ e: factsB.exitNumber, p: factsB.exitPrimaryLocation })
  );
}

// --- Non-regression: Kostelany / EXIT locals / wrong-way / animal / obstacle / roadwork ---
{
  const kost = buildTrafficSituationSummary({
    impact: KOSTELANY_RAW,
    impactFull: KOSTELANY_RAW,
    eventType: "uzavirka",
    road: "III/42826",
    municipality: "Kostelany",
    district: "Kroměříž",
  });
  ok("NONREG_KOSTELANY", /sportovní\s+akc/i.test(kost) && /Barum/i.test(kost), kost);

  const f354 = parseOfficialCommentFacts(LOCAL_EXIT_354);
  ok("NONREG_D1_EXIT_354_PRIMARY", f354.exitPrimaryLocation === true && f354.exitNumber === "354");

  const f46 = parseOfficialCommentFacts(LOCAL_EXIT_46);
  ok("NONREG_D48_EXIT_46", f46.exitNumber === "46" && f46.exitPrimaryLocation === true);

  const f76 = parseOfficialCommentFacts(LOCAL_EXIT_76);
  ok("NONREG_D0_EXIT_76", f76.exitNumber === "76" && f76.exitPrimaryLocation === true);

  const ww = classifyEventPresentation({
    impact: WRONG_WAY_RAW,
    impactFull: WRONG_WAY_RAW,
    eventType: "prekazka",
    road: "D49",
  });
  ok("NONREG_WRONG_WAY", /PROTISMĚRU/i.test(ww.titleCs || ""), ww.titleCs);

  const animal = buildTrafficSituationSummary({
    impact: ANIMAL_RAW,
    impactFull: ANIMAL_RAW,
    eventType: "nehoda",
    road: "D10",
  });
  ok("NONREG_ANIMAL", /srn/i.test(animal), animal);

  const obs = classifyEventPresentation({
    impact: OBSTACLE_RAW,
    impactFull: OBSTACLE_RAW,
    eventType: "prekazka",
  });
  ok("NONREG_OBSTACLE", obs.kind === EVENT_KIND.OBSTACLE || /PŘEKÁŽKA|stojící|Nepojízdn/i.test(obs.titleCs || ""), obs.kind);

  const rw = classifyEventPresentation({
    impact: ROADWORK_RAW,
    impactFull: ROADWORK_RAW,
    eventType: "prace",
  });
  ok("NONREG_ROADWORK", rw.kind === EVENT_KIND.ROADWORKS || /PRÁCE|ÚDRŽBA/i.test(rw.titleCs || ""), rw.kind);
}

// --- No hardcode pass path ---
{
  const src = fs.readFileSync(PRESENTER, "utf8");
  ok("NO_HARDCODE_D1_349", !/road\s*===\s*["']D1["']\s*&&\s*km/.test(src) && !/349\.5["'].*354/.test(src));
  ok("NO_HARDCODE_EXIT_354_DIVERSION", !/if\s*\(\s*exit\s*===\s*354\s*\)/.test(src) && !/exit\s*===\s*["']354["']\s*.*diversion/.test(src));
}

ok("MASTER_DATASET_PASS", fails.length === 0, String(fails.length));
ok("PREVIOUSLY_CORRECT_CASES_BROKEN", fails.filter((f) => /^NONREG_/.test(f.split(":")[0])).length === 0, String(fails.filter((f) => /^NONREG_/.test(f.split(":")[0])).length));

const out = {
  guard: "iu-traffic-closure-accident-diversion-exit-guard",
  pass: fails.length === 0,
  failCount: fails.length,
  fails,
  results,
};
console.log(JSON.stringify(out, null, 2));
if (fails.length) {
  console.log("IU_TRAFFIC_CLOSURE_ACCIDENT_DIVERSION_EXIT_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_CLOSURE_ACCIDENT_DIVERSION_EXIT_GUARD_PASS");
