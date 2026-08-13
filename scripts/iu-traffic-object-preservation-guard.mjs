#!/usr/bin/env node
/**
 * CI-blocking guard: when NDIC source safely names a concrete transport object
 * (e.g. železniční přejezd P7454), collapsed DOPRAVNÍ SITUACE must preserve it.
 * Never requires invented objects. Guards the real presentation model, not a
 * parser-only unit test.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildTrafficCardPresentation,
  buildTrafficSituationSummary,
  buildLocalityHeaderModel,
  extractNamedTransportObject,
  extractFullClosureObjectPhrase,
  parseOfficialCommentFacts,
  LOCATION_KIND,
} from "../assets/iu-traffic-card-presenter-v1.js";

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

function base(extra) {
  return {
    publicEventId: "iu-te-" + "b".repeat(32),
    lifecycleStatus: "ACTIVE",
    preciseLocationVerified: true,
    source: "ŘSD/NDIC",
    ...extra,
  };
}

const P7454_IMPACT =
  'ulice Havlíčkova, Frýdlant nad Ostravicí, okr. Frýdek-Místek, , Od 14.09.2026 00:00, Do 15.09.2026 23:59, úplná uzavírka železničního přejezdu P7454 na místní komunikaci III. třídy ev.č. 9c "SNP" na ul. Havlíčkova ve Frýdlantu nad Ostravicí, Vydal: Městský úřad Frýdlant nad Ostravicí';

const p7454Input = base({
  eventType: "uzavirka",
  category: "uzavirka",
  impact: P7454_IMPACT,
  impactFull: P7454_IMPACT,
  municipality: "Frýdlant nad Ostravicí",
  street: "Havlíčkova",
  district: "Frýdek-Místek",
});

const named = extractNamedTransportObject(P7454_IMPACT);
const facts = parseOfficialCommentFacts(P7454_IMPACT);
const closurePhrase = extractFullClosureObjectPhrase(P7454_IMPACT);
const summary = buildTrafficSituationSummary(p7454Input);
const pres = buildTrafficCardPresentation(p7454Input);
const hdr = buildLocalityHeaderModel(p7454Input);
const collapsed = String(pres.situationSummary || "");

ok(
  "P7454_RAW_HAS_RAILWAY_CROSSING",
  /železničního\s+přejezdu\s+P7454/i.test(P7454_IMPACT)
);
ok(
  "P7454_PARSER_OBJECT_TYPE",
  named && named.kind === LOCATION_KIND.RAILWAY_CROSSING,
  named ? named.kind : "null"
);
ok(
  "P7454_PARSER_OBJECT_ID",
  named && named.objectIdentifier === "P7454",
  named ? String(named.objectIdentifier) : "null"
);
ok(
  "P7454_FACTS_PRESERVE_OBJECT",
  facts.namedObjectKind === LOCATION_KIND.RAILWAY_CROSSING &&
    facts.objectIdentifier === "P7454" &&
    /železniční\s+přejezd\s+P7454/i.test(String(facts.namedObject || ""))
);
ok(
  "P7454_CLOSURE_PHRASE",
  /železničního\s+přejezdu\s+P7454/i.test(String(closurePhrase || "")),
  String(closurePhrase || "")
);
ok(
  "P7454_SUMMARY_PRESERVES_OBJECT",
  /Úplná\s+uzavírka\s+železničního\s+přejezdu\s+P7454/i.test(summary),
  summary
);
ok(
  "P7454_COLLAPSED_CARD_PRESERVES_OBJECT",
  /Úplná\s+uzavírka\s+železničního\s+přejezdu\s+P7454/i.test(collapsed),
  collapsed
);
ok(
  "P7454_NOT_GENERIC_COMMUNICATION_ONLY",
  !/^Úplná\s+uzavírka\s+komunikace\.?$/i.test(collapsed),
  collapsed
);
ok(
  "P7454_HEADER_KEEPS_STREET",
  /ulice:\s*Havlíčkova/i.test(String(hdr.besideLocality || "")),
  String(hdr.besideLocality || "")
);
ok(
  "P7454_NO_HARDCODE_IN_PRESENTER",
  !/P7454/.test(
    fs.readFileSync(path.join(root, "assets/iu-traffic-card-presenter-v1.js"), "utf8")
  )
);

// Fail-closed: no object invention when source has only generic closure.
const genericImpact = "úplná uzavírka komunikace, obec Testovice";
const genericNamed = extractNamedTransportObject(genericImpact);
const genericSum = buildTrafficSituationSummary(
  base({ eventType: "uzavirka", impact: genericImpact, impactFull: genericImpact })
);
ok("NO_INVENTION_NAMED_NULL", genericNamed == null);
ok(
  "NO_INVENTION_GENERIC_SUMMARY",
  /^Úplná\s+uzavírka\s+komunikace\.?$/i.test(genericSum) && !/přejezd/i.test(genericSum),
  genericSum
);

// Additional safe object categories (source-grounded only).
const variants = [
  {
    id: "NAMED_BRIDGE_CLOSURE",
    impact: "úplná uzavírka mostu Evženka na silnici II/123",
    want: /Úplná\s+uzavírka\s+mostu\s+Evženka/i,
  },
  {
    id: "NAMED_TUNNEL_PHRASE",
    impact: "úplná uzavírka tunelu Panenská na dálnici D8",
    want: /Úplná\s+uzavírka\s+tunelu\s+Panenská/i,
  },
  {
    id: "NAMED_INTERSECTION",
    impact: "úplná uzavírka křižovatky Severka na silnici I/35",
    want: /Úplná\s+uzavírka\s+křižovatky\s+Severka/i,
  },
];
for (const v of variants) {
  const sum = buildTrafficSituationSummary(
    base({ eventType: "uzavirka", impact: v.impact, impactFull: v.impact })
  );
  const card = buildTrafficCardPresentation(
    base({ eventType: "uzavirka", impact: v.impact, impactFull: v.impact })
  );
  ok(v.id + "_SUMMARY", v.want.test(sum), sum);
  ok(v.id + "_COLLAPSED", v.want.test(String(card.situationSummary || "")), card.situationSummary);
  ok(
    v.id + "_NOT_GENERIC",
    !/^Úplná\s+uzavírka\s+komunikace\.?$/i.test(String(card.situationSummary || ""))
  );
}

// Numbered road + km must still win for place line (regression vs object work).
const kmInput = base({
  eventType: "uzavirka",
  road: "D1",
  roadClass: "MOTORWAY",
  kilometer: 22.2,
  kilometerTo: 25.2,
  direction: "Brno",
  impact: "D1, mezi km 22.2 a 25.2, ve směru Brno, úplná uzavírka, most Šmejkalka",
  impactFull: "D1, mezi km 22.2 a 25.2, ve směru Brno, úplná uzavírka, most Šmejkalka",
});
const kmPres = buildTrafficCardPresentation(kmInput);
ok(
  "KM_SECTION_STILL_VISIBLE",
  /\bkm\s*22[,.]2/i.test(String(kmPres.placeLine || "")),
  String(kmPres.placeLine || "")
);

const smokeSrc = fs.readFileSync(path.join(root, ".github/workflows/smoke.yml"), "utf8");
const pkgSrc = fs.readFileSync(path.join(root, "package.json"), "utf8");
ok(
  "OBJECT_PRESERVATION_GUARD_IN_PACKAGE",
  /iu-traffic-object-preservation-guard/.test(pkgSrc)
);
ok(
  "OBJECT_PRESERVATION_GUARD_IN_SMOKE",
  /iu-traffic-object-preservation-guard/.test(smokeSrc)
);

console.log(
  JSON.stringify(
    {
      ok: fails.length === 0,
      pass: results.filter((r) => r.pass).length,
      fail: fails.length,
      fails,
      OBJECT_PRESERVATION_GUARD_IMPLEMENTED: "YES",
      OBJECT_PRESERVATION_GUARD_CI_BLOCKING: /iu-traffic-object-preservation-guard/.test(smokeSrc)
        ? "YES"
        : "NO",
      P7454_COLLAPSED_SUMMARY: collapsed,
      RAW_HAS_RAILWAY_CROSSING_P7454: /P7454/.test(P7454_IMPACT) ? "YES" : "NO",
      PARSER_PRESERVES_RAILWAY_CROSSING:
        named && named.kind === LOCATION_KIND.RAILWAY_CROSSING ? "YES" : "NO",
      PARSER_PRESERVES_P7454: named && named.objectIdentifier === "P7454" ? "YES" : "NO",
      SUMMARY_PRESERVES_OBJECT: /přejezdu\s+P7454/i.test(summary) ? "YES" : "NO",
      COLLAPSED_CARD_HAS_RAILWAY_CROSSING: /přejezdu\s+P7454/i.test(collapsed)
        ? "YES"
        : "NO",
      GENERIC_COMMUNICATION_ONLY: /^Úplná\s+uzavírka\s+komunikace\.?$/i.test(collapsed)
        ? "YES"
        : "NO",
    },
    null,
    2
  )
);

process.exit(fails.length ? 1 : 0);
