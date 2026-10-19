/** Canonical claim / evidence fingerprints v25 — explicit algorithm version. */
import { createHash } from "node:crypto";

export const FINGERPRINT_ALGO = "cor_fp_v25";

/** Publication-relevant field keys (sorted at hash time). */
export const NORMALIZED_CLAIM_FIELD_KEYS = Object.freeze([
  "advertiserId",
  "affiliateLink",
  "affiliateLinkVerified",
  "assortmentScope",
  "brandRestrictions",
  "campaignId",
  "cjCid",
  "cjPromotionId",
  "contractPermissionState",
  "couponCode",
  "currency",
  "customerDiscountUnit",
  "customerDiscountValue",
  "exclusions",
  "externalCampaignId",
  "landingUrl",
  "market",
  "marketingClaimText",
  "minOrderValue",
  "network",
  "offerDescription",
  "offerTitle",
  "offerType",
  "productId",
  "productVariant",
  "promotionId",
  "promotionTerms",
  "publisherCommissionUnit",
  "publisherCommissionValue",
  "redemptionTerms",
  "sourceUpdatedAt",
  "timezone",
  "validFrom",
  "validTo",
]);

const TECHNICAL_META_KEYS = new Set(["claimSequence", "contentFingerprint", "evidenceFingerprint", "normalizedFingerprint"]);

function digestHex(material) {
  return createHash("sha256").update(material, "utf8").digest("hex").slice(0, 32);
}

/** Deterministic JSON-like canonical value (not plain JSON.stringify on objects). */
export function canonValue(v) {
  if (v === undefined) return { m: "missing" };
  if (v === null) return { m: "null" };
  if (typeof v === "boolean") return { m: "bool", v };
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return { m: "str", v: String(v) };
    return { m: "num", v };
  }
  if (typeof v === "string") return { m: "str", v };
  if (Array.isArray(v)) return { m: "arr", v: v.map((x) => canonValue(x)) };
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return { m: "obj", v: keys.map((k) => [k, canonValue(v[k])]) };
  }
  return { m: "str", v: String(v) };
}

export function stableCanonJson(value) {
  return JSON.stringify(canonValue(value));
}

export function normalizedClaimFingerprint(input) {
  const fields = input?.fields || {};
  const body = NORMALIZED_CLAIM_FIELD_KEYS.map((k) => [k, canonValue(fields[k])]);
  return digestHex(`${FINGERPRINT_ALGO}|norm|${JSON.stringify(body)}`);
}

export function sourceEvidenceFingerprint(input) {
  const evidence = input?.evidence ?? {};
  return digestHex(`${FINGERPRINT_ALGO}|ev|${stableCanonJson(evidence)}`);
}

/** Combined material fingerprint — normalized claim + source evidence. */
export function claimContentFingerprint(input) {
  const norm = normalizedClaimFingerprint(input);
  const ev = sourceEvidenceFingerprint(input);
  return digestHex(`${FINGERPRINT_ALGO}|combo|${norm}|${ev}`);
}

export function eventDetailFingerprint(detail) {
  return digestHex(`${FINGERPRINT_ALGO}|evt|${stableCanonJson(detail ?? {})}`);
}

export function nextClaimSequence(priorClaimJson, contentFp, evidenceFp, offerAssignmentChanged, revisionAllowsCanonicalUpdate) {
  const priorMeta = priorClaimJson?.meta || {};
  const priorSeq = Number(priorMeta.claimSequence || 0);
  const priorFp = priorMeta.contentFingerprint || null;
  const priorEv = priorMeta.evidenceFingerprint || null;
  if (!priorClaimJson) {
    return {
      claimSequence: 1,
      contentFingerprint: contentFp,
      evidenceFingerprint: evidenceFp,
      materialChange: true,
      priorSequence: 0,
      priorContentFingerprint: null,
      priorEvidenceFingerprint: null,
    };
  }
  const contentChanged = priorFp !== contentFp || priorEv !== evidenceFp;
  const materialChange = revisionAllowsCanonicalUpdate !== false && (contentChanged || offerAssignmentChanged);
  if (!materialChange) {
    return {
      claimSequence: priorSeq,
      contentFingerprint: priorFp || contentFp,
      evidenceFingerprint: priorEv || evidenceFp,
      materialChange: false,
      priorSequence: priorSeq,
      priorContentFingerprint: priorFp,
      priorEvidenceFingerprint: priorEv,
    };
  }
  return {
    claimSequence: priorSeq + 1,
    contentFingerprint: contentFp,
    evidenceFingerprint: evidenceFp,
    materialChange: true,
    priorSequence: priorSeq,
    priorContentFingerprint: priorFp,
    priorEvidenceFingerprint: priorEv,
  };
}

export function conflictsFingerprint(conflicts) {
  const norm = (conflicts || [])
    .map((c) => ({ type: c.type, signatures: c.signatures || [], sources: c.sources || [] }))
    .sort((a, b) => a.type.localeCompare(b.type));
  return createHash("sha256").update(JSON.stringify(norm), "utf8").digest("hex").slice(0, 24);
}

/** @deprecated v24 alias */
export { claimContentFingerprint as claimContentFingerprintV25 };
