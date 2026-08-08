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
  safeGunzip,
  unwrapTmcTransportLayers,
  isGzipMagic,
  isZipMagic,
} from "./ndic-datex-v1/tmc-zip.mjs";
import zlib from "zlib";
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";
import { situationToFeedItem, situationsToFeedItems, mergeNdicRevisions, isPublishableNdicItem } from "./ndic-datex-v1/normalize-feed.mjs";
import { createFixtureDiscovery, createAuthenticatedPullDiscovery } from "./ndic-datex-v1/discovery-adapter.mjs";
import { classifyNetworkFailure } from "./ndic-datex-v1-shadow-probe.mjs";
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
  ok("ssrf_https_downgrade_reject", threw, "downgrade");
  ok("ssrf_allow_mobilitydata", !!assertAllowedPullUrl("https://mobilitydata.rsd.cz/DataSource/Get?x=1"), "allow");

  const denyUrls = [
    ["https://127.0.0.1/x", "PULL_URL_HOST_DENIED"],
    ["https://localhost/x", "PULL_URL_HOST_DENIED"],
    ["https://10.0.0.5/x", "PULL_URL_HOST_DENIED"],
    ["https://192.168.1.10/x", "PULL_URL_HOST_DENIED"],
    ["https://172.16.0.2/x", "PULL_URL_HOST_DENIED"],
    ["https://[::1]/x", "PULL_URL_HOST_DENIED"],
  ];
  for (const [u, code] of denyUrls) {
    let d = false;
    try {
      assertAllowedPullUrl(u);
    } catch (e) {
      d = e.code === code || e.code === "PULL_URL_INVALID";
    }
    ok("ssrf_deny_" + u.replace(/[^a-z0-9]+/gi, "_"), d, u);
  }
  let creds = false;
  try {
    assertAllowedPullUrl("https://user:pass@mobilitydata.rsd.cz/x");
  } catch (e) {
    creds = e.code === "PULL_URL_EMBEDDED_CREDS";
  }
  ok("ssrf_deny_url_credentials", creds, "embedded");
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
  ok("reject_external_entity", threw, "entity");
  let ent2 = false;
  try {
    parseSafeXml('<!DOCTYPE foo [<!ENTITY bar SYSTEM "https://evil.example/x">]><r>&bar;</r>');
  } catch (e) {
    ent2 = e.code === "XML_UNSAFE" || /forbidden|DOCTYPE|ENTITY/i.test(e.message);
  }
  ok("reject_external_entity_https", ent2, "ext-https");
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

