/** Source revision schemas v26 — strict comparability, no cross-schema ordering. */

export const REVISION_SCHEMA = Object.freeze({
  monotonic_revision_number: "monotonic_revision_number",
  trusted_source_updated_at: "trusted_source_updated_at",
  opaque_etag: "opaque_etag",
  unknown: "unknown",
});

function versioningSystemKey(input) {
  return `${input?.source || "?"}:${input?.sourceRecordId || "?"}`;
}

/**
 * @returns {{
 *   schemaType: string,
 *   versioningSystem: string,
 *   revisionNumber: number|null,
 *   sourceUpdatedAt: string|null,
 *   sourceUpdatedAtMs: number|null,
 *   etag: string|null,
 *   token: string|null,
 *   trust: string,
 * }}
 */
export function extractRevisionDescriptor(input) {
  const meta = input?.meta?.sourceRevision || input?.meta || {};
  const evidence = input?.evidence || {};
  const versioningSystem = versioningSystemKey(input);

  const revisionNumberRaw =
    meta.revisionNumber ?? meta.sourceRevisionNumber ?? evidence.revisionNumber ?? evidence.sourceRevisionNumber ?? null;
  const revisionNumber =
    revisionNumberRaw != null && Number.isFinite(Number(revisionNumberRaw)) ? Number(revisionNumberRaw) : null;

  const sourceUpdatedAt = input.sourceUpdatedAt ?? meta.sourceUpdatedAt ?? evidence.sourceUpdatedAt ?? null;
  let sourceUpdatedAtMs = null;
  if (sourceUpdatedAt && typeof sourceUpdatedAt === "string") {
    const t = Date.parse(sourceUpdatedAt);
    if (Number.isFinite(t)) sourceUpdatedAtMs = t;
  }

  const etag = meta.etag ?? evidence.etag ?? null;
  const token = meta.token ?? meta.revisionToken ?? evidence.revisionToken ?? null;

  let schemaType = REVISION_SCHEMA.unknown;
  if (revisionNumber != null) {
    schemaType = REVISION_SCHEMA.monotonic_revision_number;
  } else if (sourceUpdatedAtMs != null) {
    schemaType = REVISION_SCHEMA.trusted_source_updated_at;
  } else if (etag && String(etag).length > 0) {
    schemaType = REVISION_SCHEMA.opaque_etag;
  } else if (token && String(token).length > 0) {
    schemaType = REVISION_SCHEMA.opaque_etag;
  }

  return {
    schemaType,
    versioningSystem,
    revisionNumber,
    sourceUpdatedAt: sourceUpdatedAt ? String(sourceUpdatedAt) : null,
    sourceUpdatedAtMs,
    etag: etag ? String(etag) : null,
    token: token ? String(token) : null,
    trust: "adapter_unverified",
  };
}

export function confirmedRevisionFromClaim(claimJson) {
  if (!claimJson?.meta) return null;
  return claimJson.meta.confirmedRevision || claimJson.meta.sourceRevision || null;
}

function compareSameSchema(prior, next, contentFp, priorContentFp) {
  if (prior.schemaType === REVISION_SCHEMA.monotonic_revision_number) {
    if (next.revisionNumber == null) {
      return incomparable("revision_schema_mismatch");
    }
    if (next.revisionNumber < prior.revisionNumber) {
      return staleResult();
    }
    if (next.revisionNumber > prior.revisionNumber) {
      return acceptResult();
    }
    if (priorContentFp !== contentFp) {
      return sameRevDiffContent();
    }
    return idempotentResult();
  }

  if (prior.schemaType === REVISION_SCHEMA.trusted_source_updated_at) {
    if (next.sourceUpdatedAtMs == null) {
      return incomparable("revision_schema_mismatch");
    }
    if (next.sourceUpdatedAtMs < prior.sourceUpdatedAtMs) {
      return staleResult();
    }
    if (next.sourceUpdatedAtMs > prior.sourceUpdatedAtMs) {
      return acceptResult();
    }
    if (priorContentFp !== contentFp) {
      return sameRevDiffContent();
    }
    return idempotentResult();
  }

  if (prior.schemaType === REVISION_SCHEMA.opaque_etag) {
    const pe = prior.etag || prior.token;
    const ne = next.etag || next.token;
    if (!pe || !ne) {
      return incomparable("revision_schema_mismatch");
    }
    if (pe === ne) {
      if (priorContentFp !== contentFp) {
        return sameRevDiffContent();
      }
      return idempotentResult();
    }
    return incomparable("etag_change_no_order");
  }

  return ambiguousResult("source_revision_order_unknown");
}

function staleResult() {
  return {
    relation: "stale_revision",
    stale: true,
    ambiguous: false,
    incomparable: false,
    sameRevisionContentConflict: false,
    canonicalEligible: false,
    publishBlockReason: "stale_source_revision",
  };
}

function acceptResult() {
  return {
    relation: "newer_revision",
    stale: false,
    ambiguous: false,
    incomparable: false,
    sameRevisionContentConflict: false,
    canonicalEligible: true,
    publishBlockReason: null,
  };
}

function idempotentResult() {
  return {
    relation: "same_revision_same_content",
    stale: false,
    ambiguous: false,
    incomparable: false,
    sameRevisionContentConflict: false,
    canonicalEligible: true,
    publishBlockReason: null,
  };
}

function sameRevDiffContent() {
  return {
    relation: "same_revision_diff_content",
    stale: false,
    ambiguous: false,
    incomparable: false,
    sameRevisionContentConflict: true,
    canonicalEligible: false,
    publishBlockReason: "source_revision_content_conflict",
  };
}

