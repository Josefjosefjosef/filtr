/**
 * Build + persist redacted NDIC isolated-shadow forensic retention artifacts.
 * Never retains raw DATEX/TMC/auth. Never enables publication.
 */
import fs from "node:fs";
import path from "node:path";
import {
  FORENSIC_SCHEMA,
  CARD_PREVIEW_SCHEMA,
  VALIDATION_REPORT_SCHEMA,
  FORENSIC_DIR_NAME,
  FORENSIC_SUMMARY_FILE,
  FORENSIC_CARD_PREVIEW_FILE,
  FORENSIC_VALIDATION_FILE,
  MAX_CARD_PREVIEW_ITEMS,
  CARD_PREVIEW_ALLOWLIST,
  HTTP_STATUS_CLASS,
} from "./shadow-forensic-constants.mjs";
import {
  validateForensicSummary,
  validateCardPreview,
  validateValidationReport,
  scanForensicCanaries,
} from "./shadow-forensic-schema.mjs";
import { PARSER_VERSION } from "./config.mjs";

function clip(s, n) {
  if (s == null || s === "") return null;
  const t = String(s).trim();
  if (!t) return null;
  return t.length > n ? t.slice(0, n) : t;
}

function httpStatusClass(status) {
  const n = Number(status);
  if (!Number.isFinite(n) || n <= 0) return HTTP_STATUS_CLASS.none;
  if (n >= 200 && n < 300) return HTTP_STATUS_CLASS["2xx"];
  if (n >= 300 && n < 400) return HTTP_STATUS_CLASS["3xx"];
  if (n >= 400 && n < 500) return HTTP_STATUS_CLASS["4xx"];
  if (n >= 500 && n < 600) return HTTP_STATUS_CLASS["5xx"];
  return HTTP_STATUS_CLASS.unknown;
}

function resolveHeadSha(explicit) {
  const fromEnv = String(process.env.GITHUB_SHA || process.env.IU_NDIC_FORENSIC_HEAD_SHA || "").toLowerCase().trim();
  const want = String(explicit || fromEnv || "").toLowerCase().trim();
  if (/^[0-9a-f]{40}$/.test(want)) return want;
  return "0000000000000000000000000000000000000000";
}

function resolveRunId(explicit) {
  const fromEnv = String(process.env.GITHUB_RUN_ID || "").trim();
  const want = String(explicit || fromEnv || "").trim();
  if (want && want.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(want)) return want;
  return "local-forensic";
}

/**
 * Build allowlisted card preview row from a gate/feed item.
 * Unverified geo fields stay null (never invent km/direction/locality).
 */
export function buildCardPreviewItem(item) {
  const trust = String((item && item.localizationTrust) || "");
  const verifiedLoc = trust === "tmc" || trust === "coordinates";
  const row = {
    type: clip(item && item.eventType, 80),
    road: verifiedLoc ? clip(item && item.roadNumber, 40) : null,
    km: null,
    direction: verifiedLoc ? clip(item && item.direction, 40) : null,
    locality: verifiedLoc ? clip(item && item.region && item.region.name, 80) : null,
    startsAt: clip(item && item.validFrom, 40),
    endsAt: clip(item && item.validTo, 40),
    status: clip(item && item.status, 40),
    severity: clip(item && item.severity, 40),
    source: clip((item && item.sourceLabel) || "NDIC", 40),
    lastChangedAt: clip((item && (item.lastUpdatedBySource || item.sortAt || item.lastProcessedAt)) || null, 40),
  };
  for (const k of CARD_PREVIEW_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) row[k] = null;
  }
  return row;
}

/**
 * @param {{
 *   ok?: boolean,
 *   reason?: string,
 *   mode?: string,
 *   published?: boolean,
 *   diagnostics?: object,
 *   stats?: object,
 *   result?: object,
 *   gateItems?: object[],
 *   startedAt?: string,
 *   finishedAt?: string,
 *   headSha?: string,
 *   runId?: string,
 *   shadowIsolated?: boolean,
 *   datexBytesRead?: number,
 *   datexHttpStatus?: number,
 *   datexContentTypeValid?: boolean,
 *   geocodingUsed?: boolean,
 * }} ctx
 */
