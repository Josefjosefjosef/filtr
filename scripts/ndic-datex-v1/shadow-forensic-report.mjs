/**
 * Build + persist redacted NDIC isolated-shadow forensic retention artifacts.
 * Never retains raw DATEX/TMC/auth. Never enables publication.
 *
 * PUBLICATION_ITEMS / PUBLICATION_PROJECTIONS_TOTAL =
 *   gate-passed internal feed projections (legal provenance attached).
 *   NOT "publicly displayable geo cards".
 * PUBLICATION_ELIGIBLE_TOTAL =
 *   projections with verified location trust (tmc|coordinates) + provenance.
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
  MAX_DATEX_BYTES_READ,
  CARD_PREVIEW_ALLOWLIST,
  HTTP_STATUS_CLASS,
  VERIFIED_LOCATION_TRUST,
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

function normalizeIso(s, fallback) {
  if (typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s) && s.length <= 40) {
    return s;
  }
  const ms = Date.parse(s);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  return fallback;
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
  const fromEnv = String(process.env.GITHUB_SHA || process.env.IU_NDIC_FORENSIC_HEAD_SHA || "")
    .toLowerCase()
    .trim();
  const want = String(explicit || fromEnv || "")
    .toLowerCase()
    .trim();
  if (/^[0-9a-f]{40}$/.test(want)) return want;
  return "0000000000000000000000000000000000000000";
}

function resolveRunId(explicit) {
  // Prefer GitHub Actions run id for artifact correlation.
  const fromEnv = String(process.env.GITHUB_RUN_ID || "").trim();
  if (fromEnv && fromEnv.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(fromEnv)) return fromEnv;
  const want = String(explicit || "").trim();
  if (want && want.length <= 80 && /^[A-Za-z0-9._:-]+$/.test(want)) return want;
  return "local-forensic";
}

function hasVerifiedLocationTrust(item) {
  const trust = String((item && item.localizationTrust) || "");
  const tmcOk = item && item.ndicV1 && Number(item.ndicV1.tmcOk) > 0;
  return VERIFIED_LOCATION_TRUST.includes(trust) || tmcOk;
}

function hasProvenance(item) {
  return Boolean(item && item.attribution && item.sourceId);
}

/**
 * Build allowlisted card preview row from a gate/feed item.
 * Unverified geo fields stay null (never invent km/direction/locality).
 */
export function buildCardPreviewItem(item) {
  const verifiedLoc = hasVerifiedLocationTrust(item);
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
    lastChangedAt: clip(
      (item && (item.lastUpdatedBySource || item.sortAt || item.lastProcessedAt)) || null,
      40
    ),
  };
  for (const k of CARD_PREVIEW_ALLOWLIST) {
    if (!Object.prototype.hasOwnProperty.call(row, k)) row[k] = null;
  }
  return row;
}

function computeResolverAndPublicationMetrics(allItems, gateItems) {
  let active = 0;
  let future = 0;
  let ended = 0;
  let cancelled = 0;
  let resolvedBasic = 0;
  let resolvedOther = 0;
  let unresolvedTotal = 0;
  let unresolvedTmc = 0;
  let unresolvedMissing = 0;
  let unresolvedInvalid = 0;
  let resolverAttempted = 0;
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
    const tmcMiss = it && it.ndicV1 && Number(it.ndicV1.tmcMiss) > 0;
    if (tmcOk || tmcMiss) resolverAttempted += 1;

    if (trust === "tmc" || tmcOk) resolvedBasic += 1;
    else if (trust === "coordinates") resolvedOther += 1;
    else {
      unresolvedTotal += 1;
      if (tmcMiss && !tmcOk) unresolvedTmc += 1;
      else unresolvedMissing += 1;
    }

    if (hasProvenance(it)) provenanceValid += 1;
    else provenanceMissing += 1;

    if (it && it.publishedAtSource) sourceTimeValid += 1;
    else sourceTimeMissing += 1;
  }

  let pubEligible = 0;
  let pubBlocked = 0;
  let blockedLocation = 0;
  let blockedKm = 0;
  let blockedDirection = 0;
  let blockedProvenance = 0;
  let withLocation = 0;
  let withoutLocation = 0;
  let withKm = 0;
  let withoutKm = 0;
  let withDirection = 0;
  let withoutDirection = 0;

  for (const it of gateItems) {
    const verified = hasVerifiedLocationTrust(it);
    const prov = hasProvenance(it);
    // km is never projected from current feed model (always absent)
    const hasKm = false;
    const hasDir = verified && Boolean(clip(it && it.direction, 40));

    if (verified) {
      withLocation += 1;
      if (hasDir) withDirection += 1;
      else {
        withoutDirection += 1;
        blockedDirection += 1;
      }
    } else {
      withoutLocation += 1;
      withoutDirection += 1;
      blockedLocation += 1;
      blockedDirection += 1;
    }
    withoutKm += 1;
    blockedKm += 1;
    if (!prov) blockedProvenance += 1;

    // Eligible for precise public geo publication only with verified location + provenance.
    // Unresolved location ⇒ blocked (not publicly displayable as precise traffic card).
    if (verified && prov) pubEligible += 1;
    else pubBlocked += 1;
  }

  return {
    active,
    future,
    ended,
    cancelled,
    resolvedBasic,
    resolvedOther,
    unresolvedTotal,
    unresolvedTmc,
    unresolvedMissing,
    unresolvedInvalid,
    resolverAttempted,
    provenanceValid,
    provenanceMissing,
    sourceTimeValid,
    sourceTimeMissing,
    pubEligible,
    pubBlocked,
    blockedLocation,
    blockedKm,
    blockedDirection,
    blockedProvenance,
    withLocation,
    withoutLocation,
    withKm,
    withoutKm,
    withDirection,
    withoutDirection,
  };
}

