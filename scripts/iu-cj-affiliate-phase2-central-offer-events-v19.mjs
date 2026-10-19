/** Structured registry events v19 — aggregation-friendly, no PII/secrets. */
import { REGISTRY_EVENT_KIND } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";
import { createHash } from "node:crypto";

export function buildRegistryEvent(kind, detail, partnerKey = null) {
  const ts = new Date().toISOString();
  const id = createHash("sha256").update(kind + "|" + ts + "|" + JSON.stringify(detail)).digest("hex").slice(0, 20);
  return {
    eventId: `cre:${id}`,
    kind,
    partnerKey: partnerKey ? String(partnerKey).slice(0, 64) : null,
    detail,
    createdAt: ts,
  };
}

export function buildDeterministicRegistryEvent(kind, detail, partnerKey, dedupeMaterial, createdAt) {
  const ts = createdAt || new Date().toISOString();
  const id = createHash("sha256").update(kind + "|" + dedupeMaterial, "utf8").digest("hex").slice(0, 20);
  return {
    eventId: `cre:${id}`,
    kind,
    partnerKey: partnerKey ? String(partnerKey).slice(0, 64) : null,
    detail,
    createdAt: ts,
  };
}

export function eventForClaimCommitted(input, offerId, identityKey, identityMode) {
  const partnerKey = input.fields?.cjCid || input.fields?.advertiserId || null;
  const dedupe = ["claim", input.source, input.sourceRecordId, offerId, identityKey].join("|");
  return buildDeterministicRegistryEvent(
    REGISTRY_EVENT_KIND.claim_committed,
    {
      offerId,
      source: input.source,
      sourceRecordId: input.sourceRecordId,
      identityKey,
      identityMode,
    },
    partnerKey,
    dedupe,
    input.observedAt
  );
}

export function eventForConflictDeterministic(offerId, conflicts, partnerKey, dedupeSuffix, observedAt) {
  const types = conflicts.map((c) => c.type).sort().join(",");
  const dedupe = ["conflict", offerId, types, dedupeSuffix].join("|");
  return buildDeterministicRegistryEvent(
    REGISTRY_EVENT_KIND.source_conflict,
    { offerId, conflictTypes: conflicts.map((c) => c.type) },
    partnerKey,
    dedupe,
    observedAt
  );
}

export function eventForInvalidClaim(reason, source) {
  return buildRegistryEvent(REGISTRY_EVENT_KIND.invalid_source_record, { reason, source }, source);
}

export function eventForConflict(offerId, conflicts, partnerKey) {
  return buildRegistryEvent(
    REGISTRY_EVENT_KIND.source_conflict,
    { offerId, conflictTypes: conflicts.map((c) => c.type) },
    partnerKey
  );
}