export function buildShadowForensicBundle(ctx = {}) {
  const finishedAt = ctx.finishedAt || new Date().toISOString();
  const startedAt = ctx.startedAt || finishedAt;
  const headSha = resolveHeadSha(ctx.headSha);
  const runId = resolveRunId(ctx.runId || (ctx.diagnostics && ctx.diagnostics.runId));
  const mode = ctx.mode || "shadow";
  const result = ctx.result || {};
  const parsed = result.parsed || {};
  const stats = ctx.stats || result.stats || {};
  const gateItems = Array.isArray(ctx.gateItems)
    ? ctx.gateItems
    : Array.isArray(result.gate && result.gate.items)
      ? result.gate.items
      : [];
  const quarantine = Array.isArray(result.quarantine) ? result.quarantine : [];
  const rejectedParse = Array.isArray(result.rejectedParse) ? result.rejectedParse : [];
  const allItems = Array.isArray(result.all) ? result.all : gateItems;

  let active = 0;
  let future = 0;
  let ended = 0;
  let cancelled = 0;
  let resolvedBasic = 0;
  let unresolved = 0;
  let provenanceValid = 0;
  let provenanceMissing = 0;
  let sourceTimeValid = 0;
  let sourceTimeMissing = 0;

  for (const it of allItems) {
    const st = String((it && it.status) || "");
    if (st === "aktivni") active += 1;
    else if (st === "naplanovano") future += 1;
    else if (st === "ukonceno") ended += 1;
    else if (st === "zruseno") cancelled += 1;

    const trust = String((it && it.localizationTrust) || "");
    const tmcOk = it && it.ndicV1 && Number(it.ndicV1.tmcOk) > 0;
    if (trust === "tmc" || tmcOk) resolvedBasic += 1;
    else unresolved += 1;

    if (it && it.attribution && it.sourceId) provenanceValid += 1;
    else provenanceMissing += 1;

    if (it && it.publishedAtSource) sourceTimeValid += 1;
    else sourceTimeMissing += 1;
  }

  const loaded = Number(parsed.situationCount) || allItems.length || gateItems.length;
  const rejected = (Number(parsed.rejectedCount) || 0) + quarantine.length + rejectedParse.length;
  const duplicatesDetected = Number(stats.unchanged) || 0;
  const deduplicated = duplicatesDetected;
  const previewSource = gateItems.slice(0, MAX_CARD_PREVIEW_ITEMS);
  const previewItems = previewSource.map(buildCardPreviewItem);

  const summary = {
    schema: FORENSIC_SCHEMA,
    RUN_ID: runId,
    HEAD_SHA: headSha,
    MODE: mode,
    STARTED_AT: startedAt,
    FINISHED_AT: finishedAt,
    OK: Boolean(ctx.ok),
    REASON: clip(ctx.reason || (ctx.ok ? "ok" : "failed"), 120) || "unknown",
    DATEX_HTTP_STATUS_CLASS: httpStatusClass(ctx.datexHttpStatus),
    DATEX_CONTENT_TYPE_VALID: Boolean(ctx.datexContentTypeValid),
    DATEX_BYTES_READ: Number.isFinite(ctx.datexBytesRead) ? Math.max(0, Math.floor(ctx.datexBytesRead)) : 0,
    DATEX_XML_PARSE_PASS: Boolean(parsed.ok != null ? parsed.ok : ctx.ok),
    TMC_ARCHIVE_USED: Boolean(ctx.diagnostics && ctx.diagnostics.tmc && (ctx.diagnostics.tmc.ok || ctx.diagnostics.tmc.reason === "fixture")),
    TMC_VERSION: clip((ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.meta && ctx.diagnostics.tmc.meta.version) || "unknown", 64) || "unknown",
    TMC_RESOLVER_VERSION: clip(PARSER_VERSION, 64) || "unknown",
    LOADED_EVENTS: loaded,
    ACTIVE_EVENTS: active,
    FUTURE_EVENTS: future,
    ENDED_EVENTS: ended,
    REJECTED_EVENTS: rejected,
    RESOLVED_BASIC: resolvedBasic,
    UNRESOLVED: unresolved,
    DUPLICATES_DETECTED: duplicatesDetected,
    DEDUPLICATED_EVENTS: deduplicated,
    NORMALIZED_EVENTS: gateItems.length,
    AGGREGATED_EVENTS: gateItems.length,
    DIFF_NEW: Number(stats.new) || 0,
    DIFF_CHANGED: Number(stats.updated) || 0,
    DIFF_ENDED: Number(stats.ended) || 0,
    DIFF_CANCELLED: cancelled,
    PUBLICATION_ITEMS: gateItems.length,
    PUBLICATION_REJECTED: rejected,
    FEED_ITEMS: gateItems.length,
    CARD_PREVIEW_COUNT: previewItems.length,
    CARD_VALIDATION_PASS: false,
    PROVENANCE_FIELDS_VALID: provenanceValid,
    PROVENANCE_FIELDS_MISSING: provenanceMissing,
    PROVENANCE_REJECTED: quarantine.filter((q) => q && /provenance|legal/i.test(String(q.quarantineReason || ""))).length,
    SOURCE_TIME_VALID: sourceTimeValid,
    SOURCE_TIME_MISSING: sourceTimeMissing,
    UNVERIFIED_KM_PUBLISHED: 0,
    UNVERIFIED_DIRECTION_PUBLISHED: 0,
    UNVERIFIED_LOCATION_PUBLISHED: 0,
    FUZZY_MATCH_USED: false,
    GEOCODING_USED: Boolean(ctx.geocodingUsed),
    HEURISTIC_LOCATION_USED: false,
    PUBLICATION_ENABLED: false,
    PUBLISHED: false,
    SHADOW_ISOLATED: ctx.shadowIsolated !== false,
    MAX_CARD_PREVIEW_ITEMS,
  };

  const cardPreview = {
    schema: CARD_PREVIEW_SCHEMA,
    HEAD_SHA: headSha,
    RUN_ID: runId,
    items: previewItems,
    COUNT: previewItems.length,
    PUBLICATION_ENABLED: false,
  };

  const summaryCheck = validateForensicSummary(summary);
  const cardCheck = validateCardPreview(cardPreview);
  summary.CARD_VALIDATION_PASS = cardCheck.ok;

  // Re-validate after CARD_VALIDATION_PASS assignment
  const summaryCheck2 = validateForensicSummary(summary);
  const canary = scanForensicCanaries({ summary, cardPreview });

  const fails = []
    .concat(summaryCheck2.fails.map((f) => "summary:" + f))
    .concat(cardCheck.fails.map((f) => "card:" + f))
    .concat(canary.fails.map((f) => "canary:" + f));

  const validationReport = {
    schema: VALIDATION_REPORT_SCHEMA,
    HEAD_SHA: headSha,
    RUN_ID: runId,
    SUMMARY_SCHEMA_PASS: summaryCheck2.ok,
    CARD_PREVIEW_SCHEMA_PASS: cardCheck.ok,
    CANARY_PASS: canary.ok,
    FORENSIC_RETENTION_PASS: summaryCheck2.ok && cardCheck.ok && canary.ok,
    PUBLICATION_ENABLED: false,
    PUBLISHED: false,
    FAILS: fails.slice(0, 100),
  };
  const reportCheck = validateValidationReport(validationReport);
  if (!reportCheck.ok) {
    validationReport.FORENSIC_RETENTION_PASS = false;
    validationReport.FAILS = validationReport.FAILS.concat(reportCheck.fails.map((f) => "report:" + f)).slice(0, 100);
  }

  return {
    summary,
    cardPreview,
    validationReport,
    ok: validationReport.FORENSIC_RETENTION_PASS === true,
  };
}

