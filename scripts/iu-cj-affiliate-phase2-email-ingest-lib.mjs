#!/usr/bin/env node
/** CJ partner email ingest — pure logic (no IMAP, no persistence, no v15 changes). */
import { createHash, createHmac } from "node:crypto";
import {
  OFFLINE_PRODUCTION_SEAL_SIMULATION_MARKER,
  vaultActivateProductionTrustContext,
  vaultConfigureProductionKeyMaterial,
  vaultHarnessResetProductionKeyState,
  vaultIsProductionKeyConfigured,
  vaultIsProductionTrustContextLocked,
  vaultVerifyProductionHmacHex,
} from "./iu-cj-affiliate-phase2-email-ingest-production-trust-vault.mjs";
import {
  COMMERCIAL_ACTION_DEDUP_IMAP_PIPELINE_ATTESTATION_V20,
  IMAP_PIPELINE_ATTESTATION_SOURCE_V20,
  verifyImapPipelineAttestationOnRecord,
} from "./iu-cj-affiliate-phase2-email-ingest-imap-pipeline-seal.mjs";

export const EMAIL_INGEST_RULES_VERSION = "iu-cj-affiliate-phase2-email-ingest-v24";

/** Fail-closed: offline library never creates production HMAC seals (v21). */
export const PRODUCTION_SIGNING_ENABLED = false;

export const PRODUCTION_DEDUP_TRUST_STATUS = "BLOCKED – AWAITING TRUSTED ADAPTER";

export { COMMERCIAL_ACTION_DEDUP_IMAP_PIPELINE_ATTESTATION_V20 };

export const PRODUCTION_DEDUP_TRUST_BLOCKED_REASON = "blocked_awaiting_trusted_imap_adapter";

/** Set only by pipeline seal helper — required for dedup trust. */
export const COMMERCIAL_ACTION_DEDUP_PIPELINE_SEAL_PROVENANCE = "iu_cj_email_ingest_pipeline_seal_authority_v19";

/** Marker on keys built only via buildOfflineTestMailboxMessageKey (not production). */
export const OFFLINE_TEST_MAILBOX_KEY_HELPER = "iu_cj_email_ingest_offline_test_mailbox_key_v1";

/** Canonical mailbox key hash input format (v2 — length-safe, no delimiter ambiguity). */
export const MAILBOX_KEY_CANONICAL_VERSION = 2;

/** Canonical commercial action key hash input format (v2 — JSON, no pipe-join ambiguity). */
export const COMMERCIAL_ACTION_KEY_CANONICAL_VERSION = 2;

/** Trust marker set only by future IMAP adapter — not from e-mail body. */
export const IMAP_ADAPTER_TRUST_SOURCE = "iu_cj_imap_adapter_identity_v1";

/** Offline selftest-only marker; never accepted in productionMode. */
export const SYNTHETIC_TEST_IDENTITY_MODE = "iu_cj_email_ingest_synthetic_test_identity_v1";

/** Set only by pipeline helpers (never from partner e-mail body). */
export const COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE = "iu_cj_email_ingest_pipeline_identity_v1";

/** HMAC seal version on persisted dedup records. */
export const COMMERCIAL_ACTION_DEDUP_SEAL_VERSION = 2;

export const COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_OFFLINE_SELFTEST = "offline_selftest_v1";
export const COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_PRODUCTION = "production_worker_v1";

export const COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_PRODUCTION = "production_worker";
export const COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_OFFLINE_SELFTEST = "offline_selftest";

/** v13 audit repro only — public material (do not use for trust decisions). */
export const COMMERCIAL_ACTION_DEDUP_SEAL_LEGACY_V13_PUBLIC_MATERIAL = "iu_cj_email_ingest_offline_dedup_seal_material_v1";

let offlineSelftestSealKeyMaterial = null;
let defaultPipelineDedupSealAuthority = null;
let activeCommercialActionDedupTrustContext = null;
const activeDedupSealAuthorityTokens = new Set();
const productionVaultBoundAuthorityTokens = new Set();
let offlineSelftestSealKeyMaterialForCollisionCheck = null;

export const IMAP_UID_MAX = 4294967295;

export const MAILBOX_DEFAULT = "info@infouzel.cz";
export const CJ_MEMBER_MESSAGING_FROM = "owner-membermessaging@mx6.cj.com";

export const BRANCH = Object.freeze({
  commercial: "commercial",
  contract: "contract",
  mixed: "mixed_requires_split",
  unknown: "unknown",
});

export const COMMERCIAL_KIND = Object.freeze({
  coupon_offer: "coupon_offer",
  multi_action_promo: "multi_action_promo",
  commission_change: "commission_change",
  marketing_inspiration: "marketing_inspiration",
  program_welcome: "program_welcome",
  territorial_promo: "territorial_promo",
  shipping_promo: "shipping_promo",
});

export const CONTRACT_KIND = Object.freeze({
  program_terms_notice: "program_terms_notice",
  terms_attachment_candidate: "terms_attachment_candidate",
  program_termination: "program_termination",
  creative_rights_change: "creative_rights_change",
  unknown_terms_reference: "unknown_terms_reference",
});

export const PROCESSING_STATE = Object.freeze({
  pending: "pending",
  parsed: "parsed",
  needs_review: "needs_review",
  quarantined: "quarantined",
  duplicate_skipped: "duplicate_skipped",
  original_unavailable: "original_unavailable",
});

export const VERIFICATION_STATE = Object.freeze({
  unverified: "unverified",
  mailbox_resolvable: "mailbox_resolvable",
  mailbox_missing: "mailbox_missing",
  reverify_required: "reverify_required",
});

export const TERRITORY_SIGNAL = Object.freeze({
  cz_explicit: "cz_explicit",
  cz_absent_foreign_only: "cz_absent_foreign_only",
  cz_excluded: "cz_excluded",
  ambiguous_between_actions: "ambiguous_between_actions",
  unknown: "unknown",
});

const LINK_ID = /\bLINK\s*ID[:\s]+(\d{6,})\b/i;
const CID_TOKEN = /\bCID[:\s]+(\d{6,})\b/i;
const COUPON_INLINE = /\b(?:kupón|kód|code|coupon)[:\s,—-]+([A-Z0-9]{4,})\b/i;
const KUPON_PREFIX = /^\s*Kupón[:\s]+([A-Z0-9]+)/i;
const MARKET_LIST = /\b(?:trhy|markets|countries|trh|market)[:\s]+([A-Z]{2}(?:\s*,\s*[A-Z]{2})*)/i;
const DISCOUNT_START = /\bDiscount\s+(\d{1,2})\s*%/i;
const MIN_ORDER = /min\.?\s*nákup\s*([\d\s]+)\s*Kč/i;

export function validateImapIntegerField(value, fieldName) {
  if (value === null || value === undefined) {
    return { ok: false, reason: fieldName + "_missing" };
  }
  if (typeof value === "boolean") {
    return { ok: false, reason: fieldName + "_invalid_type" };
  }
  if (typeof value === "object") {
    return { ok: false, reason: fieldName + "_invalid_type" };
  }
  let n;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, reason: fieldName + "_non_integer" };
    }
    n = value;
  } else if (typeof value === "string") {
    if (value.length === 0) {
      return { ok: false, reason: fieldName + "_missing" };
    }
    if (/\s/.test(value)) {
      return { ok: false, reason: fieldName + "_invalid_format" };
    }
    if (!/^\d+$/.test(value)) {
      return { ok: false, reason: fieldName + "_invalid_format" };
    }
    const big = BigInt(value);
    if (big <= 0n || big > BigInt(IMAP_UID_MAX)) {
      return { ok: false, reason: big <= 0n ? fieldName + "_non_positive" : fieldName + "_exceeds_imap32" };
    }
    n = Number(value);
    if (!Number.isSafeInteger(n)) {
      return { ok: false, reason: fieldName + "_exceeds_imap32" };
    }
  } else {
    return { ok: false, reason: fieldName + "_invalid_type" };
  }
  if (n <= 0) return { ok: false, reason: fieldName + "_non_positive" };
  if (n > IMAP_UID_MAX) return { ok: false, reason: fieldName + "_exceeds_imap32" };
  return { ok: true, value: n };
}

const IMAP_CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

export function validateMailboxAddressField(mailbox) {
  if (typeof mailbox !== "string") {
    return { ok: false, reason: "invalid_mailbox_type" };
  }
  if (IMAP_CONTROL_CHAR_RE.test(mailbox)) {
    return { ok: false, reason: "mailbox_invalid_control_char" };
  }
  const trimmed = mailbox.trim();
  if (!trimmed) {
    return { ok: false, reason: "invalid_mailbox_address" };
  }
  const mb = trimmed.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mb)) {
    return { ok: false, reason: "invalid_mailbox_address" };
  }
  return { ok: true, mailbox: mb };
}

export function validateImapFolderField(folder) {
  if (typeof folder !== "string") {
    return { ok: false, reason: "invalid_folder_type" };
  }
  if (folder.length === 0) {
    return { ok: false, reason: "invalid_folder" };
  }
  if (IMAP_CONTROL_CHAR_RE.test(folder)) {
    return { ok: false, reason: "folder_invalid_control_char" };
  }
  return { ok: true, folder };
}

export function validateMailboxIdentityFields({ mailbox, folder }) {
  const mbVal = validateMailboxAddressField(mailbox);
  if (!mbVal.ok) return mbVal;
  const fdVal = validateImapFolderField(folder);
  if (!fdVal.ok) return fdVal;
  return { ok: true, mailbox: mbVal.mailbox, folder: fdVal.folder };
}

export function buildCanonicalMailboxKeyDigestInput({ mailbox, folder, uidvalidity, uid }) {
  return JSON.stringify({
    v: MAILBOX_KEY_CANONICAL_VERSION,
    mailbox,
    folder,
    uidvalidity,
    uid,
  });
}

export function isVerifiedMailboxKeyRecord(key) {
  return isStructurallyValidMailboxKeyRecord(key);
}

export function isStructurallyValidMailboxKeyRecord(key) {
  if (!key || key.ok !== true || typeof key.keyId !== "string" || !key.keyId) return false;
  if (typeof key.mailbox !== "string" || typeof key.folder !== "string") return false;
  if (key.uid == null || key.uidvalidity == null) return false;
  const rebuilt = buildMailboxMessageKey({
    mailbox: key.mailbox,
    folder: key.folder,
    uidvalidity: key.uidvalidity,
    uid: key.uid,
  });
  return rebuilt.ok === true && rebuilt.keyId === key.keyId;
}

export function isDedupTrustEligibleMailboxKey(mailboxKey) {
  if (!isStructurallyValidMailboxKeyRecord(mailboxKey)) return false;
  if (activeCommercialActionDedupTrustContext === COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_PRODUCTION) {
    return mailboxKey.identityTrustSource === IMAP_ADAPTER_TRUST_SOURCE;
  }
  if (activeCommercialActionDedupTrustContext === COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_OFFLINE_SELFTEST) {
    return (
      mailboxKey.offlineTestMailboxKeyHelper === OFFLINE_TEST_MAILBOX_KEY_HELPER ||
      mailboxKey.identityMode === SYNTHETIC_TEST_IDENTITY_MODE
    );
  }
  return false;
}

/** Offline prod-lock tests only — simulates future IMAP adapter trust stamp. */
export function applyImapAdapterTrustToMailboxKeyForOfflineSimulation(mailboxKey, options = {}) {
  if (!mailboxKey?.ok) return mailboxKey;
  const simulationOnly = options.simulationOnly !== false;
  return {
    ...mailboxKey,
    identityTrustSource: IMAP_ADAPTER_TRUST_SOURCE,
    ...(simulationOnly ? { imapAdapterTrustSimulationOnly: true } : {}),
  };
}

