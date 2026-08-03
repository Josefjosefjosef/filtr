/**
 * NDIC DATEX v1 guard — fixtures only (no MobilityData network, no secrets).
 * Exit 0 = PASS, 1 = FAIL.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getNdicDatexV1Config, assertAllowedPullUrl, TMC_COUNTRY_CODE, TMC_LOCATION_TABLE_NUMBER, NDIC_ID_PREFIX } from "./ndic-datex-v1/config.mjs";
import { parseSafeXml } from "./ndic-datex-v1/safe-xml.mjs";
import { parseDatexSituationPublication } from "./ndic-datex-v1/parse-datex.mjs";
import { mapSituationRecordType } from "./ndic-datex-v1/category-map.mjs";
import { makeStableItemId, buildSituationIdentity } from "./ndic-datex-v1/identity.mjs";
import { classifyTrafficLifecycle, classifyChangeSignificance } from "./ndic-datex-v1/lifecycle.mjs";
import {
  parseTmcTablePayload,
  validateTmcTable,
  activateTmcTable,
  rollbackTmcTable,
  emptyTmcStore,
  tmcPublicMeta,
} from "./ndic-datex-v1/tmc-table.mjs";
import {
  buildStoredZip,
  parseTmcTableFromDownload,
  safeUnzipEntries,
} from "./ndic-datex-v1/tmc-zip.mjs";
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";
import { situationToFeedItem, situationsToFeedItems, mergeNdicRevisions, isPublishableNdicItem } from "./ndic-datex-v1/normalize-feed.mjs";
import { createFixtureDiscovery, createAuthenticatedPullDiscovery } from "./ndic-datex-v1/discovery-adapter.mjs";
import {
  processAndGate,
  tryAcquireLock,
  releaseLock,
  applyConditionalResult,
  createSyncState,
  atomicPublishDecision,
  sanityCheckSnapshot,
} from "./ndic-datex-v1/sync-core.mjs";
import { buildTrafficTitle } from "./ndic-datex-v1/title.mjs";
import { isOwnedByNdicDatexV1, composeFeedItemsWithForeignNamespaces } from "./iu-info-events-namespace-compose.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "ndic-datex-v1", "fixtures");

const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(`${name}: ${detail || "failed"}`);
}

function read(name) {
  return fs.readFileSync(path.join(FIX, name), "utf8");
}

function readJson(name) {
  return JSON.parse(read(name));
}

// --- config / flag default ---
{
  const c = getNdicDatexV1Config({});
  ok("flag_default_off", c.mode === "off" && !c.enabled, c.mode);
  ok("tmc_cc_ltn", c.tmcCountryCode === 2 && c.tmcLocationTableNumber === 25, `${c.tmcCountryCode}/${c.tmcLocationTableNumber}`);
  const shadow = getNdicDatexV1Config({ IU_NDIC_DATEX_V1_MODE: "shadow" });
  ok("shadow_mode", shadow.mode === "shadow", shadow.mode);
  const active = getNdicDatexV1Config({ IU_NDIC_DATEX_V1_MODE: "active" });
  ok("active_mode", active.enabled === true, String(active.enabled));
}

// --- SSRF host allowlist ---
{
  let threw = false;
  try {
    assertAllowedPullUrl("https://evil.example/x");
  } catch (e) {
    threw = e.code === "PULL_URL_HOST_DENIED";
  }
  ok("ssrf_deny_foreign_host", threw, "expected HOST_DENIED");
  threw = false;
  try {
    assertAllowedPullUrl("http://mobilitydata.rsd.cz/x");
  } catch (e) {
    threw = e.code === "PULL_URL_NOT_HTTPS";
  }
  ok("ssrf_deny_http", threw, "expected NOT_HTTPS");
  ok("ssrf_allow_mobilitydata", !!assertAllowedPullUrl("https://mobilitydata.rsd.cz/DataSource/Get?x=1"), "allow");
}

// --- XML safety ---
{
  let threw = false;
  try {
    parseSafeXml(read("unsafe-xxe.xml"));
  } catch (e) {
    threw = e.code === "XML_UNSAFE" || /forbidden|DOCTYPE|ENTITY/i.test(e.message);
  }
  ok("reject_xxe", threw, "expected XML_UNSAFE");
}

// --- DATEX parse base ---
{
  const parsed = parseDatexSituationPublication(read("snapshot-base.xml"));
  ok("parse_situations_ge3", parsed.situationCount >= 3, String(parsed.situationCount));
  const ids = parsed.situations.map((s) => s.situationId);
  ok("stable_situation_ids", ids.includes("CZ-NDIC-FIX-ACC-001") && ids.includes("CZ-NDIC-FIX-RW-002"), ids.join(","));
  const acc = parsed.situations.find((s) => s.situationId === "CZ-NDIC-FIX-ACC-001");
  ok("accident_type", acc && acc.records[0].recordType === "Accident", acc && acc.records[0].recordType);
  ok("tmc_ref_present", acc && acc.records[0].tmcRefs.length >= 1, "tmc");
  ok("coords_present", acc && acc.records[0].coordinates && acc.records[0].coordinates.lat === 49.2, "coords");
}

// --- category map + unknown type ---
{
  ok("map_accident", mapSituationRecordType("Accident").known === true, "accident");
  ok("map_unknown_safe", mapSituationRecordType("CompletelyNewFutureRecordType").known === false, "unknown");
  const unk = parseDatexSituationPublication(read("unknown-type.xml"));
  const tmc = parseTmcTablePayload(readJson("tmc-table-cc2-ltn25.json"));
  const { items, quarantine } = situationsToFeedItems(unk.situations, {
    tmcTable: tmc,
    nowIso: "2026-07-01T08:30:00+02:00",
  });
  ok("unknown_type_quarantine_or_safe", quarantine.length >= 1 || items.every((i) => i.categoryKnown === false), "quarantine");
  ok("unknown_type_no_throw", true, "no throw");
}

// --- identity / idempotence ---
{
  const parsed = parseDatexSituationPublication(read("snapshot-base.xml"));
  const id1 = buildSituationIdentity(parsed.situations[0]);
  const id2 = buildSituationIdentity(parsed.situations[0]);
  ok("identity_stable", id1.itemId === id2.itemId && id1.itemId.startsWith(NDIC_ID_PREFIX), id1.itemId);
  ok("makeStable_deterministic", makeStableItemId("CZ-NDIC-FIX-ACC-001") === makeStableItemId("CZ-NDIC-FIX-ACC-001"), "id");
}

// --- lifecycle ---
{
  const active = classifyTrafficLifecycle({
    validFrom: "2026-07-01T07:00:00+02:00",
    validTo: null,
    openEnded: true,
    nowIso: "2026-07-01T08:00:00+02:00",
  });
  ok("lifecycle_active", active.status === "aktivni" && active.publishable, active.status);
  const sched = classifyTrafficLifecycle({
    validFrom: "2026-08-10T08:00:00+02:00",
    validTo: "2026-08-20T18:00:00+02:00",
    nowIso: "2026-07-01T08:00:00+02:00",
  });
  ok("lifecycle_scheduled", sched.status === "naplanovano" && sched.publishable, sched.status);
  const ended = classifyTrafficLifecycle({
    validFrom: "2026-06-01T08:00:00+02:00",
    validTo: "2026-06-02T08:00:00+02:00",
    nowIso: "2026-07-01T08:00:00+02:00",
  });
  ok("lifecycle_ended", ended.status === "ukonceno" && !ended.publishable, ended.status);
  const soft = classifyTrafficLifecycle({
    validFrom: "2026-07-01T07:00:00+02:00",
    missingFromSnapshot: true,
    missingStreak: 1,
    nowIso: "2026-07-01T08:00:00+02:00",
  });
  ok("soft_missing_not_hard_end", soft.publishable === true && soft.softMissing === true, soft.lifecycle);
  const hardMiss = classifyTrafficLifecycle({
    validFrom: "2026-07-01T07:00:00+02:00",
    missingFromSnapshot: true,
    missingStreak: 3,
    nowIso: "2026-07-01T08:00:00+02:00",
  });
  ok("hard_missing_ends", hardMiss.publishable === false, hardMiss.lifecycle);
}

// --- TMC table ---
{
  const table = parseTmcTablePayload(readJson("tmc-table-cc2-ltn25.json"));
  const v = validateTmcTable(table);
  ok("tmc_valid_cc2_ltn25", v.ok === true, JSON.stringify(v));
  ok("tmc_reject_bad_cc", validateTmcTable({ ...table, countryCode: 99 }).ok === false, "cc");
  ok("tmc_reject_bad_ltn", validateTmcTable({ ...table, tableNumber: 1 }).ok === false, "ltn");
  ok("tmc_reject_empty", validateTmcTable({ ...table, points: {} }).ok === false, "empty");
  const store = emptyTmcStore();
  const a1 = activateTmcTable(store, table);
  ok("tmc_activate", a1.ok && a1.activated, a1.reason);
  const a2 = activateTmcTable(store, table);
  ok("tmc_idempotent_same", a2.ok && a2.activated === false, a2.reason);
  const next = { ...table, version: "fixture-11.1", points: { ...table.points, "303": { lcd: 303, name: "X" } } };
  const a3 = activateTmcTable(store, parseTmcTablePayload(next));
  ok("tmc_new_version", a3.ok && a3.activated, a3.reason);
  // failed import keeps previous
  const badStore = emptyTmcStore();
  activateTmcTable(badStore, table);
  const prevVer = badStore.active.version;
  const fail = activateTmcTable(badStore, { ...table, countryCode: 9, version: "bad" });
  ok("tmc_fail_keeps_old", fail.ok === false && badStore.active.version === prevVer, fail.reason);
  const rb = rollbackTmcTable(store);
  ok("tmc_rollback", rb.ok === true, rb.reason);
  const meta = tmcPublicMeta(store);
  ok("tmc_public_meta_no_points", meta.active && !meta.points && meta.pointCount > 0, JSON.stringify(meta));
}

// --- localization ---
{
  const table = parseTmcTablePayload(readJson("tmc-table-cc2-ltn25.json"));
  const loc = localizeFromTmc(
    [{ kind: "point", countryCode: 2, tableNumber: 25, locationCode: 101, direction: "positive" }],
    table,
    {}
  );
  ok("tmc_localize_name", /Brno/i.test(loc.locationLabel), loc.locationLabel);
  ok("tmc_localize_road", loc.roadNumber === "D1", loc.roadNumber);
  ok("tmc_missing_lcd", localizeFromTmc([{ locationCode: 99999, countryCode: 2, tableNumber: 25 }], table, {}).tmcMiss >= 1, "miss");
  ok("national_fallback", localizeFromTmc([], null, {}).trust === "national_fallback", "fallback");
}

// --- titles ---
{
  const t = buildTrafficTitle({ labelCs: "Dopravní nehoda", roadNumber: "D1", locationLabel: "Brno-centrum", direction: "kladný směr" });
  ok("title_shape", /^Dopravní nehoda —/.test(t) && /D1/.test(t), t);
}

// --- normalize + merge revisions ---
{
  const tmc = parseTmcTablePayload(readJson("tmc-table-cc2-ltn25.json"));
  const base = parseDatexSituationPublication(read("snapshot-base.xml"));
  const { items: baseItems } = situationsToFeedItems(base.situations, {
    tmcTable: tmc,
    nowIso: "2026-07-01T08:30:00+02:00",
  });
  ok("base_publishable_ge2", baseItems.filter(isPublishableNdicItem).length >= 2, String(baseItems.length));
  const acc = baseItems.find((i) => /ACC-001/.test(i.sourceSituationId));
  ok("attr_ndic", acc && acc.attribution === "Zdroj: NDIC", acc && acc.attribution);
  ok("attr_full", acc && /NDIC/.test(acc.attributionFull), acc && acc.attributionFull);
  ok("no_partnership_wording", acc && !/partner|spolupráci s ŘSD|schváleno ŘSD|oficiální služba ŘSD/i.test(JSON.stringify(acc)), "partnership");

  const upd = parseDatexSituationPublication(read("snapshot-update.xml"));
  const { items: updItems } = situationsToFeedItems(upd.situations, {
    tmcTable: tmc,
    nowIso: "2026-07-01T09:30:00+02:00",
    firstSeenMap: new Map(baseItems.map((i) => [i.id, i.firstSeenByInfoUzel])),
  });
  const merged = mergeNdicRevisions(baseItems, updItems, { nowIso: "2026-07-01T09:30:00+02:00" });
  ok("update_same_id", merged.stats.updated >= 1, JSON.stringify(merged.stats));
  ok("no_duplicate_cards", new Set(merged.items.map((i) => i.id)).size === merged.items.length, "dupes");
  const sameAgain = mergeNdicRevisions(merged.items, merged.items, { nowIso: "2026-07-01T09:35:00+02:00" });
  ok("idempotent_reprocess", sameAgain.stats.unchanged >= 1 || sameAgain.items.length === merged.items.length, JSON.stringify(sameAgain.stats));

  const cancel = parseDatexSituationPublication(read("snapshot-cancel.xml"));
  const { items: cancelItems } = situationsToFeedItems(cancel.situations, {
    tmcTable: tmc,
    nowIso: "2026-07-01T10:30:00+02:00",
  });
  ok("cancelled_not_publishable", cancelItems.every((i) => i.status !== "zruseno" || !i.publishable) || cancelItems.length === 0, "cancel");
  // cancelled goes to quarantine list or non-publishable
  const cancelAll = cancel.situations.map((s) => situationToFeedItem(s, { tmcTable: tmc, nowIso: "2026-07-01T10:30:00+02:00" }));
  ok("cancel_status", cancelAll.some((i) => i.status === "zruseno" && i.publishable === false), "zruseno");
}

// --- change significance ---
{
  const a = { title: "A", status: "aktivni", validTo: null, roadNumber: "D1" };
  const b = { title: "A", status: "aktivni", validTo: "2026-07-01T12:00:00Z", roadNumber: "D1" };
  ok("significant_validTo", classifyChangeSignificance(a, b).significant === true, "validTo");
  ok("new_is_significant", classifyChangeSignificance(null, a).kind === "new", "new");
}

// --- locks / conditional / atomic publish ---
{
  const lock = { locked: false, runId: null, startedAt: null, expiresAt: null };
  const a = tryAcquireLock(lock, { ttlMs: 60000, runId: "r1" });
  const b = tryAcquireLock(lock, { ttlMs: 60000, runId: "r2" });
  ok("single_flight", a.ok && !b.ok, "lock");
  releaseLock(lock, "r1");
  ok("lock_release", tryAcquireLock(lock, { runId: "r3" }).ok, "r3");

  const sync = createSyncState("fixture");
  const r304 = applyConditionalResult({ status: 304, headers: {}, body: null }, sync);
  ok("http_304", r304.action === "not_modified" && sync.status === "not_modified", r304.action);

  const decShadow = atomicPublishDecision({
    mode: "shadow",
    validationOk: true,
    suspicious: false,
    candidateSnapshot: { items: [1] },
    lastKnownGood: { items: [] },
  });
  ok("shadow_no_publish", decShadow.publish === false, decShadow.reason);

  const sanity = sanityCheckSnapshot(10, 1);
  ok("sanity_drop", sanity.ok === false && sanity.alarms.some((a) => a.code === "SUSPICIOUS_DROP"), "drop");
}

// --- discovery fixture + auth header not in URL ---
async function discoveryChecks() {
  const disc = createFixtureDiscovery([{ name: "snapshot-base.xml", xml: read("snapshot-base.xml") }]);
  ok("fixture_list", (await disc.listLatest()).length === 1, "list");
  const body = await disc.fetchBody("snapshot-base.xml");
  ok("fixture_body", body.status === 200 && /SituationPublication/.test(body.body), "body");
  let authThrew = false;
  try {
    createAuthenticatedPullDiscovery({ url: "https://mobilitydata.rsd.cz/x", user: "", pass: "" });
  } catch (e) {
    authThrew = e.code === "PULL_CREDS_MISSING";
  }
  ok("auth_requires_creds", authThrew, "creds");
}

// --- processAndGate with mocked legal (bypass file if needed) ---
{
  const tmc = parseTmcTablePayload(readJson("tmc-table-cc2-ltn25.json"));
  // Gate may fail if legal registry not yet rebuilt — still must not throw
  let threw = false;
  let result;
  try {
    result = processAndGate(read("snapshot-base.xml"), {
      tmcTable: tmc,
      nowIso: "2026-07-01T08:30:00+02:00",
      prevItems: [],
      legalRegistry: {
        gate: { enforceHard: true },
        entries: [],
      },
      sourceRegistry: { entries: [{ id: "ndic", productionActive: false, productionApproved: false, legalStatus: "review" }] },
    });
  } catch (e) {
    threw = true;
  }
  ok("process_no_throw_gate_fail", !threw && result && result.gate.gateOk === false, "gate");
}

// --- namespace ownership helpers ---
{
  const item = { id: NDIC_ID_PREFIX + "x", sourceId: "ndic", adapterOwner: "ndic-datex-v1" };
  ok("namespace_owned", isOwnedByNdicDatexV1(item) === true, "owned");
  const composed = composeFeedItemsWithForeignNamespaces(
    [item, { id: "ie-chmi-v2-1", sourceId: "chmi", capV2: {} }],
    [{ id: "ie-other-1", sourceId: "szdc" }]
  );
  ok(
    "namespace_preserve_ndic_and_chmi",
    composed.some((i) => i.id === item.id) && composed.some((i) => i.id === "ie-chmi-v2-1") && composed.some((i) => i.id === "ie-other-1"),
    composed.map((i) => i.id).join(",")
  );
}

// --- no raw TMC / secrets in public meta ---
{
  const store = emptyTmcStore();
  activateTmcTable(store, parseTmcTablePayload(readJson("tmc-table-cc2-ltn25.json")));
  const pub = JSON.stringify(tmcPublicMeta(store));
  ok("public_meta_no_lcd_dump", !/"101"/.test(pub) && !/Brno-centrum/.test(pub), pub);
}

// --- TMC ZIP (fixture) + bomb / path guards ---
{
  const json = read("tmc-table-cc2-ltn25.json");
  const zip = buildStoredZip([{ name: "tmc-table.json", data: json }]);
  const fromZip = parseTmcTableFromDownload(zip);
  ok("tmc_zip_json_roundtrip", validateTmcTable(fromZip).ok === true, "zip-json");
  ok("tmc_zip_points", Object.keys(fromZip.points || {}).length >= 3, String(Object.keys(fromZip.points || {}).length));

  let bomb = false;
  try {
    // Claim huge uncompressed size vs tiny payload
    const evil = Buffer.from(zip);
    // local header uncomp size at offset 22
    evil.writeUInt32LE(0x3fffffff, 22);
    safeUnzipEntries(evil);
  } catch (e) {
    bomb = e && (e.code === "TMC_ZIP_RATIO" || e.code === "TMC_ZIP_ENTRY_TOO_LARGE" || e.code === "TMC_ZIP_BOMB");
  }
  ok("tmc_zip_bomb_reject", bomb, "bomb");

  let trav = false;
  try {
    const bad = buildStoredZip([{ name: "../evil.json", data: "{}" }]);
    safeUnzipEntries(bad);
  } catch (e) {
    trav = e && e.code === "TMC_ZIP_BAD_PATH";
  }
  ok("tmc_zip_path_traversal_reject", trav, "path");
}

// --- secret contract names (static; never read secret values) ---
{
  const cfgSrc = fs.readFileSync(path.join(__dirname, "ndic-datex-v1", "config.mjs"), "utf8");
  const wfSrc = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "update-ndic-datex-v1.yml"), "utf8");
  const syncSrc = fs.readFileSync(path.join(__dirname, "ndic-datex-v1-prod-sync.mjs"), "utf8");
  const datexNames = ["IU_NDIC_PULL_URL", "IU_NDIC_PULL_USER", "IU_NDIC_PULL_PASS", "IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID"];
  const tmcNames = ["IU_NDIC_TMC_PULL_URL", "IU_NDIC_TMC_PULL_USER", "IU_NDIC_TMC_PULL_PASS"];
  for (const n of datexNames) {
    ok("secret_contract_datex_" + n, cfgSrc.includes(n) && wfSrc.includes(n), n);
  }
  for (const n of tmcNames) {
    ok("secret_contract_tmc_" + n, cfgSrc.includes(n) && wfSrc.includes(n), n);
  }
  ok("secret_contract_tmc_optional_fallback", /IU_NDIC_TMC_PULL_USER \|\| pullUser/.test(cfgSrc), "fallback");
  ok("default_mode_off", getNdicDatexV1Config({}).mode === "off", "mode");
  ok("prod_sync_uses_zip_parser", /parseTmcTableFromDownload/.test(syncSrc), "zip-parser");
  ok("no_authorization_console", !/console\.(log|info|debug|error).*Authorization/i.test(syncSrc), "no-auth-log");
}

// --- empty / damaged docs ---
{
  let emptyThrew = false;
  try {
    parseDatexSituationPublication("");
  } catch (e) {
    emptyThrew = e.code === "XML_EMPTY" || /empty/i.test(e.message);
  }
  ok("empty_xml_reject", emptyThrew, "empty");
  let badThrew = false;
  try {
    parseDatexSituationPublication("<not-closed");
  } catch (_) {
    badThrew = true;
  }
  ok("damaged_xml_reject", badThrew, "damaged");
}

await discoveryChecks();

if (fails.length) {
  console.log("FAIL " + fails.length);
  for (const f of fails) console.log(" - " + f);
  process.exit(1);
}
console.log(
  "PASS ndic-datex-v1-guard checks=" +
    [
      "config",
      "ssrf",
      "xml",
      "parse",
      "category",
      "identity",
      "lifecycle",
      "tmc",
      "localize",
      "title",
      "normalize",
      "locks",
      "discovery",
      "namespace",
    ].length
);