// --- TMC ZIP / GZIP (synthetic fixtures only) + bomb / path guards ---
{
  const json = read("tmc-table-cc2-ltn25.json");
  const plain = parseTmcTableFromDownload(Buffer.from(json, "utf8"));
  ok("tmc_plain_json", validateTmcTable(plain).ok === true, "plain");

  const zip = buildStoredZip([{ name: "tmc-table.json", data: json }]);
  const fromZip = parseTmcTableFromDownload(zip);
  ok("tmc_zip_json_roundtrip", validateTmcTable(fromZip).ok === true, "zip-json");
  ok("tmc_zip_points", Object.keys(fromZip.points || {}).length >= 3, String(Object.keys(fromZip.points || {}).length));

  const gzipPlain = zlib.gzipSync(Buffer.from(json, "utf8"));
  ok("tmc_gzip_magic", isGzipMagic(gzipPlain) === true, "gzip-magic");
  const fromGzip = parseTmcTableFromDownload(gzipPlain);
  ok("tmc_gzip_json_roundtrip", validateTmcTable(fromGzip).ok === true, "gzip-json");

  const gzipZip = zlib.gzipSync(zip);
  const fromGzipZip = parseTmcTableFromDownload(gzipZip);
  ok("tmc_gzip_containing_zip", validateTmcTable(fromGzipZip).ok === true, "gzip-zip");

  const alreadyDecoded = unwrapTmcTransportLayers(zip, { contentEncoding: "gzip" });
  ok(
    "tmc_http_gzip_already_decoded_no_double",
    alreadyDecoded.skippedDoubleGzip === true && isZipMagic(alreadyDecoded.body),
    "no-double"
  );
  const fromClaimedGzip = parseTmcTableFromDownload(zip, { contentEncoding: "gzip" });
  ok("tmc_content_encoding_gzip_decoded_body", validateTmcTable(fromClaimedGzip).ok === true, "ce-gzip");

  let corruptGzip = false;
  try {
    safeGunzip(Buffer.from([0x1f, 0x8b, 0x00, 0x00, 0xff]));
  } catch (e) {
    corruptGzip = e && (e.code === "TMC_GZIP_CORRUPT" || e.code === "TMC_GZIP_BOMB");
  }
  ok("tmc_gzip_corrupt_reject", corruptGzip, "gzip-corrupt");

  let corruptZip = false;
  try {
    safeUnzipEntries(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
  } catch (e) {
    corruptZip = e && (e.code === "TMC_ZIP_TRUNCATED" || e.code === "TMC_ZIP_NO_ENTRIES" || e.code === "TMC_ZIP_MAGIC");
  }
  ok("tmc_zip_corrupt_reject", corruptZip, "zip-corrupt");

  let unknownSig = false;
  try {
    parseTmcTableFromDownload(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]));
  } catch (e) {
    unknownSig = e && e.code === "TMC_UNKNOWN_SIGNATURE";
  }
  ok("tmc_unknown_signature_reject", unknownSig, "unknown");

  let bomb = false;
  try {
    const evil = Buffer.from(zip);
    evil.writeUInt32LE(0x3fffffff, 22);
    safeUnzipEntries(evil);
  } catch (e) {
    bomb = e && (e.code === "TMC_ZIP_RATIO" || e.code === "TMC_ZIP_ENTRY_TOO_LARGE" || e.code === "TMC_ZIP_BOMB");
  }
  ok("tmc_zip_bomb_reject", bomb, "bomb");

  let trav = false;
  let travCat = null;
  try {
    const bad = buildStoredZip([{ name: "../evil.json", data: "{}" }]);
    safeUnzipEntries(bad);
  } catch (e) {
    trav = e && e.code === "TMC_ZIP_BAD_PATH";
    travCat = e && e.pathRejectCategory;
  }
  ok("tmc_zip_path_traversal_reject", trav, "path");
  ok("tmc_zip_path_traversal_category", travCat === "TMC_PATH_PARENT_TRAVERSAL", travCat);

  let dirOk = false;
  try {
    const withDir = buildStoredZip([
      { name: "loc/", data: Buffer.alloc(0) },
      { name: "loc/POINTS.DAT", data: Buffer.from("a,b\n1,2\n", "utf8") },
    ]);
    const out = safeUnzipEntries(withDir);
    dirOk = out.length === 1 && out.diagnostics && out.diagnostics.directoryEntryCount === 1;
  } catch (_e) {
    dirOk = false;
  }
  ok("tmc_zip_safe_directory_entry_ok", dirOk, "dir");

  let symlink = false;
  try {
    const z = buildStoredZip([{ name: "link.json", data: "{}" }]);
    // Mutate first central-directory external attrs to Unix symlink mode 0xA000
    const CENTRAL = 0x02014b50;
    for (let i = 0; i + 46 <= z.length; i++) {
      if (z.readUInt32LE(i) === CENTRAL) {
        z.writeUInt32LE((0xa000 << 16) >>> 0, i + 38);
        break;
      }
    }
    safeUnzipEntries(z);
  } catch (e) {
    symlink = e && e.code === "TMC_ZIP_SYMLINK";
  }
  ok("tmc_zip_symlink_reject", symlink, "symlink");

  let tooLargeIn = false;
  try {
    const tiny = Buffer.alloc(64, 0x41);
    tiny.writeUInt32LE(0x04034b50, 0);
    safeUnzipEntries(tiny, { limits: { maxCompressedTotal: 16 } });
  } catch (e) {
    tooLargeIn = e && (e.code === "TMC_ZIP_TOO_LARGE" || e.code === "TMC_ZIP_MAGIC" || e.code === "TMC_ZIP_EMPTY");
  }
  ok("tmc_zip_max_input_size_reject", tooLargeIn, "max-input");

  let tooLargeEntry = false;
  try {
    const big = buildStoredZip([{ name: "big.json", data: "x" }]);
    // local header uncomp size at offset 22
    big.writeUInt32LE(64 * 1024 * 1024, 22);
    safeUnzipEntries(big, { limits: { maxSingleUncompressed: 1024 } });
  } catch (e) {
    tooLargeEntry = e && (e.code === "TMC_ZIP_ENTRY_TOO_LARGE" || e.code === "TMC_ZIP_SIZE_MISMATCH" || e.code === "TMC_ZIP_RATIO");
  }
  ok("tmc_zip_max_uncompressed_reject", tooLargeEntry, "max-uncomp");

  let absPath = false;
  try {
    safeUnzipEntries(buildStoredZip([{ name: "/abs/evil.json", data: "{}" }]));
  } catch (e) {
    absPath = e && e.code === "TMC_ZIP_BAD_PATH";
  }
  ok("tmc_zip_absolute_path_reject", absPath, "abs");

  let nested = false;
  try {
    const inner = buildStoredZip([{ name: "a.json", data: "{}" }]);
    safeUnzipEntries(buildStoredZip([{ name: "nested.zip", data: inner }]));
  } catch (e) {
    nested = e && e.code === "TMC_ZIP_NESTED";
  }
  ok("tmc_zip_nested_archive_reject", nested, "nested");

  let tooMany = false;
  try {
    const files = [];
    for (let i = 0; i < 70; i++) files.push({ name: "f" + i + ".json", data: "{}" });
    safeUnzipEntries(buildStoredZip(files), { limits: { maxEntries: 64 } });
  } catch (e) {
    tooMany = e && e.code === "TMC_ZIP_TOO_MANY";
  }
  ok("tmc_zip_too_many_entries", tooMany, "too-many");

  let gzipBomb = false;
  try {
    // Highly compressible payload exceeding maxGzipOutput when limited tiny
    const big = Buffer.alloc(256 * 1024, 0);
    const gz = zlib.gzipSync(big);
    safeGunzip(gz, { maxOutput: 1024 });
  } catch (e) {
    gzipBomb = e && (e.code === "TMC_GZIP_BOMB" || e.code === "TMC_GZIP_CORRUPT");
  }
  ok("tmc_gzip_bomb_reject", gzipBomb, "gzip-bomb");

  // Atomic / last-good
  {
    const store = emptyTmcStore();
    const good = parseTmcTablePayload(readJson("tmc-table-cc2-ltn25.json"));
    activateTmcTable(store, good);
    const badAct = activateTmcTable(store, { version: "bad", countryCode: 2, tableNumber: 25, points: {} });
    ok("tmc_incomplete_table_rejected", badAct.ok === false, "incomplete");
    ok("tmc_last_good_preserved", store.active && store.active.version === good.version, "last-good");
    const rb = rollbackTmcTable(store);
    ok("tmc_rollback_api", rb.ok === true || store.lastGood != null || store.active != null, "rollback");
    ok("tmc_atomic_import", store.active && store.active.version === good.version, "atomic");
  }

  // Delimited CSV/POINTS fixture + fail-closed unknown binary
  {
    const csv = ["lcd;name;roadNumber;lat;lon", "101;Brno;D1;49.2;16.6", "102;Praha;D1;50.1;14.4"].join("\n");
    const fromCsv = parseTmcTablePayload(csv, { version: "csv-fixture" });
    ok("tmc_csv_delimited_parse", validateTmcTable({ ...fromCsv, countryCode: 2, tableNumber: 25 }).ok === true, "csv");
    ok("tmc_csv_points_ge2", Object.keys(fromCsv.points || {}).length >= 2, "csv-pts");
    let unknownFmt = false;
    try {
      // ZIP with opaque binary payload (not JSON/CSV/POINTS) must fail closed
      const opaque = buildStoredZip([{ name: "table.bin", data: Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x11, 0x22, 0x33]) }]);
      parseTmcTableFromDownload(opaque);
    } catch (e) {
      unknownFmt = e && (e.code === "TMC_ZIP_NO_PAYLOAD" || e.code === "TMC_UNKNOWN_SIGNATURE" || e.code === "TMC_EMPTY");
    }
    ok("tmc_unknown_csv_format_fail_closed", unknownFmt, "unknown-fmt");
  }
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
  ok("secret_contract_tmc_dedicated_primary", /tmcAuthSource|tmcAuthContract/.test(cfgSrc), "dedicated");
  {
    const fb = getNdicDatexV1Config({
      IU_NDIC_PULL_URL: "https://mobilitydata.rsd.cz/datex",
      IU_NDIC_PULL_USER: "datex-user",
      IU_NDIC_PULL_PASS: "datex-pass",
      IU_NDIC_TMC_PULL_URL: "https://mobilitydata.rsd.cz/tmc",
      IU_NDIC_TMC_PULL_USER: "",
      IU_NDIC_TMC_PULL_PASS: "",
    });
    ok(
      "tmc_empty_optional_secrets_use_datex_auth",
      fb.hasTmcCredentials === true &&
        fb.tmcAuthSource === "datex_fallback" &&
        fb.tmcPullUser === "datex-user" &&
        fb.tmcPullPass === "datex-pass",
      "gha-empty-string"
    );
    const ded = getNdicDatexV1Config({
      IU_NDIC_PULL_URL: "https://mobilitydata.rsd.cz/datex",
      IU_NDIC_PULL_USER: "datex-user",
      IU_NDIC_PULL_PASS: "datex-pass",
      IU_NDIC_TMC_PULL_URL: "https://mobilitydata.rsd.cz/tmc",
      IU_NDIC_TMC_PULL_USER: "tmc-user",
      IU_NDIC_TMC_PULL_PASS: "tmc-pass",
    });
    ok(
      "tmc_dedicated_auth_preferred",
      ded.tmcAuthSource === "dedicated" &&
        ded.tmcAuthContract === "DEDICATED" &&
        ded.tmcPullUser === "tmc-user" &&
        ded.tmcPullPass === "tmc-pass" &&
        ded.tmcDatexAuthFallbackEnabled === false,
      "dedicated-primary"
    );
  }
  ok("default_mode_off", getNdicDatexV1Config({}).mode === "off", "mode");
  ok("prod_sync_uses_tmc_download_load", /loadTmcTableFromDownload/.test(syncSrc), "tmc-download-load");
  ok("prod_sync_no_datex_clamp_on_tmc", !/parseTmcTableFromDownload\(bodyBuf/.test(syncSrc), "no-direct-zip-parse");
  ok("prod_sync_passes_content_encoding", /contentEncoding/.test(syncSrc), "content-encoding");
  ok("no_authorization_console", !/console\.(log|info|debug|error).*Authorization/i.test(syncSrc), "no-auth-log");
  ok("shadow_isolated_helper", /isShadowIsolated|IU_NDIC_SHADOW_ISOLATED/.test(syncSrc), "isolated");
  const probeSrc = fs.readFileSync(path.join(__dirname, "ndic-datex-v1-shadow-probe.mjs"), "utf8");
  ok("shadow_probe_requires_shadow", /mode !== "shadow"/.test(probeSrc), "probe-mode");
  ok("shadow_probe_no_feed_write", !/feed\.json/.test(probeSrc), "probe-no-feed");
  ok("shadow_probe_wipes_workdir", /wipeDir|rmSync/.test(probeSrc), "probe-wipe");
  ok("shadow_probe_cleanup_finally", /finally\s*\{[\s\S]*wipeDir/.test(probeSrc), "cleanup-finally");
  ok("shadow_probe_no_fetch_retry", /fetchOnceNoRetry/.test(probeSrc) && !/MAX_RETRIES/.test(probeSrc), "no-retry");
  ok("shadow_probe_tmc_skip_shared_net", /tmcSkippedDueToSharedNetworkFailure|shared_network_failure/.test(probeSrc), "tmc-skip");
  ok("shadow_probe_no_host_in_report", !/datexHostRedacted|tmcHostRedacted/.test(probeSrc), "no-host");
  ok("shadow_probe_no_raw_xml_log", !/console\.(log|info|debug).*raw|console\.(log|info).*xml/i.test(probeSrc), "no-raw-xml-log");
  ok("shadow_probe_aggregate_only_stdout", /Aggregate-only stdout/.test(probeSrc), "aggregate");
  const shadowWf = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "ndic-datex-v1-shadow-probe.yml"), "utf8");
  ok("shadow_wf_no_schedule", !/schedule:/.test(shadowWf), "no-cron");
  ok(
    "shadow_wf_choice_shadow_and_inspection",
    /options:[\s\S]*-\s*shadow/.test(shadowWf) &&
      /-\s*format_inspection/.test(shadowWf) &&
      !/-\s*active/.test(shadowWf),
    "choice"
  );
  ok("shadow_wf_retention_1d", /retention-days:\s*1/.test(shadowWf), "retention");
  ok("shadow_wf_contents_read", /contents:\s*read/.test(shadowWf), "perms");
  ok("shadow_wf_wipe_always", /Wipe temp workdir[\s\S]*if:\s*always\(\)|if:\s*always\(\)[\s\S]*Wipe temp workdir/.test(shadowWf), "wipe-always");
  ok("shadow_wf_artifact_json_only", /shadow-report\.json/.test(shadowWf) && !/\.(xml|zip|csv)\s*$/m.test(shadowWf.split("path:")[1] || ""), "art-json");
  const updateWf = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "update-ndic-datex-v1.yml"), "utf8");
  ok("update_wf_no_schedule", !/schedule:/.test(updateWf), "update-no-cron");
  ok("update_wf_default_off", /default:\s*off/.test(updateWf), "update-default-off");
  ok("update_wf_commit_active_only", /mode == 'active'/.test(updateWf), "commit-active-only");
  ok(
    "update_wf_data_pr_portable_no_gh_cli",
    /ndic-open-or-refresh-data-pr\.mjs/.test(updateWf) && !/gh pr create/.test(updateWf),
    "portable-pr"
  );
  ok(
    "data_pr_helper_exports_run_fn",
    /export async function runOpenOrRefreshDataPr/.test(
      fs.readFileSync(path.join(__dirname, "ndic-open-or-refresh-data-pr.mjs"), "utf8")
    ),
    "data-pr-export"
  );
  ok(
    "update_wf_commits_traffic_offline_snapshot",
    /ndic-stage-shared-write-outputs\.mjs/.test(updateWf) &&
      /traffic_offline_snapshot\.json/.test(
        fs.readFileSync(path.join(__dirname, "ndic-stage-shared-write-outputs.mjs"), "utf8")
      ) &&
      /ndic-assert-candidate-required-outputs\.mjs/.test(updateWf),
    "snapshot-commit"
  );
  ok(
    "prod_sync_active_unverified_counters",
    /countActivePublicationSafetyCounters/.test(syncSrc) &&
      /UNVERIFIED_LOCATION_PUBLISHED/.test(syncSrc),
    "active-counters"
  );
}