function ambiguousResult(reason) {
  return {
    relation: "revision_order_ambiguous",
    stale: false,
    ambiguous: true,
    incomparable: false,
    sameRevisionContentConflict: false,
    canonicalEligible: false,
    publishBlockReason: reason,
  };
}

function incomparable(reason) {
  return {
    relation: "revision_order_incomparable",
    stale: false,
    ambiguous: true,
    incomparable: true,
    sameRevisionContentConflict: false,
    canonicalEligible: false,
    publishBlockReason: reason,
  };
}

export function evaluateSourceRevisionOrderV26(priorClaimJson, input, contentFp, priorContentFp) {
  if (!priorClaimJson) {
    const next = extractRevisionDescriptor(input);
    return {
      relation: "first_delivery",
      stale: false,
      ambiguous: next.schemaType === REVISION_SCHEMA.unknown,
      incomparable: false,
      sameRevisionContentConflict: false,
      canonicalEligible: next.schemaType !== REVISION_SCHEMA.unknown,
      publishBlockReason: next.schemaType === REVISION_SCHEMA.unknown ? "source_revision_order_unknown" : null,
      confirmedDescriptor: next,
    };
  }

  const priorDesc = confirmedRevisionFromClaim(priorClaimJson);
  const priorNorm = priorDesc?.schemaType
    ? priorDesc
    : {
        ...extractRevisionDescriptor({ ...priorClaimJson, meta: { sourceRevision: priorDesc } }),
      };
  const nextDesc = extractRevisionDescriptor(input);

  if (priorNorm.schemaType === REVISION_SCHEMA.unknown || nextDesc.schemaType === REVISION_SCHEMA.unknown) {
    return { ...ambiguousResult("source_revision_order_unknown"), confirmedDescriptor: priorNorm };
  }

  if (priorNorm.schemaType !== nextDesc.schemaType) {
    return { ...incomparable("revision_schema_incomparable"), confirmedDescriptor: priorNorm };
  }

  if (priorNorm.versioningSystem !== nextDesc.versioningSystem) {
    return { ...incomparable("revision_versioning_system_mismatch"), confirmedDescriptor: priorNorm };
  }

  const cmp = compareSameSchema(priorNorm, nextDesc, contentFp, priorContentFp);
  return { ...cmp, confirmedDescriptor: priorNorm };
}

export function buildDeliveryRecord(input, outcome, ts) {
  return {
    observedAt: input.observedAt || ts,
    sourceUpdatedAt: input.sourceUpdatedAt || null,
    descriptor: extractRevisionDescriptor(input),
    outcome,
  };
}

export function applyConfirmedRevisionMeta(claimPayload, priorClaimJson, input, revEval, ts) {
  const delivery = buildDeliveryRecord(input, revEval.relation, ts);
  const deliveries = [...(priorClaimJson?.meta?.deliveryHistory || [])];
  deliveries.push(delivery);

  if (revEval.stale || revEval.incomparable) {
    claimPayload.meta = {
      ...(priorClaimJson?.meta || {}),
      ...(claimPayload.meta || {}),
      confirmedRevision: priorClaimJson?.meta?.confirmedRevision || confirmedRevisionFromClaim(priorClaimJson),
      lastDelivery: delivery,
      deliveryHistory: deliveries,
      revisionOutcome: revEval.stale ? "stale_rejected" : "revision_order_incomparable",
    };
    if (revEval.stale && priorClaimJson) {
      claimPayload.meta.staleDeliveries = [
        ...(priorClaimJson.meta?.staleDeliveries || []),
        {
          observedAt: delivery.observedAt,
          descriptor: delivery.descriptor,
          fieldsSnapshot: input.fields,
          evidenceSnapshot: input.evidence,
        },
      ];
    }
    return claimPayload;
  }

  if (revEval.sameRevisionContentConflict) {
    claimPayload.meta = {
      ...(claimPayload.meta || {}),
      confirmedRevision: priorClaimJson?.meta?.confirmedRevision || confirmedRevisionFromClaim(priorClaimJson),
      lastDelivery: delivery,
      deliveryHistory: deliveries,
      revisionOutcome: "same_revision_content_conflict",
    };
    return claimPayload;
  }

  if (revEval.relation === "same_revision_same_content") {
    claimPayload.meta = {
      ...(priorClaimJson?.meta || {}),
      ...(claimPayload.meta || {}),
      confirmedRevision: priorClaimJson?.meta?.confirmedRevision || extractRevisionDescriptor(input),
      lastDelivery: delivery,
      deliveryHistory: deliveries,
      revisionOutcome: "accepted_idempotent",
    };
    return claimPayload;
  }

  claimPayload.meta = {
    ...(claimPayload.meta || {}),
    confirmedRevision: extractRevisionDescriptor(input),
    lastDelivery: delivery,
    deliveryHistory: deliveries,
    revisionOutcome: "accepted",
  };
  return claimPayload;
}

export function confirmedRevisionRankKey(descriptor) {
  if (!descriptor || descriptor.schemaType === REVISION_SCHEMA.unknown) return null;
  if (descriptor.schemaType === REVISION_SCHEMA.monotonic_revision_number) {
    return `monotonic:${descriptor.revisionNumber}`;
  }
  if (descriptor.schemaType === REVISION_SCHEMA.trusted_source_updated_at) {
    return `time:${descriptor.sourceUpdatedAtMs}`;
  }
  if (descriptor.schemaType === REVISION_SCHEMA.opaque_etag) {
    return `etag:${descriptor.etag || descriptor.token}`;
  }
  return null;
}

/** @deprecated v25 export names */
export const extractSourceRevision = extractRevisionDescriptor;
export function evaluateSourceRevisionOrder(priorClaimJson, input, contentFp, priorContentFp) {
  return evaluateSourceRevisionOrderV26(priorClaimJson, input, contentFp, priorContentFp);
}
