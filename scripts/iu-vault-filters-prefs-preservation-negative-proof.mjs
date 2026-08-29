#!/usr/bin/env node
/**
 * Empty prefs overwrite before/after hydrate is blocked by central vault guards.
 * This proof asserts FORCE_EMPTY_PREFS no longer destroys prefs (PASS required).
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
  timeout: 180000,
});

const out = String(r.stdout || "") + String(r.stderr || "");
const passedAsExpected =
  r.status === 0 && /IU_VAULT_FILTERS_PREFS_PRESERVATION_GUARD_PASS|PASS/.test(out);

console.log(
  JSON.stringify({
    IU_VAULT_FILTERS_PREFS_PRESERVATION_NEGATIVE_PROOF: passedAsExpected ? "PASS" : "FAIL",
    childStatus: r.status,
    meaning: "empty_prefs_clobber_blocked_centrally",
  })
);

if (!passedAsExpected) {
  console.error("IU_VAULT_FILTERS_PREFS_PRESERVATION_NEGATIVE_PROOF_FAIL");
  console.error(out.slice(-2000));
  process.exit(1);
}
console.log("IU_VAULT_FILTERS_PREFS_PRESERVATION_NEGATIVE_PROOF_PASS");