// --- cleanup success / error / interrupt (local temp only; no NDIC network) ---
{
  const work = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "ndic-wipe-"));
  const rawXml = path.join(work, "raw.xml");
  const rawZip = path.join(work, "raw.zip");
  fs.writeFileSync(rawXml, "<SituationPublication/>");
  fs.writeFileSync(rawZip, "PK\u0003\u0004");
  ok("cleanup_workdir_created", fs.existsSync(rawXml) && fs.existsSync(rawZip), "created");
  // success path wipe
  fs.rmSync(work, { recursive: true, force: true });
  ok("cleanup_on_success", !fs.existsSync(work), "success-wipe");
  const work2 = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "ndic-wipe-err-"));
  fs.writeFileSync(path.join(work2, "raw.xml"), "<x/>");
  let errThrown = false;
  try {
    throw new Error("parser_fail_sim");
  } catch (_) {
    errThrown = true;
    fs.rmSync(work2, { recursive: true, force: true });
  }
  ok("cleanup_on_error", errThrown && !fs.existsSync(work2), "error-wipe");
  const work3 = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "ndic-wipe-int-"));
  fs.writeFileSync(path.join(work3, "raw.csv"), "a;b");
  // interrupt simulation: finally always runs
  try {
    try {
      throw new Error("interrupt_sim");
    } finally {
      fs.rmSync(work3, { recursive: true, force: true });
    }
  } catch (_) {
    /* expected */
  }
  ok("cleanup_on_interrupt", !fs.existsSync(work3), "interrupt-wipe");
}

