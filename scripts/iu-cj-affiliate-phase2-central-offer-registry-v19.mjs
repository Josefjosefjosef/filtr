/** In-memory registry facade (uses same reconcile as D1). */
import { reconcileOfferClaims } from "./iu-cj-affiliate-phase2-central-offer-conflict-v19.mjs";
import { computeOfferIdentityKey } from "./iu-cj-affiliate-phase2-central-offer-identity-v19.mjs";
import { validateSourceClaim } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";
import { offerIdFromIdentityKey } from "./iu-cj-affiliate-phase2-central-offer-identity-v19.mjs";

export function createInMemoryCentralOfferRegistry(options = {}) {
  const offers = new Map();
  const claimsByOffer = new Map();
  const claimsBySourceKey = new Map();
  const defaultReferenceTime = options.referenceTime ?? null;

  function recomputeOffer(offerId, identityAmbiguous) {
    const list = claimsByOffer.get(offerId) || [];
    const reconciled = reconcileOfferClaims(list, {
      referenceTime: defaultReferenceTime,
      identityAmbiguous,
    });
    const prev = offers.get(offerId) || {};
    offers.set(offerId, {
      ...prev,
      offerId,
      ...reconciled,
      claims: list,
    });
    return reconciled;
  }

  function registerSourceClaim(input) {
    const v = validateSourceClaim(input);
    if (!v.ok) return { ok: false, reason: v.reason };

    const referenceTime = input.referenceTime ?? defaultReferenceTime;
    const { identityKey, ambiguous } = computeOfferIdentityKey(input.fields, input.sourceRecordId, {
      source: input.source,
    });
    const offerId = offerIdFromIdentityKey(identityKey);
    if (!offers.has(offerId)) {
      offers.set(offerId, { offerId, identityKey, createdAt: input.observedAt });
      claimsByOffer.set(offerId, []);
    }

    const sk = `${input.source}:${input.sourceRecordId}`;
    const prior = claimsBySourceKey.get(sk);
    const oldOfferId = prior?.offerId || null;

    const claim = {
      source: input.source,
      sourceRecordId: input.sourceRecordId,
      observedAt: input.observedAt,
      sourceUpdatedAt: input.sourceUpdatedAt || null,
      fields: input.fields,
      evidence: input.evidence,
      meta: input.meta || {},
    };
    claimsBySourceKey.set(sk, { offerId, claim });
    const list = (claimsByOffer.get(offerId) || []).filter((c) => `${c.source}:${c.sourceRecordId}` !== sk);
    list.push(claim);
    claimsByOffer.set(offerId, list);

    const reconciled = reconcileOfferClaims(list, { referenceTime, identityAmbiguous: ambiguous });
    offers.set(offerId, {
      offerId,
      identityKey,
      ...reconciled,
      claims: list,
    });

    if (oldOfferId && oldOfferId !== offerId) {
      const oldList = (claimsByOffer.get(oldOfferId) || []).filter((c) => `${c.source}:${c.sourceRecordId}` !== sk);
      claimsByOffer.set(oldOfferId, oldList);
      recomputeOffer(oldOfferId, false);
    }

    return {
      ok: true,
      offerId,
      identityKey,
      identityAmbiguous: ambiguous,
      ...reconciled,
      claimsCount: list.length,
    };
  }

  function getOffer(offerId) {
    return offers.get(offerId) || null;
  }

  return { registerSourceClaim, getOffer, _offers: offers };
}
