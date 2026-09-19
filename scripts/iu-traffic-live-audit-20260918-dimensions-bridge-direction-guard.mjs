#!/usr/bin/env node
/**
 * Freeze guard — NDIC live audit 18.9.2026
 *
 * Invariants:
 * - NUMERIC SOURCE FIDELITY: d30,90 must not become 0,90
 * - OBJECT PROVENANCE: "zametání/opravy mostů" must not create named MOST
 * - DIRECTION PROVENANCE: primary location direction beats arrangement-only direction
 * - MULTI-LOCATION PRESERVATION: structured multi-road / multi-municipality kept
 * - DIVERSION SEPARATION: objízdná localities must not contaminate primary
 *
 * Pure local, no network. No screenshot hardcodes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseOversizeLoadFactsFromText,
  parseOfficialCommentFacts,
  extractNamedTransportObject,
  looksLikeBridgeObjectToken,
  extractPrimaryAffectedRoadNumbersFromOfficialComment,
  extractInMunicipalitiesListFromOfficialComment,
  splitPrimaryVsDetourComment,
  composeRoadNumberWithClass,
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  LOCATION_KIND,
} from "../assets/iu-traffic-card-presenter-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRESENTER = path.join(ROOT, "assets", "iu-traffic-card-presenter-v1.js");

const fails = [];
const results = [];
const previouslyCorrectBroken = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}
function prevOk(id, cond, detail) {
  ok(id, cond, detail);
  if (!cond) previouslyCorrectBroken.push(id);
}

function rowMap(card) {
  return Object.fromEntries(((card.expanded && card.expanded.rows) || []).map((r) => [r.key, r.value]));
}

// --- A: dimensions d30,90 ---
{
  const raw = "Parametry NN: d30,90 m; š 3,25 m; v 4,30 m; hmotnost 166,50 tun.";
  const facts = parseOversizeLoadFactsFromText(raw);
  ok(
    "A_DIM_LENGTH_30_90",
    facts.loadLengthDisplay === "30,90" && facts.loadLengthM === 30.9,
    JSON.stringify({ d: facts.loadLengthDisplay, n: facts.loadLengthM })
  );
  ok(
    "A_DIM_FULL",
    facts.loadWidthDisplay === "3,25" && facts.loadHeightDisplay === "4,30",
    JSON.stringify({ w: facts.loadWidthDisplay, h: facts.loadHeightDisplay })
  );
  ok("A_DIM_NOT_0_90", facts.loadLengthDisplay !== "0,90" && facts.loadLengthM !== 0.9);
  const sit = String(
    buildTrafficSituationSummary({
      impact: "Nadměrný náklad. " + raw,
      impactFull: "Nadměrný náklad. " + raw,
      eventType: "prekazka",
    }) || ""
  );
  ok("A_DIM_IN_SITUATION", /30,90\s*×\s*3,25\s*×\s*4,30/.test(sit), sit);
}

// --- B: dimensions negative — leading digit must not drop ---
{
  const cases = [
    ["d12,50 m; š 3,00 m; v 4,00 m", "12,50"],
    ["d100,50 m; š 3,00 m; v 4,00 m", "100,50"],
    ["d3 4,0 m; š 4,80 m; v 5,40 m", "4,0"],
  ];
  for (const [seg, expect] of cases) {
    const f = parseOversizeLoadFactsFromText("Parametry NN: " + seg);
    ok(
      "B_DIM_NEG_" + expect.replace(",", "_"),
      f.loadLengthDisplay === expect,
      String(f.loadLengthDisplay)
    );
  }
}

// --- C: generic bridge wording → no named MOST ---
{
  const raw =
    "D46, mezi km 38 a 34, ve směru Brno, pomalu jedoucí vozidlo údržby, levý jízdní pruh uzavřen, čištění, zametání mostů - strojně, údržba a opravy mostů";
  const named = extractNamedTransportObject(raw);
  ok("C_GENERIC_BRIDGE_NO_NAMED", named == null, named ? named.name : "null");
  ok("C_ANÍ_MOST_NOT_TOKEN", looksLikeBridgeObjectToken("ání most") === false);
  const card = buildTrafficCardPresentation({
    impact: raw,
    impactFull: raw,
    eventType: "uzavirka",
    roadNumber: "D46",
  });
  const blob = [card.placeLine, card.situationSummary, JSON.stringify(card.communication || {})].join(
    " "
  );
  ok("C_NO_ANÍ_MOST_IN_CARD", !/ání\s+most/i.test(blob), card.placeLine);
  ok("C_KEEP_D46_KM_BRNO", /D46/.test(card.placeLine || "") && /38\s*[–-]\s*34/.test(card.placeLine || "") && /Brno/i.test(card.placeLine || ""), card.placeLine);
}

// --- D: real named bridge preserved ---
{
  const raw = "Barrandovský most, Praha 5, Praha, omezení";
  const named = extractNamedTransportObject(raw);
  ok(
    "D_REAL_BRIDGE_KEPT",
    named && named.kind === LOCATION_KIND.BRIDGE && /Barrandovský\s+most/i.test(named.name),
    named ? named.name : "null"
  );
  prevOk("D_LOOKS_LIKE_BRIDGE_TOKEN", looksLikeBridgeObjectToken("Barrandovský most") === true);
  prevOk("D_BARE_MOST_NOT_BRIDGE", looksLikeBridgeObjectToken("Most") === false);
}

// --- E: primary direction Jaroměř vs arrangement Polsko ---
{
  const raw =
    "D11, mezi km 104.1 a 104.6, ve směru Jaroměř, práce na silnici. provoz ve směru Polsko bude veden 2 provizorními jízdními pruhy";
  const facts = parseOfficialCommentFacts(raw);
  ok("E_PRIMARY_DIR_JAROMER", facts.directionHuman === "Jaroměř", facts.directionHuman);
  ok("E_NOT_POLSKO_PRIMARY", facts.directionHuman !== "Polsko");
  const card = buildTrafficCardPresentation({
    impact: raw,
    impactFull: raw,
    eventType: "prace",
    roadNumber: "D11",
  });
  ok("E_PLACE_HAS_JAROMER", /směr\s+Jaroměř/i.test(card.placeLine || ""), card.placeLine);
  ok("E_PLACE_NOT_POLSKO", !/směr\s+Polsko/i.test(card.placeLine || ""), card.placeLine);
}

// --- F + G + H: multi-road / multi-municipality / diversion ---
{
  const raw =
    "na silnicích 36748, 36747 v obcích Halenkovice a Napajedla okres Zlín. Využijte objízdnou trasu přes Spytihněv nebo Žlutavu.";
  const split = splitPrimaryVsDetourComment(raw);
  ok("H_DETOUR_SPLIT", /objízdn/i.test(split.detourText || "") && /Halenkovice/i.test(split.primaryText || ""));
  const roads = extractPrimaryAffectedRoadNumbersFromOfficialComment(raw);
  ok(
    "F_MULTI_ROAD_BOTH",
    roads.includes("36748") && roads.includes("36747"),
    JSON.stringify(roads)
  );
  ok(
    "F_NO_INVENTED_III_PREFIX",
    !roads.some((r) => /^III\//i.test(r)) &&
      composeRoadNumberWithClass("36748", null) === "36748",
    JSON.stringify(roads)
  );
  const munis = extractInMunicipalitiesListFromOfficialComment(raw);
  ok(
    "G_MULTI_MUNI_BOTH",
    munis.includes("Halenkovice") && munis.includes("Napajedla"),
    JSON.stringify(munis)
  );
  const facts = parseOfficialCommentFacts(raw);
  ok("G_CITY_HALENKOVICE", facts.city === "Halenkovice", facts.city);
  ok(
    "G_ADD_NAPAJEDELA",
    Array.isArray(facts.additionalMunicipalities) &&
      facts.additionalMunicipalities.some((x) => /Napajedla/i.test(x)),
    JSON.stringify(facts.additionalMunicipalities)
  );
  ok("G_DISTRICT_ZLIN", facts.district === "Zlín", facts.district);
  ok(
    "H_DIVERSION_NOT_PRIMARY_CITY",
    !/Spytihněv|Žlutava/i.test(String(facts.city || "")) &&
      !(facts.additionalMunicipalities || []).some((x) => /Spytihněv|Žlutava/i.test(x)),
    JSON.stringify({ city: facts.city, add: facts.additionalMunicipalities })
  );
  const card = buildTrafficCardPresentation({ impact: raw, impactFull: raw, eventType: "uzavirka" });
  ok(
    "FG_PLACE_PRESERVES",
    /36748/.test(card.placeLine || "") &&
      /36747/.test(card.placeLine || "") &&
      /Halenkovice/i.test(card.placeLine || "") &&
      /Napajedla/i.test(card.placeLine || "") &&
      /Zlín/i.test(card.placeLine || ""),
    card.placeLine
  );
  ok(
    "H_PLACE_NO_DIVERSION_LEAK",
    !/Spytihněv|Žlutava/i.test(card.placeLine || ""),
    card.placeLine
  );
}

// --- Freeze: presenter must not reintroduce the broken dimension regex ---
{
  const src = fs.readFileSync(PRESENTER, "utf8");
  ok(
    "FREEZE_NO_OPTIONAL_D3_EATER",
    !src.includes("\\bd(?:3)?"),
    "optional (?:3)? dimension eater present"
  );
  ok("FREEZE_HAS_PRIMARY_D_CAPTURE", src.includes("\\bd\\s*(\\d+"));
  ok("FREEZE_HAS_OCR_D3_WHITESPACE", src.includes("\\bd3\\s+(\\d+"));
}

// --- Lightweight dataset audit over local feed snapshot (if present) ---
const audit = {
  dimensionMismatchBefore: null,
  dimensionMismatchAfter: 0,
  suspiciousBridgeObjectBefore: null,
  suspiciousBridgeObjectAfter: 0,
  structuredDirectionLostBefore: null,
  structuredDirectionLostAfter: 0,
  multiDirectionConflictCount: 0,
  structuredMultiRoadLostBefore: null,
  structuredMultiRoadLostAfter: 0,
  structuredMultiMunicipalityLostBefore: null,
  structuredMultiMunicipalityLostAfter: 0,
  diversionLocalityLeakBefore: null,
  diversionLocalityLeakAfter: 0,
  NO_CHANGE: [],
  scanned: 0,
};
{
  const feedPath = path.join(ROOT, "projects", "data", "info_events", "feed.json");
  if (!fs.existsSync(feedPath)) {
    audit.NO_CHANGE.push("NO CHANGE — insufficient source certainty (no local feed.json)");
  } else {
    let feed;
    try {
      feed = JSON.parse(fs.readFileSync(feedPath, "utf8"));
    } catch {
      feed = null;
      audit.NO_CHANGE.push("NO CHANGE — insufficient source certainty (feed.json unreadable)");
    }
    const items = Array.isArray(feed)
      ? feed
      : Array.isArray(feed && feed.items)
        ? feed.items
        : Array.isArray(feed && feed.events)
          ? feed.events
          : [];
    for (const it of items) {
      const text = String(
        (it && (it.impactFull || it.impact || it.description || it.comment || it.rawText)) || ""
      );
      if (!text) continue;
      audit.scanned += 1;

      const dimM = text.match(
        /\bd\s*(\d+(?:[.,]\d+)?)\s*m\s*[;,]?\s*š\s*(\d+(?:[.,]\d+)?)\s*m\s*[;,]?\s*v\s*(\d+(?:[.,]\d+)?)\s*m\b/i
      );
      if (dimM) {
        const parsed = parseOversizeLoadFactsFromText(text);
        const expect = String(dimM[1]).replace(".", ",");
        if (parsed.loadLengthDisplay && parsed.loadLengthDisplay !== expect.replace(/^0+(?=\d)/, "")) {
          // Compare numeric fidelity: source token vs parsed display.
          const srcNum = Number(String(dimM[1]).replace(",", "."));
          if (parsed.loadLengthM != null && Math.abs(parsed.loadLengthM - srcNum) > 0.001) {
            audit.dimensionMismatchAfter += 1;
          }
        }
        // Leading-digit loss heuristic: source >= 10 but parsed < 10 with matching decimals.
        const src = String(dimM[1]);
        if (/^\d{2,}/.test(src) && parsed.loadLengthDisplay && /^0,/.test(parsed.loadLengthDisplay)) {
          audit.dimensionMismatchAfter += 1;
        }
      }

      const named = extractNamedTransportObject(text);
      if (named && named.kind === LOCATION_KIND.BRIDGE) {
        if (
          /ání\s+most/i.test(named.name) ||
          /^(?:ání|etí|ení|avy)\s+most/i.test(named.name) ||
          /(?:zametání|čištění|opravy)\s+most/i.test(named.name)
        ) {
          audit.suspiciousBridgeObjectAfter += 1;
        }
      }

      if (
        /\bve\s+směru\s+[A-ZÁ-Ž]/iu.test(text) &&
        /\bprovoz\s+ve\s+směru\b/i.test(text)
      ) {
        audit.multiDirectionConflictCount += 1;
        const facts = parseOfficialCommentFacts(text);
        const primaryM = text.match(
          /\b(?:ve\s+směru|v\s+směru)\s+((?:na\s+|do\s+)?[^,;]{2,40}?)(?=\s*,|\s+práce|\s+provoz)/iu
        );
        if (primaryM) {
          const want = String(primaryM[1] || "").trim().split(/\s+/)[0];
          if (want && facts.directionHuman && !new RegExp(want, "i").test(facts.directionHuman)) {
            audit.structuredDirectionLostAfter += 1;
          }
          if (want && !facts.directionHuman) audit.structuredDirectionLostAfter += 1;
        }
      }

      if (/\bna\s+silnicích\s+\d{3,6}\s*,\s*\d{3,6}\b/i.test(text)) {
        const roads = extractPrimaryAffectedRoadNumbersFromOfficialComment(text);
        if (roads.length < 2) audit.structuredMultiRoadLostAfter += 1;
      }
      if (/\bv\s+obcích\s+[^,;]+?\s+a\s+[^,;]+/i.test(text)) {
        const munis = extractInMunicipalitiesListFromOfficialComment(text);
        if (munis.length < 2) audit.structuredMultiMunicipalityLostAfter += 1;
      }
      if (/\b(?:Využijte\s+)?objízdn\w*\s+tras/i.test(text)) {
        const facts = parseOfficialCommentFacts(text);
        const detour = splitPrimaryVsDetourComment(text).detourText || "";
        const detourTowns = detour.match(/[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][\p{L}\-]+/gu) || [];
        for (const t of detourTowns.slice(0, 6)) {
          if (
            facts.city &&
            new RegExp("^" + t + "$", "i").test(facts.city) &&
            !new RegExp(t, "i").test(splitPrimaryVsDetourComment(text).primaryText || "")
          ) {
            audit.diversionLocalityLeakAfter += 1;
          }
        }
      }
    }
  }
}

ok("AUDIT_DIM_MISMATCH_AFTER_ZERO", audit.dimensionMismatchAfter === 0, String(audit.dimensionMismatchAfter));
ok(
  "AUDIT_SUSPICIOUS_BRIDGE_AFTER_ZERO",
  audit.suspiciousBridgeObjectAfter === 0,
  String(audit.suspiciousBridgeObjectAfter)
);
ok(
  "AUDIT_DIR_LOST_AFTER_ZERO",
  audit.structuredDirectionLostAfter === 0,
  String(audit.structuredDirectionLostAfter)
);
ok(
  "AUDIT_MULTI_ROAD_LOST_AFTER_ZERO",
  audit.structuredMultiRoadLostAfter === 0,
  String(audit.structuredMultiRoadLostAfter)
);
ok(
  "AUDIT_MULTI_MUNI_LOST_AFTER_ZERO",
  audit.structuredMultiMunicipalityLostAfter === 0,
  String(audit.structuredMultiMunicipalityLostAfter)
);
ok(
  "AUDIT_DIVERSION_LEAK_AFTER_ZERO",
  audit.diversionLocalityLeakAfter === 0,
  String(audit.diversionLocalityLeakAfter)
);

const pass = fails.length === 0 && previouslyCorrectBroken.length === 0;
const out = {
  guard: "iu-traffic-live-audit-20260918-dimensions-bridge-direction-guard",
  pass,
  failCount: fails.length,
  fails,
  PREVIOUSLY_CORRECT_CASES_BROKEN: previouslyCorrectBroken.length,
  previouslyCorrectBroken,
  audit,
  results,
};
console.log(JSON.stringify(out, null, 2));
if (!pass) process.exit(1);
console.log("IU_TRAFFIC_LIVE_AUDIT_20260918_DIMENSIONS_BRIDGE_DIRECTION_GUARD_PASS");