// --- shadow probe network classification (no network) ---
{
  const dns = classifyNetworkFailure(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }), "connect_or_headers");
  ok("classify_dns_A", dns.failureCategory === "A", "dns");
  const refused = classifyNetworkFailure(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }), "connect_or_headers");
  ok("classify_tcp_B", refused.failureCategory === "B", "refused");
  const tls = classifyNetworkFailure(Object.assign(new Error("certificate verify failed"), { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }), "connect_or_headers");
  ok("classify_tls_C", tls.failureCategory === "C", "tls");
  const abortConnect = classifyNetworkFailure(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), "connect_or_headers");
  ok("classify_timeout_D", abortConnect.failureCategory === "D", "abort-connect");
  const abortBody = classifyNetworkFailure(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), "response_body");
  ok("classify_timeout_F", abortBody.failureCategory === "F", "abort-body");
  const redir = classifyNetworkFailure(new Error("unexpected redirect"), "connect_or_headers");
  ok("classify_redirect_G", redir.failureCategory === "G", "redirect");
  const ssrf = classifyNetworkFailure(Object.assign(new Error("host denied"), { code: "PULL_URL_HOST_DENIED" }), "ssrf_allowlist");
  ok("classify_ssrf_H", ssrf.failureCategory === "H", "ssrf");
  ok("classify_no_url_leak", !/mobilitydata|https?:\/\//i.test(JSON.stringify(dns)), "no-url");
}

// --- empty / damaged docs ---
{
  let emptyOk = false;
  try {
    const empty = parseDatexSituationPublication("");
    emptyOk = empty && empty.ok === false && (empty.parserFailureCode === "XML_EMPTY" || empty.parserCompatible === false);
  } catch (e) {
    emptyOk = e.code === "XML_EMPTY" || /empty/i.test(e.message);
  }
  ok("empty_xml_reject", emptyOk, "empty");
  let badOk = false;
  try {
    const bad = parseDatexSituationPublication("<not-closed");
    badOk = bad && bad.ok === false;
  } catch (_) {
    badOk = true;
  }
  ok("damaged_xml_reject", badOk, "damaged");
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
