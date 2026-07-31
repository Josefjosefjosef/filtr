#!/usr/bin/env node
/**
 * Guard: production CHMI sync must not hardcode incident ORP lists / times / fixture seeds.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const prod = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs"), "utf8");
const ledger = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2/territory-onset-ledger.mjs"), "utf8");

ok("no_seedOpenEndedLedgerFromSmogFixtures", !/seedOpenEndedLedgerFromSmogFixtures/.test(prod));
ok("no_USTI_ORP_RE", !/USTI_ORP_RE/.test(prod));
ok("no_hardcoded_1100_incident", !/String\(o\) === ["']1100["']/.test(prod));
ok("no_hardcoded_1312_iso", !/2026-07-30T13:12/.test(prod));
ok("no_hardcoded_1125_iso", !/2026-07-31T11:25:23/.test(prod));
ok("has_buildTerritoryOnsetLedger", /buildTerritoryOnsetLedgerFromOrderedDocuments/.test(prod));
ok("has_listRecentForOnsetLedger", /listRecentForOnsetLedger/.test(prod));
ok("fixtureSeed_explicit_false", /fixtureSeed:\s*false/.test(prod));
ok("ledger_module_no_incident_orp_list", !/4201[\s\S]{0,40}4216/.test(ledger));
ok("ledger_doc_says_no_hardcode", /No incident-specific/.test(ledger));

if (fails.length) {
  console.error("IU_CHMI_NO_INCIDENT_HARDCODE_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_NO_INCIDENT_HARDCODE_GUARD=PASS");
