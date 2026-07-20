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

const REQUIRED_FLAGS = Object.freeze([
  "commercialUseAllowed",
  "adSupportedUseAllowed",
  "sponsoredContentContextAllowed",
  "automationAllowed",
  "storageAllowed",
  "cacheAllowed",
  "publicDisplayAllowed",
  "modificationAllowed",
  "normalizationAllowed",
  "metadataEnrichmentAllowed",
  "combinationAllowed",
  "aggregationAllowed",
  "crossSourceDisplayAllowed",
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

function isHttpsUrl(v) {
  try {
    const u = new URL(String(v || ""));
    return u.protocol === "https:";
  } catch (_) {
    return false;
  }
}

function hasExternalEvidence(legal) {
  const ev = Array.isArray(legal.evidence) ? legal.evidence : [];
  return ev.some((e) => {
    if (typeof e === "string") return isHttpsUrl(e);
    if (e && typeof e === "object") return isHttpsUrl(e.url);
    return false;
  });
}

function reauditOk(legal, nowMs = Date.now()) {
  if (legal.suspended === true) return false;
  const due = Date.parse(String(legal.reauditDue || ""));
  if (!Number.isFinite(due)) return false;
  return due >= nowMs;
}

/**
 * Production ingest allowed only when source registry + legal registry pass hard gate.
 * Phase-2: requires concrete licenseUrl, evidence URL(s), field allowlist, fresh reaudit.
 */
export function canPublishFromSource(sourceEntry, legalRegistry, nowMs = Date.now()) {
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
  if (legal.suspended === true) return { ok: false, reason: "suspended" };
  if (!isApprovedStatus(legal.status)) {
    return { ok: false, reason: "legal_status_not_approved:" + legal.status };
  }
  for (const flag of REQUIRED_FLAGS) {
    if (legal[flag] !== true) return { ok: false, reason: "flag_false:" + flag };
  }
  if (legal.paidLicenseRequired === true) return { ok: false, reason: "paid_license_required" };
  if (legal.shareAlike === true && legal.shareAlikeCompatibleWithInfoUzel !== true) {
    return { ok: false, reason: "sharealike_incompatible" };
  }
  if (legal.odblOrShareAlikeRisk === true && legal.shareAlikeCompatibleWithInfoUzel !== true) {
    return { ok: false, reason: "odbl_sharealike_risk" };
  }
  if (!isHttpsUrl(legal.licenseUrl)) return { ok: false, reason: "missing_license_url" };
  if (!isHttpsUrl(legal.termsUrl)) return { ok: false, reason: "missing_terms_url" };
  if (!hasExternalEvidence(legal)) return { ok: false, reason: "missing_external_evidence" };
  if (!Array.isArray(legal.fieldAllowlist) || legal.fieldAllowlist.length < 2) {
    return { ok: false, reason: "missing_field_allowlist" };
  }
  if (!legal.datasetId || !legal.distributionId) return { ok: false, reason: "missing_dataset_distribution_ids" };
  if (!reauditOk(legal, nowMs)) return { ok: false, reason: "reaudit_expired_or_missing" };
  if (String(legal.status) === "APPROVED_WITH_SPECIFIC_CONDITIONS") {
    const cond = Array.isArray(legal.specificConditions) ? legal.specificConditions : [];
    if (cond.length < 1) return { ok: false, reason: "specific_conditions_empty" };
    if (!isHttpsUrl(legal.conditionsEvidenceUrl) && !hasExternalEvidence(legal)) {
      return { ok: false, reason: "specific_conditions_unproven" };
    }
  }
  if (!hard) return { ok: true, reason: "soft_pass", legal };
  return { ok: true, reason: "approved", legal };
}

export function renderAttribution(legalEntry, item, templates) {
  const tpls = templates || {};
  const id = legalEntry && legalEntry.attributionTemplateId;
  let tpl = null;
  for (const v of Object.values(tpls)) {
    if (v && v.id === id) tpl = v;
  }
  if (!tpl || !tpl.template) return "";
  const map = {
    institution: (legalEntry && (legalEntry.institution || legalEntry.providerLabel)) || "",
    datasetLabel: (legalEntry && legalEntry.datasetLabel) || "",
    licenseLabel: (legalEntry && legalEntry.licenseLabel) || "",
    licenseUrl: (legalEntry && legalEntry.licenseUrl) || "",
    sourceUrl: (item && (item.url || item.originalUrl)) || (legalEntry && legalEntry.distributionUrl) || "",
    provider: (legalEntry && legalEntry.providerLabel) || "",
  };
  return String(tpl.template).replace(/\{([a-zA-Z]+)\}/g, (_, k) => (map[k] != null ? String(map[k]) : ""));
}

export function attachLegalProvenance(item, sourceEntry, legalEntry, legalRegistry) {
  const out = Object.assign({}, item || {});
  const templates = (legalRegistry && legalRegistry.attributionTemplates) || {};
  out.legal = {
    providerId: sourceEntry && sourceEntry.id,
    datasetId: legalEntry && legalEntry.datasetId,
    distributionId: legalEntry && legalEntry.distributionId,
    legalRecordVersion: legalEntry && legalEntry.recordVersion,
    approvalStatus: legalEntry && legalEntry.status,
    attributionTemplateId: legalEntry && legalEntry.attributionTemplateId,
    attributionText: renderAttribution(legalEntry, out, templates),
    fetchedAt: out.fetchedAt || out.firstSeenByInfoUzel || new Date().toISOString(),
    sourceUrl: out.url || out.originalUrl || "",
    modifications: Array.isArray(legalEntry && legalEntry.transformations)
      ? legalEntry.transformations
      : ["normalized-metadata-link-only"],
    fieldAllowlist: (legalEntry && legalEntry.fieldAllowlist) || [],
  };
  return out;
}

export function applyFieldAllowlist(item, legalEntry) {
  const allow = new Set((legalEntry && legalEntry.fieldAllowlist) || []);
  if (!allow.size) return null;
  const out = {};
  for (const k of allow) {
    if (item && Object.prototype.hasOwnProperty.call(item, k)) out[k] = item[k];
  }
  // Always keep id/sourceId for pipeline integrity when present
  if (item && item.id != null) out.id = item.id;
  if (item && item.sourceId != null) out.sourceId = item.sourceId;
  return out;
}

export { LEGAL_PATH, SOURCE_PATH, REPO, REQUIRED_FLAGS };
