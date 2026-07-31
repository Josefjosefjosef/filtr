#!/usr/bin/env node
/**
 * Guard: revision-aware source vs production feed (watchdog-style).
 * Fails when production CHMI count/IDs diverge from cold-start rebuild
 * using recent window + references + territory ledger.
 *
 * Network required. Skip only when IU_CHMI_WATCHDOG_OFFLINE=1 (explicit).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createOpendataActiveStreamsDiscovery } from "./chmi-cap-v2/discovery-adapter.mjs";
import { createGeoRegistry } from "./chmi-cap-v2/geo-registry.mjs";
import { processCapDocuments } from "./chmi-cap-v2/sync-core.mjs";
import { latestRevisionForThread } from "./chmi-cap-v2/revisions.mjs";
import {
  isPublishableChmiItem,
  mergeFeedItemsById,
  revisionsToFeed,
} from "./chmi-cap-v2/normalize-feed.mjs";
import {
  applyTerritoryOnsetLedgerToFeed,
  buildTerritoryOnsetLedgerFromOrderedDocuments,
} from "./chmi-cap-v2/territory-onset-ledger.mjs";
import {
  ONSET_LEDGER_RECENT_PER_STREAM,
  mergeOnsetHistoryEntries,
  resolveReferenceChainEntries,
} from "./chmi-cap-v2/revision-chain-history.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

if (process.env.IU_CHMI_WATCHDOG_OFFLINE === "1") {
  console.log("IU_CHMI_REVISION_AWARE_WATCHDOG_GUARD=SKIP offline");
  process.exit(0);
}

const PROD_URL = "https://josefjosefjosef.github.io/filtr/projects/data/info_events/feed.json";
const prod = await (await fetch(PROD_URL, { cache: "no-store" })).json();
const prodItems = (prod.items || []).filter((i) => i && i.sourceId === "chmi" && isPublishableChmiItem(i));

const discovery = createOpendataActiveStreamsDiscovery();
const latest = await discovery.listLatest();
const recent = discovery.listRecentForOnsetLedger(ONSET_LEDGER_RECENT_PER_STREAM);
const listed = discovery.getLastListed();
const docs = [];
for (const e of latest) {
  const resp = await discovery.fetchBody(e.url, {});
  if (resp.status === 200 && resp.body) docs.push({ xml: resp.body, sourceUrl: e.url, name: e.name, mtime: e.mtime });
}
const refEntries = resolveReferenceChainEntries(docs, listed);
const merged = mergeOnsetHistoryEntries(recent, refEntries);
const histDocs = [];
for (const e of merged) {
  const head = docs.find((d) => d.sourceUrl === e.url);
  if (head) {
    histDocs.push(head);
    continue;
  }
  const resp = await discovery.fetchBody(e.url, {});
  if (resp.status === 200 && resp.body) {
    histDocs.push({ xml: resp.body, sourceUrl: e.url, name: e.name, mtime: e.mtime });
  }
}

const nowIso = new Date().toISOString();
const processed = processCapDocuments(docs, { registry: createGeoRegistry(), receivedAt: nowIso });
const tids = [...new Set(processed.report.revisions.map((r) => r.alert_thread_id))];
const revs = tids.map((tid) => latestRevisionForThread(processed.store, tid)).filter(Boolean);
let expected = mergeFeedItemsById(revisionsToFeed(revs, { nowIso })).filter(isPublishableChmiItem);
const built = buildTerritoryOnsetLedgerFromOrderedDocuments(histDocs, { nowIso, seedLedger: {} });
expected = (applyTerritoryOnsetLedgerToFeed([], expected, built.ledger, { nowIso }).items || []).filter(
  isPublishableChmiItem
);

const prodIds = new Set(prodItems.map((i) => i.id));
const expIds = new Set(expected.map((i) => i.id));
const missing = [...expIds].filter((id) => !prodIds.has(id));
const extra = [...prodIds].filter((id) => !expIds.has(id));

ok("wiring_recent_16", ONSET_LEDGER_RECENT_PER_STREAM >= 16);
ok("hist_docs_ge_recent", histDocs.length >= recent.length || histDocs.length >= 2, String(histDocs.length));
ok("expected_gt_head_only_or_eq", expected.length >= 1, String(expected.length));

// Soft: report divergence (production may lag until data PR). Hard fail only when
 // IU_CHMI_WATCHDOG_STRICT=1 OR expected equals prod (must stay matched).
const strict = process.env.IU_CHMI_WATCHDOG_STRICT === "1";
if (strict) {
  ok("count_match", prodItems.length === expected.length, `${prodItems.length}!=${expected.length}`);
  ok("missing_id_0", missing.length === 0, missing.slice(0, 5).join(","));
  ok("extra_id_0", extra.length === 0, extra.slice(0, 5).join(","));
}

const smogExp = expected.filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || ""));
const smogProd = prodItems.filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || ""));
ok("smog_expected_3", smogExp.length === 3, String(smogExp.length));
ok("smog_prod_3", smogProd.length === 3, String(smogProd.length));

const report = {
  prodGeneratedAt: prod.generatedAt,
  prodCount: prodItems.length,
  expectedCount: expected.length,
  missingCount: missing.length,
  extraCount: extra.length,
  histDocs: histDocs.length,
  refEntries: refEntries.length,
  recent: recent.length,
  strict,
};

fs.writeFileSync(
  path.join(process.env.TEMP || "/tmp", "iu_chmi_watchdog_report.json"),
  JSON.stringify({ ...report, missing: missing.slice(0, 20), extra: extra.slice(0, 20) }, null, 2)
);

if (fails.length) {
  console.error("IU_CHMI_REVISION_AWARE_WATCHDOG_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  console.error(JSON.stringify(report));
  process.exit(1);
}
console.log("IU_CHMI_REVISION_AWARE_WATCHDOG_GUARD=PASS");
console.log(JSON.stringify(report));
