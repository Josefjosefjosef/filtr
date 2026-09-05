#!/usr/bin/env node
/**
 * Phase 8A — legal documentation semantic guard.
 * Run: npm run iu-info-center-legal-content-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(REPO, "projects", "index.html");
const INFO_CENTER = path.join(REPO, "assets", "iu-info-center.js");

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
  const ic = read(INFO_CENTER);
  const blob = html + "\n" + ic;
  let fails = 0;

  if (!html.includes('data-iu-legal-content="phase8a-v1"')) {
    fail("legal_content_marker_missing");
    fails += 1;
  } else ok("legal_content_marker");

  if (!html.includes("Správce osobních údajů")) {
    fail("controller_label_missing");
    fails += 1;
  } else ok("controller_label");

  if (!html.includes("InfoUzel Analytics") || !html.includes("ads.infouzel.cz")) {
    fail("analytics_ads_recipients_missing");
    fails += 1;
  } else ok("analytics_ads_recipients");

  if (!html.includes('data-iu-legal-truth="international-transfers"')) {
    fail("international_transfers_section_missing");
    fails += 1;
  } else ok("international_transfers_section");

  if (!html.includes("Mezinárodní předávání dat")) {
    fail("international_transfers_heading_missing");
    fails += 1;
  } else ok("international_transfers_heading");

  if (!html.includes("automatická doba smazání") && !html.includes("automatickou dobu smazání")) {
    fail("analytics_retention_truth_missing");
    fails += 1;
  } else ok("analytics_retention_truth");

  if (/Nic neopouští tvoje zařízení/i.test(blob)) {
    fail("absolute_zero_network_claim");
    fails += 1;
  } else ok("no_absolute_zero_network");

  if (/žádná data neopouštějí/i.test(blob) || /nic se nikam neposílá/i.test(blob)) {
    fail("absolute_no_data_leaves_claim");
    fails += 1;
  } else ok("no_absolute_no_data_leaves");

  if (/InfoUzel synchronizuje/i.test(blob) && !/nesynchronizuje/i.test(blob)) {
    fail("false_cloud_sync_claim");
    fails += 1;
  } else ok("no_false_cloud_sync");

  if (/žádné třetí strany/i.test(blob) || /bez třetích stran/i.test(blob)) {
    fail("false_no_third_parties_claim");
    fails += 1;
  } else ok("no_false_no_third_parties");

  if (/<strong>\s*Zprávy\s*<\/strong>/i.test(html) || /<strong>\s*Sport\s*<\/strong>/i.test(html)) {
    fail("historical_module_in_legal_inventory");
    fails += 1;
  } else ok("no_historical_modules");

  if (!ic.includes('DOC_VERSION = "2.0"')) {
    fail("doc_version_not_20");
    fails += 1;
  } else ok("doc_version_20");

  const dataSources = html.match(
    /id="iuInfoCenterDetailDataSources"[\s\S]*?<\/article>/
  );
  if (!dataSources) {
    fail("data_sources_section_missing");
    fails += 1;
  } else {
    const ds = dataSources[0];
    if (/docs\/data-sources\/legal-review-info-panel\.md/.test(ds)) {
      fail("data_sources_exposes_internal_doc_path");
      fails += 1;
    } else ok("data_sources_no_internal_doc_path");
    if (!/Open-Meteo/.test(ds) || !/ČHMÚ|CHMI/.test(ds)) {
      fail("data_sources_missing_weather_providers");
      fails += 1;
    } else ok("data_sources_weather_providers");
    if (!/NDIC/.test(ds) || !/dopravniinfo\.cz/.test(ds)) {
      fail("data_sources_missing_traffic_provider");
      fails += 1;
    } else ok("data_sources_traffic_provider");
    if (!/Česká národní banka|ČNB/.test(ds) || !/CoinGecko/.test(ds)) {
      fail("data_sources_missing_panel_providers");
      fails += 1;
    } else ok("data_sources_panel_providers");
    if (/placeholder_only|verified_requires_attribution/.test(ds)) {
      fail("data_sources_exposes_internal_status_tokens");
      fails += 1;
    } else ok("data_sources_no_internal_status_tokens");
    if (!/Informační panel/.test(ds)) {
      fail("data_sources_missing_info_panel_section");
      fails += 1;
    } else ok("data_sources_info_panel_section");
  }

  if (fails === 0) {
    console.log("iCENTRUM_LEGAL_CONTENT_GUARD=PASS");
  } else {
    console.error("iCENTRUM_LEGAL_CONTENT_GUARD=FAIL count=" + fails);
    process.exit(1);
  }
}

main();
