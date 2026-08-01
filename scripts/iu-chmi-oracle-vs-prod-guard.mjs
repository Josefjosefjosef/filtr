#!/usr/bin/env node
/**
 * Guard: CHMI product-stream inventory + production vs expected rebuild invariants.
 *
 * Offline (default CI): wiring + geo Praha alias + smog fixture chain + no last-6-only.
 * Live (IU_CHMI_ORACLE_LIVE=1): cold-start rebuild must match production card IDs/count.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyTerritoryOnsetLedgerToFeed,
  buildTerritoryOnsetLedgerFromOrderedDocuments,
} from "./chmi-cap-v2/territory-onset-ledger.mjs";
import { isPublishableChmiItem, normalizeCapInstant } from "./chmi-cap-v2/normalize-feed.mjs";
import { ONSET_LEDGER_RECENT_PER_STREAM } from "./chmi-cap-v2/revision-chain-history.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const prodSync = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs"), "utf8");
const discovery = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2/discovery-adapter.mjs"), "utf8");
const geoBuild = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2/build-geo-registry.mjs"), "utf8");
const geoJson = JSON.parse(fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2/data/geo-registry.json"), "utf8"));

ok("window_ge_16", ONSET_LEDGER_RECENT_PER_STREAM >= 16, String(ONSET_LEDGER_RECENT_PER_STREAM));
ok("no_sole_listRecent_6", !/listRecentForOnsetLedger\(\s*6\s*\)/.test(prodSync));
ok("references_traversal", /resolveReferenceChainEntries/.test(prodSync));
ok("persistent_ledger_merge", /mergeOnsetLedgersPreferPrimary/.test(prodSync));
ok("epoch_clears_onset_ledger", /openEndedOrpOnset\s*=\s*\{\s*\}/.test(prodSync));
ok("no_unused_split_import", !/splitOpenEndedByPriorTerritoryOnset/.test(prodSync));
ok("select_latest_per_stream", /selectLatestPerProductStream/.test(discovery));
ok("praha_alias_1100_to_1000_build", /aliases\["1100"\]\s*=\s*"1000"/.test(geoBuild));
ok("praha_alias_in_registry", geoJson.aliases && geoJson.aliases["1100"] === "1000");

// Smog fixture chain still three segments
const FIX = path.join(REPO, "scripts/fixtures/chmi-cap-v2");
const chain = [
  "alert-smog-oustecky-301116-1312.xml",
  "alert-smog-oustecky-310929-1125.xml",
  "alert-smog-expand-praha-sc-1317.xml",
  "alert-smog-expand-pardubicky-1429.xml",
].map((name) => ({
  xml: fs.readFileSync(path.join(FIX, name), "utf8"),
  sourceUrl: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/" + name,
  name,
}));
const nowIso = "2026-07-31T15:00:00.000Z";
const built = buildTerritoryOnsetLedgerFromOrderedDocuments(chain, { nowIso });
const headItems = (built.itemsByStep[3] || []).filter((i) => isPublishableChmiItem(i));
const split = applyTerritoryOnsetLedgerToFeed([], headItems, built.ledger, { nowIso });
const smog = (split.items || []).filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || ""));
ok("smog_segments_3", smog.length === 3, String(smog.length));
const byVf = Object.fromEntries(smog.map((i) => [normalizeCapInstant(i.validFrom), (i.region.orpIds || []).length]));
ok("usti_16", byVf[normalizeCapInstant("2026-07-30T13:12:59+02:00")] === 16, JSON.stringify(byVf));
ok("praha_27", byVf[normalizeCapInstant("2026-07-31T13:17:45+02:00")] === 27, JSON.stringify(byVf));
ok("pard_30", byVf[normalizeCapInstant("2026-07-31T14:29:29+02:00")] === 30, JSON.stringify(byVf));

if (process.env.IU_CHMI_ORACLE_LIVE === "1") {
  const { createOpendataActiveStreamsDiscovery } = await import("./chmi-cap-v2/discovery-adapter.mjs");
  const { createGeoRegistry } = await import("./chmi-cap-v2/geo-registry.mjs");
  const { processCapDocuments } = await import("./chmi-cap-v2/sync-core.mjs");
  const { latestRevisionForThread } = await import("./chmi-cap-v2/revisions.mjs");
  const { mergeFeedItemsById, revisionsToFeed } = await import("./chmi-cap-v2/normalize-feed.mjs");
  const { mergeOnsetHistoryEntries, resolveReferenceChainEntries } = await import(
    "./chmi-cap-v2/revision-chain-history.mjs"
  );

  const discoveryLive = createOpendataActiveStreamsDiscovery();
  const latest = await discoveryLive.listLatest();
  const streams = [...new Set(latest.map((x) => x.productKey))].sort();
  ok("live_streams_only_50_70", streams.join(",") === "50,70", streams.join(","));

  const docs = [];
  for (const e of latest) {
    const resp = await discoveryLive.fetchBody(e.url, {});
    if (resp.status === 200 && resp.body) docs.push({ xml: resp.body, sourceUrl: e.url, name: e.name, mtime: e.mtime });
  }
  const listed = discoveryLive.getLastListed();
  const recent = discoveryLive.listRecentForOnsetLedger(ONSET_LEDGER_RECENT_PER_STREAM);
  const histEntries = mergeOnsetHistoryEntries(recent, resolveReferenceChainEntries(docs, listed));
  const histDocs = [];
  for (const e of histEntries) {
    const hit = docs.find((d) => d.sourceUrl === e.url);
    if (hit) {
      histDocs.push(hit);
      continue;
    }
    const resp = await discoveryLive.fetchBody(e.url, {});
    if (resp.status === 200 && resp.body) histDocs.push({ xml: resp.body, sourceUrl: e.url, name: e.name, mtime: e.mtime });
  }

  const now = new Date().toISOString();
  const processed = processCapDocuments(docs, { registry: createGeoRegistry(), receivedAt: now });
  const tids = [...new Set(processed.report.revisions.map((r) => r.alert_thread_id))];
  const revs = tids.map((tid) => latestRevisionForThread(processed.store, tid)).filter(Boolean);
  let expected = mergeFeedItemsById(revisionsToFeed(revs, { nowIso: now })).filter(isPublishableChmiItem);
  const ledgerBuilt = buildTerritoryOnsetLedgerFromOrderedDocuments(histDocs, { nowIso: now, seedLedger: {} });
  expected = (applyTerritoryOnsetLedgerToFeed([], expected, ledgerBuilt.ledger, { nowIso: now }).items || []).filter(
    isPublishableChmiItem
  );

  // Prefer live production site; fall back to Pages mirror.
  let prod = null;
  for (const url of [
    "https://infouzel.cz/projects/data/info_events/feed.json",
    "https://josefjosefjosef.github.io/filtr/projects/data/info_events/feed.json",
  ]) {
    try {
      prod = await (await fetch(url, { cache: "no-store" })).json();
      if (prod) break;
    } catch (_) {}
  }
  const prodItems = ((prod && prod.items) || []).filter((i) => i && i.sourceId === "chmi" && isPublishableChmiItem(i));
  const expIds = new Set(expected.map((i) => i.id));
  const prodIds = new Set(prodItems.map((i) => i.id));
  ok("live_count_match", expected.length === prodItems.length, `${expected.length}!=${prodItems.length}`);
  ok("live_missing_id_0", [...expIds].every((id) => prodIds.has(id)), [...expIds].filter((id) => !prodIds.has(id)).join(","));
  ok("live_extra_id_0", [...prodIds].every((id) => expIds.has(id)), [...prodIds].filter((id) => !expIds.has(id)).join(","));
  ok("live_no_holice_card", !prodItems.some((i) => /^Riziko požárů — Holice$/i.test(i.title || "")));
  // Smog count is dynamic from official CAP — must match cold-start, never a hardcoded incident size.
  const smogExp = expected.filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || "")).length;
  const smogProd = prodItems.filter((i) => /smogov/i.test((i.capV2 && i.capV2.event) || "")).length;
  ok("live_smog_matches_oracle", smogExp === smogProd, `${smogExp}!=${smogProd}`);
}

if (fails.length) {
  console.error("IU_CHMI_ORACLE_VS_PROD_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_ORACLE_VS_PROD_GUARD=PASS");
