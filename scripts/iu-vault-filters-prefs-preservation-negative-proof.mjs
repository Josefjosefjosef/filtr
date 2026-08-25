#!/usr/bin/env node
/**
 * Negative: force empty prefs write before hydrate must FAIL the prefs guard.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(REPO, "scripts", "iu-vault-filters-prefs-preservation-guard-v1.mjs");

const r = spawnSync(process.execPath, [script], {
  env: { ...process.env, IU_NEG_FORCE_EMPTY_PREFS: "1" },
  encoding: "utf8",
  cwd: REPO,
});

const out = String(r.stdout || "") + String(r.stderr || "");
const failedAsExpected = r.status !== 0 && /IU_VAULT_FILTERS_PREFS_PRESERVATION_GUARD_FAIL|FAIL/.test(out);

console.log(JSON.stringify({
  IU_VAULT_FILTERS_PREFS_PRESERVATION_NEGATIVE_PROOF: failedAsExpected ? "PASS" : "FAIL",
  childStatus: r.status,
  sawFail: /FAIL/.test(out),
}));

if (!failedAsExpected) {
  console.error("IU_VAULT_FILTERS_PREFS_PRESERVATION_NEGATIVE_PROOF_FAIL");
  console.error(out.slice(-2000));
  process.exit(1);
}
console.log("IU_VAULT_FILTERS_PREFS_PRESERVATION_NEGATIVE_PROOF_PASS");