export function productionSealWouldCollideWithOfflineSelftestMaterial(proposedMaterial) {
  return (
    offlineSelftestSealKeyMaterialForCollisionCheck != null &&
    proposedMaterial === offlineSelftestSealKeyMaterialForCollisionCheck
  );
}

function collectMissingMailboxKeyFields({ mailbox, folder, uidvalidity, uid }) {
  const reasons = {};
  if (mailbox === undefined || mailbox === null) {
    reasons.mailbox = "mailbox_missing";
  } else if (typeof mailbox !== "string" || mailbox.trim() === "") {
    reasons.mailbox = "mailbox_missing";
  }
  if (folder === undefined || folder === null) {
    reasons.folder = "folder_missing";
  } else if (typeof folder !== "string" || folder.length === 0) {
    reasons.folder = "folder_missing";
  }
  if (uidvalidity === undefined || uidvalidity === null) reasons.uidvalidity = "uidvalidity_missing";
  if (uid === undefined || uid === null) reasons.uid = "uid_missing";
  return reasons;
}

/**
 * Offline selftest/fixture helper — may apply default mailbox/folder; not for production ingest.
 */
export function buildOfflineTestMailboxMessageKey({
  mailbox = MAILBOX_DEFAULT,
  folder = "INBOX",
  uidvalidity,
  uid,
  messageIdHeader = null,
  testCaseId = null,
}) {
  const built = buildMailboxMessageKey({ mailbox, folder, uidvalidity, uid, messageIdHeader });
  if (!built.ok) return built;
  return {
    ...built,
    offlineTestMailboxKeyHelper: OFFLINE_TEST_MAILBOX_KEY_HELPER,
    offlineTestCaseId: testCaseId ? String(testCaseId) : null,
  };
}

/** Explicit offline test key — not a substitute for missing production IMAP fields. */
export function buildSyntheticTestMailboxKey({
  mailbox = MAILBOX_DEFAULT,
  folder = "INBOX",
  uidvalidity,
  uid,
  messageIdHeader = null,
  testCaseId = null,
}) {
  const built = buildOfflineTestMailboxMessageKey({
    mailbox,
    folder,
    uidvalidity,
    uid,
    messageIdHeader,
    testCaseId,
  });
  if (!built.ok) return built;
  return {
    ...built,
    identityMode: SYNTHETIC_TEST_IDENTITY_MODE,
    productionImapIdentity: false,
    syntheticTestCaseId: testCaseId ? String(testCaseId) : null,
  };
}

function collectMissingProductionImapFields(message = {}) {
  const reasons = {};
  if (typeof message.mailbox !== "string" || message.mailbox.trim() === "") {
    reasons.mailbox = "mailbox_missing";
  }
  if (typeof message.folder !== "string" || message.folder.length === 0) {
    reasons.folder = "folder_missing";
  }
  if (message.uid == null) reasons.uid = "uid_missing";
  if (message.uidvalidity == null) reasons.uidvalidity = "uidvalidity_missing";
  return reasons;
}

/** Build canonical production key from explicit message fields only (no defaults). */
export function buildProductionMailboxKeyFromMessage(message = {}) {
  const missing = collectMissingProductionImapFields(message);
  if (Object.keys(missing).length > 0) {
    return { ok: false, reason: "missing_imap_identity", reasons: missing, mailboxKey: null };
  }
  const built = buildMailboxMessageKey({
    mailbox: message.mailbox,
    folder: message.folder,
    uidvalidity: message.uidvalidity,
    uid: message.uid,
    messageIdHeader: message.messageIdHeader || null,
  });
  if (!built.ok) {
    return { ok: false, reason: "invalid_mailbox_identity", reasons: built.reasons, mailboxKey: null };
  }
  return { ok: true, reason: null, reasons: null, mailboxKey: built };
}

function confirmKeyMatchesCanonical(mailboxKeyConfirm, canonical, { allowSynthetic = false } = {}) {
  if (mailboxKeyConfirm == null) return { ok: true };
  if (mailboxKeyConfirm.verified === true && !mailboxKeyConfirm.keyId) {
    return { ok: false, reason: "unverified_mailbox_key_confirm", reasons: { override: "verified_flag_not_trusted" } };
  }
  if (!isVerifiedMailboxKeyRecord(mailboxKeyConfirm)) {
    return {
      ok: false,
      reason: "unverified_mailbox_key_confirm",
      reasons: { override: "incomplete_or_spoofed_mailbox_key" },
    };
  }
  if (!allowSynthetic && mailboxKeyConfirm.identityMode === SYNTHETIC_TEST_IDENTITY_MODE) {
    return {
      ok: false,
      reason: "synthetic_identity_rejected_in_production",
      reasons: { identityMode: "synthetic_not_allowed" },
    };
  }
  if (mailboxKeyConfirm.keyId !== canonical.keyId) {
    return { ok: false, reason: "mailbox_key_confirm_mismatch", reasons: { keyId: "canonical_mismatch" } };
  }
  return { ok: true };
}

/**
 * Production IMAP identity — all four fields required on message; optional confirm key must match canonical.
 * A confirm/override object never substitutes missing message fields.
 */
export function resolveProductionMailboxIdentity(message = {}, mailboxKeyConfirm = null) {
  const builtRes = buildProductionMailboxKeyFromMessage(message);
  if (!builtRes.ok) return builtRes;
  const confirmRes = confirmKeyMatchesCanonical(mailboxKeyConfirm, builtRes.mailboxKey, { allowSynthetic: false });
  if (!confirmRes.ok) {
    return { ok: false, reason: confirmRes.reason, reasons: confirmRes.reasons, mailboxKey: null };
  }
  return { ok: true, reason: null, reasons: null, mailboxKey: builtRes.mailboxKey };
}

/** @deprecated Use resolveProductionMailboxIdentity — kept for audit references only. */
export function resolveMessageMailboxIdentity(message = {}, mailboxKeyOverride = null) {
  return resolveProductionMailboxIdentity(message, mailboxKeyOverride);
}

/**
 * Offline selftest path — same explicit fields; may confirm with synthetic test keys (never for production/D1).
 */
export function resolveOfflineTestMailboxIdentity(message = {}, mailboxKeyConfirm = null) {
  const builtRes = buildProductionMailboxKeyFromMessage(message);
  if (!builtRes.ok) return builtRes;
  const confirmRes = confirmKeyMatchesCanonical(mailboxKeyConfirm, builtRes.mailboxKey, { allowSynthetic: true });
  if (!confirmRes.ok) {
    return { ok: false, reason: confirmRes.reason, reasons: confirmRes.reasons, mailboxKey: null };
  }
  const mk =
    mailboxKeyConfirm && mailboxKeyConfirm.identityMode === SYNTHETIC_TEST_IDENTITY_MODE
      ? { ...mailboxKeyConfirm, offlineTestOnly: true }
      : {
          ...builtRes.mailboxKey,
          identityMode: SYNTHETIC_TEST_IDENTITY_MODE,
          offlineTestOnly: true,
        };
  return { ok: true, reason: null, reasons: null, mailboxKey: mk };
}

function rejectForgedAdapterTrustFlags(envelope) {
  if (envelope.trusted === true || envelope.verified === true || envelope.ok === true) {
    return { ok: false, reason: "forged_adapter_trust_flags", mailboxKey: null };
  }
  if (envelope.mailboxIdentity?.trusted === true || envelope.mailboxIdentity?.verified === true) {
    return { ok: false, reason: "forged_adapter_trust_flags", mailboxKey: null };
  }
  return null;
}

/**
 * Structural parse only — does NOT authenticate FORPSI/IMAP session (offline library cannot).
 */
export function parseImapAdapterIdentityEnvelopeStructure(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return {
      structuralOk: false,
      reason: "missing_adapter_envelope",
      mailboxKey: null,
      authenticationStatus: "not_authenticated",
      trustedForProduction: false,
    };
  }
  const forged = rejectForgedAdapterTrustFlags(envelope);
  if (forged) {
    return {
      structuralOk: false,
      reason: forged.reason,
      mailboxKey: null,
      authenticationStatus: "not_authenticated",
      trustedForProduction: false,
    };
  }
  if (envelope.adapterTrustSource !== IMAP_ADAPTER_TRUST_SOURCE) {
    return {
      structuralOk: false,
      reason: "untrusted_adapter_source",
      mailboxKey: null,
      authenticationStatus: "not_authenticated",
      trustedForProduction: false,
    };
  }
  if (envelope.provenanceFromEmailBody === true) {
    return {
      structuralOk: false,
      reason: "identity_from_body_rejected",
      mailboxKey: null,
      authenticationStatus: "not_authenticated",
      trustedForProduction: false,
    };
  }
  const id = envelope.mailboxIdentity;
  if (!id || typeof id !== "object" || Array.isArray(id)) {
    return {
      structuralOk: false,
      reason: "missing_mailbox_identity",
      mailboxKey: null,
      authenticationStatus: "not_authenticated",
      trustedForProduction: false,
    };
  }
  const built = buildMailboxMessageKey({
    mailbox: id.mailbox,
    folder: id.folder,
    uid: id.uid,
    uidvalidity: id.uidvalidity,
  });
  if (!built.ok) {
    return {
      structuralOk: false,
      reason: "invalid_mailbox_identity",
      reasons: built.reasons,
      mailboxKey: null,
      authenticationStatus: "not_authenticated",
      trustedForProduction: false,
    };
  }
  return {
    structuralOk: true,
    reason: null,
    adapterTrustSource: envelope.adapterTrustSource,
    adapterSessionRef: envelope.adapterSessionRef || null,
    mailboxKey: built,
    authenticationStatus: "structure_only_offline",
    trustedForProduction: false,
  };
}

/** @deprecated Use parseImapAdapterIdentityEnvelopeStructure — never implies authenticated production message. */
export function validateImapAdapterIdentityEnvelope(envelope) {
  const parsed = parseImapAdapterIdentityEnvelopeStructure(envelope);
  return {
    ok: parsed.structuralOk,
    reason: parsed.reason,
    reasons: parsed.reasons || null,
    adapterTrustSource: parsed.adapterTrustSource || null,
    adapterSessionRef: parsed.adapterSessionRef || null,
    mailboxKey: parsed.mailboxKey,
    authenticationStatus: parsed.authenticationStatus,
    trustedForProduction: false,
  };
}

export function assertMessageIdentityMatchesAdapter(message = {}, adapterMailboxKey) {
  if (!adapterMailboxKey?.ok) {
    return { ok: false, reason: "invalid_adapter_mailbox_key" };
  }
  const checks = [
    ["mailbox", message.mailbox, adapterMailboxKey.mailbox],
    ["folder", message.folder, adapterMailboxKey.folder],
    ["uid", message.uid, adapterMailboxKey.uid],
    ["uidvalidity", message.uidvalidity, adapterMailboxKey.uidvalidity],
  ];
  for (const [field, msgVal, adapterVal] of checks) {
    if (msgVal == null) continue;
    if ((field === "mailbox" || field === "folder") && String(msgVal).trim() === "") continue;
    const normMsg = field === "mailbox" ? String(msgVal).trim().toLowerCase() : msgVal;
    if (normMsg !== adapterVal) {
      return { ok: false, reason: "message_adapter_identity_conflict", reasons: { [field]: "mismatch" } };
    }
  }
  return { ok: true };
}

