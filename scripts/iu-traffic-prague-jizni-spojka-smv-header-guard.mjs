#!/usr/bin/env node
/**
 * PRAGUE_JIZNI_SPOJKA_SMV_HEADER_GUARD + NON_SMV_PRAGUE_STREET_HEADER_GUARD
 *
 * Positive: Praha + Jižní spojka + authoritative named SMV registry
 *   → [PRAHA] [SMV] Jižní spojka (no "ulice:" on first row)
 * Negative: Praha + ordinary street / bare "spojka" must not get SMV.
 * Protects numbered SMV (I/11) and motorway (D1) patterns.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLocalityHeaderModel,
  buildTrafficCardPresentation,
  classifyRoadPresentation,
  resolveNamedSmvRoadEnrichment,
  matchSmvNamedRoadRegistry,
  TRAFFIC_SIGN_ASSET,
} from "../assets/iu-traffic-card-presenter-v1.js";
import { buildTrafficCardViewModel as vmOverview } from "../assets/iu-traffic-overview-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false, detail: detail || "" });
  }
}

const ASSET = path.join(root, "assets", "images", "traffic-road-motor-vehicles.png");
ok("SMV_ASSET_EXISTS", fs.existsSync(ASSET), ASSET);

const REF = {
  municipality: "Praha",
  street: "Jižní spojka",
  impact:
    "ulice Jižní spojka, Praha, Od 14.08.2026 15:00, Pozor! Olej na vozovce; sjízdné se zvýšenou opatrností",
  impactFull:
    "ulice Jižní spojka, Praha, Od 14.08.2026 15:00, Pozor! Olej na vozovce; sjízdné se zvýšenou opatrností",
  eventType: "prekazka",
  category: "prekazka",
};

const entry = matchSmvNamedRoadRegistry(REF);
ok("REGISTRY_MATCH", !!entry && entry.roadId === "praha-jizni-spojka", entry && entry.roadId);
ok("REGISTRY_SMV_TRUE", entry && entry.motorVehicleRoad === true);
ok("REGISTRY_SECTION_INDEPENDENT", entry && entry.sectionDependent === false);

const enrich = resolveNamedSmvRoadEnrichment(REF);
ok("ENRICH_CONFIRMED", enrich && enrich.motorVehicleRoadConfirmed === true);
ok("ENRICH_NAME", enrich && enrich.displayName === "Jižní spojka", enrich && enrich.displayName);

const hdr = buildLocalityHeaderModel(REF);
ok("MUNI_SIGN", hdr.municipalitySignLabel === "PRAHA", hdr.municipalitySignLabel);
ok("BESIDE_PLAIN", hdr.besideLocality === "Jižní spojka", hdr.besideLocality);
ok("NO_ULICE_PREFIX", !/^ulice:/i.test(String(hdr.besideLocality || "")));
ok("STREET_LABEL_KEPT_FOR_DETAIL", /^ulice:\s*Jižní spojka$/i.test(String(hdr.streetLabel || "")));
ok("NAMED_SMV_FLAG", hdr.namedSmvRoad === true);

const card = buildTrafficCardPresentation(REF);
ok(
  "SMV_ICON",
  card.roadPresentation.showMotorVehiclesIcon === true &&
    card.roadPresentation.roadTypeIcon === TRAFFIC_SIGN_ASSET.MOTOR_VEHICLES,
  String(card.roadPresentation.roadTypeIcon)
);
ok("SMV_ALT", card.roadPresentation.roadTypeIconAlt === "Silnice pro motorová vozidla");
ok("NO_MOTORWAY", card.roadPresentation.showMotorwayIcon === false);
ok(
  "ICON_NOT_FIRST",
  card.communication.roadTypeIconFirst === false,
  String(card.communication.roadTypeIconFirst)
);
ok("HEADER_ORDER_MUNI_SMV_NAME", card.communication.municipalitySignLabel === "PRAHA");
ok(
  "HEADER_BESIDE",
  card.communication.besideLocality === "Jižní spojka" &&
    !/^ulice:/i.test(card.communication.besideLocality || "")
);

const vm = vmOverview(REF);
ok("VM_SMV", vm.roadBadge.showMotorVehiclesIcon === true);
ok("VM_MUNI", vm.municipalitySignLabel === "PRAHA");
ok("VM_BESIDE", vm.besideLocality === "Jižní spojka");

// Explicit structured motorVehicleRoad=true without relying on street field alone
const structuredOnly = buildTrafficCardPresentation({
  municipality: "Praha",
  street: "Jižní spojka",
  motorVehicleRoadConfirmed: true,
  impact: "olej na vozovce",
});
ok(
  "STRUCTURED_STILL_PLAIN",
  structuredOnly.communication.besideLocality === "Jižní spojka" &&
    structuredOnly.roadPresentation.showMotorVehiclesIcon === true
);

// --- NON_SMV_PRAGUE_STREET ---
const jandova = buildTrafficCardPresentation({
  municipality: "Praha",
  street: "Jandova",
  impact: "ulice Jandova, Praha, uzavírka",
  impactFull: "ulice Jandova, Praha, uzavírka",
});
ok("JANDOVA_MUNI", jandova.communication.municipalitySignLabel === "PRAHA");
ok(
  "JANDOVA_ULICE",
  /^ulice:\s*Jandova$/i.test(String(jandova.communication.besideLocality || "")),
  jandova.communication.besideLocality
);
ok("JANDOVA_NO_SMV", jandova.roadPresentation.showMotorVehiclesIcon === false);

const vinohrady = buildLocalityHeaderModel({
  municipality: "Praha",
  street: "Vinohradská",
  impact: "ulice Vinohradská, Praha",
});
ok("VINOHRADSKA_ULICE", /^ulice:\s*Vinohradská$/i.test(String(vinohrady.besideLocality || "")));
ok("VINOHRADSKA_NO_NAMED_SMV", vinohrady.namedSmvRoad !== true);

// Bare "spojka" must never activate
const bareSpojka = matchSmvNamedRoadRegistry({
  municipality: "Praha",
  street: "spojka",
  impact: "spojka, Praha",
});
ok("BARE_SPOJKA_NO_MATCH", bareSpojka == null);

const otherTown = resolveNamedSmvRoadEnrichment({
  municipality: "Brno",
  street: "Jižní spojka",
  impact: "Jižní spojka, Brno",
});
ok("OTHER_TOWN_NO_ENRICH", otherTown == null);

const falseExplicit = resolveNamedSmvRoadEnrichment({
  ...REF,
  motorVehicleRoadConfirmed: false,
});
ok("EXPLICIT_FALSE_WINS", falseExplicit == null);

// Numbered SMV still icon-first; motorway never SMV
const smvNum = buildTrafficCardPresentation({
  road: "I/11",
  municipality: "Ostrava",
  isMotorVehicleRoad: true,
  impact: "ulice Rudná, Ostrava",
});
ok("NUMBERED_SMV_ICON", smvNum.roadPresentation.showMotorVehiclesIcon === true);
ok("NUMBERED_SMV_ICON_FIRST", smvNum.communication.roadTypeIconFirst === true);
ok(
  "NUMBERED_SMV_KEEPS_ULICE",
  /ulice:\s*Rudná/.test(String(smvNum.communication.besideLocality || ""))
);

const d1 = classifyRoadPresentation("D1", { isMotorVehicleRoad: true });
ok("MOTORWAY_NOT_SMV", d1.showMotorwayIcon === true && d1.showMotorVehiclesIcon === false);

const d48 = classifyRoadPresentation("D48", {});
ok("D48_MOTORWAY", d48.showMotorwayIcon === true && d48.showMotorVehiclesIcon === false);

const out = {
  guard: "iu-traffic-prague-jizni-spojka-smv-header-guard",
  pass: fails.length === 0,
  PRAGUE_JIZNI_SPOJKA_SMV_HEADER_GUARD_PASS: fails.length === 0,
  NON_SMV_PRAGUE_STREET_HEADER_GUARD_PASS: !fails.some((f) =>
    /JANDOVA|VINOHRADSKA|BARE_SPOJKA|OTHER_TOWN/.test(f)
  ),
  EXISTING_SMV_CASES_BROKEN: fails.some((f) => /NUMBERED_SMV|MOTORWAY_NOT_SMV/.test(f))
    ? 1
    : 0,
  failCount: fails.length,
  fails,
  resultCount: results.length,
};
console.log(JSON.stringify(out, null, 2));
if (!out.pass) {
  console.error("IU_TRAFFIC_PRAGUE_JIZNI_SPOJKA_SMV_HEADER_GUARD_FAIL");
  process.exit(1);
}
console.log("IU_TRAFFIC_PRAGUE_JIZNI_SPOJKA_SMV_HEADER_GUARD_PASS");
