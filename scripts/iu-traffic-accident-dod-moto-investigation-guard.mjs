#!/usr/bin/env node
/**
 * Accident DOD×MOTO participants + explicit injury + investigation guard.
 * Fixture-based general rules — no municipality / road hardcode pass path.
 * Pure local, no network.
 */
import {
  parseOfficialCommentFacts,
  parseAccidentParticipantsFromText,
  formatAccidentSituationLead,
  formatAccidentLeadFromParticipants,
  expandTrafficAbbreviationsCs,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  classifyEventPresentation,
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

function rowMap(card) {
  return Object.fromEntries(((card.expanded && card.expanded.rows) || []).map((r) => [r.key, r.value]));
}

const REF_RAW =
  "Od 13.8.2026 14:35 do 16:40; na silnici 592 v obci Kryštofovo Údolí okres Liberec; nehoda; probíhá vyšetřování nehody; DOD x MOTO, se zraněním.";

// --- Reference fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "nehoda",
    road: "592",
    roadClass: "CLASS_II",
    municipality: "Kryštofovo Údolí",
    district: "Liberec",
  };
  const ev = classifyEventPresentation(input);
  const lead = formatAccidentSituationLead(expandTrafficAbbreviationsCs(REF_RAW), facts);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const card = buildTrafficCardPresentation(input);
  const rows = rowMap(card);
  const parts = facts.accidentParticipants || [];

  ok("EVENT_ACCIDENT", ev.kind === "accident", ev.kind);
  ok("TITLE_NEHODA", /NEHODA/i.test(ev.titleCs || ""), ev.titleCs);
  ok("ROAD_II592", /II\/592/i.test(card.placeLine || ""), card.placeLine);
  ok("MUNI", /Kryštofovo\s+Údolí/i.test(card.placeLine || ""), card.placeLine);
  ok("DISTRICT", /Liberec/i.test(card.placeLine || ""), card.placeLine);
  ok("PARTICIPANT_DOD", parts.includes(ACCIDENT_PARTICIPANT.VAN), JSON.stringify(parts));
  ok("PARTICIPANT_MOTO", parts.includes(ACCIDENT_PARTICIPANT.MOTORCYCLE), JSON.stringify(parts));
  ok("PARTICIPANTS_PRESENT", parts.length >= 2, JSON.stringify(parts));
  ok("PARTICIPANTS_NORMALIZED", parts.every((p) => Object.values(ACCIDENT_PARTICIPANT).includes(p)), JSON.stringify(parts));
  ok("INJURY_PRESENT", facts.injuryPresent === true, String(facts.injuryPresent));
  ok("INVESTIGATION_PRESENT", facts.accidentInvestigationActive === true, String(facts.accidentInvestigationActive));
  ok("LEAD_NOT_BARE", !/^Nehoda\.?$/i.test(String(lead || "").trim()), lead);
  ok("LEAD_PARTS", /dodávk/i.test(lead) && /motocykl/i.test(lead), lead);
  ok("LEAD_INJURY", /se\s+zraněním/i.test(lead), lead);
  ok("SIT_NOT_GENERIC_ONLY", !/^Nehoda\.?$/i.test(sit.trim()), sit);
  ok("SIT_PARTICIPANTS", /dodávk/i.test(sit) && /motocykl/i.test(sit), sit);
  ok("SIT_INJURY", /se\s+zraněním/i.test(sit), sit);
  ok("SIT_INVESTIGATION", /vyšetřování/i.test(sit), sit);
  ok("NO_INJURY_COUNT", !/\d+\s+zraněn/i.test(sit), sit);
  ok("NO_SEVERITY", !/vážn[ée]\s+zraněn|lehké\s+zraněn|těžké\s+zraněn/i.test(sit), sit);
  ok("NO_HELO", !/vrtulník|helikoptér/i.test(sit), sit);
  ok("NO_DUP_NEHODA", !/^Nehoda\.\s+Nehoda/i.test(sit) && !/nehoda,\s+nehoda/i.test(sit), sit);
  ok("RAW_PRESERVED", /DOD\s*x\s*MOTO/i.test(rows.sourceDescription || ""), rows.sourceDescription);
  ok(
    "PLACE_SHAPE",
    /II\/592\s*·\s*Kryštofovo\s+Údolí\s*·\s*okres\s+Liberec/i.test(card.placeLine || ""),
    card.placeLine
  );
}

// --- Abbreviation mapping + structured lead without RAW re-parse in composer path ---
{
  const parts = parseAccidentParticipantsFromText("nehoda; DOD x MOTO, se zraněním.");
  ok("ABBREV_PARSE_VAN", parts.includes(ACCIDENT_PARTICIPANT.VAN), JSON.stringify(parts));
  ok("ABBREV_PARSE_MOTO", parts.includes(ACCIDENT_PARTICIPANT.MOTORCYCLE), JSON.stringify(parts));
  const lead = formatAccidentLeadFromParticipants(parts, "se zraněním");
  ok("STRUCTURED_LEAD", /dodávk/i.test(lead || "") && /motocykl/i.test(lead || ""), lead);
  ok("EXPAND_DOD", /dodávka/i.test(expandTrafficAbbreviationsCs("1x DOD")), expandTrafficAbbreviationsCs("1x DOD"));
  ok("EXPAND_MOTO", /motocykl/i.test(expandTrafficAbbreviationsCs("MOTO")), expandTrafficAbbreviationsCs("MOTO"));
  ok("EXPAND_NA_STILL", /nákladní/i.test(expandTrafficAbbreviationsCs("NA")), expandTrafficAbbreviationsCs("NA"));
  // Must not expand lowercase Czech "na" preposition.
  ok("NO_EXPAND_PREP_NA", !/nákladní/.test(expandTrafficAbbreviationsCs("na silnici 592")), expandTrafficAbbreviationsCs("na silnici 592"));
}

