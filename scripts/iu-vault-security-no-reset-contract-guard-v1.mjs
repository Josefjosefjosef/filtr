#!/usr/bin/env node
/**
 * Security operations must not call personal-module default/reset helpers
 * (except explicit wipe confirmation path).
 */
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VAULT_FILES = [
  "assets/iu-vault-lock-v1.js",
  "assets/iu-vault-bootstrap-v1.js",
  "assets/iu-vault-app-lock-v1.js",
  "assets/iu-vault-storage-v1.js",
  "assets/iu-vault-ui-v1.js",
  "assets/iu-vault-pin-v1.js",
  "assets/iu-vault-device-v1.js",
];

const FORBIDDEN = [
  /defaultPrefs\s*\(/,
  /resetNotes\s*\(/,
  /resetTasks\s*\(/,
  /clearAllNotes\s*\(/,
  /seedDefaultMailbox\s*\(/,
  /resetQuickTools\s*\(/,
  /DEFAULT_NOTES/,
  /defaultTasks\s*\(/,
];

function main() {
  const fails = [];
  for (const rel of VAULT_FILES) {
    const abs = path.join(REPO, rel);
    if (!fs.existsSync(abs)) {
      fails.push(`missing:${rel}`);
      continue;
    }
    const src = fs.readFileSync(abs, "utf8");
    for (const re of FORBIDDEN) {
      if (re.test(src)) fails.push(`${rel}:${re}`);
    }
  }

  const wipe = fs.readFileSync(path.join(REPO, "assets", "iu-vault-wipe-v1.js"), "utf8");
  if (!/wipePersonalVault/.test(wipe)) fails.push("wipe_missing_entry");
  if (!/isWipeConfirmPhraseAccepted/.test(wipe)) fails.push("wipe_missing_phrase_gate");

  const prot = fs.readFileSync(path.join(REPO, "assets", "iu-vault-protected-keys-v1.js"), "utf8");
  const backup = fs.readFileSync(path.join(REPO, "assets", "iu-user-data-backup-core.js"), "utf8");
  const keySources = prot + "\n" + backup;
  for (const k of [
    "iu.infoEvents.prefs.v1",
    "iu.notes.store.v1",
    "iu.tasks.mvp.v1",
    "iuWeatherCitySelectedV1",
  ]) {
    if (!srcIncludes(keySources, k)) fails.push(`prot_missing:${k}`);
  }

  const core = fs.readFileSync(path.join(REPO, "assets", "iu-info-system-core-v1.js"), "utf8");
  if (!/isVaultPrefsOpaque|clearPrefsMemCache/.test(core)) {
    fails.push("info_core_missing_prefs_opaque_guard");
  }
  if (!/iu-vault-hydrated/.test(core)) fails.push("info_core_missing_hydrate_clear");

  const pass = fails.length === 0;
  console.log(JSON.stringify({ IU_VAULT_SECURITY_NO_RESET_CONTRACT_GUARD: pass ? "PASS" : "FAIL", fails }));
  if (!pass) {
    console.error("IU_VAULT_SECURITY_NO_RESET_CONTRACT_GUARD_FAIL");
    process.exit(1);
  }
  console.log("IU_VAULT_SECURITY_NO_RESET_CONTRACT_GUARD_PASS");
}

function srcIncludes(src, needle) {
  return src.indexOf(needle) >= 0;
}

main();