/** Primary message identity: all four IMAP fields required — no implicit mailbox or folder. */
export function buildMailboxMessageKey({ mailbox, folder, uidvalidity, uid, messageIdHeader = null }) {
  const missing = collectMissingMailboxKeyFields({ mailbox, folder, uidvalidity, uid });
  if (Object.keys(missing).length > 0) {
    return {
      ok: false,
      error: "invalid_mailbox_identity",
      reasons: {
        mailbox: missing.mailbox || null,
        folder: missing.folder || null,
        uidvalidity: missing.uidvalidity || null,
        uid: missing.uid || null,
      },
      keyId: null,
      messageIdHeader: messageIdHeader ? String(messageIdHeader).trim() : null,
      messageIdTrustedUnique: false,
    };
  }
  const mbVal = validateMailboxIdentityFields({ mailbox, folder });
  const uvVal = validateImapIntegerField(uidvalidity, "uidvalidity");
  const uidVal = validateImapIntegerField(uid, "uid");
  if (!mbVal.ok || !uvVal.ok || !uidVal.ok) {
    return {
      ok: false,
      error: "invalid_mailbox_identity",
      reasons: {
        mailbox: mbVal.ok ? null : mbVal.reason,
        folder: mbVal.ok ? null : mbVal.reason,
        uidvalidity: uvVal.ok ? null : uvVal.reason,
        uid: uidVal.ok ? null : uidVal.reason,
      },
      keyId: null,
      messageIdHeader: messageIdHeader ? String(messageIdHeader).trim() : null,
      messageIdTrustedUnique: false,
    };
  }
  const canonicalInput = buildCanonicalMailboxKeyDigestInput({
    mailbox: mbVal.mailbox,
    folder: mbVal.folder,
    uidvalidity: uvVal.value,
    uid: uidVal.value,
  });
  const digest = createHash("sha256").update(canonicalInput, "utf8").digest("hex").slice(0, 32);
  return {
    ok: true,
    keyId: "mbk2_" + digest,
    keyCanonicalVersion: MAILBOX_KEY_CANONICAL_VERSION,
    mailbox: mbVal.mailbox,
    folder: mbVal.folder,
    uidvalidity: uvVal.value,
    uid: uidVal.value,
    messageIdHeader: messageIdHeader ? String(messageIdHeader).trim() : null,
    messageIdTrustedUnique: false,
  };
}

/** v10 audit repro — permissive Number() coercion (do not use in production paths). */
export function validateCommercialActionIndexLegacyV10(actionIndex) {
  if (actionIndex === undefined || actionIndex === null) {
    return { ok: false, reason: "action_index_missing" };
  }
  if (typeof actionIndex === "object" || typeof actionIndex === "boolean") {
    return { ok: false, reason: "invalid_action_index_type" };
  }
  const n = Number(actionIndex);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, reason: "invalid_action_index" };
  }
  return { ok: true, value: n };
}

/** Production contract: parser loop index only — safe non-negative integer (typeof number). */
export function validateCommercialActionIndex(actionIndex) {
  if (actionIndex === undefined || actionIndex === null) {
    return { ok: false, reason: "action_index_missing" };
  }
  if (typeof actionIndex !== "number") {
    return { ok: false, reason: "invalid_action_index_type" };
  }
  if (!Number.isSafeInteger(actionIndex) || actionIndex < 0) {
    return { ok: false, reason: "invalid_action_index" };
  }
  return { ok: true, value: actionIndex };
}

export function validateBlockFingerprintField(blockFingerprint) {
  if (blockFingerprint === undefined || blockFingerprint === null) {
    return { ok: false, reason: "block_fingerprint_missing" };
  }
  if (typeof blockFingerprint !== "string") {
    return { ok: false, reason: "invalid_block_fingerprint_type" };
  }
  return { ok: true, value: blockFingerprint };
}

export function buildCanonicalCommercialActionDigestInput({ mailboxKeyId, actionIndex, blockFingerprint }) {
  return JSON.stringify({
    v: COMMERCIAL_ACTION_KEY_CANONICAL_VERSION,
    mailboxKeyId,
    actionIndex,
    blockFingerprint,
  });
}

/** v9 pipe-join (ambiguous) — audit repro only; not used for new keys. */
export function buildLegacyCommercialActionKeyDigestInputV9(mailboxKey, actionIndex, blockFingerprint) {
  if (!mailboxKey?.ok || !mailboxKey.keyId) return null;
  return [mailboxKey.keyId, String(actionIndex), String(blockFingerprint || "")].join("|");
}

export function buildCommercialActionKeyLegacyV9(mailboxKey, actionIndex, blockFingerprint) {
  const preHash = buildLegacyCommercialActionKeyDigestInputV9(mailboxKey, actionIndex, blockFingerprint);
  if (preHash == null) return null;
  const digest = createHash("sha256").update(preHash, "utf8").digest("hex").slice(0, 24);
  return "cak_" + digest;
}

export function classifyCommercialActionKeyFormat(commercialActionKey) {
  if (typeof commercialActionKey !== "string" || commercialActionKey.length === 0) return "invalid";
  if (/^cak2_[a-f0-9]{24}$/.test(commercialActionKey)) return "canonical_v2";
  if (/^cak_[a-f0-9]{24}$/.test(commercialActionKey)) return "legacy_v9_pipe";
  return "unknown";
}

export function normalizeCommercialActionDedupRecord(entry) {
  if (entry == null) return { commercialActionKey: null };
  if (typeof entry === "string") return { commercialActionKey: entry };
  return {
    commercialActionKey: entry.commercialActionKey ?? null,
    mailboxKeyId: entry.mailboxKeyId ?? entry.mailboxKey?.keyId ?? null,
    mailbox: entry.mailbox ?? entry.mailboxKey?.mailbox ?? null,
    folder: entry.folder ?? entry.mailboxKey?.folder ?? null,
    uid: entry.uid ?? entry.mailboxKey?.uid ?? null,
    uidvalidity: entry.uidvalidity ?? entry.mailboxKey?.uidvalidity ?? null,
    actionIndex: entry.actionIndex ?? entry.commercialActionIndex ?? null,
    blockFingerprint: entry.blockFingerprint ?? entry.rawBlockFingerprint ?? null,
    advertiserCid: entry.advertiserCid ?? null,
    territorySignal: entry.territorySignal ?? entry.territory?.signal ?? null,
    identityTrustSource: entry.identityTrustSource ?? null,
    identityTrustSeal: entry.identityTrustSeal ?? null,
    identityTrustSealVersion: entry.identityTrustSealVersion ?? null,
    identityTrustSealProfile: entry.identityTrustSealProfile ?? null,
    identityTrustSealProvenance: entry.identityTrustSealProvenance ?? null,
    identityTrustSealAuthorityToken: entry.identityTrustSealAuthorityToken ?? null,
    identityImapPipelineAttestation: entry.identityImapPipelineAttestation ?? null,
    identityImapPipelineAttestationSource: entry.identityImapPipelineAttestationSource ?? null,
    identityImapAdapterSessionRef: entry.identityImapAdapterSessionRef ?? null,
    verified: entry.verified === true ? true : null,
  };
}

export function initCommercialActionDedupOfflineSelftestSeal(sealKeyMaterial) {
  if (vaultIsProductionTrustContextLocked()) {
    return { ok: false, reason: "production_trust_context_locked" };
  }
  if (typeof sealKeyMaterial !== "string" || sealKeyMaterial.length < 16) {
    return { ok: false, reason: "invalid_offline_selftest_seal_material" };
  }
  offlineSelftestSealKeyMaterial = sealKeyMaterial;
  offlineSelftestSealKeyMaterialForCollisionCheck = sealKeyMaterial;
  return { ok: true, profile: COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_OFFLINE_SELFTEST };
}

export function configureCommercialActionDedupProductionSealFromEnvironment() {
  const envKey = process.env.IU_CJ_EMAIL_INGEST_DEDUP_SEAL_KEY;
  if (typeof envKey !== "string" || envKey.length < 16) {
    return { ok: false, reason: "production_dedup_seal_key_missing" };
  }
  const assigned = vaultConfigureProductionKeyMaterial(envKey);
  if (!assigned.ok) return assigned;
  return { ok: true, profile: COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_PRODUCTION, idempotent: assigned.idempotent === true };
}

export function activateCommercialActionDedupProductionTrustContext() {
  if (!vaultIsProductionKeyConfigured()) {
    return { ok: false, reason: "production_dedup_seal_key_missing" };
  }
  if (
    vaultIsProductionTrustContextLocked() &&
    activeCommercialActionDedupTrustContext === COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_PRODUCTION
  ) {
    return { ok: true, context: activeCommercialActionDedupTrustContext, alreadyActive: true, locked: true };
  }
  if (vaultIsProductionTrustContextLocked()) {
    return { ok: false, reason: "production_trust_context_locked" };
  }
  const vaultLock = vaultActivateProductionTrustContext();
  if (!vaultLock.ok) return vaultLock;
  activeCommercialActionDedupTrustContext = COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_PRODUCTION;
  return { ok: true, context: activeCommercialActionDedupTrustContext, locked: true };
}

export function activateCommercialActionDedupOfflineSelftestTrustContext() {
  if (vaultIsProductionTrustContextLocked()) {
    return { ok: false, reason: "production_trust_context_locked" };
  }
  if (!offlineSelftestSealKeyMaterial) {
    return { ok: false, reason: "offline_selftest_seal_not_configured" };
  }
  activeCommercialActionDedupTrustContext = COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_OFFLINE_SELFTEST;
  return { ok: true, context: activeCommercialActionDedupTrustContext };
}

export function getCommercialActionDedupTrustContextStatus() {
  return {
    activeContext: activeCommercialActionDedupTrustContext,
    productionTrustContextLocked: vaultIsProductionTrustContextLocked(),
    productionKeyConfigured: vaultIsProductionKeyConfigured(),
    offlineSelftestKeyConfigured: offlineSelftestSealKeyMaterial != null,
  };
}

/** Offline selftest harness — reset keys/context (refused after production lock). */
export function resetCommercialActionDedupTrustStateForOfflineSelftestHarness() {
  if (vaultIsProductionTrustContextLocked()) {
    return { ok: false, reason: "production_trust_context_locked" };
  }
  offlineSelftestSealKeyMaterial = null;
  offlineSelftestSealKeyMaterialForCollisionCheck = null;
  const vaultReset = vaultHarnessResetProductionKeyState();
  if (!vaultReset.ok) return vaultReset;
  defaultPipelineDedupSealAuthority = null;
  activeCommercialActionDedupTrustContext = null;
  activeDedupSealAuthorityTokens.clear();
  productionVaultBoundAuthorityTokens.clear();
  return { ok: true };
}

function sealProfilePermittedInActiveTrustContext(profile) {
  if (activeCommercialActionDedupTrustContext === COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_PRODUCTION) {
    if (profile !== COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_PRODUCTION) {
      return { ok: false, reason: "seal_profile_rejected_in_production_context" };
    }
    return { ok: true };
  }
  if (activeCommercialActionDedupTrustContext === COMMERCIAL_ACTION_DEDUP_TRUST_CONTEXT_OFFLINE_SELFTEST) {
    if (profile !== COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_OFFLINE_SELFTEST) {
      return { ok: false, reason: "seal_profile_rejected_in_offline_selftest_context" };
    }
    return { ok: true };
  }
  return { ok: false, reason: "dedup_trust_context_unconfigured" };
}

function sealAuthorityPermittedInActiveTrustContext(sealAuthority) {
  if (!sealAuthority?.profile) return { ok: false, reason: "invalid_seal_authority" };
  return sealProfilePermittedInActiveTrustContext(sealAuthority.profile);
}

export function registerDefaultPipelineDedupSealAuthority(sealAuthority) {
  if (!sealAuthority?.authorityToken || !activeDedupSealAuthorityTokens.has(sealAuthority.authorityToken)) {
    return { ok: false, reason: "invalid_seal_authority" };
  }
  if (sealAuthority.profile === COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_PRODUCTION) {
    return { ok: false, reason: "production_seal_authority_not_publicly_registerable_v20" };
  }
  const ctxPerm = sealAuthorityPermittedInActiveTrustContext(sealAuthority);
  if (!ctxPerm.ok) return ctxPerm;
  defaultPipelineDedupSealAuthority = sealAuthority;
  return { ok: true };
}