// --- Information-value: accident with concrete facts must not collapse to bare Nehoda ---
{
  const cases = [
    {
      id: "DOD_MOTO_INJURY",
      raw: "nehoda; DOD x MOTO, se zraněním.",
      need: /dodávk/i,
    },
    {
      id: "DOD_MOTO_INV",
      raw: "nehoda; probíhá vyšetřování nehody; DOD x MOTO.",
      need: /vyšetřování/i,
    },
    {
      id: "TRUCK_CAR",
      raw: "nehoda; nákladní automobil x osobní automobil.",
      need: /nákladní/i,
    },
    {
      id: "INJURY_ONLY_PAIR",
      raw: "2 havarovaná vozidla; nákladní automobil x osobní automobil, se zraněním.",
      need: /zraněn/i,
    },
  ];
  for (const c of cases) {
    const sit = String(
      buildTrafficSituationSummary({
        impact: c.raw,
        impactFull: c.raw,
        eventType: "nehoda",
      }) || ""
    );
    ok("INFO_NOT_BARE_" + c.id, !/^Nehoda\.?$/i.test(sit.trim()), sit);
    ok("INFO_HAS_" + c.id, c.need.test(sit), sit);
  }
}

// --- Bare accident without extras stays safe fallback ---
{
  const sit = String(
    buildTrafficSituationSummary({
      impact: "nehoda.",
      impactFull: "nehoda.",
      eventType: "nehoda",
    }) || ""
  );
  ok("BARE_FALLBACK", /^Nehoda\.?$/i.test(sit.trim()), sit);
}

// --- Cross regression: Brno / Hradec / Jandova-class still rich ---
{
  const brno =
    "Od 13.8.2026 13:05 do 16:10; v ulici Opuštěná v obci Brno; nehoda nákladního vozidla; překážka, která může bránit provozu v celé šířce vozovky nebo její části; nákladní automobil x osobní automobil.";
  const sitB = String(
    buildTrafficSituationSummary({ impact: brno, impactFull: brno, eventType: "nehoda" }) || ""
  );
  ok("BRNO_PARTS", /nákladní/i.test(sitB) && /osobní/i.test(sitB), sitB);
  ok("BRNO_IMPACT", /může\s+bránit/i.test(sitB), sitB);

  const hradec =
    "Od 13.8.2026 13:45 do 15:50; na silnici 57 v obci Hradec nad Moravicí okres Opava; 2 havarovaná vozidla; probíhají záchranné a vyprošťovací práce, nebezpečí; jízdní pruh uzavřen; nákladní automobil x osobní automobil, se zraněním.";
  const sitH = String(
    buildTrafficSituationSummary({ impact: hradec, impactFull: hradec, eventType: "nehoda" }) || ""
  );
  ok("HRADEC_TYPES", /nákladní/i.test(sitH) && /osobní/i.test(sitH), sitH);
  ok("HRADEC_INJURY", /zraněn/i.test(sitH), sitH);

  const jandova =
    "ulice Jandova v obci Praha okres území Hlavního města Prahy, směr prosecká estakáda, omezení, Pozor! Překážka na vozovce, od 13.8.2026 10:20 do 13.8.2026 17:25, stojící vozidlo po havárii před železničním viaduktem u náměstí OSN, Zdroj: TSK Praha / DIC";
  const sitJ = String(
    buildTrafficSituationSummary({
      impact: jandova,
      impactFull: jandova,
      eventType: "prekazka",
      municipality: "Praha",
      street: "Jandova",
      direction: "prosecká estakáda",
    }) || ""
  );
  ok("JANDOVA_STATIONARY", /stojící\s+vozidlo/i.test(sitJ), sitJ);
  ok("JANDOVA_NOT_ACCIDENT_UPGRADE", !/^Nehoda/i.test(sitJ.trim()), sitJ);
}

const pass = fails.length === 0;
const out = {
  pass,
  failed: fails,
  counts: { pass: results.filter((r) => r.pass).length, fail: fails.length },
  KRYSTOFOVO_UDOLI_FIXTURE: results
    .filter((r) =>
      [
        "EVENT_ACCIDENT",
        "PARTICIPANT_DOD",
        "PARTICIPANT_MOTO",
        "INJURY_PRESENT",
        "INVESTIGATION_PRESENT",
        "SIT_NOT_GENERIC_ONLY",
        "SIT_PARTICIPANTS",
        "SIT_INJURY",
        "SIT_INVESTIGATION",
      ].includes(r.id)
    )
    .every((r) => r.pass),
  PARTICIPANT_GUARD: results
    .filter((r) => r.id.includes("PARTICIPANT") || r.id.includes("ABBREV_PARSE"))
    .every((r) => r.pass),
  INJURY_GUARD: results
    .filter((r) => r.id.includes("INJURY"))
    .every((r) => r.pass),
  INVESTIGATION_GUARD: results
    .filter((r) => r.id.includes("INVESTIGATION") || r.id.includes("INV"))
    .every((r) => r.pass),
  INFORMATION_VALUE_GUARD: results
    .filter((r) => r.id.includes("INFO_NOT_BARE") || r.id.includes("SIT_NOT_GENERIC"))
    .every((r) => r.pass),
};
console.log(JSON.stringify(out, null, 2));
if (!pass) {
  console.error("IU_TRAFFIC_ACCIDENT_DOD_MOTO_INVESTIGATION_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_ACCIDENT_DOD_MOTO_INVESTIGATION_GUARD_PASS");
