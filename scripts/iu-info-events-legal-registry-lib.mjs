/**
 * InfoUzel — legal source whitelist helpers (machine-readable contract).
 * Used by guard + refresh publish gate. Does not fetch source sites.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEGAL_PATH = path.join(REPO, "projects/data/info_events/legal_source_registry.json");
const SOURCE_PATH = path.join(REPO, "projects/data/info_events/source_registry.json");

export const APPROVED_STATUSES = Object.freeze([
  "APPROVED_CC0",
  "APPROVED_CC_BY",
  "APPROVED_OPEN_DATA",
  "APPROVED_WITH_ATTRIBUTION",
  "APPROVED_WITH_SPECIFIC_CONDITIONS",
]);

export const ALL_STATUSES = Object.freeze([
  "DISCOVERED",
  "RESEARCH_IN_PROGRESS",
  "LEGAL_REVIEW_REQUIRED",
  "LICENSE_UNCLEAR",
  "COMMERCIAL_USE_UNCLEAR",
  "AD_SUPPORTED_USE_UNCLEAR",
  "COMBINATION_RIGHTS_UNCLEAR",
  "DATABASE_RIGHTS_UNCLEAR",
  "PERSONAL_DATA_REVIEW_REQUIRED",
  "TECHNICAL_REVIEW_REQUIRED",
  "LEGAL_COMPATIBILITY_REVIEW_REQUIRED",
  ...APPROVED_STATUSES,
  "REJECTED_NON_COMMERCIAL_ONLY",
  "REJECTED_NO_DERIVATIVES",
  "REJECTED_NO_REDISTRIBUTION",
  "REJECTED_NO_AUTOMATION",
  "REJECTED_PAID_LICENSE",
  "REJECTED_INCOMPATIBLE_LICENSE",
  "REJECTED_UNCLEAR_TERMS",
  "REJECTED",
  "SUSPENDED",
  "REMOVED",
]);

export function loadLegalRegistry(repoRoot = REPO) {
  const p = path.join(repoRoot, "projects/data/info_events/legal_source_registry.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function loadSourceRegistry(repoRoot = REPO) {
  const p = path.join(repoRoot, "projects/data/info_events/source_registry.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function isApprovedStatus(status) {
  return APPROVED_STATUSES.includes(String(status || ""));
}

export function legalEntryBySourceId(legal, sourceId) {
  const id = String(sourceId || "");
  return (legal.entries || []).find((e) => e && String(e.sourceId) === id) || null;
}

/**
 * Production ingest allowed only when:
 * - source.productionActive && productionApproved && legalStatus==="approved" (existing gate)
 * - AND legal registry entry exists with APPROVED_* status
 * - AND commercialUseAllowed / adSupportedUseAllowed / combinationAllowed are true
 * - AND hardGate enabled (default true)
 */
export function canPublishFromSource(sourceEntry, legalRegistry) {
  const gate = (legalRegistry && legalRegistry.gate) || {};
  const hard = gate.enforceHard !== false;
  if (!sourceEntry) return { ok: false, reason: "missing_source" };
  if (!(sourceEntry.productionActive && sourceEntry.productionApproved && sourceEntry.legalStatus === "approved")) {
    return { ok: false, reason: "source_registry_gate" };
  }
  const legal = legalEntryBySourceId(legalRegistry, sourceEntry.id);
  if (!legal) {
    return { ok: false, reason: hard ? "missing_legal_entry" : "missing_legal_entry_soft" };
  }
  if (!isApprovedStatus(legal.status)) {
    return { ok: false, reason: "legal_status_not_approved:" + legal.status };
  }
  if (legal.commercialUseAllowed !== true) return { ok: false, reason: "commercial_use_not_allowed" };
  if (legal.adSupportedUseAllowed !== true) return { ok: false, reason: "ad_supported_use_not_allowed" };
  if (legal.combinationAllowed !== true) return { ok: false, reason: "combination_not_allowed" };
  if (legal.automationAllowed !== true) return { ok: false, reason: "automation_not_allowed" };
  if (legal.storageAllowed !== true) return { ok: false, reason: "storage_not_allowed" };
  if (legal.publicDisplayAllowed !== true) return { ok: false, reason: "public_display_not_allowed" };
  if (legal.modificationAllowed !== true) return { ok: false, reason: "modification_not_allowed" };
  if (legal.paidLicenseRequired === true) return { ok: false, reason: "paid_license_required" };
  if (legal.shareAlike === true && legal.shareAlikeCompatibleWithInfoUzel !== true) {
    return { ok: false, reason: "sharealike_incompatible" };
  }
  if (!hard) return { ok: true, reason: "soft_pass", legal };
  return { ok: true, reason: "approved", legal };
}

export function attachLegalProvenance(item, sourceEntry, legalEntry) {
  const out = Object.assign({}, item || {});
  out.legal = {
    providerId: sourceEntry && sourceEntry.id,
    datasetId: legalEntry && legalEntry.datasetId,
    distributionId: legalEntry && legalEntry.distributionId,
    legalRecordVersion: legalEntry && legalEntry.recordVersion,
    approvalStatus: legalEntry && legalEntry.status,
    attributionTemplateId: legalEntry && legalEntry.attributionTemplateId,
    fetchedAt: out.fetchedAt || out.firstSeenByInfoUzel || new Date().toISOString(),
    sourceUrl: out.url || out.originalUrl || "",
    modifications: "normalized-metadata-link-only",
  };
  return out;
}

export { LEGAL_PATH, SOURCE_PATH, REPO };
