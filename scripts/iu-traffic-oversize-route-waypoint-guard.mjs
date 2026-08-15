#!/usr/bin/env node
/**
 * Oversize route / waypoint EXIT not primary + load-fact + warning-sign guard.
 *
 * Route itinerary EXIT must not become collapsed primary location.
 * Local motorway EXIT events must still keep EXIT as primary.
 * Explicit "Nadměrný náklad" → NADMĚRNÝ NÁKLAD (not generic obstacle).
 * Expanded source description / itinerary must stay complete.
 * No municipality / EXIT / weight hardcode pass path.
 * Pure local, no network.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  parseOfficialCommentFacts,
  hasExplicitOversizeLoad,
  isRouteBasedTrafficEvent,
  formatOversizeLoadSituationLead,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildLocalityHeaderModel,
  classifyEventPresentation,
  analyzePrimaryCause,
  TRAFFIC_SIGN_ASSET,
  EVENT_KIND,
} from "../assets/iu-traffic-card-presenter-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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

function sha(s) {
  return crypto.createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

const REF_RAW =
  "Od 15.8.2026 23:45 do 17.8.2026 07:00; na silnici v obci Brno; Pozor! Nadměrný náklad; Pozor! Očekávejte zdržení; NN převoz turbíny Brno - st. hr. Sudoměřice. Parametra NN: d3 4,0 m; š 4,80 m; v 5,40 m; hmotnost 213,0 tun. Trasa: Brno – Sudoměřice, hr.př. Trasa: Brno – Sudoměřice, hr.př. Brno - I/42 - I/50 - II/- I/50 –II/430 - Bedřichovice (mimo) - nadjezd přes D1 - III/3839 - vlevo nájezd do protisměru na D1 směr Ostrava přes odpočívku Rohlenka 207 - D1 protisměrem - EXIT 210 protisměrem - I/50A - I/50 - Slavkov u Brna (obchvatem) - Bučovice I/50 - Kunovice I/55 - Veselí nad Moravou I/55 - Strážnice.";

const GENERIC_RAW =
  "Od 1.1.2027 22:00 do 2.1.2027 06:00; na silnici v obci Sampleville; Pozor! Nadměrný náklad; Pozor! Očekávejte zdržení; NN převoz turbíny Sampleville - Border. Parametra NN: d3 3,5 m; š 3,20 m; v 4,10 m; hmotnost 180,0 tun. Trasa: Sampleville – Border. Sampleville - I/1 - D1 - EXIT 99 - I/2 - Midtown - I/3 - Border.";

const LOCAL_EXIT_354 =
  "Od 14.8.2026 10:00 do 12:00; D1 výjezd EXIT 354; nehoda; probíhá vyšetřování nehody; OA x NA.";

const LOCAL_EXIT_76 =
  "Od 14.8.2026 11:00 do 13:00; D0 EXIT 76 směr Brno; kolona 1 km.";

const LOCAL_EXIT_46 =
  "Od 14.8.2026 12:00 do 14:00; D48 EXIT 46; práce na silnici; údržba a opravy.";

const WARNING_ASSET = path.join(ROOT, "assets", "images", "traffic-event-warning.png");

// --- Warning sign asset reuse ---
{
  ok("WARNING_SIGN_EXISTING_ASSET_FOUND", fs.existsSync(WARNING_ASSET), WARNING_ASSET);
  ok(
    "WARNING_SIGN_ASSET_PATH",
    TRAFFIC_SIGN_ASSET.WARNING === "/assets/images/traffic-event-warning.png",
    TRAFFIC_SIGN_ASSET.WARNING
  );
}

// --- Reference oversize route fixture ---
{
  const facts = parseOfficialCommentFacts(REF_RAW);
  const input = {
    impact: REF_RAW,
    impactFull: REF_RAW,
    eventType: "prekazka",
    municipality: "Brno",
    illustrationKey: "prekazka",
    validity: { validFrom: "2026-08-15T23:45:00+02:00", validTo: "2026-08-17T07:00:00+02:00" },
  };
  const ev = classifyEventPresentation(input);
  const cause = analyzePrimaryCause(REF_RAW, input);
  const hdr = buildLocalityHeaderModel(input);
  const card = buildTrafficCardPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  const lead = formatOversizeLoadSituationLead(facts, REF_RAW);
  const rows = rowMap(card);
  const sourceDesc = rows.sourceDescription || "";
  const beforeHash = sha(REF_RAW);
  const afterHash = sha(sourceDesc);

  ok("ROUTE_BASED_EVENT_DETECTED", facts.routeBasedEvent === true && isRouteBasedTrafficEvent(REF_RAW), String(facts.routeBasedEvent));
  ok("OVERSIZE_EXPLICIT", hasExplicitOversizeLoad(REF_RAW) && facts.oversizeLoad === true);
  ok("BRNO_MUNICIPALITY_STRUCTURED", /Brno/i.test(String(facts.city || input.municipality)), facts.city);
  ok("MUNI_SIGN_BRNO", /BRNO/i.test(String(hdr.municipalitySignLabel || "")), hdr.municipalitySignLabel);
  ok("EXIT_210_EXTRACTED", facts.exitNumber === "210", facts.exitNumber);
  ok("ROUTE_WAYPOINT_NOT_PRIMARY_LOCATION_GUARD", facts.exitPrimaryLocation === false, String(facts.exitPrimaryLocation));
  ok("EXIT_210_PRIMARY", facts.exitPrimaryLocation === false);
  ok("EXIT_HEADER_ABSENT", !hdr.exitHeaderLabel && !card.communication.exitHeaderLabel, hdr.exitHeaderLabel);
  ok("FIRST_ROW_NO_EXIT", !/EXIT\s*210/i.test(String(hdr.municipalitySignLabel || "") + " " + String(hdr.besideLocality || "")));
  ok("OVERSIZE_TYPE_GUARD", ev.kind === EVENT_KIND.OVERSIZE_LOAD && /NADMĚRNÝ\s+NÁKLAD/i.test(ev.titleCs || ""), ev.titleCs);
  ok("CAUSE_OVERSIZE", cause === "OVERSIZE_LOAD", cause);
  ok("WARNING_SIGN_GUARD", ev.asset === TRAFFIC_SIGN_ASSET.WARNING, ev.asset);
  ok("EVENT_LABEL_VISIBLE", /NADMĚRNÝ\s+NÁKLAD/i.test(ev.titleCs || ""));
  ok(
    "COLLAPSED_LOCATION_GUARD",
    /Brno\s*·\s*trasa\s+přes\s+více\s+lokalit/i.test(card.placeLine || ""),
    card.placeLine
  );
  ok("EXIT_210_VISIBLE_IN_COLLAPSED_PRIMARY_LOCATION", !/EXIT\s*210/i.test(card.placeLine || "") && !card.communication.exitHeaderLabel);
  ok("LOAD_TYPE_VALUE", facts.loadType === "turbína", facts.loadType);
  ok("LOAD_WEIGHT_VALUE", facts.loadWeightTons === 213, facts.loadWeightTons);
  ok("DIMENSION_ORDER_CONFIRMED", facts.loadLengthDisplay === "4,0" && facts.loadWidthDisplay === "4,80" && facts.loadHeightDisplay === "5,40", JSON.stringify({ l: facts.loadLengthDisplay, w: facts.loadWidthDisplay, h: facts.loadHeightDisplay }));
  ok("LOAD_FACT_COVERAGE_GUARD", /turbín/i.test(sit) && /213\s*tun/i.test(sit) && /4,0/i.test(sit) && /4,80/i.test(sit) && /5,40/i.test(sit) && /zdržení/i.test(sit), sit);
  ok("LEAD_OK", /turbín/i.test(lead || "") && /213/i.test(lead || ""), lead);
  ok("NO_GENERIC_OBSTACLE_TITLE", !/PŘEKÁŽKA\s+NA\s+VOZOVCE/i.test(ev.titleCs || ""));
  ok("EXPANDED_DETAIL_NON_REGRESSION_GUARD", beforeHash === afterHash && /EXIT\s*210/i.test(sourceDesc) && /Trasa:/i.test(sourceDesc), afterHash.slice(0, 12));
  ok("EXPANDED_EXIT_ROW_KEPT", String(rows.exitNumber || "") === "210", rows.exitNumber);
  ok("NO_HARDCODE_PASS", !/if\s*\(\s*city\s*===/.test(fs.readFileSync(path.join(ROOT, "assets/iu-traffic-card-presenter-v1.js"), "utf8")));
}

// --- Generic municipality/route (no Brno/210 hardcode path) ---
{
  const facts = parseOfficialCommentFacts(GENERIC_RAW);
  const input = {
    impact: GENERIC_RAW,
    impactFull: GENERIC_RAW,
    eventType: "prekazka",
    municipality: "Sampleville",
  };
  const ev = classifyEventPresentation(input);
  const card = buildTrafficCardPresentation(input);
  const sit = String(buildTrafficSituationSummary(input) || "");
  ok("GENERIC_ROUTE_BASED", facts.routeBasedEvent === true);
  ok("GENERIC_EXIT_NOT_PRIMARY", facts.exitNumber === "99" && facts.exitPrimaryLocation === false, String(facts.exitNumber) + "/" + facts.exitPrimaryLocation);
  ok("GENERIC_OVERSIZE_TYPE", ev.kind === EVENT_KIND.OVERSIZE_LOAD, ev.kind);
  ok("GENERIC_PLACE", /Sampleville\s*·\s*trasa\s+přes\s+více\s+lokalit/i.test(card.placeLine || ""), card.placeLine);
  ok("GENERIC_LOAD", /turbín/i.test(sit) && /180\s*tun/i.test(sit), sit);
  ok("GENERIC_HEADER_NO_EXIT", !card.communication.exitHeaderLabel);
}

// --- Local EXIT positive guards ---
{
  for (const [id, raw, exit] of [
    ["EXIT_354", LOCAL_EXIT_354, "354"],
    ["EXIT_76", LOCAL_EXIT_76, "76"],
    ["EXIT_46", LOCAL_EXIT_46, "46"],
  ]) {
    const facts = parseOfficialCommentFacts(raw);
    const input = { impact: raw, impactFull: raw, eventType: id === "EXIT_354" ? "nehoda" : id === "EXIT_76" ? "kolona" : "prace" };
    const hdr = buildLocalityHeaderModel(input);
    const card = buildTrafficCardPresentation(input);
    ok("LOCAL_" + id + "_PRIMARY", facts.exitNumber === exit && facts.exitPrimaryLocation === true && facts.routeBasedEvent === false, JSON.stringify({ exit: facts.exitNumber, primary: facts.exitPrimaryLocation, route: facts.routeBasedEvent }));
    ok(
      "LOCAL_" + id + "_HEADER",
      (hdr.exitHeaderLabel || card.communication.exitHeaderLabel) === "EXIT " + exit,
      hdr.exitHeaderLabel || card.communication.exitHeaderLabel
    );
  }
  ok("LOCAL_EXIT_POSITIVE_GUARD_PASS", true);
}

// --- Bare obstacle without oversize stays obstacle ---
{
  const raw = "Od 1.1.2026 10:00; na silnici 100; překážka na vozovce; olej na vozovce.";
  const ev = classifyEventPresentation({ impact: raw, impactFull: raw, eventType: "prekazka" });
  ok("BARE_OBSTACLE_NOT_OVERSIZE", ev.kind === EVENT_KIND.OBSTACLE, ev.kind);
}

const pass = fails.length === 0;
console.log(
  JSON.stringify(
    {
      guard: "iu-traffic-oversize-route-waypoint-guard",
      pass,
      failCount: fails.length,
      fails,
      WARNING_SIGN_EXISTING_ASSET_FOUND: results.some((r) => r.id === "WARNING_SIGN_EXISTING_ASSET_FOUND" && r.pass),
      ROUTE_WAYPOINT_NOT_PRIMARY_LOCATION_GUARD_PASS: results.some((r) => r.id === "ROUTE_WAYPOINT_NOT_PRIMARY_LOCATION_GUARD" && r.pass),
      LOCAL_EXIT_POSITIVE_GUARD_PASS: results.some((r) => r.id === "LOCAL_EXIT_354_PRIMARY" && r.pass),
      OVERSIZE_TYPE_GUARD_PASS: results.some((r) => r.id === "OVERSIZE_TYPE_GUARD" && r.pass),
      WARNING_SIGN_GUARD_PASS: results.some((r) => r.id === "WARNING_SIGN_GUARD" && r.pass),
      LOAD_FACT_COVERAGE_GUARD_PASS: results.some((r) => r.id === "LOAD_FACT_COVERAGE_GUARD" && r.pass),
      EXPANDED_DETAIL_NON_REGRESSION_GUARD_PASS: results.some((r) => r.id === "EXPANDED_DETAIL_NON_REGRESSION_GUARD" && r.pass),
      results,
    },
    null,
    2
  )
);
process.exit(pass ? 0 : 1);
