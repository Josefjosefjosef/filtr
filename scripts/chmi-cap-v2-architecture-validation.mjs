/**
 * CHMI CAP v2 — independent architecture closeout validation.
 * Exit 0 = ARCHITECTURE_CLOSEOUT_PASS, 1 = FAIL.
 *
 * Covers: no fixed bulletin-count limits, multi-stream discovery, lifecycle,
 * dedupe, geography, fail-safe, stress (up to 200 synthetic bulletins),
 * regression guards against silent truncation / incomplete healthy.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { performance } from "perf_hooks";
import {
  capProductKeyFromUrl,
  selectLatestPerProductStream,
  resolveDiscoveryAdapter,
} from "./chmi-cap-v2/discovery-adapter.mjs";
import { parseCapAlertXml } from "./chmi-cap-v2/parse-cap.mjs";
import { assembleActiveStateFromOrderedDocuments, groupListedByProductStream } from "./chmi-cap-v2/lifecycle.mjs";
import { mergeFeedItemsById, revisionsToFeed, summarizeAlertLocality } from "./chmi-cap-v2/normalize-feed.mjs";
import { processCapDocuments, atomicPublishDecision, suspiciousDrop } from "./chmi-cap-v2/sync-core.mjs";
import { createGeoRegistry, mapHazardGeography } from "./chmi-cap-v2/geo-registry.mjs";
import { buildCapIdentity } from "./chmi-cap-v2/identity.mjs";
import { getChmiCapV2Config } from "./chmi-cap-v2/config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const fails = [];
const evidence = [];

function ok(name, cond, detail) {
  if (!cond) fails.push(`${name}: ${detail || "failed"}`);
  else evidence.push(`PASS ${name}`);
}

function makeCapXml(opts) {
  const {
    product = "50",
    seq = "001",
    sent = "2026-07-29T12:00:00+02:00",
    msgType = "Alert",
    status = "Actual",
    references = "",
    infos = [{ event: "Test", severity: "Moderate", orps: ["6203"], expires: "2026-12-31T23:59:00+02:00" }],
  } = opts;
  const identifier = `2.49.0.0.203.0.CZ.ARCH.${product}.${seq}`;
  const infoXml = infos
    .map((inf) => {
      const areas = (inf.orps || ["6203"])
        .map(
          (code) =>
            `<area><areaDesc>ORP ${code}</areaDesc><geocode><valueName>CISORP</valueName><value>${code}</value></geocode></area>`
        )
        .join("");
      return `<info>
    <language>cs</language>
    <category>Met</category>
    <event>${inf.event}</event>
    <urgency>Expected</urgency>
    <severity>${inf.severity || "Moderate"}</severity>
    <certainty>Likely</certainty>
    <onset>${inf.onset || sent}</onset>
    <expires>${inf.expires || ""}</expires>
    <headline>${inf.event}</headline>
    <description>${inf.description || inf.event}</description>
    <instruction>${inf.instruction || "Sledujte vývoj."}</instruction>
    ${areas}
  </info>`;
    })
    .join("\n");
  const refs = references ? `<references>${references}</references>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${identifier}</identifier>
  <sender>chmi@chmi.cz</sender>
  <sent>${sent}</sent>
  <status>${status}</status>
  <msgType>${msgType}</msgType>
  <scope>Public</scope>
  ${refs}
  ${infoXml}
</alert>`;
}

function listedForStreams(streamCount, filesPerStream = 3) {
  const listed = [];
  let t = 1_000_000;
  for (let s = 1; s <= streamCount; s++) {
    const product = String(10 + s);
    for (let f = 1; f <= filesPerStream; f++) {
      t += 1000;
      const name = `alert_cap_${product}_${String(f).padStart(6, "0")}.xml`;
      listed.push({
        url: `https://opendata.chmi.cz/meteorology/weather/alerts/cap/${name}`,
        mtime: t,
      });
    }
  }
  return listed;
}

// --- 1) Source forensic: no fixed bulletin-count discovery limit ---
{
  const discSrc = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2/discovery-adapter.mjs"), "utf8");
  const syncSrc = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs"), "utf8");
  const wfSrc = fs.readFileSync(path.join(REPO, ".github/workflows/update-chmi-cap-v2.yml"), "utf8");
  ok("no_slice_maxfiles", !/\.slice\(\s*0\s*,\s*maxFiles\s*\)/.test(discSrc), "slice(0,maxFiles)");
  ok("no_maxfiles_env", !/IU_CHMI_CAP_V2_MAX_FILES/.test(discSrc + syncSrc + wfSrc), "MAX_FILES env");
  ok("no_maxCapMessagesPerRun", !/maxCapMessagesPerRun/.test(fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2/config.mjs"), "utf8")), "dead maxCapMessages");
  ok("discovery_selection_streams", /latest_per_product_stream/.test(discSrc), "selection marker");
  ok("sync_fixedLimit_false", /fixedLimit:\s*false/.test(syncSrc), "fixedLimit");
  const resolved = resolveDiscoveryAdapter({}, { kind: "opendata_active_streams" });
  ok("resolve_active_streams", resolved.type === "opendata_active_streams" && resolved.selection === "latest_per_product_stream", resolved.type);
}

// --- 2) selectLatestPerProductStream: 1 / 2 / 5 / 10 streams ---
{
  for (const n of [1, 2, 5, 10]) {
    const listed = listedForStreams(n, 4);
    const selected = selectLatestPerProductStream(listed);
    ok(`streams_${n}_count`, selected.length === n, `got ${selected.length}`);
    const keys = new Set(selected.map((x) => x.productKey));
    ok(`streams_${n}_unique`, keys.size === n, [...keys].join(","));
    // newest file per stream (padStart 000004)
    ok(
      `streams_${n}_newest`,
      selected.every((x) => /_000004\.xml$/.test(x.name)),
      selected.map((x) => x.name).join("|")
    );
  }
  // Unknown new product auto-discovered (no whitelist)
  const withNew = listedForStreams(2, 1).concat([
    { url: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_99_999999.xml", mtime: 9e12 },
  ]);
  const sel = selectLatestPerProductStream(withNew);
  ok("new_product_99_discovered", sel.some((x) => x.productKey === "99"), JSON.stringify(sel.map((x) => x.productKey)));
}

// --- 3) Lifecycle Alert → Update → Cancel within a stream ---
{
  const alertXml = makeCapXml({
    product: "50",
    seq: "A1",
    sent: "2026-07-29T10:00:00+02:00",
    msgType: "Alert",
    infos: [{ event: "Silné bouřky", severity: "Moderate", orps: ["6203"], expires: "2026-07-30T00:00:00+02:00" }],
  });
  const alert = parseCapAlertXml(alertXml);
  const updateXml = makeCapXml({
    product: "50",
    seq: "A2",
    sent: "2026-07-29T12:00:00+02:00",
    msgType: "Update",
    references: `chmi@chmi.cz,${alert.identifier},${alert.sent}`,
    infos: [
      {
        event: "Silné bouřky",
        severity: "Severe",
        orps: ["6203", "6216", "1000"],
        expires: "2026-07-31T00:00:00+02:00",
      },
    ],
  });
  const cancelXml = makeCapXml({
    product: "50",
    seq: "A3",
    sent: "2026-07-29T14:00:00+02:00",
    msgType: "Cancel",
    references: `chmi@chmi.cz,${alert.identifier},${alert.sent}`,
    infos: [{ event: "Silné bouřky", severity: "Severe", orps: ["6203"], expires: "2026-07-29T14:00:00+02:00" }],
  });

  // Frozen receivedAt — expires 2026-07-31T00:00+02 must still be active under this clock.
  const frozenNow = "2026-07-30T15:00:00.000Z";
  const afterUpdate = assembleActiveStateFromOrderedDocuments(
    [
      { xml: alertXml, sourceUrl: "a1" },
      { xml: updateXml, sourceUrl: "a2" },
    ],
    { receivedAt: frozenNow }
  );
  ok("lifecycle_update_active", afterUpdate.activeCount === 1, String(afterUpdate.activeCount));
  ok(
    "lifecycle_update_severity",
    afterUpdate.active[0] && afterUpdate.active[0].capV2.severity === "Severe",
    afterUpdate.active[0] && afterUpdate.active[0].capV2.severity
  );
  ok(
    "lifecycle_update_areas_union",
    afterUpdate.active[0] && (afterUpdate.active[0].region.orpIds || []).length >= 3,
    afterUpdate.active[0] && JSON.stringify(afterUpdate.active[0].region.orpIds)
  );
  ok("lifecycle_same_thread", afterUpdate.threadCount === 1, String(afterUpdate.threadCount));

  const afterCancel = assembleActiveStateFromOrderedDocuments(
    [
      { xml: alertXml, sourceUrl: "a1" },
      { xml: updateXml, sourceUrl: "a2" },
      { xml: cancelXml, sourceUrl: "a3" },
    ],
    { receivedAt: frozenNow }
  );
  ok("lifecycle_cancel_not_active", afterCancel.activeCount === 0, String(afterCancel.activeCount));
  ok("lifecycle_cancel_status", afterCancel.cancelled.length >= 1 || afterCancel.items.every((i) => i.status !== "aktivni"), "still active");
}

// --- 4) Expiry ---
{
  const expired = makeCapXml({
    product: "70",
    seq: "E1",
    sent: "2026-06-01T10:00:00+02:00",
    infos: [{ event: "Stav sucha", severity: "Moderate", orps: ["4212"], expires: "2026-06-02T00:00:00+02:00" }],
  });
  const assembled = assembleActiveStateFromOrderedDocuments([{ xml: expired, sourceUrl: "e1" }], {
    receivedAt: "2026-07-29T12:00:00.000Z",
  });
  ok("expiry_not_active", assembled.activeCount === 0, String(assembled.activeCount));
}

// --- 5) Parallel streams with distinct hazards ---
{
  const docs = [];
  for (const [product, event, orp] of [
    ["50", "Vysoké teploty", "1000"],
    ["70", "Stav sucha", "4212"],
    ["80", "Riziko požárů", "6203"],
  ]) {
    docs.push({
      xml: makeCapXml({
        product,
        seq: "P1",
        sent: "2026-07-29T12:00:00+02:00",
        infos: [{ event, severity: "Moderate", orps: [orp], expires: "2026-12-31T23:59:00+02:00" }],
      }),
      sourceUrl: `stream-${product}`,
    });
  }
  const multi = assembleActiveStateFromOrderedDocuments(docs);
  ok("parallel_streams_all_active", multi.activeCount === 3, String(multi.activeCount));
  const events = new Set(multi.active.map((i) => i.capV2.event));
  ok("parallel_events_distinct", events.size === 3, [...events].join("|"));
}

// --- 6) Dedup: same event different severity/validity/area must NOT merge ---
{
  const a = makeCapXml({
    product: "50",
    seq: "D1",
    sent: "2026-07-29T10:00:00+02:00",
    infos: [{ event: "Vysoké teploty", severity: "Moderate", orps: ["1000"], expires: "2026-08-15T00:00:00+02:00" }],
  });
  const b = makeCapXml({
    product: "50",
    seq: "D2",
    sent: "2026-07-29T10:00:00+02:00",
    infos: [{ event: "Vysoké teploty", severity: "Severe", orps: ["6203"], expires: "2026-08-20T00:00:00+02:00" }],
  });
  // Different identifiers → different threads → two items
  const both = assembleActiveStateFromOrderedDocuments(
    [
      { xml: a, sourceUrl: "d1" },
      { xml: b, sourceUrl: "d2" },
    ],
    { receivedAt: "2026-07-29T12:00:00.000Z" }
  );
  ok("dedupe_keeps_distinct", both.activeCount === 2, String(both.activeCount));
}

// --- 7) Dedup mergeFeedItemsById unions areas for same id ---
{
  const base = {
    id: "ie-chmi-v2-same",
    title: "Test — Praha",
    status: "aktivni",
    region: { orpIds: ["orp:1000"], orpNames: ["Praha"], precise: true },
    capV2: { event: "Test", geo: { links: [{ orpId: "orp:1000", orpName: "Praha", krajName: "Hlavní město Praha" }], totalAreas: 1, mappedAreas: 1 } },
    updatedAt: "2026-07-29T10:00:00.000Z",
  };
  const other = {
    ...base,
    title: "Test — Brno",
    region: { orpIds: ["orp:6203"], orpNames: ["Brno"], precise: true },
    capV2: { event: "Test", geo: { links: [{ orpId: "orp:6203", orpName: "Brno", krajName: "Jihomoravský kraj" }], totalAreas: 1, mappedAreas: 1 } },
    updatedAt: "2026-07-29T11:00:00.000Z",
  };
  const merged = mergeFeedItemsById([base, other]);
  ok("dedupe_merge_one", merged.length === 1, String(merged.length));
  ok("dedupe_merge_union_orps", (merged[0].region.orpIds || []).length === 2, JSON.stringify(merged[0].region.orpIds));
}

// --- 8) Geography completeness on multi-ORP ---
{
  const xml = makeCapXml({
    product: "50",
    seq: "G1",
    infos: [
      {
        event: "Vysoké teploty",
        severity: "Moderate",
        orps: ["1000", "6203", "3213", "4212", "2101"],
        expires: "2026-12-31T23:59:00+02:00",
      },
    ],
  });
  const alert = parseCapAlertXml(xml);
  const id = buildCapIdentity(alert);
  const reg = createGeoRegistry();
  const geo = mapHazardGeography(id.hazards[0], reg);
  ok("geo_all_mapped", geo.links.length === 5 && geo.quarantine.length === 0, JSON.stringify({ links: geo.links.length, q: geo.quarantine }));
  const loc = summarizeAlertLocality(geo.links, geo.displayNames);
  ok("geo_summary_not_single_town", loc.extraAreaCount >= 1 || /ORP|kraj|dalš/i.test(loc.summary), loc.summary);
  const feed = revisionsToFeed(
    processCapDocuments(
      [{ xml, sourceUrl: "https://opendata.chmi.cz/meteorology/weather/alerts/cap/alert_cap_50_geo.xml" }],
      { config: getChmiCapV2Config({ IU_CHMI_CAP_V2_MODE: "active" }), registry: reg }
    ).report.revisions
  );
  ok("geo_orpNames_published", feed[0] && (feed[0].region.orpNames || []).length >= 5, JSON.stringify(feed[0] && feed[0].region.orpNames));
}

// --- 9) Silent truncation removed — CAP_TRUNCATED throws ---
{
  const manyAreas = Array.from({ length: 3 }, (_, i) => `<area><areaDesc>A${i}</areaDesc><geocode><valueName>CISORP</valueName><value>6203</value></geocode></area>`).join("");
  // Force tiny limit
  let threw = false;
  try {
    parseCapAlertXml(
      makeCapXml({
        product: "50",
        seq: "T1",
        infos: [{ event: "X", severity: "Moderate", orps: ["1000", "6203", "3213"], expires: "2026-12-31T23:59:00+02:00" }],
      }),
      { limits: { maxAreasPerInfo: 1 } }
    );
  } catch (e) {
    threw = e && e.code === "CAP_TRUNCATED";
  }
  ok("truncation_fails_hard", threw, "expected CAP_TRUNCATED");
}

// --- 10) Fail-safe publish gate ---
{
  const lastGood = { items: [{ id: "old", sourceId: "chmi", status: "aktivni" }], chmiItems: [{ id: "old" }] };
  const bad = atomicPublishDecision({
    mode: "active",
    validationOk: false,
    suspicious: false,
    candidateSnapshot: { items: [], chmiItems: [] },
    lastKnownGood: lastGood,
  });
  ok("failsafe_no_publish", bad.publish === false, bad.reason);
  ok("failsafe_keeps_last_good", bad.activeSnapshot === lastGood, "snapshot lost");
  ok("suspicious_drop_detect", suspiciousDrop(10, 2) === true, "not suspicious");
}

// --- 11) Stress: 20 / 50 / 100 / 200 bulletins across many streams ---
{
  for (const total of [20, 50, 100, 200]) {
    const streamCount = Math.min(20, Math.max(1, Math.floor(total / 5)));
    const perStream = Math.ceil(total / streamCount);
    const docs = [];
    let n = 0;
    const t0 = performance.now();
    const mem0 = process.memoryUsage().heapUsed;
    for (let s = 0; s < streamCount; s++) {
      const product = String(20 + s);
      for (let f = 0; f < perStream && n < total; f++, n++) {
        const hour = 10 + (f % 10);
        docs.push({
          xml: makeCapXml({
            product,
            seq: `S${s}F${f}`,
            sent: `2026-07-29T${String(hour).padStart(2, "0")}:00:00+02:00`,
            msgType: f === 0 ? "Alert" : "Update",
            references:
              f === 0
                ? ""
                : `chmi@chmi.cz,2.49.0.0.203.0.CZ.ARCH.${product}.S${s}F0,2026-07-29T10:00:00+02:00`,
            infos: [
              {
                event: `Jev ${product}`,
                severity: f % 2 ? "Severe" : "Moderate",
                orps: ["1000", "6203"],
                expires: "2026-12-31T23:59:59+02:00",
              },
            ],
          }),
          sourceUrl: `stress-${product}-${f}`,
        });
      }
    }
    // Sort by sent ascending for lifecycle
    docs.sort((a, b) => {
      const sa = ((a.xml.match(/<sent>([^<]+)<\/sent>/) || [])[1] || "");
      const sb = ((b.xml.match(/<sent>([^<]+)<\/sent>/) || [])[1] || "");
      return sa.localeCompare(sb);
    });
    const assembled = assembleActiveStateFromOrderedDocuments(docs);
    const ms = performance.now() - t0;
    const mem1 = process.memoryUsage().heapUsed;
    const memDeltaMb = (mem1 - mem0) / (1024 * 1024);
    ok(`stress_${total}_active_ge_streams`, assembled.activeCount >= streamCount * 0.5, `active=${assembled.activeCount} streams=${streamCount}`);
    ok(`stress_${total}_no_loss_threads`, assembled.threadCount >= streamCount, `threads=${assembled.threadCount}`);
    ok(`stress_${total}_perf_under_30s`, ms < 30000, String(ms));
    ok(`stress_${total}_mem_delta_under_400mb`, memDeltaMb < 400, String(memDeltaMb));
    evidence.push(`stress_${total}: docs=${docs.length} active=${assembled.activeCount} threads=${assembled.threadCount} ms=${ms.toFixed(1)} memDeltaMb=${memDeltaMb.toFixed(1)}`);
  }
}

// --- 12) groupListedByProductStream has no fixed limit ---
{
  const listed = listedForStreams(15, 10);
  const grouped = groupListedByProductStream(listed, capProductKeyFromUrl);
  ok("group_all_streams", grouped.size === 15, String(grouped.size));
  ok(
    "group_all_files",
    [...grouped.values()].reduce((n, a) => n + a.length, 0) === 150,
    "file count"
  );
  const heads = selectLatestPerProductStream(listed);
  ok("heads_eq_stream_count", heads.length === 15, String(heads.length));
}

// --- 13) PRODUCTION_VERIFIED script invariants (static) ---
{
  const verifySrc = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-verify.mjs"), "utf8");
  ok("prod_verify_compares_streams", /selectLatestPerProductStream/.test(verifySrc), "no stream compare");
  ok("prod_verify_compares_events", /missing_event/.test(verifySrc), "no event diff");
  ok("prod_verify_city_filters", /CITY_FILTER_MISS/.test(verifySrc), "no city filter");
  ok("prod_verify_not_merge_only", /productionActive/.test(verifySrc) && /expectedActive/.test(verifySrc), "weak verify");
  ok("prod_verify_fail_exit", /process\.exit\(1\)/.test(verifySrc), "no fail exit");
}

// --- 14) Guard: incomplete must not be healthy ---
{
  const syncSrc = fs.readFileSync(path.join(REPO, "scripts/chmi-cap-v2-prod-sync.mjs"), "utf8");
  ok("sync_incomplete_fail", /INCOMPLETE_STREAM_CACHE/.test(syncSrc), "missing incomplete alarm");
  ok("sync_ok_requires_not_failed", /diagnostics\.status !== "failed"/.test(syncSrc), "ok ignores failed");
  ok("sync_no_publish_incomplete", /completenessOk/.test(syncSrc), "no completenessOk gate");
  ok("sync_snapshot_contract_field", /snapshotContractValid/.test(syncSrc), "missing snapshotContractValid");
}

// --- 15) CHMI product-supersession A+B regression (original error class) ---
{
  const {
    oracleProductSupersessionActive,
    diagnosticStrictUnexpiredInclusion,
    validateStreamSnapshotContract,
  } = await import("./chmi-cap-v2/snapshot-contract.mjs");
  const FIX = path.join(REPO, "scripts/fixtures/chmi-cap-v2");
  const olderXml = fs.readFileSync(path.join(FIX, "stream-ab-older.xml"), "utf8");
  const onlyAXml = fs.readFileSync(path.join(FIX, "stream-ab-newer-only-a.xml"), "utf8");
  const keepBXml = fs.readFileSync(path.join(FIX, "stream-ab-newer-cancel-a-keep-b.xml"), "utf8");
  const older = parseCapAlertXml(olderXml);
  const onlyA = parseCapAlertXml(onlyAXml);
  const keepB = parseCapAlertXml(keepBXml);

  const docsOnlyA = [
    { xml: olderXml, sourceUrl: "older", name: "older", sent: older.sent, mtime: 1, _alert: older },
    { xml: onlyAXml, sourceUrl: "onlyA", name: "onlyA", sent: onlyA.sent, mtime: 2, _alert: onlyA },
  ];
  const oracleA = oracleProductSupersessionActive(docsOnlyA, Date.parse("2026-07-29T13:00:00+02:00"));
  ok("supersession_ab_to_a_only", oracleA.active.length === 1 && oracleA.active[0].event === "jev a", JSON.stringify(oracleA.active));
  ok("supersession_b_ended_by_omission", !oracleA.active.some((h) => h.event === "jev b"), "B still active");

  const strict = diagnosticStrictUnexpiredInclusion(older, onlyA);
  ok("strict_inclusion_flags_b_drop", strict.some((v) => /jev b/i.test(v.event)), JSON.stringify(strict));

  const v = validateStreamSnapshotContract({
    productKey: "50",
    historyDocsAsc: docsOnlyA,
    mtimeHeadDoc: docsOnlyA[1],
    asOfMs: Date.parse("2026-07-29T13:00:00+02:00"),
  });
  ok("supersession_contract_pass_for_chmi_model", v.ok === true, JSON.stringify(v.alarms));

  // Never HEALTHY with only A if we incorrectly claim lifecycle kept B
  const lifeWrongExpectation = assembleActiveStateFromOrderedDocuments([
    { xml: olderXml, sourceUrl: "older" },
    { xml: onlyAXml, sourceUrl: "onlyA" },
  ]);
  // Lifecycle on same thread replaces → only A (same as supersession for single thread)
  ok(
    "lifecycle_same_thread_also_only_a",
    lifeWrongExpectation.active.every((i) => /jev a/i.test((i.capV2 && i.capV2.event) || i.title)) &&
      !lifeWrongExpectation.active.some((i) => /jev b/i.test((i.capV2 && i.capV2.event) || i.title)),
    String(lifeWrongExpectation.activeCount)
  );

  const docsKeepB = [
    { xml: olderXml, sourceUrl: "older", name: "older", sent: older.sent, mtime: 1, _alert: older },
    { xml: keepBXml, sourceUrl: "keepB", name: "keepB", sent: keepB.sent, mtime: 3, _alert: keepB },
  ];
  const oracleB = oracleProductSupersessionActive(docsKeepB, Date.parse("2026-07-29T15:00:00+02:00"));
  ok("supersession_cancel_a_keep_b", oracleB.active.length === 1 && oracleB.active[0].event === "jev b", JSON.stringify(oracleB.active));
  ok("supersession_a_gone", !oracleB.active.some((h) => h.event === "jev a"), "A still active");

  // Cross-stream: A in 50, B in 70 — both heads must survive
  const a50 = makeCapXml({
    product: "50",
    seq: "X1",
    infos: [{ event: "Jev A", severity: "Moderate", orps: ["1000"], expires: "2026-12-31T23:59:59+02:00" }],
  });
  const b70 = makeCapXml({
    product: "70",
    seq: "X1",
    infos: [{ event: "Jev B", severity: "Severe", orps: ["6203"], expires: "2026-12-31T23:59:59+02:00" }],
  });
  const multi = assembleActiveStateFromOrderedDocuments([
    { xml: a50, sourceUrl: "s50" },
    { xml: b70, sourceUrl: "s70" },
  ]);
  ok("cross_stream_keeps_both", multi.activeCount === 2, String(multi.activeCount));
}

// --- 16) Stress 300 docs (beyond prior 200) ---
{
  const total = 300;
  const streamCount = 20;
  const perStream = Math.ceil(total / streamCount);
  const docs = [];
  let n = 0;
  const t0 = performance.now();
  for (let s = 0; s < streamCount; s++) {
    const product = String(30 + s);
    for (let f = 0; f < perStream && n < total; f++, n++) {
      docs.push({
        xml: makeCapXml({
          product,
          seq: `S${s}F${f}`,
          sent: `2026-07-29T${String(10 + (f % 10)).padStart(2, "0")}:00:00+02:00`,
          msgType: f === 0 ? "Alert" : "Update",
          references:
            f === 0 ? "" : `chmi@chmi.cz,2.49.0.0.203.0.CZ.ARCH.${product}.S${s}F0,2026-07-29T10:00:00+02:00`,
          infos: [
            {
              event: `Jev ${product}`,
              severity: "Moderate",
              orps: ["1000", "6203"],
              expires: "2026-12-31T23:59:59+02:00",
            },
          ],
        }),
        sourceUrl: `stress300-${product}-${f}`,
      });
    }
  }
  const assembled = assembleActiveStateFromOrderedDocuments(docs);
  const ms = performance.now() - t0;
  ok("stress_300_threads", assembled.threadCount >= streamCount, String(assembled.threadCount));
  ok("stress_300_perf", ms < 45000, String(ms));
  evidence.push(`stress_300: docs=${docs.length} active=${assembled.activeCount} threads=${assembled.threadCount} ms=${ms.toFixed(1)}`);
}

if (fails.length) {
  console.error("CHMI_CAP_V2_ARCHITECTURE_CLOSEOUT=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}

console.log("CHMI_CAP_V2_ARCHITECTURE_CLOSEOUT=PASS");
console.log("evidence_count=" + evidence.length);
for (const line of evidence.filter((e) => e.startsWith("stress_") || e.startsWith("PASS streams_"))) {
  console.log(line);
}
process.exit(0);
