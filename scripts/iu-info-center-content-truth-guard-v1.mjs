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

  if (!vault.includes('data-iu-vault-ui-version", "5"')) {
    fail("vault_ui_version_not_5");
    fails += 1;
  } else ok("vault_ui_version_5");

  const introMarker = 'data-iu-vault-lock-intro="1"';
  const introText =
    "Zapnutím zámku se celý InfoUzel uzamkne. Při jeho otevření nebo návratu do InfoUzlu bude pro přístup vyžadováno zvolené ověření.";
  const introIdx = vault.indexOf(introMarker);
  const unlockIdx = vault.indexOf("Způsob odemknutí");
  const statusIdx = vault.indexOf("Stav zabezpečení");
  const webAuthnIdx = vault.indexOf("Zabezpečení zařízení:</strong> ověření provádí");
  const applyIdx = vault.indexOf("iuVaultApplyMindMenuMethodBtn");
  const disableIdx = vault.indexOf("iuVaultDisableMindMenuLockBtn");
  if (introIdx < 0 || !vault.includes(introText)) {
    fail("lock_intro_missing");
    fails += 1;
  } else ok("lock_intro_present");
  if (introIdx >= 0 && unlockIdx >= 0 && !(introIdx < unlockIdx)) {
    fail("lock_intro_not_before_unlock_methods");
    fails += 1;
  } else if (introIdx >= 0 && unlockIdx >= 0) ok("lock_intro_before_unlock_methods");
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
  if (disableIdx < 0 || webAuthnIdx < 0 || !(disableIdx < webAuthnIdx)) {
    fail("detail_info_not_after_disable_button");
    fails += 1;
  } else ok("detail_info_after_disable");

  const introOccurrences = vault.split(introText).length - 1;
  if (introOccurrences !== 1) {
    fail("lock_intro_duplicate_or_missing_count=" + introOccurrences);
    fails += 1;
  } else ok("lock_intro_single_occurrence");
  if (/Zapnutím zámku se při otevření nebo návratu podle nastavení ověřuje přístup/.test(vault)) {
    fail("legacy_lock_blurb_still_present");
    fails += 1;
  } else ok("legacy_lock_blurb_removed");

  if (!vault.includes("Bez dalšího zamykání") || !vault.includes("Zabezpečení zařízení — doporučeno") || !vault.includes("Vlastní PIN InfoUzlu")) {
    fail("unlock_method_options_missing");
    fails += 1;
  } else ok("unlock_method_options");
  if (
    !vault.includes("Aktivovat zabezpečení InfoUzlu") ||
    !vault.includes("Změnit PIN") ||
    !vault.includes("Změnit způsob odemknutí") ||
    !vault.includes("Vypnout zabezpečení InfoUzlu")
  ) {
    fail("security_action_buttons_missing");
    fails += 1;
  } else ok("security_action_buttons");

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

  if (!css.includes("iu-privacy-providers-table-fit-v1")) {
    fail("providers_table_fit_marker_missing");
    fails += 1;
  } else ok("providers_table_fit_marker");
  if (!/@media \(max-width:\s*1024px\)[\s\S]{0,1200}iuInfoCenter__table:has\(>\s*thead th:nth-child\(4\)\)[\s\S]{0,400}table-layout:\s*fixed/.test(css)) {
    fail("providers_table_mobile_fixed_layout_missing");
    fails += 1;
  } else ok("providers_table_mobile_fixed_layout");
  const fitChunk = css.slice(css.indexOf("iu-privacy-providers-table-fit-v1"));
  const fitBlock = fitChunk.slice(0, 1800);
  if (/overflow-x:\s*auto/.test(fitBlock)) {
    fail("providers_table_must_not_use_overflow_x_auto");
    fails += 1;
  } else ok("providers_table_no_hscroll_workaround");
  if (/text-overflow:\s*ellipsis/.test(fitBlock)) {
    fail("providers_table_must_not_ellipsis");
    fails += 1;
  } else ok("providers_table_no_ellipsis");

  const menuNav = html.match(
    /<nav class="iuInfoCenter__grid"[^>]*>[\s\S]*?<\/nav>/
  );
  if (!menuNav) {
    fail("icentrum_menu_nav_missing");
    fails += 1;
  } else {
    ok("icentrum_menu_nav");
    const labels = Array.from(menuNav[0].matchAll(/class="iuInfoCenter__tileLabel">([^<]+)</g)).map(
      (x) => x[1]
    );
    const expected = [
      "Vytvořit ikonu na plochu",
      "O InfoUzel.cz",
      "O Silverovi – AI asistent",
      "Cookies a technické ukládání",
      "Zdroje dat",
      "Ukládání a ochrana vašich dat",
      "Nastavení zabezpečení",
      "Nastavení soukromí",
      "Záloha a obnova dat",
      "Statistiky a transparentnost",
      "GDPR a Všeobecné obchodní podmínky",
      "Provozovatel a kontakt",
    ];
    if (labels.join("|") !== expected.join("|")) {
      fail("icentrum_menu_order_mismatch:" + labels.join(">"));
      fails += 1;
    } else ok("icentrum_menu_order");
    if (labels.includes("Soukromí a zabezpečení")) {
      fail("icentrum_old_privacy_security_tile_label");
      fails += 1;
    } else ok("icentrum_security_tile_renamed");
    if (!/data-iu-info-section="privacy"[\s\S]{0,400}Nastavení zabezpečení/.test(menuNav[0])) {
      fail("icentrum_privacy_section_key_label_mismatch");
      fails += 1;
    } else ok("icentrum_privacy_section_key_preserved");
    if (!/data-iu-info-section="privacy-settings"[\s\S]{0,400}Nastavení soukromí/.test(menuNav[0])) {
      fail("icentrum_privacy_settings_key_label_mismatch");
      fails += 1;
    } else ok("icentrum_privacy_settings_key_preserved");
  }

  if (fails === 0) {
    console.log("iCENTRUM_CONTENT_TRUTH_GUARD=PASS");
  } else {
    console.error("iCENTRUM_CONTENT_TRUTH_GUARD=FAIL count=" + fails);
    process.exit(1);
  }
}

main();
