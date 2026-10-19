/**
 * Trusted production publication proof for CJ affiliate ad archive.
 * Non-test archive writes stay blocked until a real adapter is enabled (no fake proofs).
 */
export type AffiliateArchivePublishEventType =
  | "initial"
  | "test_simulation"
  | "production_publish"
  | "material_change"
  | "publication_ended";

/** Must stay false until a vetted production publish adapter exists. */
export const ARCHIVE_TRUSTED_PUBLICATION_ADAPTER_ENABLED = false;

export const ARCHIVE_PUBLICATION_BLOCKED_STATUS = "BLOCKED – AWAITING TRUSTED ADAPTER";

export const TRUSTED_PUBLICATION_SOURCE_V1 = "iu_cj_trusted_publish_adapter_v1";

export type TrustedPublicationProof = {
  publicationEventId: string;
  publishedRecordIdentity: string;
  publishedAtIso: string;
  placementKey: string;
  gateDecisionVerified: boolean;
  publishProcessSuccess: boolean;
  trustedSource: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseProofObject(proof: unknown): TrustedPublicationProof | null {
  if (!proof || typeof proof !== "object") return null;
  const p = proof as Record<string, unknown>;
  if (!isNonEmptyString(p.publicationEventId)) return null;
  if (!isNonEmptyString(p.publishedRecordIdentity)) return null;
  if (!isNonEmptyString(p.publishedAtIso)) return null;
  if (!isNonEmptyString(p.placementKey)) return null;
  if (p.gateDecisionVerified !== true) return null;
  if (p.publishProcessSuccess !== true) return null;
  if (!isNonEmptyString(p.trustedSource)) return null;
  return {
    publicationEventId: p.publicationEventId.trim(),
    publishedRecordIdentity: p.publishedRecordIdentity.trim(),
    publishedAtIso: p.publishedAtIso.trim(),
    placementKey: p.placementKey.trim(),
    gateDecisionVerified: true,
    publishProcessSuccess: true,
    trustedSource: p.trustedSource.trim(),
  };
}

export function validateTrustedPublicationProof(
  proof: unknown,
  ctx: { placementKey?: string | null; gateDecision: Record<string, unknown>; productionSigningEnabled?: boolean }
): { ok: true; proof: TrustedPublicationProof } | { ok: false; reason: string; blockStatus?: string } {
  if (!ARCHIVE_TRUSTED_PUBLICATION_ADAPTER_ENABLED) {
    return {
      ok: false,
      reason: "blocked_awaiting_trusted_adapter",
      blockStatus: ARCHIVE_PUBLICATION_BLOCKED_STATUS,
    };
  }
  if (!ctx.productionSigningEnabled) {
    return { ok: false, reason: "production_signing_disabled", blockStatus: ARCHIVE_PUBLICATION_BLOCKED_STATUS };
  }
  const parsed = parseProofObject(proof);
  if (!parsed) return { ok: false, reason: "invalid_publication_proof" };
  if (parsed.trustedSource !== TRUSTED_PUBLICATION_SOURCE_V1) {
    return { ok: false, reason: "untrusted_publication_source" };
  }
  const t = Date.parse(parsed.publishedAtIso);
  if (!Number.isFinite(t)) return { ok: false, reason: "invalid_published_at" };
  const placement = (ctx.placementKey ?? "").trim();
  if (!placement || parsed.placementKey !== placement) {
    return { ok: false, reason: "placement_mismatch" };
  }
  if (ctx.gateDecision.publicationReady !== true) {
    return { ok: false, reason: "gate_not_ready" };
  }
  return { ok: true, proof: parsed };
}

export function isTestSimulationEvidence(evidence: Record<string, unknown>): boolean {
  const marker = String(evidence.marker ?? "");
  const source = String(evidence.source ?? "");
  if (marker === "test_simulation_only") return true;
  if (source === "test_simulation") return true;
  if (evidence.synthetic === true && source.includes("test")) return true;
  return false;
}

export type ArchiveWritePolicyInput = {
  mode: "insert" | "revision" | "end";
  isTest?: boolean;
  existingRecordIsTest?: boolean;
  publishEventType: AffiliateArchivePublishEventType;
  evidence: Record<string, unknown>;
  gateDecision: Record<string, unknown>;
  publicationProof?: unknown;
  productionSigningEnabled?: boolean;
  placementKey?: string | null;
};

export function validateArchiveWritePolicy(
  input: ArchiveWritePolicyInput
): { ok: true; testOnly?: boolean } | { ok: false; reason: string; blockStatus?: string } {
  const signing = input.productionSigningEnabled ?? false;
  const explicitTest = input.isTest === true || input.existingRecordIsTest === true;

  if (explicitTest) {
    if (input.isTest === false) {
      return { ok: false, reason: "cannot_downgrade_test_record" };
    }
    if (input.mode === "insert" && input.publishEventType !== "test_simulation") {
      return { ok: false, reason: "test_insert_requires_test_simulation" };
    }
    if (!isTestSimulationEvidence(input.evidence)) {
      return { ok: false, reason: "test_evidence_marker_required" };
    }
    if (
      input.publishEventType === "production_publish" ||
      input.publishEventType === "initial" ||
      (!input.existingRecordIsTest && input.isTest !== true)
    ) {
      return { ok: false, reason: "test_path_event_mismatch" };
    }
    return { ok: true, testOnly: true };
  }

  if (
    input.publishEventType === "test_simulation" &&
    input.isTest !== true &&
    !input.existingRecordIsTest
  ) {
    return { ok: false, reason: "test_simulation_requires_is_test" };
  }

  const trusted = validateTrustedPublicationProof(input.publicationProof, {
    placementKey: input.placementKey,
    gateDecision: input.gateDecision,
    productionSigningEnabled: signing,
  });
  if (!trusted.ok) return trusted;

  if (input.publishEventType === "test_simulation") {
    return { ok: false, reason: "production_path_cannot_use_test_simulation" };
  }

  return { ok: true };
}

/** @deprecated Use validateArchiveWritePolicy — kept for negative-test compatibility. */
export function validateArchivePublishEvent(input: {
  publishEventType: AffiliateArchivePublishEventType;
  gateDecision: Record<string, unknown>;
  productionSigningEnabled?: boolean;
  isTest?: boolean;
  evidence?: Record<string, unknown>;
  publicationProof?: unknown;
  placementKey?: string | null;
  mode?: "insert" | "revision" | "end";
  existingRecordIsTest?: boolean;
}): { ok: true } | { ok: false; reason: string; blockStatus?: string } {
  return validateArchiveWritePolicy({
    mode: input.mode ?? "insert",
    isTest: input.isTest,
    existingRecordIsTest: input.existingRecordIsTest,
    publishEventType: input.publishEventType,
    evidence: input.evidence ?? {},
    gateDecision: input.gateDecision,
    publicationProof: input.publicationProof,
    productionSigningEnabled: input.productionSigningEnabled,
    placementKey: input.placementKey,
  });
}
