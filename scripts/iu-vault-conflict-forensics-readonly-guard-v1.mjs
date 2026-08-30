#!/usr/bin/env node
/** Static + smoke: conflict forensics is read-only and boot-skips migrate. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

const forensics = read("assets/iu-vault-conflict-forensics-v1.js");
const boot = read("assets/iu-vault-bootstrap-v1.js");
const overlay = read("assets/iu-vault-physical-diag-overlay-v1.js");
const sw = read("sw.js");
const index = read("projects/index.html");

if (!/READ-ONLY conflict forensics/.test(forensics) && !/noMigrate:\s*true/.test(forensics)) {
  fails.push("forensics_missing_readonly_markers");
}
if (/migrateL1ToIdbOnly\s*\(/.test(forensics)) fails.push("forensics_must_not_call_migrate");
if (/writeMigrationCheckpoint|writeRecord|writeKeyRecord|writeMeta/.test(forensics)) {
  fails.push("forensics_must_not_write_idb");
}
if (!/conflictForensicsOnlyMode/.test(boot)) fails.push("bootstrap_missing_forensics_mode");
if (!/forensicsOnly:\s*true/.test(boot)) fails.push("bootstrap_missing_forensics_return");
if (!/getConflictForensics/.test(boot)) fails.push("bootstrap_missing_api");
if (!/iuConflictForensics/.test(overlay)) fails.push("overlay_missing_conflict_mode");
if (!/iu-vault-l1-migrate-v1\.js/.test(sw) || !/iu-vault-conflict-forensics-v1\.js/.test(sw)) {
  fails.push("sw_missing_network_first_migrate_forensics");
}
if (!/#iuPersistDiagOverlay/.test(index)) fails.push("css_missing_overlay_exception");
if (!/iu-vault-pin-rotate-fence-v1-20260830|iu-vault-post-hydrate-shim-v1-20260830|iu-vault-canary-diag-v1-20260830|iu-vault-canonical-durable-v1-20260830|iu-vault-hydrated-owns-ui-v1-20260829|iu-vault-key-path-atomic-v1-20260829|iu-vault-hydrated-prefs-ui-v1-20260829|iu-vault-lifecycle-diag-v1-20260829|iu-vault-inflight-durable-v1-20260829|iu-vault-l1-auth-idb-v1-20260829|iu-vault-sec-off-reload-diag-v1-20260829|iu-vault-l1-orphan-quarantine-v1-20260828|iu-vault-conflict-forensics-readonly-v1-20260828/.test(index)) {
  fails.push("index_missing_cache_bust");
}
if (!/iu-vault-physical-diag-overlay-v1\.js/.test(index)) {
  fails.push("index_missing_forensics_overlay_script");
}

const report = {
  IU_VAULT_CONFLICT_FORENSICS_READONLY_GUARD: fails.length === 0 ? "PASS" : "FAIL",
  fails,
};
console.log(JSON.stringify(report, null, 2));
if (fails.length) process.exit(1);