export function createCommercialActionDedupSealAuthorityForOfflineSelftest() {
  if (vaultIsProductionTrustContextLocked()) return null;
  if (!offlineSelftestSealKeyMaterial) return null;
  const authorityToken = createHash("sha256")
    .update("iu_cj_dedup_seal_authority_offline_v14:" + offlineSelftestSealKeyMaterial, "utf8")
    .digest("hex");
  activeDedupSealAuthorityTokens.add(authorityToken);
  return {
    authorityToken,
    profile: COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_OFFLINE_SELFTEST,
    offlineSelftestOnly: true,
  };
}

/** v20: production signing authority is not issued to public callers (awaiting trusted IMAP adapter). */
export function createCommercialActionDedupSealAuthorityForProduction() {
  return null;
}

function resolveSealKeyMaterialForProfile(profile) {
  if (profile === COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_OFFLINE_SELFTEST) return offlineSelftestSealKeyMaterial;
  return null;
}

export function buildCommercialActionDedupSealInput(record, sealProfile) {
  return JSON.stringify({
    v: COMMERCIAL_ACTION_DEDUP_SEAL_VERSION,
    profile: sealProfile,
    mailboxKeyId: record.mailboxKeyId,
    mailbox: record.mailbox,
    folder: record.folder,
    uid: record.uid,
    uidvalidity: record.uidvalidity,
    actionIndex: record.actionIndex,
    blockFingerprint: record.blockFingerprint,
    commercialActionKey: record.commercialActionKey ?? null,
    advertiserCid: record.advertiserCid ?? null,
    territorySignal: record.territorySignal ?? null,
  });
}

function computeCommercialActionDedupSeal(record, sealProfile, sealKeyMaterial) {
  if (!sealKeyMaterial) return null;
  const base = { ...record };
  delete base.identityTrustSeal;
  delete base.identityTrustSealVersion;
  delete base.identityTrustSealProfile;
  return createHmac("sha256", sealKeyMaterial).update(buildCommercialActionDedupSealInput(base, sealProfile), "utf8").digest("hex");
}

export function sealCommercialActionDedupRecordWithAuthority(record, sealAuthority) {
  if (!sealAuthority?.authorityToken || !activeDedupSealAuthorityTokens.has(sealAuthority.authorityToken)) {
    return null;
  }
  const ctxPerm = sealAuthorityPermittedInActiveTrustContext(sealAuthority);
  if (!ctxPerm.ok) return null;
  const profile = sealAuthority.profile;
  if (profile === COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_PRODUCTION) {
    return null;
  }
  const sealKeyMaterial = resolveSealKeyMaterialForProfile(profile);
  if (!sealKeyMaterial) return null;
  const seal = computeCommercialActionDedupSeal(record, profile, sealKeyMaterial);
  if (!seal) return null;
  return {
    ...record,
    identityTrustSource: COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE,
    identityTrustSealProfile: profile,
    identityTrustSeal: seal,
    identityTrustSealVersion: COMMERCIAL_ACTION_DEDUP_SEAL_VERSION,
    identityTrustSealProvenance: COMMERCIAL_ACTION_DEDUP_PIPELINE_SEAL_PROVENANCE,
    identityTrustSealAuthorityToken: sealAuthority.authorityToken,
  };
}

/** v21 fail-closed — production signing requires future trusted adapter worker (not offline lib). */
export function sealCommercialActionDedupRecordFromTrustedImapPipeline() {
  return { ok: false, reason: PRODUCTION_DEDUP_TRUST_BLOCKED_REASON, status: PRODUCTION_DEDUP_TRUST_STATUS };
}

/** v13 audit repro — forgeable public HMAC (do not use). */
export function attachCommercialActionDedupSealLegacyV13(record) {
  const base = { ...record };
  delete base.identityTrustSeal;
  delete base.identityTrustSealVersion;
  delete base.identityTrustSealProfile;
  const legacyInput = JSON.stringify({
    v: 1,
    mailboxKeyId: base.mailboxKeyId,
    mailbox: base.mailbox,
    folder: base.folder,
    uid: base.uid,
    uidvalidity: base.uidvalidity,
    actionIndex: base.actionIndex,
    blockFingerprint: base.blockFingerprint,
    commercialActionKey: base.commercialActionKey ?? null,
    advertiserCid: base.advertiserCid ?? null,
    territorySignal: base.territorySignal ?? null,
  });
  const seal = createHmac("sha256", COMMERCIAL_ACTION_DEDUP_SEAL_LEGACY_V13_PUBLIC_MATERIAL)
    .update(legacyInput, "utf8")
    .digest("hex");
  return {
    ...base,
    identityTrustSource: COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE,
    identityTrustSeal: seal,
    identityTrustSealVersion: 1,
  };
}

export function verifyCommercialActionDedupSealLegacyV13(record) {
  if (record?.identityTrustSealVersion !== 1) return { ok: false, reason: "missing_or_invalid_identity_seal" };
  const expected = attachCommercialActionDedupSealLegacyV13({
    ...record,
    identityTrustSeal: undefined,
    identityTrustSealVersion: undefined,
  }).identityTrustSeal;
  if (expected !== record.identityTrustSeal) return { ok: false, reason: "identity_seal_mismatch" };
  return { ok: true };
}

function verifyCommercialActionDedupSealCryptographic(record) {
  if (record?.identityTrustSealVersion !== COMMERCIAL_ACTION_DEDUP_SEAL_VERSION) {
    return { ok: false, reason: "missing_or_invalid_identity_seal" };
  }
  if (typeof record?.identityTrustSeal !== "string" || record.identityTrustSeal.length === 0) {
    return { ok: false, reason: "missing_or_invalid_identity_seal" };
  }
  const profile = record.identityTrustSealProfile;
  if (profile !== COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_OFFLINE_SELFTEST && profile !== COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_PRODUCTION) {
    return { ok: false, reason: "unknown_identity_seal_profile" };
  }
  if (profile === COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_PRODUCTION) {
    if (!PRODUCTION_SIGNING_ENABLED) {
      return { ok: false, reason: "production_signing_disabled_v21", status: PRODUCTION_DEDUP_TRUST_STATUS };
    }
    const base = { ...record };
    delete base.identityTrustSeal;
    delete base.identityTrustSealVersion;
    delete base.identityTrustSealProfile;
    delete base.identityTrustSealProvenance;
    const verified = vaultVerifyProductionHmacHex(buildCommercialActionDedupSealInput(base, profile), record.identityTrustSeal);
    if (!verified.ok) return verified;
    const att = verifyImapPipelineAttestationOnRecord(record);
    if (!att.ok) {
      return { ok: false, reason: att.reason || PRODUCTION_DEDUP_TRUST_BLOCKED_REASON };
    }
    return { ok: true, profile };
  }
  const sealKeyMaterial = resolveSealKeyMaterialForProfile(profile);
  if (!sealKeyMaterial) {
    return { ok: false, reason: "seal_verifier_not_configured" };
  }
  const expected = computeCommercialActionDedupSeal(record, profile, sealKeyMaterial);
  if (expected !== record.identityTrustSeal) {
    return { ok: false, reason: "identity_seal_mismatch" };
  }
  return { ok: true, profile };
}

export function verifyCommercialActionDedupSeal(record) {
  const crypto = verifyCommercialActionDedupSealCryptographic(record);
  if (!crypto.ok) return crypto;
  const ctxPerm = sealProfilePermittedInActiveTrustContext(crypto.profile);
  if (!ctxPerm.ok) return ctxPerm;
  return crypto;
}

export function getCommercialActionDedupSealConfigurationStatus() {
  return {
    offlineSelftestConfigured: offlineSelftestSealKeyMaterial != null,
    productionConfigured: vaultIsProductionKeyConfigured(),
    defaultPipelineAuthorityRegistered: defaultPipelineDedupSealAuthority != null,
    activeTrustContext: activeCommercialActionDedupTrustContext,
    productionTrustContextLocked: vaultIsProductionTrustContextLocked(),
  };
}

export function buildVerifiedCommercialActionIdentity({
  mailboxKey,
  actionIndex,
  blockFingerprint,
  advertiserCid = null,
  territorySignal = null,
}) {
  if (!mailboxKey?.ok || !mailboxKey.keyId) {
    return { ok: false, reason: "invalid_mailbox_key" };
  }
  const idxVal = validateCommercialActionIndex(actionIndex);
  if (!idxVal.ok) return { ok: false, reason: idxVal.reason };
  const fpVal = validateBlockFingerprintField(blockFingerprint);
  if (!fpVal.ok) return { ok: false, reason: fpVal.reason };
  return {
    ok: true,
    mailboxKeyId: mailboxKey.keyId,
    actionIndex: idxVal.value,
    blockFingerprint: fpVal.value,
    advertiserCid: advertiserCid != null ? String(advertiserCid) : null,
    territorySignal: territorySignal != null ? String(territorySignal) : null,
  };
}

function verifiedCommercialActionIdentitiesMatch(a, b) {
  if (a.mailboxKeyId !== b.mailboxKeyId) return false;
  if (a.actionIndex !== b.actionIndex) return false;
  if (a.blockFingerprint !== b.blockFingerprint) return false;
  if (a.advertiserCid != null && b.advertiserCid != null && a.advertiserCid !== b.advertiserCid) return false;
  if (a.territorySignal != null && b.territorySignal != null && a.territorySignal !== b.territorySignal) return false;
  return true;
}

function dedupRecordToIdentity(record) {
  if (record.mailboxKeyId == null || record.actionIndex == null || record.blockFingerprint == null) {
    return { ok: false, reason: "incomplete_dedup_record" };
  }
  const idxVal = validateCommercialActionIndex(record.actionIndex);
  if (!idxVal.ok) return { ok: false, reason: idxVal.reason };
  const fpVal = validateBlockFingerprintField(record.blockFingerprint);
  if (!fpVal.ok) return { ok: false, reason: fpVal.reason };
  return {
    ok: true,
    mailboxKeyId: String(record.mailboxKeyId),
    actionIndex: idxVal.value,
    blockFingerprint: fpVal.value,
    advertiserCid: record.advertiserCid != null ? String(record.advertiserCid) : null,
    territorySignal: record.territorySignal != null ? String(record.territorySignal) : null,
  };
}

function candidateMailboxKeyToTrustedIdentity(candCtx) {
  const mailboxKey = candCtx.mailboxKey;
  if (!mailboxKey?.ok || !mailboxKey.keyId) {
    return { ok: false, reason: "invalid_mailbox_key" };
  }
  if (!isDedupTrustEligibleMailboxKey(mailboxKey)) {
    return { ok: false, reason: "mailbox_key_not_trust_eligible" };
  }
  return buildVerifiedCommercialActionIdentity({
    mailboxKey,
    actionIndex: candCtx.actionIndex ?? candCtx.commercialActionIndex,
    blockFingerprint: candCtx.blockFingerprint ?? candCtx.rawBlockFingerprint,
    advertiserCid: candCtx.advertiserCid,
    territorySignal: candCtx.territorySignal ?? candCtx.territory?.signal,
  });
}

