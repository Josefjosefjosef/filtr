/** Typed revision ranks + CAS-gated SQL accept (v28). */
import { REVISION_SCHEMA } from "./iu-cj-affiliate-phase2-central-offer-source-revision-v26.mjs";

export const CONFIRMED_REV_SCHEMA = Object.freeze({
  monotonic: "monotonic",
  time: "time",
  etag: "etag",
});

export function revisionRankFromDescriptor(descriptor) {
  if (!descriptor || descriptor.schemaType === REVISION_SCHEMA.unknown) {
    return { confirmedRevSchema: null, confirmedRevNum: null, confirmedRevMs: null };
  }
  if (descriptor.schemaType === REVISION_SCHEMA.monotonic_revision_number) {
    const n = descriptor.revisionNumber;
    if (n == null || !Number.isFinite(n)) {
      return { confirmedRevSchema: null, confirmedRevNum: null, confirmedRevMs: null };
    }
    return { confirmedRevSchema: CONFIRMED_REV_SCHEMA.monotonic, confirmedRevNum: Math.trunc(n), confirmedRevMs: null };
  }
  if (descriptor.schemaType === REVISION_SCHEMA.trusted_source_updated_at) {
    const ms = descriptor.sourceUpdatedAtMs;
    if (ms == null || !Number.isFinite(ms)) {
      return { confirmedRevSchema: null, confirmedRevNum: null, confirmedRevMs: null };
    }
    return { confirmedRevSchema: CONFIRMED_REV_SCHEMA.time, confirmedRevNum: null, confirmedRevMs: Math.trunc(ms) };
  }
  if (descriptor.schemaType === REVISION_SCHEMA.opaque_etag) {
    return { confirmedRevSchema: CONFIRMED_REV_SCHEMA.etag, confirmedRevNum: null, confirmedRevMs: null };
  }
  return { confirmedRevSchema: null, confirmedRevNum: null, confirmedRevMs: null };
}

export function computeClaimAcceptDecision(revEval) {
  if (revEval.stale) return { accept: false, reason: "stale_source_revision" };
  if (revEval.incomparable) return { accept: false, reason: "revision_schema_incomparable" };
  if (revEval.sameRevisionContentConflict) return { accept: false, reason: "source_revision_content_conflict" };
  if (revEval.ambiguous && revEval.relation === "revision_order_ambiguous") {
    return { accept: false, reason: "source_revision_order_unknown" };
  }
  if (revEval.relation === "revision_order_incomparable") {
    return { accept: false, reason: "revision_schema_incomparable" };
  }
  if (revEval.relation === "same_revision_same_content") {
    return { accept: true, reason: "same_revision_same_content", idempotent: true };
  }
  return { accept: true, reason: revEval.relation, idempotent: false };
}

/** CAS + typed rank — no NULL-schema bypass; legacy rows require legacy_rev_unverified=0. */
export function sqlConfirmedStateAcceptExpression(priorGen) {
  const gen = Number.isFinite(Number(priorGen)) ? Math.trunc(Number(priorGen)) : 0;
  const cas = `central_offer_source_claims.confirmed_gen = ${gen}`;
  const typedRank = `(central_offer_source_claims.legacy_rev_unverified = 0
    AND central_offer_source_claims.confirmed_rev_schema IS NOT NULL
    AND central_offer_source_claims.confirmed_rev_schema = excluded.confirmed_rev_schema
    AND (
      (excluded.confirmed_rev_schema = 'monotonic' AND excluded.confirmed_rev_num IS NOT NULL AND central_offer_source_claims.confirmed_rev_num IS NOT NULL AND excluded.confirmed_rev_num >= central_offer_source_claims.confirmed_rev_num)
      OR (excluded.confirmed_rev_schema = 'time' AND excluded.confirmed_rev_ms IS NOT NULL AND central_offer_source_claims.confirmed_rev_ms IS NOT NULL AND excluded.confirmed_rev_ms >= central_offer_source_claims.confirmed_rev_ms)
      OR (excluded.confirmed_rev_schema = 'etag' AND central_offer_source_claims.confirmed_revision_key = excluded.confirmed_revision_key AND central_offer_source_claims.confirmed_content_fp = excluded.confirmed_content_fp)
    ))`;
  const firstConfirm = `(central_offer_source_claims.confirmed_rev_schema IS NULL AND central_offer_source_claims.legacy_rev_unverified = 0 AND excluded.claim_accept = 1 AND excluded.confirmed_rev_schema IS NOT NULL)`;
  return `(excluded.claim_accept = 1 AND ${cas} AND (${firstConfirm} OR ${typedRank}))`;
}