/**
 * Card location validation: projected geo fields may be non-null only for verified-trust sources.
 */
export function evaluateCardLocationValidation(previewSource, previewItems) {
  if (previewSource.length !== previewItems.length) return false;
  for (let i = 0; i < previewSource.length; i += 1) {
    const src = previewSource[i];
    const row = previewItems[i];
    const verified = hasVerifiedLocationTrust(src);
    const geoFields = [row.road, row.km, row.direction, row.locality];
    const anyGeo = geoFields.some((v) => v != null && v !== "");
    if (!verified && anyGeo) return false;
    if (row.km != null) return false; // km never verified in current model
  }
  return true;
}

/**
 * Card publication eligibility: preview must not claim geo for blocked items.
 * Schema-valid projection ≠ publicly displayable precise card.
 */
export function evaluateCardPublicationEligibility(previewSource, previewItems, summaryEligibleTotal) {
  if (!evaluateCardLocationValidation(previewSource, previewItems)) return false;
  // If zero eligible in full gate set, preview must not show any geo fields.
  if (summaryEligibleTotal === 0) {
    return previewItems.every((row) => row.road == null && row.km == null && row.direction == null && row.locality == null);
  }
  return true;
}

/**
 * @param {object} ctx
 */
export function buildShadowForensicBundle(ctx = {}) {
  const finishedAt = normalizeIso(ctx.finishedAt, new Date().toISOString());
  const startedAt = normalizeIso(ctx.startedAt || finishedAt, finishedAt);
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

  const m = computeResolverAndPublicationMetrics(allItems, gateItems);

  const loaded = Number(parsed.situationCount) || allItems.length || gateItems.length;
  const rejected = (Number(parsed.rejectedCount) || 0) + quarantine.length + rejectedParse.length;
  const duplicatesDetected = Number(stats.unchanged) || 0;
  const deduplicated = duplicatesDetected;
  const previewSource = gateItems.slice(0, MAX_CARD_PREVIEW_ITEMS);
  const previewItems = previewSource.map(buildCardPreviewItem);

  let datexBytes = Number.isFinite(ctx.datexBytesRead) ? Math.max(0, Math.floor(ctx.datexBytesRead)) : 0;
  if (datexBytes > MAX_DATEX_BYTES_READ) datexBytes = MAX_DATEX_BYTES_READ;

  const cardProjectionPass = true; // set after validateCardPreview
  const cardLocationPass = evaluateCardLocationValidation(previewSource, previewItems);
  const cardEligPass = evaluateCardPublicationEligibility(previewSource, previewItems, m.pubEligible);

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
    DATEX_BYTES_READ: datexBytes,
    DATEX_XML_PARSE_PASS: Boolean(parsed.ok != null ? parsed.ok : ctx.ok),
    TMC_ARCHIVE_USED: Boolean(
      ctx.diagnostics && ctx.diagnostics.tmc && (ctx.diagnostics.tmc.ok || ctx.diagnostics.tmc.reason === "fixture")
    ),
    TMC_VERSION:
      clip(
        (ctx.diagnostics && ctx.diagnostics.tmc && ctx.diagnostics.tmc.meta && ctx.diagnostics.tmc.meta.version) ||
          "unknown",
        64
      ) || "unknown",
    TMC_RESOLVER_VERSION: clip(PARSER_VERSION, 64) || "unknown",
    LOADED_EVENTS: loaded,
    ACTIVE_EVENTS: m.active,
    FUTURE_EVENTS: m.future,
    ENDED_EVENTS: m.ended,
    REJECTED_EVENTS: rejected,
    RESOLVED_BASIC: m.resolvedBasic,
    UNRESOLVED: m.unresolvedTotal,
    DUPLICATES_DETECTED: duplicatesDetected,
    DEDUPLICATED_EVENTS: deduplicated,
    NORMALIZED_EVENTS: gateItems.length,
    AGGREGATED_EVENTS: gateItems.length,
    DIFF_NEW: Number(stats.new) || 0,
    DIFF_CHANGED: Number(stats.updated) || 0,
    DIFF_ENDED: Number(stats.ended) || 0,
    DIFF_CANCELLED: m.cancelled,
    // PUBLICATION_ITEMS = internal projections (NOT public geo-eligible count)
    PUBLICATION_ITEMS: gateItems.length,
    PUBLICATION_REJECTED: rejected,
    FEED_ITEMS: gateItems.length,
    CARD_PREVIEW_COUNT: previewItems.length,
    CARD_VALIDATION_PASS: false,
    CARD_PROJECTION_VALIDATION_PASS: false,
    CARD_PUBLICATION_ELIGIBILITY_PASS: cardEligPass,
    CARD_LOCATION_VALIDATION_PASS: cardLocationPass,
    PROVENANCE_FIELDS_VALID: m.provenanceValid,
    PROVENANCE_FIELDS_MISSING: m.provenanceMissing,
    PROVENANCE_REJECTED: quarantine.filter((q) => q && /provenance|legal/i.test(String(q.quarantineReason || ""))).length,
    SOURCE_TIME_VALID: m.sourceTimeValid,
    SOURCE_TIME_MISSING: m.sourceTimeMissing,
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
    PUBLICATION_PROJECTIONS_TOTAL: gateItems.length,
    PUBLICATION_ELIGIBLE_TOTAL: m.pubEligible,
    PUBLICATION_BLOCKED_TOTAL: m.pubBlocked,
    PUBLICATION_BLOCKED_LOCATION: m.blockedLocation,
    PUBLICATION_BLOCKED_KM: m.blockedKm,
    PUBLICATION_BLOCKED_DIRECTION: m.blockedDirection,
    PUBLICATION_BLOCKED_PROVENANCE: m.blockedProvenance,
    PUBLICATION_WITH_LOCATION: m.withLocation,
    PUBLICATION_WITHOUT_LOCATION: m.withoutLocation,
    PUBLICATION_WITH_KM: m.withKm,
    PUBLICATION_WITHOUT_KM: m.withoutKm,
    PUBLICATION_WITH_DIRECTION: m.withDirection,
    PUBLICATION_WITHOUT_DIRECTION: m.withoutDirection,
    RESOLVER_INPUT_TOTAL: allItems.length,
    RESOLVER_ATTEMPTED_TOTAL: m.resolverAttempted,
    RESOLVED_OTHER_VALID_LOCATION: m.resolvedOther,
    UNRESOLVED_TOTAL: m.unresolvedTotal,
    UNRESOLVED_TMC_REFERENCE: m.unresolvedTmc,
    UNRESOLVED_MISSING_REFERENCE: m.unresolvedMissing,
    UNRESOLVED_INVALID_REFERENCE: m.unresolvedInvalid,
    FEED_INTERNAL_ITEMS: gateItems.length,
    FEED_PUBLICATION_ELIGIBLE_ITEMS: m.pubEligible,
    FEED_PUBLICATION_BLOCKED_ITEMS: m.pubBlocked,
  };

  // Fail-closed: never count unverified geo as published in preview
  for (const row of previewItems) {
    if (row.km != null) summary.UNVERIFIED_KM_PUBLISHED += 1;
  }
  // Recompute location/direction unverified from preview vs source trust
  for (let i = 0; i < previewSource.length; i += 1) {
    const verified = hasVerifiedLocationTrust(previewSource[i]);
    const row = previewItems[i];
    if (!verified) {
      if (row.locality != null || row.road != null) summary.UNVERIFIED_LOCATION_PUBLISHED += 1;
      if (row.direction != null) summary.UNVERIFIED_DIRECTION_PUBLISHED += 1;
    }
  }

  const cardPreview = {
    schema: CARD_PREVIEW_SCHEMA,
    HEAD_SHA: headSha,
    RUN_ID: runId,
    items: previewItems,
    COUNT: previewItems.length,
    PUBLICATION_ENABLED: false,
  };

  const cardCheck = validateCardPreview(cardPreview);
  summary.CARD_PROJECTION_VALIDATION_PASS = cardCheck.ok;
  summary.CARD_PUBLICATION_ELIGIBILITY_PASS = cardEligPass && cardCheck.ok;
  summary.CARD_LOCATION_VALIDATION_PASS = cardLocationPass && cardCheck.ok;
  summary.CARD_VALIDATION_PASS =
    summary.CARD_PROJECTION_VALIDATION_PASS &&
    summary.CARD_PUBLICATION_ELIGIBILITY_PASS &&
    summary.CARD_LOCATION_VALIDATION_PASS;

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
    FORENSIC_RETENTION_PASS: summaryCheck2.ok && cardCheck.ok && canary.ok && summary.CARD_VALIDATION_PASS,
    PUBLICATION_ENABLED: false,
    PUBLISHED: false,
    FAILS: fails.slice(0, 100),
  };
  const reportCheck = validateValidationReport(validationReport);
  if (!reportCheck.ok) {
    validationReport.FORENSIC_RETENTION_PASS = false;
    validationReport.FAILS = validationReport.FAILS.concat(reportCheck.fails.map((f) => "report:" + f)).slice(0, 100);
  }

  void cardProjectionPass;

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
export function printShadowForensicStdout(summary, validationReport) {
  const retentionPass = validationReport && validationReport.FORENSIC_RETENTION_PASS === true;
  const lines = [
    "SHADOW_FORENSIC_SUMMARY_OK=" + (retentionPass ? "YES" : "NO"),
    "FORENSIC_RETENTION_PASS=" + (retentionPass ? "YES" : "NO"),
    "LOADED_EVENTS=" + (summary && summary.LOADED_EVENTS),
    "ACTIVE_EVENTS=" + (summary && summary.ACTIVE_EVENTS),
    "FUTURE_EVENTS=" + (summary && summary.FUTURE_EVENTS),
    "ENDED_EVENTS=" + (summary && summary.ENDED_EVENTS),
    "RESOLVED_BASIC=" + (summary && summary.RESOLVED_BASIC),
    "RESOLVED_OTHER_VALID_LOCATION=" + (summary && summary.RESOLVED_OTHER_VALID_LOCATION),
    "UNRESOLVED_TOTAL=" + (summary && summary.UNRESOLVED_TOTAL),
    "UNRESOLVED_TMC_REFERENCE=" + (summary && summary.UNRESOLVED_TMC_REFERENCE),
    "UNRESOLVED_MISSING_REFERENCE=" + (summary && summary.UNRESOLVED_MISSING_REFERENCE),
    "PUBLICATION_PROJECTIONS_TOTAL=" + (summary && summary.PUBLICATION_PROJECTIONS_TOTAL),
    "PUBLICATION_ELIGIBLE_TOTAL=" + (summary && summary.PUBLICATION_ELIGIBLE_TOTAL),
    "PUBLICATION_BLOCKED_TOTAL=" + (summary && summary.PUBLICATION_BLOCKED_TOTAL),
    "PUBLICATION_BLOCKED_LOCATION=" + (summary && summary.PUBLICATION_BLOCKED_LOCATION),
    "FEED_INTERNAL_ITEMS=" + (summary && summary.FEED_INTERNAL_ITEMS),
    "FEED_PUBLICATION_ELIGIBLE_ITEMS=" + (summary && summary.FEED_PUBLICATION_ELIGIBLE_ITEMS),
    "FEED_PUBLICATION_BLOCKED_ITEMS=" + (summary && summary.FEED_PUBLICATION_BLOCKED_ITEMS),
    "CARD_PROJECTION_VALIDATION_PASS=" + (summary && summary.CARD_PROJECTION_VALIDATION_PASS ? "YES" : "NO"),
    "CARD_PUBLICATION_ELIGIBILITY_PASS=" + (summary && summary.CARD_PUBLICATION_ELIGIBILITY_PASS ? "YES" : "NO"),
    "CARD_LOCATION_VALIDATION_PASS=" + (summary && summary.CARD_LOCATION_VALIDATION_PASS ? "YES" : "NO"),
    "CARD_VALIDATION_PASS=" + (summary && summary.CARD_VALIDATION_PASS ? "YES" : "NO"),
    "UNVERIFIED_LOCATION_PUBLISHED=" + (summary && summary.UNVERIFIED_LOCATION_PUBLISHED),
    "UNVERIFIED_KM_PUBLISHED=" + (summary && summary.UNVERIFIED_KM_PUBLISHED),
    "UNVERIFIED_DIRECTION_PUBLISHED=" + (summary && summary.UNVERIFIED_DIRECTION_PUBLISHED),
    "PUBLISHED=false",
    "PUBLICATION_ENABLED=NO",
  ];
  if (!retentionPass && validationReport && Array.isArray(validationReport.FAILS)) {
    const safe = validationReport.FAILS.slice(0, 12)
      .map((f) => String(f).replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80))
      .filter(Boolean);
    lines.push("FORENSIC_FAILS=" + safe.join("|"));
  }
  for (const line of lines) console.log(line);
}
