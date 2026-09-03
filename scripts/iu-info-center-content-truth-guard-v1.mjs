#!/usr/bin/env node
/**
 * iCentrum content / technical-truth semantic guard (Phase 6).
 * Static source checks — not a brittle full-page snapshot.
 *
 * Run: npm run iu-info-center-content-truth-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(REPO, "projects", "index.html");
const VAULT_UI = path.join(REPO, "assets", "iu-vault-ui-v1.js");
const CSS = path.join(REPO, "assets", "iu-info-center.css");

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

function extractAboutInventory(html) {
  const m = html.match(
    /data-iu-ic-feature-inventory="current-v1"[\s\S]*?<\/ul>/
  );
  return m ? m[0] : "";
}

function main() {
  const html = read(INDEX);
  const vault = read(VAULT_UI);
  const css = read(CSS);
  let fails = 0;

  const about = extractAboutInventory(html);
  if (!about) {
    fail("about_inventory_marker_missing");
    fails += 1;
  } else {
    ok("about_inventory_marker");
    if (/<strong>\s*Zprávy\s*<\/strong>/i.test(about)) {
      fail("historical_standalone_zpravy_in_about");
      fails += 1;
    } else ok("no_standalone_zpravy");
    if (/RSS agregátor článků/i.test(about)) {
      fail("historical_rss_aggregator_in_about");
      fails += 1;
    } else ok("no_rss_aggregator_product");
    if (/<strong>\s*Sport,\s*Finance,\s*Zdraví/i.test(about)) {
      fail("historical_bundled_sport_finance_sections");
      fails += 1;
    } else ok("no_historical_bundled_sections");
    if (!/Přehled dne/i.test(about)) {
      fail("current_prehled_dne_missing");
      fails += 1;
    } else ok("prehled_dne_present");
  }

  if (!vault.includes('data-iu-vault-ui-version", "4"')) {
    fail("vault_ui_version_not_4");
    fails += 1;
  } else ok("vault_ui_version_4");

  const unlockIdx = vault.indexOf("Způsob odemknutí");
  const statusIdx = vault.indexOf("Stav zabezpečení");
  const webAuthnIdx = vault.indexOf("Zabezpečení zařízení:</strong> ověření provádí");
  const applyIdx = vault.indexOf("iuVaultApplyMindMenuMethodBtn");
  if (
    unlockIdx < 0 ||
    statusIdx < 0 ||
    webAuthnIdx < 0 ||
    applyIdx < 0 ||
    !(unlockIdx < applyIdx && applyIdx < webAuthnIdx && webAuthnIdx < statusIdx)
  ) {
    fail("vault_controls_order_regression");
    fails += 1;
  } else ok("vault_controls_order");

  if (!vault.includes("Co zabezpečení chrání a co ne")) {
    fail("limitations_section_missing");
    fails += 1;
  } else ok("limitations_section");

  if (!vault.includes("dodatečný zámek vypnutý") && !vault.includes("Dodatečný zámek")) {
    fail("security_off_semantics_missing");
    fails += 1;
  } else ok("security_off_semantics");

  if (!vault.includes("minimum") || !vault.includes("6 číslic")) {
    fail("pin_minimum_claim_missing");
    fails += 1;
  } else ok("pin_minimum_claim");

  if (/přesně\s*6\s*číslic/i.test(vault) || /maximální délka\s*6/i.test(vault)) {
    fail("pin_exact_six_claim");
    fails += 1;
  } else ok("pin_not_exact_six");

  if (/100%\s*bezpečn|zcela bezpečn|nelze prolomit|nikdo se k datům nemůže/i.test(vault)) {
    fail("absolute_security_marketing");
    fails += 1;
  } else ok("no_absolute_security_marketing");

  if (/žádná data nejsou odesílána|nic nikdy neopouští zařízení/i.test(vault + about)) {
    fail("absolute_zero_network_claim");
    fails += 1;
  } else ok("no_absolute_zero_network");

  if (!vault.includes("Serverová obnova PINu neexistuje") && !vault.includes("nelze obnovit ze serveru")) {
    fail("no_server_pin_recovery_claim_missing");
    fails += 1;
  } else ok("no_server_pin_recovery");

  if (!html.includes('data-iu-ic-truth="backup"') || !html.includes('data-iu-ic-truth="import-destructive"')) {
    fail("backup_import_truth_markers_missing");
    fails += 1;
  } else ok("backup_import_truth_markers");

  if (!html.includes("šifrovaně") && !html.includes("Šifrování at-rest")) {
    fail("encrypted_at_rest_user_copy_missing");
    fails += 1;
  } else ok("encrypted_at_rest_user_copy");

  if (!css.includes("iuInfoCenter__status--ok") || !css.includes("iuInfoCenter__status--warn") || !css.includes("iuInfoCenter__status--danger") || !css.includes("iuInfoCenter__status--info")) {
    fail("color_semantic_classes_missing");
    fails += 1;
  } else ok("color_semantic_classes");

  if (!css.includes("iuInfoCenter__statusLabel")) {
    fail("color_not_only_signal_label_missing");
    fails += 1;
  } else ok("color_not_only_signal");

  if (fails === 0) {
    console.log("iCENTRUM_CONTENT_TRUTH_GUARD=PASS");
  } else {
    console.error("iCENTRUM_CONTENT_TRUTH_GUARD=FAIL count=" + fails);
    process.exit(1);
  }
}

main();
