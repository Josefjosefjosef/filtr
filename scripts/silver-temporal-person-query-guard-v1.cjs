#!/usr/bin/env node
"use strict";
const path = require("path");
const shared = require("./silver-calendar-query-intent-routing-v1-shared.cjs");
const REPORT = path.join(__dirname, "silver-temporal-person-query-guard-v1-report.json");
function main() {
  const cases = shared.filterFamilies(shared.buildCorpusV1(320), [
    "kdy_jsem_mel",
    "co_jsem_resil",
    "s_kym_jsem_byl",
    "minuly_mesic",
    "pred_tydnem",
    "vcera_dopoledne",
    "pristi_tyden",
    "temporal_ambiguity",
    "person_ambiguity"
  ]);
  const res = shared.runAudit("silver_temporal_person_query_v1", cases, REPORT);
  process.exit(shared.printHeader("silver_temporal_person_query_v1", res.report, 95) ? 0 : 1);
}
if (require.main === module) main();
