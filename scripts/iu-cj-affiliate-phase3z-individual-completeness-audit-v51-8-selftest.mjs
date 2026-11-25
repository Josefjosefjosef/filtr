#!/usr/bin/env node
/**
 * Offline selftest wrapper for individual completeness audit (V51.8). No network, no writes.
 */
import { runIndividualCompletenessSelftest } from "./iu-cj-affiliate-phase3z-individual-completeness-audit-v51-8.mjs";

try {
  const result = runIndividualCompletenessSelftest();
  console.log(
    JSON.stringify({ IU_CJ_INDIVIDUAL_COMPLETENESS_SELFTEST: result.ok ? "PASS" : "FAIL", ...result }, null, 2),
  );
  if (!result.ok) process.exit(1);
} catch (err) {
  console.log(JSON.stringify({ IU_CJ_INDIVIDUAL_COMPLETENESS_SELFTEST: "FAIL", error: String(err?.message || err) }));
  process.exit(1);
}
