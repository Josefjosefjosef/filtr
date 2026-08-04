#!/usr/bin/env node
/**
 * Shadow-report schema + redaction contract (static + synthetic fixture).
 * No network. No secrets. Exit 0 = PASS.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.IU_REPO_ROOT || path.resolve(process.cwd());
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

const probeSrc = fs.readFileSync(path.join(ROOT, "scripts", "ndic-datex-v1-shadow-probe.mjs"), "utf8");
const wfSrc = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ndic-datex-v1-shadow-probe.yml"), "utf8");

/** Allowed top-level fields in sanitized stdout / artifact JSON */
const ALLOWED_TOP = [
  "ok",
  "reason",
  "mode",
  "startedAt",
  "finishedAt",
  "secretsPresentByName",
  "datexRequestAttempted",
  "tmcRequestAttempted",
  "tmcSkippedDueToSharedNetworkFailure",
  "preflight",
  "datex",
  "tmc",
  "mapping",
  "lifecycle",
  "security",
  "sources",
  "tmcPublicMeta",
  "errorCode",
  "gate",
  "phases",
];

/** Keys that must never appear (actual secret/payload carriers — not boolean *Displayed flags) */
const FORBIDDEN_KEYS = new Set([
  "password",
  "passwd",
  "pullPass",
  "tmcPullPass",
  "authorization",
  "Authorization",
  "cookie",
  "cookies",
  "set-cookie",
  "rawXml",
  "rawCSV",
  "rawCsv",
  "rawZip",
  "rawBody",
  "base64",
  "payloadBase64",
  "pullUrl",
  "tmcPullUrl",
  "url",
  "endpoint",
  "stack",
  "stackTrace",
  "username",
  "userName",
  "pullUser",
  "tmcPullUser",
  "token",
  "secretValue",
  "subscriberId",
  "entryName",
  "fileName",
  "pathName",
  "zipEntryName",
]);

const ALLOWED_PATH_REJECT = new Set([
  "TMC_PATH_ABSOLUTE",
  "TMC_PATH_PARENT_TRAVERSAL",
  "TMC_PATH_BACKSLASH",
  "TMC_PATH_CONTROL_CHAR",
  "TMC_PATH_EMPTY",
  "TMC_PATH_DIRECTORY_ENTRY",
  "TMC_PATH_DRIVE_PREFIX",
  "TMC_PATH_NORMALIZATION_CHANGED",
  "TMC_PATH_DUPLICATE",
  "TMC_PATH_TOO_LONG",
  "TMC_PATH_DEPTH_EXCEEDED",
  "TMC_PATH_UNSUPPORTED_ENCODING",
  "TMC_PATH_OTHER",
  null,
]);

ok("probe_has_path_reject_contract", /pathRejectCategory/.test(probeSrc), "path");
ok("probe_streaming_bounded", /streamingBounded|streamResponseToFileBounded/.test(probeSrc), "stream");
ok("probe_no_raw_entry_name_log", !/console\.(log|info).*entryName|console\.(log|info).*nameRaw/.test(probeSrc), "name");
ok("probe_truthful_gate", /parserCompatible/.test(probeSrc) && /situationRecords\s*>\s*0/.test(probeSrc), "gate");
ok("probe_structure_diag", /scanDatexStructure|rootNamespaceUri|parserCompatibilityReason|parseDatexFileStreaming/.test(probeSrc), "struct");
ok("probe_zip_metadata", /inspectZipDeclaredMetadata|zipMetadata|entrySizeRejectCategory/.test(probeSrc), "zipmeta");
ok("probe_streaming_parse", /parseDatexFileStreaming|streamingParse|keepOnDisk/.test(probeSrc), "stream-parse");
ok("probe_tmc_from_file", /summarizeTmcFromFile|analyzeAndGateTmcZipFile/.test(probeSrc), "tmc-disk");
ok("probe_phase_tri_state", /phaseTri|NOT_RUN/.test(probeSrc) && /attachPhaseResults/.test(probeSrc), "phases");
ok("probe_no_test_disk_env_activation", /assertNoTestDiskProviderEnv/.test(probeSrc), "disk-env");
ok("probe_no_create_test_disk_provider", !/createTestDiskStatsProvider/.test(probeSrc), "no-test-provider");
ok("probe_no_full_xml_toString_hotpath", !/summarizeDatexFromFile[\s\S]{0,200}buf\.toString\("utf8"\)/.test(probeSrc), "no-tostring");