/** Trusted stored identity — valid pipeline HMAC seal + active trust context + IMAP tuple. */
export function dedupRecordToTrustedIdentity(record) {
  const sealVal = verifyCommercialActionDedupSeal(record);
  if (!sealVal.ok) return sealVal;
  if (record.identityTrustSealProvenance !== COMMERCIAL_ACTION_DEDUP_PIPELINE_SEAL_PROVENANCE) {
    return { ok: false, reason: "missing_pipeline_seal_provenance" };
  }
  if (record.identityTrustSealProfile === COMMERCIAL_ACTION_DEDUP_SEAL_PROFILE_PRODUCTION) {
    if (!PRODUCTION_SIGNING_ENABLED) {
      return { ok: false, reason: PRODUCTION_DEDUP_TRUST_BLOCKED_REASON, status: PRODUCTION_DEDUP_TRUST_STATUS };
    }
    const att = verifyImapPipelineAttestationOnRecord(record);
    if (!att.ok) {
      return { ok: false, reason: att.reason || PRODUCTION_DEDUP_TRUST_BLOCKED_REASON };
    }
  }
  if (record.identityTrustSource !== COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE) {
    return { ok: false, reason: "untrusted_identity_source" };
  }
  if (record.verified === true && record.identityTrustSource !== COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE) {
    return { ok: false, reason: "spoofed_verified_flag" };
  }
  if (
    record.mailbox == null ||
    record.folder == null ||
    record.uid == null ||
    record.uidvalidity == null ||
    record.mailboxKeyId == null
  ) {
    return { ok: false, reason: "incomplete_imap_identity_tuple" };
  }
  const rebuilt = buildMailboxMessageKey({
    mailbox: record.mailbox,
    folder: record.folder,
    uidvalidity: record.uidvalidity,
    uid: record.uid,
  });
  if (!rebuilt.ok || rebuilt.keyId !== record.mailboxKeyId) {
    return { ok: false, reason: "mailbox_key_identity_mismatch" };
  }
  const core = dedupRecordToIdentity(record);
  if (!core.ok) return core;
  return { ...core, identityTrustSource: COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE };
}

/** v11 audit repro — unsafe key-only duplicate_skip (do not use in production). */
export function evaluateCommercialActionDedupLegacyV11(existingRecords, candidate) {
  const candKey =
    typeof candidate === "string" ? candidate : candidate?.commercialActionKey != null ? candidate.commercialActionKey : null;
  const candCtx = typeof candidate === "object" && candidate != null ? candidate : {};
  const candIdentity = buildVerifiedCommercialActionIdentity({
    mailboxKey: candCtx.mailboxKey,
    actionIndex: candCtx.actionIndex ?? candCtx.commercialActionIndex,
    blockFingerprint: candCtx.blockFingerprint ?? candCtx.rawBlockFingerprint,
    advertiserCid: candCtx.advertiserCid,
    territorySignal: candCtx.territorySignal ?? candCtx.territory?.signal,
  });
  const normalized = (existingRecords || []).map(normalizeCommercialActionDedupRecord).filter((r) => r.commercialActionKey || r.mailboxKeyId);
  if (candKey) {
    for (const ex of normalized) {
      if (ex.commercialActionKey === candKey) {
        const exId = dedupRecordToIdentity(ex);
        if (exId.ok && candIdentity.ok && !verifiedCommercialActionIdentitiesMatch(exId, candIdentity)) {
          return { decision: "requires_review", skip: false, reason: "legacy_key_identity_conflict" };
        }
        return { decision: "duplicate_skip", skip: true, reason: "same_commercial_action_key" };
      }
    }
  }
  if (!candIdentity.ok) {
    return { decision: "requires_review", skip: false, reason: candIdentity.reason || "candidate_identity_incomplete" };
  }
  for (const ex of normalized) {
    const exId = dedupRecordToIdentity(ex);
    if (!exId.ok) continue;
    if (verifiedCommercialActionIdentitiesMatch(exId, candIdentity)) {
      return { decision: "duplicate_skip", skip: true, reason: "same_verified_commercial_action_identity" };
    }
  }
  return { decision: "new_action", skip: false, reason: null };
}

/** v12 audit repro — spoofable trust string + order-dependent early return (do not use). */
export function evaluateCommercialActionDedupLegacyV12(existingRecords, candidate) {
  const candKey =
    typeof candidate === "string" ? candidate : candidate?.commercialActionKey != null ? candidate.commercialActionKey : null;
  const candCtx = typeof candidate === "object" && candidate != null ? candidate : {};
  const candTrusted = candidateMailboxKeyToTrustedIdentity(candCtx);
  const normalized = (existingRecords || []).map(normalizeCommercialActionDedupRecord).filter((r) => r.commercialActionKey || r.mailboxKeyId);
  if (candKey) {
    for (const ex of normalized) {
      if (ex.commercialActionKey !== candKey) continue;
      const exTrusted = dedupRecordToTrustedIdentityLegacyV12(ex);
      if (!exTrusted.ok || !candTrusted.ok) {
        return { decision: "requires_review", skip: false, reason: "same_key_without_verified_identity" };
      }
      if (!verifiedCommercialActionIdentitiesMatch(exTrusted, candTrusted)) {
        return { decision: "requires_review", skip: false, reason: "legacy_key_identity_conflict" };
      }
      return { decision: "duplicate_skip", skip: true, reason: "same_verified_commercial_action_identity" };
    }
  }
  if (!candTrusted.ok) {
    return { decision: "requires_review", skip: false, reason: candTrusted.reason || "candidate_identity_incomplete" };
  }
  for (const ex of normalized) {
    const exTrusted = dedupRecordToTrustedIdentityLegacyV12(ex);
    if (!exTrusted.ok) continue;
    if (verifiedCommercialActionIdentitiesMatch(exTrusted, candTrusted)) {
      return { decision: "duplicate_skip", skip: true, reason: "same_verified_commercial_action_identity" };
    }
  }
  return { decision: "new_action", skip: false, reason: null };
}

function dedupRecordToTrustedIdentityLegacyV12(record) {
  if (record.identityTrustSource !== COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE) {
    return { ok: false, reason: "untrusted_identity_source" };
  }
  if (
    record.mailbox == null ||
    record.folder == null ||
    record.uid == null ||
    record.uidvalidity == null ||
    record.mailboxKeyId == null
  ) {
    return { ok: false, reason: "incomplete_imap_identity_tuple" };
  }
  const rebuilt = buildMailboxMessageKey({
    mailbox: record.mailbox,
    folder: record.folder,
    uidvalidity: record.uidvalidity,
    uid: record.uid,
  });
  if (!rebuilt.ok || rebuilt.keyId !== record.mailboxKeyId) {
    return { ok: false, reason: "mailbox_key_identity_mismatch" };
  }
  const core = dedupRecordToIdentity(record);
  if (!core.ok) return core;
  return { ...core, identityTrustSource: COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE };
}

/**
 * Cross-generation safe dedup: duplicate_skip only with sealed trusted identity; order-independent.
 * Returns decision: duplicate_skip | new_action | requires_review
 */
export function evaluateCommercialActionDedup(existingRecords, candidate) {
  const candKey =
    typeof candidate === "string" ? candidate : candidate?.commercialActionKey != null ? candidate.commercialActionKey : null;
  const candCtx = typeof candidate === "object" && candidate != null ? candidate : {};
  const candTrusted = candidateMailboxKeyToTrustedIdentity(candCtx);

  const normalized = (existingRecords || []).map(normalizeCommercialActionDedupRecord).filter((r) => r.commercialActionKey || r.mailboxKeyId);

  let trustedIdentityMatch = false;
  let sameKeyUntrustedExisting = false;
  let sameKeyTrustedConflict = false;
  let storeLegacyKeyCollision = false;
  let crossGenUntrustedExisting = false;

  for (const ex of normalized) {
    const exTrusted = dedupRecordToTrustedIdentity(ex);
    if (candTrusted.ok && exTrusted.ok && verifiedCommercialActionIdentitiesMatch(exTrusted, candTrusted)) {
      trustedIdentityMatch = true;
    }
    if (candKey && ex.commercialActionKey === candKey) {
      if (!exTrusted.ok) sameKeyUntrustedExisting = true;
      else if (candTrusted.ok && !verifiedCommercialActionIdentitiesMatch(exTrusted, candTrusted)) {
        sameKeyTrustedConflict = true;
      }
    }
  }

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      if (!a.commercialActionKey || a.commercialActionKey !== b.commercialActionKey) continue;
      const idA = dedupRecordToTrustedIdentity(a);
      const idB = dedupRecordToTrustedIdentity(b);
      if (idA.ok && idB.ok && !verifiedCommercialActionIdentitiesMatch(idA, idB)) {
        storeLegacyKeyCollision = true;
      }
    }
  }

  for (const ex of normalized) {
    if (!ex.commercialActionKey || !candKey) continue;
    const exFmt = classifyCommercialActionKeyFormat(ex.commercialActionKey);
    const candFmt = classifyCommercialActionKeyFormat(candKey);
    const crossGenPair =
      (exFmt === "legacy_v9_pipe" && candFmt === "canonical_v2") ||
      (exFmt === "canonical_v2" && candFmt === "legacy_v9_pipe");
    if (!crossGenPair) continue;
    const exTrusted = dedupRecordToTrustedIdentity(ex);
    if (!exTrusted.ok && candTrusted.ok && !trustedIdentityMatch) {
      crossGenUntrustedExisting = true;
    }
  }

  const candKeyInStore = candKey != null && normalized.some((ex) => ex.commercialActionKey === candKey);

  if (storeLegacyKeyCollision && (trustedIdentityMatch || candKeyInStore)) {
    return { decision: "requires_review", skip: false, reason: "legacy_key_collision_suspected" };
  }
  if (sameKeyTrustedConflict) {
    return { decision: "requires_review", skip: false, reason: "legacy_key_identity_conflict" };
  }
  if (trustedIdentityMatch && candKey && sameKeyUntrustedExisting) {
    return { decision: "requires_review", skip: false, reason: "relevant_unverified_record_conflict" };
  }
  if (trustedIdentityMatch) {
    return { decision: "duplicate_skip", skip: true, reason: "same_verified_commercial_action_identity" };
  }
  if (candKey && sameKeyUntrustedExisting) {
    return { decision: "requires_review", skip: false, reason: "same_key_without_verified_identity" };
  }
  if (!candTrusted.ok) {
    return {
      decision: "requires_review",
      skip: false,
      reason: candTrusted.reason || "candidate_identity_incomplete",
    };
  }
  if (crossGenUntrustedExisting) {
    return {
      decision: "requires_review",
      skip: false,
      reason: "cross_generation_key_without_verified_existing_identity",
    };
  }

  return { decision: "new_action", skip: false, reason: null };
}

function dedupRecordToTrustedIdentityLegacyV13(record) {
  const sealVal = verifyCommercialActionDedupSealLegacyV13(record);
  if (!sealVal.ok) return sealVal;
  if (record.identityTrustSource !== COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE) {
    return { ok: false, reason: "untrusted_identity_source" };
  }
  if (
    record.mailbox == null ||
    record.folder == null ||
    record.uid == null ||
    record.uidvalidity == null ||
    record.mailboxKeyId == null
  ) {
    return { ok: false, reason: "incomplete_imap_identity_tuple" };
  }
  const rebuilt = buildMailboxMessageKey({
    mailbox: record.mailbox,
    folder: record.folder,
    uidvalidity: record.uidvalidity,
    uid: record.uid,
  });
  if (!rebuilt.ok || rebuilt.keyId !== record.mailboxKeyId) {
    return { ok: false, reason: "mailbox_key_identity_mismatch" };
  }
  const core = dedupRecordToIdentity(record);
  if (!core.ok) return core;
  return { ...core, identityTrustSource: COMMERCIAL_ACTION_DEDUP_TRUST_SOURCE };
}