export function resolveForensicDir(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.IU_NDIC_FORENSIC_DIR) return path.resolve(process.env.IU_NDIC_FORENSIC_DIR);
  const base = process.env.RUNNER_TEMP || process.env.TEMP || process.env.TMPDIR || ".";
  return path.join(base, FORENSIC_DIR_NAME);
}

export function writeShadowForensicBundle(dir, bundle) {
  fs.mkdirSync(dir, { recursive: true });
  const files = [
    [FORENSIC_SUMMARY_FILE, bundle.summary],
    [FORENSIC_CARD_PREVIEW_FILE, bundle.cardPreview],
    [FORENSIC_VALIDATION_FILE, bundle.validationReport],
  ];
  for (const [name, obj] of files) {
    const p = path.join(dir, name);
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, p);
  }
  return {
    dir,
    files: files.map(([name]) => name),
  };
}

/** Safe aggregate-only stdout lines (no raw payloads). */
export function printShadowForensicStdout(summary) {
  const lines = [
    "SHADOW_FORENSIC_SUMMARY_OK=" + (summary && summary.OK && summary.CARD_VALIDATION_PASS ? "YES" : "NO"),
    "LOADED_EVENTS=" + (summary && summary.LOADED_EVENTS),
    "ACTIVE_EVENTS=" + (summary && summary.ACTIVE_EVENTS),
    "FUTURE_EVENTS=" + (summary && summary.FUTURE_EVENTS),
    "ENDED_EVENTS=" + (summary && summary.ENDED_EVENTS),
    "RESOLVED_BASIC=" + (summary && summary.RESOLVED_BASIC),
    "UNRESOLVED=" + (summary && summary.UNRESOLVED),
    "DEDUPLICATED_EVENTS=" + (summary && summary.DEDUPLICATED_EVENTS),
    "PUBLICATION_ITEMS=" + (summary && summary.PUBLICATION_ITEMS),
    "FEED_ITEMS=" + (summary && summary.FEED_ITEMS),
    "CARD_VALIDATION_PASS=" + (summary && summary.CARD_VALIDATION_PASS ? "YES" : "NO"),
    "PUBLISHED=false",
    "PUBLICATION_ENABLED=NO",
  ];
  for (const line of lines) console.log(line);
}
