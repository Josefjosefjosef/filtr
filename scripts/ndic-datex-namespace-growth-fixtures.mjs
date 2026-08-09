#!/usr/bin/env node
/**
 * Offline DATEX namespace/structure + growth/health + TMC ZIP metadata fixtures.
 * No NDIC network. Exit 0 = PASS.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  scanDatexStructure,
  pickRootNamespaceUri,
  isApplicationDatexNamespace,
  chunkBoundaryProbe,
} from "./ndic-datex-v1/datex-structure.mjs";
import { parseDatexSituationPublication } from "./ndic-datex-v1/parse-datex.mjs";
import {
  clampDatexMaxResponseBytes,
  limitUtilization,
  createLifecycleTracker,
  noteFetchSuccess,
  noteParseSuccess,
  noteFailure,
  isRetryableShadowError,
  retryDelayMs,
  computeHealthState,
  DATEX_LIMIT_MIN_BYTES,
  DATEX_LIMIT_MAX_BYTES,
  DATEX_LIMIT_DEFAULT_BYTES,
  RETRY_POLICY,
} from "./ndic-datex-v1/growth-health.mjs";
import {
  buildStoredZip,
  safeUnzipEntries,
  inspectZipDeclaredMetadata,
  DEFAULT_ZIP_LIMITS,
  TMC_ZIP_LIMITS_PREV,
} from "./ndic-datex-v1/tmc-zip.mjs";
import { DATEX_MAX_RESPONSE_BYTES, DATEX_PREV_RESPONSE_BYTES } from "./ndic-datex-v1/bounded-fetch.mjs";

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(ROOT, "ndic-datex-v1", "fixtures", "snapshot-base.xml");
const baseXml = fs.readFileSync(FIX, "utf8");

// --- namespace selection ---
{
  const xsiFirst = `<?xml version="1.0"?>
<d2LogicalModel xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://datex2.eu/schema/2/2_0" modelBaseVersion="2">
  <payloadPublication xsi:type="SituationPublication">
    <situation id="S1" version="1"><situationRecord xsi:type="Accident" id="R1" version="1">
      <situationRecordCreationTime>2026-01-01T00:00:00Z</situationRecordCreationTime>
      <validity><validityStatus>active</validityStatus></validity>
    </situationRecord></situation>
  </payloadPublication>
</d2LogicalModel>`;
  ok(
    "ns_ignores_xsi_first",
    pickRootNamespaceUri(xsiFirst) === "http://datex2.eu/schema/2/2_0",
    pickRootNamespaceUri(xsiFirst)
  );
  ok("ns_is_application", isApplicationDatexNamespace("http://datex2.eu/schema/2/2_0"), "app");
  ok("ns_xsi_not_app", !isApplicationDatexNamespace("http://www.w3.org/2001/XMLSchema-instance"), "xsi");

  const prefixed = `<?xml version="1.0"?>
<d2:d2LogicalModel xmlns:d2="http://datex2.eu/schema/2/2_0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" modelBaseVersion="2">
  <d2:payloadPublication xsi:type="SituationPublication">
    <d2:situation id="S1" version="1">
      <d2:situationRecord xsi:type="Accident" id="R1" version="1">
        <d2:situationRecordCreationTime>2026-01-01T00:00:00Z</d2:situationRecordCreationTime>
        <d2:validity><d2:validityStatus>active</d2:validityStatus></d2:validity>
      </d2:situationRecord>
    </d2:situation>
  </d2:payloadPublication>
</d2:d2LogicalModel>`;
  const prefScan = scanDatexStructure(prefixed);
  ok("ns_prefixed_root", prefScan.rootLocalName === "d2logicalmodel", prefScan.rootLocalName);
  ok("ns_prefixed_uri", prefScan.rootNamespaceUri === "http://datex2.eu/schema/2/2_0", String(prefScan.rootNamespaceUri));
  ok("ns_prefixed_situations", prefScan.candidateSituationElementCount === 1, String(prefScan.candidateSituationElementCount));
  const prefParsed = parseDatexSituationPublication(prefixed);
  ok("ns_prefixed_parse", prefParsed.parserCompatible === true && prefParsed.recordCount >= 1, String(prefParsed.parserFailureCode));

  const unknownNs = `<root xmlns="http://example.invalid/not-datex"><situation id="S1" version="1"><situationRecord id="R1" version="1"><x/></situationRecord></situation></root>`;
  const unk = parseDatexSituationPublication(unknownNs);
  ok("ns_unknown_reject", unk.parserCompatible === false, unk.parserFailureCode);

  const baseScan = scanDatexStructure(baseXml);
  ok("fixture_root_ns", baseScan.rootNamespaceUri === "http://datex2.eu/schema/2/2_0", baseScan.rootNamespaceUri);
  ok("fixture_not_xsi", baseScan.rootNamespaceUri !== "http://www.w3.org/2001/XMLSchema-instance", "xsi");
  ok("fixture_situations", baseScan.candidateSituationElementCount >= 3, String(baseScan.candidateSituationElementCount));
  ok("fixture_records", baseScan.candidateSituationRecordElementCount >= 3, String(baseScan.candidateSituationRecordElementCount));

  const parsedBase = parseDatexSituationPublication(baseXml);
  ok("fixture_parser_compatible", parsedBase.parserCompatible === true, parsedBase.parserFailureCode);
  ok("fixture_records_nonzero", parsedBase.recordCount > 0, String(parsedBase.recordCount));
  ok("fixture_namespace_returned", isApplicationDatexNamespace(parsedBase.namespace), parsedBase.namespace);

  ok("zero_records_incompatible", parseDatexSituationPublication(`<?xml version="1.0"?>
<d2LogicalModel xmlns="http://datex2.eu/schema/2/2_0" modelBaseVersion="2">
  <payloadPublication xsi:type="SituationPublication" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  </payloadPublication>
</d2LogicalModel>`).parserCompatible === false, "empty");

  ok(
    "chunk_boundary",
    chunkBoundaryProbe(baseXml, [17, 41, 100, 250]),
    "chunks"
  );
}

// --- growth / clamp / health / retry ---
{
  ok("limit_default", DATEX_LIMIT_DEFAULT_BYTES === DATEX_MAX_RESPONSE_BYTES, String(DATEX_LIMIT_DEFAULT_BYTES));
  ok("clamp_ok", clampDatexMaxResponseBytes(40 * 1024 * 1024).ok === true, "40");
  ok("clamp_unbounded", clampDatexMaxResponseBytes("unlimited").ok === false, "unlim");
  ok("clamp_nan", clampDatexMaxResponseBytes("abc").ok === false, "nan");
  ok("clamp_below", clampDatexMaxResponseBytes(1024).errorCode === "LIMIT_BELOW_MIN", "min");
  ok("clamp_above", clampDatexMaxResponseBytes(200 * 1024 * 1024).errorCode === "LIMIT_ABOVE_MAX", "max");
  ok("clamp_min_bound", DATEX_LIMIT_MIN_BYTES === 16 * 1024 * 1024, "minb");
  ok("clamp_max_bound", DATEX_LIMIT_MAX_BYTES === 96 * 1024 * 1024, "maxb");

  const util = limitUtilization(72 * 1024 * 1024, DATEX_MAX_RESPONSE_BYTES);
  ok("util_pct", util.utilizationPercent > 80 && util.utilizationPercent < 100, String(util.utilizationPercent));
  ok("util_warn", util.warningThresholdsHit.includes(70) && util.warningThresholdsHit.includes(80), JSON.stringify(util.warningThresholdsHit));
  ok("util_prev", util.previousHardCapBytes === DATEX_PREV_RESPONSE_BYTES, "prev");

  ok("retry_timeout", isRetryableShadowError({ code: "TIMEOUT" }) === true, "to");
  ok("retry_oversize_no", isRetryableShadowError({ code: "RESPONSE_TOO_LARGE" }) === false, "os");
  ok("retry_auth_no", isRetryableShadowError({ code: "HTTP_401" }) === false, "401");
  ok("retry_parser_no", isRetryableShadowError({ code: "XML_ELEMENTS" }) === false, "el");
  ok("retry_max_attempts", RETRY_POLICY.maxAttempts === 3, "att");
  const d0 = retryDelayMs(0, { random: () => 0 });
  const d2 = retryDelayMs(2, { random: () => 0 });
  ok("retry_backoff", d2 > d0, d0 + ":" + d2);

  let life = createLifecycleTracker({});
  ok("health_degraded_init", life.health === "degraded" || life.health === "healthy", life.health);
  noteFetchSuccess(life);
  noteParseSuccess(life);
  ok("health_healthy", computeHealthState(life) === "healthy", life.health);
  noteFailure(life);
  noteFailure(life);
  ok("health_degraded_fails", life.health === "degraded", life.health);
  noteFailure(life);
  noteFailure(life);
  noteFailure(life);
  ok("health_blocked", life.health === "blocked", life.health);
  noteParseSuccess(life);
  ok("health_reset", life.consecutiveFailures === 0 && life.health === "healthy", String(life.consecutiveFailures));
}

// memory bound: raising download limit must not retain N copies of XML in one helper
{
  const big = Buffer.alloc(2 * 1024 * 1024, 0x41);
  const before = process.memoryUsage().heapUsed;
  const scans = [];
  for (let i = 0; i < 3; i++) {
    scans.push(scanDatexStructure("<?xml version='1.0'?><r xmlns='http://datex2.eu/schema/2/2_0'>" + "x".repeat(1000) + "</r>"));
  }
  void big;
  const after = process.memoryUsage().heapUsed;
  ok("no_linear_multi_copy_guard", after - before < 40 * 1024 * 1024, "delta=" + (after - before));
  ok("scans_ok", scans.every((s) => s.rootLocalName === "r"), "scans");
}

// --- TMC ZIP metadata / size limits ---
{
  ok("tmc_prev_64", TMC_ZIP_LIMITS_PREV.maxSingleUncompressed === 64 * 1024 * 1024, "prev");
  ok("tmc_new_150", DEFAULT_ZIP_LIMITS.maxSingleUncompressed === 150 * 1024 * 1024, "new");
  ok("tmc_total_420", DEFAULT_ZIP_LIMITS.maxUncompressedTotal === 420 * 1024 * 1024, "tot");
  ok("tmc_comp_48", DEFAULT_ZIP_LIMITS.maxCompressedTotal === 48 * 1024 * 1024, "comp");
  ok("tmc_ratio_80", DEFAULT_ZIP_LIMITS.maxCompressionRatio === 80, "ratio");
  ok("tmc_entries_256", DEFAULT_ZIP_LIMITS.maxEntries === 256, "entries");
  ok("tmc_covers_observed_117", DEFAULT_ZIP_LIMITS.maxSingleUncompressed > 117804443, "entry_obs");
  ok("tmc_covers_observed_332", DEFAULT_ZIP_LIMITS.maxUncompressedTotal > 332163805, "tot_obs");
  ok("tmc_covers_observed_21", DEFAULT_ZIP_LIMITS.maxCompressedTotal > 21075661, "comp_obs");
  ok("tmc_covers_ratio_45", DEFAULT_ZIP_LIMITS.maxCompressionRatio > 45.87, "ratio_obs");
  ok("tmc_covers_entries_97", DEFAULT_ZIP_LIMITS.maxEntries > 97, "entries_obs");

  const small = buildStoredZip([{ name: "POINTS.CSV", data: "a;b\n1;2\n" }]);
  const meta = inspectZipDeclaredMetadata(small);
  ok("meta_files", meta.fileEntryCount === 1, String(meta.fileEntryCount));
  ok("meta_no_names", !JSON.stringify(meta).includes("POINTS"), "name-leak");

  const under = Buffer.alloc(1000, 0x31);
  const zUnder = buildStoredZip([{ name: "a.csv", data: under }]);
  ok("size_under", safeUnzipEntries(zUnder, { limits: { maxSingleUncompressed: 1000 } }).length === 1, "under");

  let exact = false;
  try {
    safeUnzipEntries(buildStoredZip([{ name: "a.csv", data: Buffer.alloc(1000, 0x32) }]), {
      limits: { maxSingleUncompressed: 1000 },
    });
    exact = true;
  } catch (_) {
    exact = false;
  }
  ok("size_exact", exact, "exact");

  let over = false;
  try {
    safeUnzipEntries(buildStoredZip([{ name: "a.csv", data: Buffer.alloc(1001, 0x33) }]), {
      limits: { maxSingleUncompressed: 1000 },
    });
  } catch (e) {
    over = e.code === "TMC_ZIP_ENTRY_TOO_LARGE" && e.entrySizeRejectCategory === "TMC_SIZE_PER_ENTRY";
  }
  ok("size_over_enum", over, "over");

  const declaredOver = inspectZipDeclaredMetadata(
    buildStoredZip([{ name: "big.csv", data: Buffer.alloc(2000, 0x34) }]),
    { limits: { maxSingleUncompressed: 1000 } }
  );
  ok("meta_entries_over", declaredOver.entriesOverCurrentPerEntryLimit >= 1, String(declaredOver.entriesOverCurrentPerEntryLimit));
  ok("meta_reject_cat", declaredOver.entrySizeRejectCategory === "TMC_SIZE_PER_ENTRY", declaredOver.entrySizeRejectCategory);

  const withDir = buildStoredZip([
    { name: "loc/", data: "" },
    { name: "loc/points.csv", data: "a;b\n" },
  ]);
  const md = inspectZipDeclaredMetadata(withDir);
  ok("meta_dir", md.directoryEntryCount >= 1 && md.fileEntryCount === 1, JSON.stringify(md));
}

if (fails.length) {
  console.error("[ndic-datex-namespace-growth-fixtures] FAIL " + fails.length);
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    DATEX_LIMIT_DEFAULT_BYTES,
    TMC_maxSingleUncompressed: DEFAULT_ZIP_LIMITS.maxSingleUncompressed,
    TMC_maxUncompressedTotal: DEFAULT_ZIP_LIMITS.maxUncompressedTotal,
  })
);
console.log("[ndic-datex-namespace-growth-fixtures] PASS");