const FORBIDDEN_VALUE_RE =
  /https?:\/\/[^\s"]+|Authorization\s*:\s*\S+|Basic\s+[A-Za-z0-9+/=]{12,}|<SituationPublication[\s>]|IU_NDIC_PULL_PASS\s*=/i;

ok("probe_aggregate_only", /Aggregate-only stdout/.test(probeSrc), "comment");
ok("probe_exception_sanitized", /probe_exception/.test(probeSrc) && /never dump stack/.test(probeSrc), "exc");
ok("probe_no_console_stack", !/console\.(log|info|debug|error)\([^)]*\.stack/.test(probeSrc), "stack-log");

ok("wf_artifact_json_only", /shadow-report\.json/.test(wfSrc), "path");
ok("wf_artifact_not_workdir", !/path:\s*\$\{\{\s*runner\.temp\s*\}\}\/ndic-shadow-work/.test(wfSrc), "workdir");
ok(
  "wf_artifact_path_exact",
  /path:\s*\$\{\{\s*runner\.temp\s*\}\}\/ndic-shadow-report\/shadow-report\.json/.test(wfSrc),
  "exact"
);

const sample = {
  ok: false,
  reason: "shadow_probe_partial_or_failed",
  mode: "shadow",
  startedAt: "1970-01-01T00:00:00.000Z",
  finishedAt: "1970-01-01T00:00:01.000Z",
  secretsPresentByName: {
    IU_NDIC_PULL_URL: true,
    IU_NDIC_PULL_USER: true,
    IU_NDIC_PULL_PASS: true,
    IU_NDIC_TMC_PULL_URL: true,
    IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID: true,
  },
  datexRequestAttempted: false,
  tmcRequestAttempted: false,
  tmcSkippedDueToSharedNetworkFailure: false,
  preflight: { ok: true },
  phases: {
    datexFetch: "NOT_RUN",
    datexXxeProtection: "NOT_RUN",
    datexChunkBoundary: "NOT_RUN",
    tmcFetch: "NOT_RUN",
    tmcDiskPreflight: "NOT_RUN",
  },
  datex: {
    downloadSuccess: false,
    authenticationAccepted: false,
    responseFormat: null,
    datexVersion: null,
    namespace: null,
    situationRecords: 0,
    normalized: 0,
    rejected: 0,
    categories: {},
    lifecycle: {},
    withGeometry: 0,
    withTmcRef: 0,
    parserCompatible: true,
    xxeProtectionVerified: true,
    httpStatus: null,
    contentType: null,
    elapsedMs: 0,
    failurePhase: "ssrf_allowlist",
    failureCategory: "H",
    errorCode: "PULL_URL_HOST_DENIED",
    errorClass: "ConfigError",
    beforeHttpResponse: true,
    redirectCount: 0,
    sourceLabel: "DATEX_SOURCE",
    rawDataExposed: false,
    streamingBounded: true,
    maxBytes: 83886080,
    limitPreviousBytes: 33554432,
  },
  tmc: {
    downloadSuccess: false,
    skipped: true,
    skipReason: "offline_fixture",
    authenticationAccepted: false,
    sameCredentialsAsDatex: false,
    responseFormat: null,
    zipDetected: false,
    fileCount: 0,
    fileExtSummary: {},
    compressedSize: 0,
    uncompressedSize: 0,
    detectedVersion: null,
    detectedInnerFormat: null,
    importerCompatible: false,
    parsedRecordCount: 0,
    rejectedRecordCount: 0,
    zipSlipVerified: true,
    zipBombVerified: true,
    atomicActivationVerified: false,
    lastGoodRollbackVerified: false,
    rawZipExposed: false,
    publicReconstructionPossible: false,
    httpStatus: null,
    contentType: null,
    elapsedMs: 0,
    failurePhase: null,
    failureCategory: null,
    errorCode: null,
    errorClass: null,
    beforeHttpResponse: false,
    redirectCount: 0,
    rejectCode: null,
    pathRejectCategory: "TMC_PATH_OTHER",
    pathDiagnostics: {
      pathRejectCategory: "TMC_PATH_OTHER",
      pathRejectCounts: { TMC_PATH_OTHER: 1 },
      isDirectoryEntry: false,
      directoryEntryCount: 0,
      fileEntryCount: 0,
      centralEntryCount: 0,
      fileExtSummary: {},
      safeDirectoryEntriesAllowed: true,
    },
    streamingBounded: true,
    maxBytes: 33554432,
    sourceLabel: "TMC_SOURCE",
  },
  mapping: {
    eventsWithTmcRef: 0,
    translated: 0,
    untranslated: 0,
    pointGeom: 0,
    linearGeom: 0,
    textOnlyLoc: 0,
    coordsValid: false,
    mappingReady: false,
  },
  lifecycle: { startSupported: true },
  security: {
    secretsReadOnlyInsideRunner: true,
    secretValuesDisplayed: false,
    authorizationDisplayed: false,
    sensitiveUrlDisplayed: false,
    rawResponseBodyDisplayed: false,
    productionStorageWrite: false,
    publicFeedWrite: false,
    commitOfRawData: false,
    artifactContainingRawData: false,
    productionDeploy: false,
    workDirIsolated: true,
    redirectPolicy: "error",
    ssrfAllowlistFailClosed: true,
  },
  sources: { datex: "DATEX_SOURCE", tmc: "TMC_SOURCE" },
  tmcPublicMeta: { active: false },
};

function walk(obj, prefix) {
  if (obj == null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? prefix + "." + k : k;
    ok("forbidden_key_" + p, !FORBIDDEN_KEYS.has(k), k);
    if (typeof v === "string") {
      ok("forbidden_value_" + p, !FORBIDDEN_VALUE_RE.test(v), "leak");
    }
    if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p);
  }
}

