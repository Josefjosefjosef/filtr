#!/usr/bin/env node
/**
 * Phase 7 — data-loss / backup claim semantic guard.
 * Run: npm run iu-info-center-dataloss-claim-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(REPO, "projects", "index.html");
const VAULT_UI = path.join(REPO, "assets", "iu-vault-ui-v1.js");

function read(p) {
  return fs.readFileSync(p, "utf8");
}

function fail(msg) {
  console.error("FAIL " + msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("PASS " + msg);
}

function main() {
  const html = read(INDEX);
  const vault = read(VAULT_UI);
  const blob = html + "\n" + vault;
  let fails = 0;

  if (!html.includes('data-iu-dataloss-ux="phase7-v1"')) {
    fail("dataloss_ux_marker_missing");
    fails += 1;
  } else ok("dataloss_ux_marker");

  if (!html.includes('data-iu-dataloss-claim="safari-itp-7d-documented"')) {
    fail("safari_itp_documented_claim_missing");
    fails += 1;
  } else ok("safari_itp_documented_claim");

  if (!html.includes("Clear site data") || !html.includes("cache")) {
    fail("clear_site_vs_cache_missing");
    fails += 1;
  } else ok("clear_site_vs_cache");

  if (!html.includes("Obnovení přístupu ≠ obnovení dat") && !html.includes("Obnovení přístupu")) {
    fail("recover_access_vs_data_missing");
    fails += 1;
  } else ok("recover_access_vs_data");

  if (!html.includes("backup-created-not-exists")) {
    fail("backup_created_not_exists_missing");
    fails += 1;
  } else ok("backup_created_not_exists");

  if (
    /data se vždy smažou přesně 7 kalendářních dní/i.test(blob) &&
    !/Nejde o tvrzení[\s\S]{0,40}data se vždy smažou přesně 7 kalendářních dní/i.test(blob)
  ) {
    fail("absolute_calendar_7day_claim");
    fails += 1;
  } else ok("no_absolute_calendar_7day");

  if (/Safari smaže data vždy po 7 dnech/i.test(blob) || /vždy po 7 dnech/i.test(blob)) {
    fail("absolute_safari_always_7day");
    fails += 1;
  } else ok("no_absolute_safari_always");

  if (/serverov(á|ou) záloh/i.test(blob) && /osobní data/i.test(blob)) {
    // allow negatives like "není serverová záloha"
  }
  if (/InfoUzel má serverovou zálohu/i.test(blob) || /automatick(á|ou) cloudov(á|ou) záloh/i.test(blob)) {
    fail("false_server_backup_claim");
    fails += 1;
  } else ok("no_false_server_backup");

  if (/data se nikdy nesmažou/i.test(blob) || /o data nemůžete přijít/i.test(blob)) {
    fail("absolute_never_lose_data");
    fails += 1;
  } else ok("no_absolute_never_lose");

  if (!html.includes("Home Screen") && !html.includes("webová aplikace na ploše") && !html.includes("Webová aplikace na ploše")) {
    fail("homescreen_itp_exemption_missing");
    fails += 1;
  } else ok("homescreen_itp_exemption");

  if (!html.includes("data-loss auditem") && html.includes("budou detailně řešeny samostatným data-loss")) {
    fail("deferred_phase7_placeholder_still_present");
    fails += 1;
  } else ok("deferred_placeholder_removed");

  if (fails === 0) {
    console.log("iCENTRUM_DATALOSS_CLAIM_GUARD=PASS");
  } else {
    console.error("iCENTRUM_DATALOSS_CLAIM_GUARD=FAIL count=" + fails);
    process.exit(1);
  }
}

main();
