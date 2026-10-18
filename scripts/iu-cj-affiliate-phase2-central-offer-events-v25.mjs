/** Registry events v25 — dedupe includes fingerprint algo generation. */
import { REGISTRY_EVENT_KIND } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";
import { buildDeterministicRegistryEvent } from "./iu-cj-affiliate-phase2-central-offer-events-v19.mjs";
import { FINGERPRINT_ALGO, claimContentFingerprint } from "./iu-cj-affiliate-phase2-central-offer-claim-fingerprint-v25.mjs";
import { conflictsFingerprint } from "./iu-cj-affiliate-phase2-central-offer-claim-fingerprint-v25.mjs";

export function eventForClaimTransitionV25(input, offerId, identityKey, identityMode, transition, revisionOutcome) {
  const partnerKey = input.fields?.cjCid || input.fields?.advertiserId || null;
  const contentFp = transition.contentFingerprint || claimContentFingerprint(input);
  const dedupe = [
    "claim_v25",
    FINGERPRINT_ALGO,
    input.source,
    input.sourceRecordId,
    String(transition.claimSequence),
    contentFp,
    transition.evidenceFingerprint || "",
    offerId,
    identityKey,
    revisionOutcome || "accepted",
  ].join("|");
  return buildDeterministicRegistryEvent(
    REGISTRY_EVENT_KIND.claim_committed,
    {
      offerId,
      source: input.source,
      sourceRecordId: input.sourceRecordId,
      identityKey,
      identityMode,
      claimSequence: transition.claimSequence,
      contentFingerprint: contentFp,
      evidenceFingerprint: transition.evidenceFingerprint,
      priorClaimSequence: transition.priorSequence,
      priorContentFingerprint: transition.priorContentFingerprint,
      validFrom: input.fields?.validFrom ?? null,
      validTo: input.fields?.validTo ?? null,
      observedAt: input.observedAt,
      revisionOutcome: revisionOutcome || "accepted",
      fingerprintAlgo: FINGERPRINT_ALGO,
    },
    partnerKey,
    dedupe,
    input.observedAt
  );
}

export function eventForStaleRevisionV25(input, offerId, identityKey, transition) {
  const partnerKey = input.fields?.cjCid || input.fields?.advertiserId || null;
  const contentFp = transition.contentFingerprint || claimContentFingerprint(input);
  const dedupe = [
    "stale_rev_v25",
    FINGERPRINT_ALGO,
    input.source,
    input.sourceRecordId,
    String(input.observedAt),
    contentFp,
    offerId,
  ].join("|");
  return buildDeterministicRegistryEvent(
    REGISTRY_EVENT_KIND.claim_committed,
    {
      kindDetail: "stale_source_revision",
      offerId,
      source: input.source,
      sourceRecordId: input.sourceRecordId,
      identityKey,
      contentFingerprint: contentFp,
      observedAt: input.observedAt,
      fingerprintAlgo: FINGERPRINT_ALGO,
    },
    partnerKey,
    dedupe,
    input.observedAt
  );
}

export function eventForClaimMoveV25(input, fromOfferId, toOfferId, identityKey, transition) {
  const partnerKey = input.fields?.cjCid || input.fields?.advertiserId || null;
  const contentFp = transition.contentFingerprint || claimContentFingerprint(input);
  const dedupe = [
    "claim_move_v25",
    FINGERPRINT_ALGO,
    input.source,
    input.sourceRecordId,
    String(transition.claimSequence),
    fromOfferId,
    toOfferId,
    contentFp,
  ].join("|");
  return buildDeterministicRegistryEvent(
    REGISTRY_EVENT_KIND.claim_committed,
    {
      kindDetail: "claim_offer_reassignment",
      fromOfferId,
      offerId: toOfferId,
      source: input.source,
      sourceRecordId: input.sourceRecordId,
      identityKey,
      claimSequence: transition.claimSequence,
      contentFingerprint: contentFp,
      fingerprintAlgo: FINGERPRINT_ALGO,
    },
    partnerKey,
    dedupe,
    input.observedAt
  );
}

export function eventForConflictTransitionV25(offerId, conflicts, partnerKey, trigger, offerRevision, observedAt) {
  const cfp = conflictsFingerprint(conflicts);
  const dedupe = ["conflict_v25", FINGERPRINT_ALGO, offerId, String(offerRevision), cfp, trigger].join("|");
  return buildDeterministicRegistryEvent(
    REGISTRY_EVENT_KIND.source_conflict,
    {
      offerId,
      conflictTypes: conflicts.map((c) => c.type),
      conflictsFingerprint: cfp,
      offerRevision,
      trigger,
      fingerprintAlgo: FINGERPRINT_ALGO,
    },
    partnerKey,
    dedupe,
    observedAt
  );
}