for (const k of Object.keys(sample)) {
  ok("top_allowed_" + k, ALLOWED_TOP.includes(k), k);
}
walk(sample, "");
ok(
  "path_reject_enum_allowed",
  ALLOWED_PATH_REJECT.has(sample.tmc.pathRejectCategory),
  sample.tmc.pathRejectCategory
);

let caught = false;
try {
  const polluted = {
    password: "x",
    datex: { rawXml: "<SituationPublication/>" },
  };
  for (const k of Object.keys(polluted)) {
    if (FORBIDDEN_KEYS.has(k)) throw new Error("bad_key");
  }
  if (polluted.datex && Object.keys(polluted.datex).some((k) => FORBIDDEN_KEYS.has(k))) throw new Error("raw");
} catch {
  caught = true;
}
ok("detects_pollution", caught, "pollution");

const blob = JSON.stringify(sample);
ok("sample_no_url", !/https?:\/\//i.test(blob), "url");
ok("sample_no_auth_header_value", !/Authorization\s*:/i.test(blob), "auth");
ok("sample_no_situation_xml", !/SituationPublication/i.test(blob), "xml");
ok("security_flags_false", sample.security.authorizationDisplayed === false && sample.security.secretValuesDisplayed === false, "flags");

if (fails.length) {
  console.error("[ndic-shadow-report-redaction] FAIL");
  for (const f of fails) console.error(" - " + f);
  process.exit(1);
}

console.log(
  JSON.stringify({
    ok: true,
    allowedTopLevelFields: ALLOWED_TOP,
    fieldMeanings: {
      ok: "aggregate probe success boolean",
      reason: "sanitized reason code",
      mode: "must be shadow",
      startedAt: "ISO timestamp",
      finishedAt: "ISO timestamp",
      secretsPresentByName: "booleans that named secrets exist (no values)",
      datexRequestAttempted: "whether DATEX fetch was attempted",
      tmcRequestAttempted: "whether TMC fetch was attempted",
      tmcSkippedDueToSharedNetworkFailure: "TMC skipped after shared net failure",
      preflight: "local preflight aggregates",
      datex: "DATEX aggregate counters/statuses (no raw XML/URL)",
      tmc: "TMC aggregate counters/statuses (no raw ZIP/CSV)",
      mapping: "mapping readiness counters",
      lifecycle: "lifecycle design booleans",
      security: "security posture booleans",
      sources: "opaque source labels only",
      tmcPublicMeta: "public TMC meta without points dump",
      errorCode: "sanitized error code on exception path",
    },
    artifactPathContract: "${{ runner.temp }}/ndic-shadow-report/shadow-report.json",
  })
);
console.log("[ndic-shadow-report-redaction] PASS");
