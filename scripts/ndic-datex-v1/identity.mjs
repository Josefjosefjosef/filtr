/**
 * Stable identity + content fingerprint for NDIC DATEX situations.
 * Primary key = official situation id (never content-hash as primary).
 */
import crypto from "crypto";
import { NDIC_ID_PREFIX, PARSER_VERSION } from "./config.mjs";

/**
 * @param {string} situationId
 */
export function makeStableItemId(situationId) {
  const sid = String(situationId || "").trim();
  if (!sid) throw Object.assign(new Error("missing_situation_id"), { code: "MISSING_SITUATION_ID" });
  // Keep source id readable when already safe; otherwise hash.
  const safe = /^[A-Za-z0-9._:-]{1,120}$/.test(sid)
    ? sid.replace(/[^A-Za-z0-9._-]/g, "_")
    : crypto.createHash("sha1").update(sid).digest("hex").slice(0, 20);
  return NDIC_ID_PREFIX + safe;
}

/**
 * @param {object} situation — parsed DATEX situation
 */
export function buildSituationIdentity(situation) {
  const situationId = String((situation && situation.situationId) || "").trim();
  if (!situationId) {
    throw Object.assign(new Error("missing_situation_id"), { code: "MISSING_SITUATION_ID" });
  }
  const itemId = makeStableItemId(situationId);
  const primary = (situation.records && situation.records[0]) || null;
  const revisionKey = [
    situation.situationVersion || "",
    primary && primary.recordVersion,
    primary && primary.versionTime,
  ]
    .filter(Boolean)
    .join("|");
  return {
    situationId,
    itemId,
    revisionKey: revisionKey || "v0",
    sourceSystem: "ndic-datex-ii",
    parserVersion: PARSER_VERSION,
  };
}

/**
 * Content fingerprint for change detection (not primary identity).
 * @param {object} normalized
 */
export function contentFingerprint(normalized) {
  const parts = [
    normalized.category || "",
    normalized.subtype || "",
    normalized.title || "",
    normalized.summary || "",
    normalized.roadNumber || "",
    normalized.direction || "",
    normalized.validFrom || "",
    normalized.validTo || "",
    normalized.lifecycle || "",
    normalized.status || "",
    (normalized.tmcLocationCodes || []).join(","),
    normalized.lat != null ? String(normalized.lat) : "",
    normalized.lon != null ? String(normalized.lon) : "",
    normalized.severity || "",
  ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/**
 * Secondary dedupe key — only when official id missing/unstable.
 * Conservative: road + tmc + time overlap + category.
 */
export function secondaryDedupeKey(n) {
  if (!n) return "";
  return [
    n.category || "",
    n.roadNumber || "",
    n.direction || "",
    (n.tmcLocationCodes || []).slice(0, 2).join("-"),
    (n.validFrom || "").slice(0, 10),
  ].join("|");
}