/** v13 audit repro — public HMAC trust + order fix without v14 conflict rule (do not use). */
export function evaluateCommercialActionDedupLegacyV13(existingRecords, candidate) {
  const candKey =
    typeof candidate === "string" ? candidate : candidate?.commercialActionKey != null ? candidate.commercialActionKey : null;
  const candCtx = typeof candidate === "object" && candidate != null ? candidate : {};
  const candTrusted = candidateMailboxKeyToTrustedIdentity(candCtx);

  const normalized = (existingRecords || []).map(normalizeCommercialActionDedupRecord).filter((r) => r.commercialActionKey || r.mailboxKeyId);

  let trustedIdentityMatch = false;
  let sameKeyUntrustedExisting = false;
  let sameKeyTrustedConflict = false;
  let storeLegacyKeyCollision = false;
  let crossGenUntrustedExisting = false;

  for (const ex of normalized) {
    const exTrusted = dedupRecordToTrustedIdentityLegacyV13(ex);
    if (candTrusted.ok && exTrusted.ok && verifiedCommercialActionIdentitiesMatch(exTrusted, candTrusted)) {
      trustedIdentityMatch = true;
    }
    if (candKey && ex.commercialActionKey === candKey) {
      if (!exTrusted.ok) sameKeyUntrustedExisting = true;
      else if (candTrusted.ok && !verifiedCommercialActionIdentitiesMatch(exTrusted, candTrusted)) {
        sameKeyTrustedConflict = true;
      }
    }
  }

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];
      if (!a.commercialActionKey || a.commercialActionKey !== b.commercialActionKey) continue;
      const idA = dedupRecordToTrustedIdentityLegacyV13(a);
      const idB = dedupRecordToTrustedIdentityLegacyV13(b);
      if (idA.ok && idB.ok && !verifiedCommercialActionIdentitiesMatch(idA, idB)) {
        storeLegacyKeyCollision = true;
      }
    }
  }

  for (const ex of normalized) {
    if (!ex.commercialActionKey || !candKey) continue;
    const exFmt = classifyCommercialActionKeyFormat(ex.commercialActionKey);
    const candFmt = classifyCommercialActionKeyFormat(candKey);
    const crossGenPair =
      (exFmt === "legacy_v9_pipe" && candFmt === "canonical_v2") ||
      (exFmt === "canonical_v2" && candFmt === "legacy_v9_pipe");
    if (!crossGenPair) continue;
    const exTrusted = dedupRecordToTrustedIdentityLegacyV13(ex);
    if (!exTrusted.ok && candTrusted.ok && !trustedIdentityMatch) {
      crossGenUntrustedExisting = true;
    }
  }

  const candKeyInStore = candKey != null && normalized.some((ex) => ex.commercialActionKey === candKey);

  if (storeLegacyKeyCollision && (trustedIdentityMatch || candKeyInStore)) {
    return { decision: "requires_review", skip: false, reason: "legacy_key_collision_suspected" };
  }
  if (sameKeyTrustedConflict) {
    return { decision: "requires_review", skip: false, reason: "legacy_key_identity_conflict" };
  }
  if (trustedIdentityMatch) {
    return { decision: "duplicate_skip", skip: true, reason: "same_verified_commercial_action_identity" };
  }
  if (candKey && sameKeyUntrustedExisting) {
    return { decision: "requires_review", skip: false, reason: "same_key_without_verified_identity" };
  }
  if (!candTrusted.ok) {
    return {
      decision: "requires_review",
      skip: false,
      reason: candTrusted.reason || "candidate_identity_incomplete",
    };
  }
  if (crossGenUntrustedExisting) {
    return {
      decision: "requires_review",
      skip: false,
      reason: "cross_generation_key_without_verified_existing_identity",
    };
  }

  return { decision: "new_action", skip: false, reason: null };
}

export function commercialActionDraftToDedupRecord(draft, mailboxKey, options = {}) {
  const base = normalizeCommercialActionDedupRecord({
    commercialActionKey: draft.commercialActionKey,
    mailboxKeyId: mailboxKey?.ok ? mailboxKey.keyId : null,
    mailbox: mailboxKey?.mailbox ?? null,
    folder: mailboxKey?.folder ?? null,
    uid: mailboxKey?.uid ?? null,
    uidvalidity: mailboxKey?.uidvalidity ?? null,
    actionIndex: draft.commercialActionIndex,
    blockFingerprint: draft.rawBlockFingerprint,
    advertiserCid: draft.advertiserCid,
    territorySignal: draft.territory?.signal,
  });
  if (!mailboxKey?.ok || !isStructurallyValidMailboxKeyRecord(mailboxKey)) {
    return base;
  }
  if (!isDedupTrustEligibleMailboxKey(mailboxKey)) {
    return base;
  }
  const sealAuthority = options.sealAuthority ?? defaultPipelineDedupSealAuthority;
  if (!sealAuthority) {
    return base;
  }
  const sealed = sealCommercialActionDedupRecordWithAuthority(base, sealAuthority);
  return sealed ?? base;
}

/** Distinct commercial event identity (separate from delivered message identity). */
export function buildCommercialActionKey(mailboxKey, actionIndex, blockFingerprint) {
  if (!mailboxKey?.ok || !mailboxKey.keyId) return null;
  const idxVal = validateCommercialActionIndex(actionIndex);
  const fpVal = validateBlockFingerprintField(blockFingerprint);
  if (!idxVal.ok || !fpVal.ok) return null;
  const canonicalInput = buildCanonicalCommercialActionDigestInput({
    mailboxKeyId: mailboxKey.keyId,
    actionIndex: idxVal.value,
    blockFingerprint: fpVal.value,
  });
  const digest = createHash("sha256").update(canonicalInput, "utf8").digest("hex").slice(0, 24);
  return "cak2_" + digest;
}

export function buildAttachmentPointer({ mailboxKey, attachmentIndex, filenameHint = null }) {
  return {
    mailboxKey: mailboxKey.keyId,
    attachmentIndex: Number(attachmentIndex),
    filenameHint: filenameHint ? String(filenameHint) : null,
    storedOutsideMailbox: false,
  };
}

export function assessAuthenticationHints({ spf, dkim, dmarc, fromAddress, authSource = "missing" }) {
  const from = String(fromAddress || "").trim().toLowerCase();
  const cjRelay = from.endsWith("@mx6.cj.com") || from === CJ_MEMBER_MESSAGING_FROM;
  const trusted = authSource === "provider" || authSource === "imap_provider";
  const spfPass = spf === "pass" || spf === true;
  const dkimPass = dkim === "pass" || dkim === true;
  const dmarcPass = dmarc === "pass" || dmarc === true;

  if (!trusted) {
    return {
      cjRelay,
      authPass: false,
      authVerified: false,
      authSource: authSource === "body_claim" ? "body_claim_untrusted" : "missing_or_untrusted",
      trustTier: "auth_unverified",
      fromAddress: from,
      auditNote: "SPF/DKIM/DMARC in message body or missing provider results are not trusted",
    };
  }

  const authPass = spfPass && dkimPass && dmarcPass;
  return {
    cjRelay,
    authPass,
    authVerified: authPass,
    authSource: "provider",
    trustTier: authPass ? (cjRelay ? "cj_relay_authenticated" : "authenticated") : "unauthenticated_quarantine",
    fromAddress: from,
    auditNote: authPass ? null : "provider_auth_failed",
  };
}

