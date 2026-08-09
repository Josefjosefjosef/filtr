#!/usr/bin/env node
/**
 * Policy + mutation fixtures for LT CZE v11 POINTS empty-field semantic-null.
 * Offline only. No network. No real archive required for mutations.
 */
import {
  documentedEmptyFieldPolicy,
  isDocumentedSemanticNullEmpty,
  isPointsTopologyFlag,
  POINTS_TOPOLOGY_FLAG_CODES,
} from "./ndic-datex-v1/tmc-points-empty-field-policy.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

// --- positive policy ---
ok("ir_points_allowed", isDocumentedSemanticNullEmpty("POINTS", "INTERRUPTSROAD") === true);
ok(
  "ir_semantics",
  documentedEmptyFieldPolicy("POINTS", "INTERRUPTSROAD").semantics === "not_applicable_no_interruption"
);
ok(
  "ir_doc_ref",
  /ltcze11_0_technicka_dokumentace\.pdf:2\.5/.test(
    documentedEmptyFieldPolicy("POINTS", "INTERRUPTSROAD").docReference || ""
  )
);

// --- must NOT allow empty INTERRUPTSROAD outside POINTS ---
ok("ir_roads_denied", isDocumentedSemanticNullEmpty("ROADS", "INTERRUPTSROAD") === false);
ok("ir_segments_denied", isDocumentedSemanticNullEmpty("SEGMENTS", "INTERRUPTSROAD") === false);
ok("ir_admin_denied", isDocumentedSemanticNullEmpty("ADMINISTRATIVEAREA", "INTERRUPTSROAD") === false);

// --- topology flags: empty NOT allowed ---
for (const f of POINTS_TOPOLOGY_FLAG_CODES) {
  ok("topo_denied_" + f, isDocumentedSemanticNullEmpty("POINTS", f) === false);
  ok("topo_is_flag_" + f, isPointsTopologyFlag(f) === true);
}
ok("topo_ir_not_flag", isPointsTopologyFlag("INTERRUPTSROAD") === false);

// --- other mandatory fields stay fail-closed on empty policy ---
for (const f of ["CID", "TABCD", "LCD", "CLASS", "XCOORD", "YCOORD", "URBAN"]) {
  ok("mandatory_denied_" + f, isDocumentedSemanticNullEmpty("POINTS", f) === false);
}

// --- mutations: forged broad bypass must be detectable as absent ---
ok(
  "no_global_allow_empty_export",
  typeof documentedEmptyFieldPolicy === "function" &&
    documentedEmptyFieldPolicy("POINTS", "CID").allowed === false
);
ok(
  "mutation_wildcard_table_star",
  isDocumentedSemanticNullEmpty("*", "INTERRUPTSROAD") === false
);
ok(
  "mutation_wildcard_field_star",
  isDocumentedSemanticNullEmpty("POINTS", "*") === false
);
ok(
  "mutation_lowercase_points",
  isDocumentedSemanticNullEmpty("points", "INTERRUPTSROAD") === false
);
ok(
  "mutation_wrong_field_name",
  isDocumentedSemanticNullEmpty("POINTS", "INTERRUPT") === false
);

const pass = results.filter((x) => x.pass).length;
const failN = results.filter((x) => !x.pass).length;
const summary = {
  suite: "TMC_POINTS_EMPTY_FIELD_POLICY_FIXTURES",
  total: results.length,
  success: pass,
  failure: failN,
  TEST_RUNNER_FALSE_GREEN_POSSIBLE: failN === 0 ? "NO" : "UNKNOWN",
};
process.stdout.write(JSON.stringify(summary) + "\n");
if (failN) {
  process.stdout.write(JSON.stringify({ fails: fails.slice(0, 50) }) + "\n");
  process.exitCode = 1;
}
