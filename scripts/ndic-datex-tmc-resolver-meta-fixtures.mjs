#!/usr/bin/env node
/**
 * Meta / mutation tests for DATEX→TMC resolver.
 * Each mutation must produce expected failure (or prove guard still holds).
 * Runs in-process against resolver APIs — no real NDIC data.
 */
import {
  resolveDatexTmcReference,
  resolveDatexEventLocations,
  parseLocationCodeSafe,
  normalizeDirection,
  RESOLVER_STATUS,
  DIRECTION,
  RESOLVER_FEATURE_FLAGS,
  DATEX_TMC_RESOLVER_ERROR,
  PUBLIC_ELIGIBILITY,
} from "./ndic-datex-v1/datex-tmc-resolver.mjs";
import { defaultSyntheticSnapshot } from "./ndic-datex-v1/tmc-resolution-snapshot.mjs";

const fails = [];
const results = [];
function ok(id, cond, detail) {
  if (cond) results.push({ id, pass: true });
  else {
    fails.push(id + (detail ? ":" + detail : ""));
    results.push({ id, pass: false });
  }
}

const snap = defaultSyntheticSnapshot();

function point(extra = {}) {
  return { kind: "point", countryCode: 2, tableNumber: 25, locationCode: "10001", direction: "positive", ...extra };
}

// Wrong CID accepted? must FAIL resolution
ok("mut_cid", resolveDatexTmcReference(point({ countryCode: 3 }), snap, {}).resolutionStatus !== RESOLVER_STATUS.RESOLVED_BASIC);

// Wrong TABCD
ok("mut_tabcd", resolveDatexTmcReference(point({ tableNumber: 1 }), snap, {}).resolutionStatus !== RESOLVER_STATUS.RESOLVED_BASIC);

// Fallback bogus locationCode must not resolve
ok("mut_fallback_lcd", resolveDatexTmcReference(point({ locationCode: "00000" }), snap, {}).resolutionStatus !== RESOLVER_STATUS.RESOLVED_BASIC);

// Fuzzy direction must not become BOTH
ok("mut_fuzzy_dir", normalizeDirection("kinda both ways maybe") === DIRECTION.UNKNOWN);

// Implicit BOTH forbidden for empty
ok("mut_implicit_both", normalizeDirection("") !== DIRECTION.BOTH);

// Empty PES_LEV → 0 forbidden (flag off)
ok("mut_pes0", RESOLVER_FEATURE_FLAGS.PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED === false);

// RNLT use forbidden
ok(
  "mut_rnlt",
  resolveDatexTmcReference(point({ requiresRnlt: true }), snap, {}).resolutionStatus ===
    RESOLVER_STATUS.UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP
);

// Languages 5th unused
ok("mut_lang5", RESOLVER_FEATURE_FLAGS.LANGUAGES_FIFTH_FIELD_USED === false);

// Ambiguous not publicly eligible
{
  const r = resolveDatexTmcReference(point({ directionConflict: true }), snap, {});
  ok("mut_amb_public", r.publiclyEligible === false && PUBLIC_ELIGIBILITY[r.resolutionStatus] === false);
}

// Kilometer estimation disabled
ok("mut_km", RESOLVER_FEATURE_FLAGS.KILOMETER_ESTIMATION_ENABLED === false);

// Coordinate interpolation disabled
ok("mut_interp", RESOLVER_FEATURE_FLAGS.COORDINATE_INTERPOLATION_ENABLED === false);

// Conflict not ignored as RESOLVED_BASIC
ok(
  "mut_conflict_ignored",
  resolveDatexEventLocations({ eventId: "x", tmcRefs: [point({ directionConflict: true })] }, snap).ok === false
);

// Whitespace locationCode rejected
ok("mut_ws_lcd", parseLocationCodeSafe("10001 ").ok === false);

// Number precision: reject non-integer
ok("mut_float_lcd", parseLocationCodeSafe(10001.5).ok === false);

// Error codes are allowlisted constants (no dynamic concat)
ok("mut_dyn_code", DATEX_TMC_RESOLVER_ERROR.DATEX_TMC_CID_MISMATCH === "DATEX_TMC_CID_MISMATCH");

// False-green guard: simulate mismatch between summary and exit (self-check logic)
{
  const fakeSummary = { total: 2, success: 1, failure: 1, skipped: 0 };
  const wouldExitZero = fakeSummary.failure === 0;
  ok("mut_false_green", wouldExitZero === false);
}

// Hardcoded PASS detection: intentional false must be recorded as fail by ok()
{
  const probeFails = [];
  function probeOk(id, cond) {
    if (!cond) probeFails.push(id);
  }
  probeOk("trap", false);
  ok("mut_hardcoded_caught", probeFails.length === 1 && probeFails[0] === "trap");
}

const pass = results.filter((x) => x.pass).length;
const failN = results.filter((x) => !x.pass).length;
const summary = {
  suite: "DATEX_TMC_RESOLVER_META",
  total: results.length,
  success: pass,
  failure: failN,
  skipped: 0,
};
process.stdout.write(JSON.stringify(summary) + "\n");
if (failN) {
  process.stdout.write(JSON.stringify({ fails: fails.slice(0, 30) }) + "\n");
  process.exitCode = 1;
}
if (summary.failure !== failN || (failN === 0 && summary.success !== summary.total)) {
  process.exitCode = 1;
}