function stripNonPromotionalFooter(text) {
  const lines = String(text || "").split(/\n+/);
  const kept = [];
  for (const line of lines) {
    if (/^(—|--|media uzel|infouzel|info@infouzel|praha|sent from|unsubscribe)/i.test(line.trim())) break;
    if (/^https?:\/\/[^\s]*\/cz\/?(\?|$)/i.test(line.trim()) && !/trh|market|sleva|kupón|offer/i.test(line)) {
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function isValidCalendarDate(y, m, d) {
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() === Number(m) - 1 && dt.getUTCDate() === Number(d);
}

/** Parse date tokens; never silently fix invalid calendar dates. */
export function parseEmailDateFromText(text, role = "action_end") {
  const raw = String(text || "");
  const czRe = /\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\b/g;
  const found = [];
  let m;
  while ((m = czRe.exec(raw)) !== null) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const valid = isValidCalendarDate(yyyy, mm, dd);
    found.push({
      role,
      raw: m[0],
      iso: valid ? `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` : null,
      valid,
      binding: valid ? "parsed_cz_date" : "invalid_calendar_reject",
    });
  }
  const enRe =
    /\b(?:until|valid through|expires)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i;
  const enM = raw.match(enRe);
  if (enM) {
    const months = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12,
    };
    const mm = months[enM[1].toLowerCase()];
    const dd = Number(enM[2]);
    const yyyy = Number(enM[3]);
    const valid = mm && isValidCalendarDate(yyyy, mm, dd);
    found.push({
      role,
      raw: enM[0],
      iso: valid ? `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}` : null,
      valid,
      binding: valid ? "parsed_en_date" : "invalid_calendar_reject",
    });
  }
  return found;
}

export function pickSingleValidityEnd(dateTokens) {
  const validEnds = dateTokens.filter((t) => t.valid && t.iso);
  if (validEnds.length === 1) return { validityEnd: validEnds[0].iso, validityBinding: "explicit_single_date" };
  if (validEnds.length === 0) {
    const invalid = dateTokens.some((t) => t.binding === "invalid_calendar_reject");
    return {
      validityEnd: null,
      validityBinding: invalid ? "invalid_date_do_not_bind" : "missing",
    };
  }
  return { validityEnd: null, validityBinding: "ambiguous_do_not_bind" };
}

export function detectTerritories(bodyText, options = {}) {
  const scope = stripNonPromotionalFooter(String(bodyText || ""));
  const text = options.actionScopeOnly ? scope : scope;

  if (/\b(?:not for|excluding|bez)\s+(?:cz|czech|čr|česk)/i.test(text)) {
    return { signal: TERRITORY_SIGNAL.cz_excluded, markets: null, czEligible: false };
  }

  const marketMatch = text.match(MARKET_LIST);
  if (marketMatch) {
    const codes = marketMatch[1]
      .split(/\s*,\s*/)
      .map((c) => c.trim().replace(/\.$/, "").toUpperCase())
      .filter(Boolean);
    if (codes.length > 0 && !codes.includes("CZ")) {
      return { signal: TERRITORY_SIGNAL.cz_absent_foreign_only, markets: marketMatch[1], czEligible: false };
    }
    if (codes.includes("CZ")) {
      return { signal: TERRITORY_SIGNAL.cz_explicit, markets: marketMatch[1], czEligible: true };
    }
  }

  const czInPromo =
    (/\bčesk[ýá]?\s+trh\b/i.test(text) || /\bfor\s+cz\b/i.test(text)) &&
    !/\btrhy:\s*(?!.*\bCZ\b)/i.test(text);
  if (czInPromo) {
    return { signal: TERRITORY_SIGNAL.cz_explicit, markets: "cz_promo_scope", czEligible: true };
  }

  return { signal: TERRITORY_SIGNAL.unknown, markets: null, czEligible: null };
}

export function classifyPartnerEmail(message) {
  const subject = String(message.subject || "");
  const body = String(message.bodyText || "") + "\n" + String(message.bodyHtmlStripped || "");
  const hints = [];

  let commercialKinds = [];
  let contractKinds = [];

  if (/new program terms|program terms|podmínky programu|terms and conditions/i.test(subject + body)) {
    contractKinds.push(CONTRACT_KIND.program_terms_notice);
    hints.push("subject_or_body_terms_notice_not_full_contract");
  }
  if (/commission|proviz/i.test(body)) {
    commercialKinds.push(COMMERCIAL_KIND.commission_change);
  }
  if (/welcome|vítáme|uvítací|joined the program/i.test(body)) {
    commercialKinds.push(COMMERCIAL_KIND.program_welcome);
  }
  if (/booking\.com|marketing|inspir/i.test(subject + body) && !/\b(kód|code|coupon|sleva|kupón)\b/i.test(body)) {
    commercialKinds.push(COMMERCIAL_KIND.marketing_inspiration);
  }
  if (/\b(kupón|coupon|kód|code)\b/i.test(body) || COUPON_INLINE.test(body)) {
    commercialKinds.push(COMMERCIAL_KIND.coupon_offer);
  }
  if ((body.match(/\d{1,2}\s*%/g) || []).length >= 2) {
    commercialKinds.push(COMMERCIAL_KIND.multi_action_promo);
  }
  if (/doprava zdarma|free shipping/i.test(body)) {
    commercialKinds.push(COMMERCIAL_KIND.shipping_promo);
  }

  commercialKinds = [...new Set(commercialKinds)];
  contractKinds = [...new Set(contractKinds)];

  let branch = BRANCH.unknown;
  if (commercialKinds.length && contractKinds.length) branch = BRANCH.mixed;
  else if (commercialKinds.length) branch = BRANCH.commercial;
  else if (contractKinds.length) branch = BRANCH.contract;

  return { branch, commercialKinds, contractKinds, hints, autoAllowed: false };
}

function isMarketPrefixLine(line) {
  return MARKET_LIST.test(line) && !DISCOUNT_START.test(line) && !/^Sleva\s+(?:až\s+)?\d/i.test(line) && !KUPON_PREFIX.test(line);
}

function isLinkIdOnlyLine(line) {
  return LINK_ID.test(line) && !KUPON_PREFIX.test(line) && !/^Kupón\b/i.test(line) && !DISCOUNT_START.test(line) && !/^Sleva\s+(?:až\s+)?\d/i.test(line);
}

function isActionStartLine(line) {
  return (
    /^Sleva\s+(?:až\s+)?\d/i.test(line) ||
    DISCOUNT_START.test(line) ||
    KUPON_PREFIX.test(line) ||
    /^Kupón\b/i.test(line)
  );
}

function nextLineIsActionStart(lines, index) {
  for (let j = index + 1; j < lines.length; j++) {
    if (isActionStartLine(lines[j])) return true;
    if (isMarketPrefixLine(lines[j])) return false;
    if (isLinkIdOnlyLine(lines[j])) continue;
  }
  return false;
}

export function segmentCommercialBlocks(bodyText) {
  const text = String(bodyText || "").trim();
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  let current = [];
  let pendingMarketPrefix = [];
  let orphanMarketBetweenActionsPending = false;

  function flushAction() {
    if (current.length) {
      const segmentMeta = {};
      if (orphanMarketBetweenActionsPending) {
        segmentMeta.orphanMarketBetweenActionsNearby = true;
        orphanMarketBetweenActionsPending = false;
      }
      blocks.push({ text: current.join("\n"), segmentMeta });
      current = [];
    }
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (isMarketPrefixLine(line)) {
      const currentHasPromo = current.some((l) => isActionStartLine(l));
      const currentHasMarket = current.some((l) => isMarketPrefixLine(l));
      if (currentHasPromo && currentHasMarket) {
        flushAction();
        pendingMarketPrefix = [line];
        continue;
      }
      if (currentHasPromo && !currentHasMarket && nextLineIsActionStart(lines, lineIndex)) {
        blocks.push({ text: line, segmentMeta: { orphanMarketBetweenActions: true } });
        orphanMarketBetweenActionsPending = true;
        continue;
      }
      if (current.length > 0) {
        current.push(line);
        continue;
      }
      flushAction();
      pendingMarketPrefix = [line];
      continue;
    }

    if (isActionStartLine(line)) {
      if (current.length > 0 && current.every((l) => isLinkIdOnlyLine(l))) {
        flushAction();
      }
      flushAction();
      if (pendingMarketPrefix.length) {
        current.push(...pendingMarketPrefix);
        pendingMarketPrefix = [];
      }
      current.push(line);
      continue;
    }

    if (isLinkIdOnlyLine(line)) {
      if (current.length === 0) current.push(line);
      else current.push(line);
      continue;
    }

    if (current.length === 0 && pendingMarketPrefix.length) {
      current.push(...pendingMarketPrefix);
      pendingMarketPrefix = [];
    }
    current.push(line);
  }
  flushAction();

  if (blocks.length === 0 && text) blocks.push({ text, segmentMeta: {} });
  return blocks;
}

function resolveBlockTerritory(blockText, segmentMeta) {
  if (segmentMeta?.orphanMarketBetweenActions) {
    return {
      signal: TERRITORY_SIGNAL.ambiguous_between_actions,
      markets: (blockText.match(MARKET_LIST) || [])[1] || null,
      czEligible: null,
      territoryBinding: "ambiguous_between_actions_needs_verification",
    };
  }
  if (segmentMeta?.orphanMarketBetweenActionsNearby) {
    return {
      signal: TERRITORY_SIGNAL.ambiguous_between_actions,
      markets: null,
      czEligible: null,
      territoryBinding: "ambiguous_between_actions_needs_verification",
    };
  }
  const territory = detectTerritories(blockText, { actionScopeOnly: true });
  return { ...territory, territoryBinding: "explicit_in_block" };
}

function parseCommercialBlock(blockText, index, message, mailboxKey, segmentMeta = {}) {
  const territory = resolveBlockTerritory(blockText, segmentMeta);
  const linkM = blockText.match(LINK_ID);
  const kuponM = blockText.match(KUPON_PREFIX) || blockText.match(COUPON_INLINE);
  const pctM =
    blockText.match(/Sleva\s+(?:až\s+)?(\d{1,2})\s*%/i) ||
    blockText.match(DISCOUNT_START) ||
    blockText.match(/(\d{1,2})\s*%/);
  const minOrderM = blockText.match(MIN_ORDER);
  const dateTokens = parseEmailDateFromText(blockText, "action_end");
  const { validityEnd, validityBinding } = pickSingleValidityEnd(dateTokens);

  const linkIds = [...blockText.matchAll(/\bLINK\s*ID[:\s]+(\d{6,})\b/gi)].map((m) => m[1]);
  const couponCode = kuponM ? kuponM[1] : null;
  let linkId = linkM ? linkM[1] : null;
  let pairingBinding = "explicit_in_block";
  if (linkIds.length > 1) {
    pairingBinding = "ambiguous_multiple_link_ids";
    linkId = null;
  } else if (linkIds.length === 1) {
    linkId = linkIds[0];
  } else if (couponCode && !linkId) {
    pairingBinding = "missing_link_id_needs_verification";
  } else if (!couponCode && linkId) {
    pairingBinding = "orphan_link_id_needs_verification";
  }
  const fingerprint = [couponCode || "", linkId || "", String(pctM ? pctM[1] : ""), validityEnd || ""].join("|");

  const cidM = blockText.match(CID_TOKEN) || String(message.bodyText || "").match(CID_TOKEN);

  return {
    commercialActionKey: buildCommercialActionKey(mailboxKey, index, fingerprint),
    kind:
      /^Sleva\s+(?:až\s+)?\d/i.test(blockText) || DISCOUNT_START.test(blockText)
        ? COMMERCIAL_KIND.multi_action_promo
        : COMMERCIAL_KIND.coupon_offer,
    pairingBinding,
    advertiserCid: cidM ? cidM[1] : message.declaredCid || null,
    couponCode,
    linkId,
    discountPercent: pctM ? Number(pctM[1]) : null,
    minOrderAmountCzk: minOrderM ? Number(minOrderM[1].replace(/\s/g, "")) : null,
    validityEnd,
    validityBinding,
    dateTokens,
    territory,
    territoryBinding: territory.territoryBinding || "explicit_in_block",
    publicationHint:
      territory.signal === TERRITORY_SIGNAL.ambiguous_between_actions
        ? "unknown_needs_gate"
        : territory.signal === TERRITORY_SIGNAL.cz_absent_foreign_only || territory.signal === TERRITORY_SIGNAL.cz_excluded
          ? "not_for_cz_visitors"
          : territory.signal === TERRITORY_SIGNAL.cz_explicit
            ? "cz_candidate_needs_gate"
            : "unknown_needs_gate",
    autoAllowed: false,
    commercialActionIndex: index,
    rawBlockFingerprint: fingerprint,
  };
}

function extractCommercialDraftsCore(message, mk) {
  const body = String(message.bodyText || "");
  const blocks = segmentCommercialBlocks(body);
  const drafts = [];

  for (let i = 0; i < blocks.length; i++) {
    const blockRec = blocks[i];
    const block = blockRec.text;
    const segmentMeta = blockRec.segmentMeta || {};
    if (segmentMeta.orphanMarketBetweenActions && !KUPON_PREFIX.test(block) && !/^Kupón\b/i.test(block)) {
      continue;
    }
    if (/^Doprava zdarma/i.test(block) && !KUPON_PREFIX.test(block) && !COUPON_INLINE.test(block)) {
      drafts.push({
        commercialActionKey: buildCommercialActionKey(mk, i, "shipping"),
        commercialActionIndex: i,
        rawBlockFingerprint: "shipping",
        kind: COMMERCIAL_KIND.shipping_promo,
        territory: detectTerritories(block, { actionScopeOnly: true }),
        autoAllowed: false,
      });
      continue;
    }
    if (
      /\bSleva\s+(?:až\s+)?\d/i.test(block) ||
      DISCOUNT_START.test(block) ||
      KUPON_PREFIX.test(block) ||
      COUPON_INLINE.test(block) ||
      (LINK_ID.test(block) && (KUPON_PREFIX.test(block) || /^Kupón\b/m.test(block)))
    ) {
      drafts.push(parseCommercialBlock(block, i, message, mk, segmentMeta));
    } else if (LINK_ID.test(block) && !KUPON_PREFIX.test(block)) {
      drafts.push({
        ...parseCommercialBlock(block, i, message, mk, segmentMeta),
        pairingBinding: "orphan_link_id_needs_verification",
        couponCode: null,
      });
    }
  }

  if (drafts.length === 0 && /proviz|commission/i.test(body)) {
    drafts.push({
      commercialActionKey: buildCommercialActionKey(mk, 0, "commission"),
      commercialActionIndex: 0,
      rawBlockFingerprint: "commission",
      kind: COMMERCIAL_KIND.commission_change,
      advertiserCid: (body.match(CID_TOKEN) || [])[1] || message.declaredCid || null,
      commissionNote: "extracted_commission_change_only_not_banner_rights",
      territory: detectTerritories(body),
      autoAllowed: false,
    });
  }

  const cls = classifyPartnerEmail(message);
  if (drafts.length === 0 && cls.commercialKinds.includes(COMMERCIAL_KIND.program_welcome)) {
    drafts.push({
      commercialActionKey: buildCommercialActionKey(mk, 0, "welcome"),
      commercialActionIndex: 0,
      rawBlockFingerprint: "welcome",
      kind: COMMERCIAL_KIND.program_welcome,
      informationalOnly: true,
      autoAllowed: false,
    });
  }
  if (drafts.length === 0 && cls.commercialKinds.includes(COMMERCIAL_KIND.marketing_inspiration)) {
    drafts.push({
      commercialActionKey: buildCommercialActionKey(mk, 0, "marketing"),
      commercialActionIndex: 0,
      rawBlockFingerprint: "marketing",
      kind: COMMERCIAL_KIND.marketing_inspiration,
      notSpecificOffer: true,
      notImageLicense: true,
      autoAllowed: false,
    });
  }

  return drafts;
}

function envelopeFromIdentity(identityRes, message, drafts) {
  if (!identityRes.ok) {
    return {
      ok: false,
      reason: identityRes.reason,
      reasons: identityRes.reasons,
      mailboxKey: null,
      drafts: [],
    };
  }
  return {
    ok: true,
    reason: null,
    reasons: null,
    mailboxKey: identityRes.mailboxKey,
    drafts,
  };
}

/** Production extraction — requires complete message identity; confirm key cannot substitute missing fields. */
export function extractCommercialDrafts(message, mailboxKeyConfirm = null) {
  const identityRes = resolveProductionMailboxIdentity(message, mailboxKeyConfirm);
  if (!identityRes.ok) return envelopeFromIdentity(identityRes, message, []);
  const drafts = extractCommercialDraftsCore(message, identityRes.mailboxKey);
  return envelopeFromIdentity(identityRes, message, drafts);
}

/** Offline regression/selftest only — not for D1 or publication pipeline. */
export function extractCommercialDraftsForOfflineTest(message, mailboxKeyConfirm = null) {
  const identityRes = resolveOfflineTestMailboxIdentity(message, mailboxKeyConfirm);
  if (!identityRes.ok) return envelopeFromIdentity(identityRes, message, []);
  const drafts = extractCommercialDraftsCore(message, identityRes.mailboxKey);
  return envelopeFromIdentity(identityRes, message, drafts);
}

export function extractContractDrafts(message, mailboxKey) {
  const cls = classifyPartnerEmail(message);
  if (!cls.contractKinds.length && cls.branch !== BRANCH.mixed) return [];
  return [
    {
      kind: CONTRACT_KIND.program_terms_notice,
      mailboxKey: mailboxKey.keyId,
      pointer: {
        mailbox: mailboxKey.mailbox,
        folder: mailboxKey.folder,
        uidvalidity: mailboxKey.uidvalidity,
        uid: mailboxKey.uid,
        messageIdHeader: mailboxKey.messageIdHeader,
      },
      subjectDeclaresTerms: /program terms|podmínky programu/i.test(String(message.subject || "")),
      fullContractTextInEmail: false,
      bannerPermissionAutoAllowed: false,
      verificationRequired: VERIFICATION_STATE.mailbox_resolvable,
      note: "Subject or notice alone is not traceable provision; re-fetch from FORPSI for verification",
    },
  ];
}

export function resolveCjPartnerIdentity(message, catalogAdvertisers, context = {}) {
  const declaredName = String(message.declaredPartnerName || message.partnerName || "").trim();
  const declaredCid = message.declaredCid ? String(message.declaredCid).trim() : null;
  const subject = String(message.subject || "");
  const body = String(message.bodyText || "");
  const cidFromBody = [...body.matchAll(/\bCID[:\s]+(\d{6,})\b/gi)].map((m) => m[1]);
  const cidFromSubject = (subject.match(CID_TOKEN) || [])[1] || null;
  const linkId = (body.match(LINK_ID) || [])[1] || null;
  const from = String(message.from || "").trim().toLowerCase();
  const approvedAliases = context.approvedAliases || message.approvedAliases || {};

  const byCid = (cid) => (catalogAdvertisers || []).find((a) => String(a.advertiserId) === String(cid));
  const auditReasons = [];

  if (from === CJ_MEMBER_MESSAGING_FROM || from.endsWith("@mx6.cj.com")) {
    auditReasons.push("cj_relay_from_not_partner_identity_proof");
  }

  const conflicts = [];
  const allCids = [...new Set([declaredCid, cidFromSubject, ...cidFromBody].filter(Boolean))];
  if (allCids.length > 1) conflicts.push("multiple_cids_in_message");

  if (declaredCid && cidFromBody.length && cidFromBody.some((c) => c !== declaredCid)) {
    conflicts.push("declared_cid_vs_body_cid");
  }

  const primaryCid = declaredCid || cidFromSubject || cidFromBody[0] || null;
  let catalogByCid = primaryCid ? byCid(primaryCid) : null;

  const aliasApproved =
    declaredName &&
    primaryCid &&
    approvedAliases[declaredName] &&
    String(approvedAliases[declaredName]) === String(primaryCid);

  if (catalogByCid && declaredName && !aliasApproved) {
    const catalogName = String(catalogByCid.advertiserName || "").trim().toLowerCase();
    if (catalogName && catalogName !== declaredName.toLowerCase()) {
      conflicts.push("declared_name_vs_catalog_for_cid");
    }
  }

  let catalogByName = null;
  if (declaredName && !primaryCid) {
    catalogByName = (catalogAdvertisers || []).find(
      (a) => String(a.advertiserName || "").trim().toLowerCase() === declaredName.toLowerCase()
    );
  }

  if (primaryCid && !catalogByCid && declaredName) {
    auditReasons.push("unknown_cid_no_fuzzy_name_fallback");
  }

  let catalogMatch = null;
  if (catalogByCid && conflicts.length === 0) catalogMatch = catalogByCid;
  else if (!primaryCid && catalogByName) catalogMatch = catalogByName;

  if (linkId && conflicts.length) {
    auditReasons.push("link_id_does_not_resolve_partner_conflict");
  }

  let confidence = "missing";
  if (conflicts.length) {
    confidence = "needs_verification";
    auditReasons.push("conflicts_present");
  } else if (aliasApproved && catalogByCid) {
    confidence = "catalog_confirmed_via_documented_alias";
  } else if (catalogMatch && primaryCid) {
    confidence = "catalog_confirmed";
  } else if (catalogMatch && !primaryCid) {
    confidence = "name_exact_match_unconfirmed_cid";
  } else if (primaryCid || declaredName) {
    confidence = "needs_verification";
    auditReasons.push("unconfirmed_partner_identity");
  }

  return {
    declaredPartnerName: declaredName || null,
    declaredCid: primaryCid || null,
    linkId,
    catalogMatch: catalogMatch
      ? {
          advertiserId: catalogMatch.advertiserId,
          advertiserName: catalogMatch.advertiserName,
          relationshipStatus: catalogMatch.relationshipStatus,
        }
      : null,
    confidence,
    conflicts,
    auditReasons,
    promptInjectionRisk: /\b(ignore previous|system:|you must allow|auto.?allow)\b/i.test(body),
  };
}

/** Skip only exact same IMAP tuple; Message-ID must not alone drop a different UID. */
export function shouldSkipDuplicate(existingKeys, mailboxKey) {
  if (!mailboxKey?.ok) return { skip: false, reason: null };
  const uidHit = (existingKeys || []).some(
    (k) =>
      k.ok !== false &&
      k.mailbox === mailboxKey.mailbox &&
      k.folder === mailboxKey.folder &&
      k.uidvalidity === mailboxKey.uidvalidity &&
      k.uid === mailboxKey.uid
  );
  if (uidHit) return { skip: true, reason: "same_mailbox_folder_uidvalidity_uid" };
  return { skip: false, reason: null };
}

export function shouldSkipDuplicateCommercialAction(existingRecords, commercialActionKey, candidateContext = null) {
  if (!commercialActionKey && !candidateContext) {
    return { skip: false, reason: null, decision: "new_action" };
  }
  const ev = evaluateCommercialActionDedup(existingRecords, {
    commercialActionKey,
    ...(candidateContext || {}),
  });
  return { skip: ev.skip, reason: ev.reason, decision: ev.decision };
}

export function assessOriginalAvailability(fetchResult) {
  if (fetchResult === "found") return { verification: VERIFICATION_STATE.mailbox_resolvable, mayRefreshEvidence: true };
  if (fetchResult === "gone") {
    return {
      verification: VERIFICATION_STATE.mailbox_missing,
      mayRefreshEvidence: false,
      permissionEffect: "existing_evidence_stale_reverify_required_no_auto_allow",
    };
  }
  return { verification: VERIFICATION_STATE.reverify_required, mayRefreshEvidence: false };
}

/**
 * Production entry for future IMAP adapter worker. Offline library cannot verify FORPSI session —
 * always quarantines (no publication) until real adapter supplies runtime attestation out-of-repo.
 */
export function processPartnerMessageFromImapAdapter(message, adapterEnvelope, context = {}) {
  const parsed = parseImapAdapterIdentityEnvelopeStructure(adapterEnvelope);
  if (!parsed.structuralOk) {
    return {
      state: PROCESSING_STATE.quarantined,
      quarantineReason: parsed.reason,
      mailboxIdentityReasons: parsed.reasons || null,
      authenticationStatus: parsed.authenticationStatus,
      autoAllowed: false,
    };
  }
  if (context.imapAdapterRuntimeAttestation === true) {
    return {
      state: PROCESSING_STATE.quarantined,
      quarantineReason: "imap_adapter_runtime_attestation_not_implemented_offline",
      authenticationStatus: "not_authenticated",
      autoAllowed: false,
    };
  }
  return {
    state: PROCESSING_STATE.quarantined,
    quarantineReason: "imap_adapter_session_not_authenticated_offline",
    authenticationStatus: parsed.authenticationStatus,
    structuralMailboxKey: parsed.mailboxKey?.keyId || null,
    autoAllowed: false,
    note: "Structural envelope parse only; real FORPSI IMAP adapter required for production ingest",
  };
}

export function processSyntheticPartnerMessage(message, context = {}) {
  const mergedMessage = {
    ...message,
    mailbox: context.mailbox ?? message.mailbox ?? MAILBOX_DEFAULT,
    folder: context.folder ?? message.folder ?? "INBOX",
    uid: context.uid ?? message.uid,
    uidvalidity: context.uidvalidity ?? message.uidvalidity,
  };
  const identityRes = context.productionImapAdapterPath
    ? resolveProductionMailboxIdentity(mergedMessage, null)
    : resolveOfflineTestMailboxIdentity(mergedMessage, null);
  if (!identityRes.ok) {
    return {
      state: PROCESSING_STATE.quarantined,
      quarantineReason: identityRes.reason,
      mailboxIdentityReasons: identityRes.reasons,
      autoAllowed: false,
    };
  }
  const mailboxKey = identityRes.mailboxKey;

  const auth = assessAuthenticationHints({
    spf: message.spf,
    dkim: message.dkim,
    dmarc: message.dmarc,
    fromAddress: message.from,
    authSource: message.authSource || "missing",
  });

  if (message.simulateSpoof || auth.trustTier === "unauthenticated_quarantine") {
    return {
      mailboxKey,
      state: PROCESSING_STATE.quarantined,
      branch: BRANCH.unknown,
      autoAllowed: false,
      auth,
    };
  }

  const dup = shouldSkipDuplicate(context.existingKeys, mailboxKey);
  if (dup.skip) {
    return { mailboxKey, state: PROCESSING_STATE.duplicate_skipped, duplicateReason: dup.reason, autoAllowed: false };
  }

  const identity = resolveCjPartnerIdentity(message, context.catalogAdvertisers || [], context);
  if (identity.promptInjectionRisk) {
    return {
      mailboxKey,
      state: PROCESSING_STATE.quarantined,
      quarantineReason: "prompt_injection_pattern",
      autoAllowed: false,
    };
  }

  const classification = classifyPartnerEmail(message);
  const commercialEnvelope = context.productionImapAdapterPath
    ? extractCommercialDrafts(mergedMessage, mailboxKey)
    : extractCommercialDraftsForOfflineTest(mergedMessage, mailboxKey);
  let commercialDrafts = commercialEnvelope.ok ? commercialEnvelope.drafts : [];
  const existingActions =
    context.existingCommercialActionRecords ||
    (context.existingCommercialActionKeys || []).map((k) =>
      typeof k === "string" ? { commercialActionKey: k } : k
    );
  let dedupRequiresReview = false;
  commercialDrafts = commercialDrafts
    .map((d) => {
      const ev = evaluateCommercialActionDedup(existingActions, {
        commercialActionKey: d.commercialActionKey,
        mailboxKey,
        actionIndex: d.commercialActionIndex,
        blockFingerprint: d.rawBlockFingerprint,
        advertiserCid: d.advertiserCid,
        territory: d.territory,
      });
      if (ev.decision === "requires_review") dedupRequiresReview = true;
      return { ...d, commercialActionDedup: ev };
    })
    .filter(
      (d) =>
        d.commercialActionDedup.decision !== "duplicate_skip" && d.commercialActionDedup.decision !== "requires_review"
    );

  const contractDrafts = extractContractDrafts(message, mailboxKey);

  const state =
    dedupRequiresReview ||
    auth.trustTier === "auth_unverified" ||
    identity.confidence === "needs_verification"
      ? PROCESSING_STATE.needs_review
      : PROCESSING_STATE.parsed;

  return {
    rulesVersion: EMAIL_INGEST_RULES_VERSION,
    mailboxKey,
    auth,
    identity,
    classification,
    commercialDrafts,
    contractDrafts,
    state,
    autoAllowed: false,
  };
}
