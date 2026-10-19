/** DB snapshot helpers for central-offer registry verification (v29.1). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createNodeSqliteD1Shim } from "./iu-cj-affiliate-phase2-cj-email-d1-sqlite-shim.mjs";
import {
  createCentralOfferRegistryStore,
  migrateCentralOfferRegistryD1,
} from "./iu-cj-affiliate-phase2-central-offer-d1-v29.mjs";
import { OFFER_SOURCE, OFFER_TYPE } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";

export const MATRIX_BASE_FIELDS = {
  network: "CJ",
  cjCid: "889901",
  advertiserId: "889901",
  market: "CZ",
  offerType: OFFER_TYPE.coupon,
  couponCode: "M291",
  productId: "m291",
  assortmentScope: "m291",
  campaignId: "CID-M291",
  validFrom: "2026-11-01",
  validTo: "2026-11-30",
};

export async function captureRegistryDbState(db) {
  const offersQ = await db
    .prepare(
      "SELECT offer_id, revision, conflict_state, publishability_state, block_reason, canonical_json FROM central_offers ORDER BY offer_id"
    )
    .bind()
    .all();
  const claimsQ = await db
    .prepare(
      "SELECT claim_id, offer_id, source, source_record_id, confirmed_gen, claim_accept, confirmed_rev_schema, confirmed_rev_num, confirmed_rev_ms, legacy_rev_unverified, confirmed_content_fp, claim_json FROM central_offer_source_claims ORDER BY source, source_record_id"
    )
    .bind()
    .all();
  const eventsQ = await db
    .prepare("SELECT event_id, kind FROM central_registry_events ORDER BY event_id")
    .bind()
    .all();
  const deliveriesQ = await db
    .prepare(
      "SELECT delivery_id, delivery_outcome, reject_reason, delivered_content_fp, idempotency_key FROM central_offer_claim_deliveries ORDER BY delivery_id"
    )
    .bind()
    .all();
  const offers = offersQ?.results ?? [];
  const claims = claimsQ?.results ?? [];
  const events = eventsQ?.results ?? [];
  const deliveries = deliveriesQ?.results ?? [];
  return {
    counts: {
      offers: offers.length,
      claims: claims.length,
      events: events.length,
      deliveries: deliveries.length,
    },
    offers: offers.map((o) => ({
      offer_id: o.offer_id,
      revision: o.revision,
      conflict_state: o.conflict_state,
      publishability_state: o.publishability_state,
      block_reason: o.block_reason,
      canonical_validTo: safeCanonValidTo(o.canonical_json),
    })),
    claims: claims.map((c) => ({
      source: c.source,
      source_record_id: c.source_record_id,
      offer_id: c.offer_id,
      confirmed_gen: c.confirmed_gen,
      claim_accept: c.claim_accept,
      confirmed_rev_schema: c.confirmed_rev_schema,
      confirmed_rev_num: c.confirmed_rev_num,
      confirmed_rev_ms: c.confirmed_rev_ms,
      legacy_rev_unverified: c.legacy_rev_unverified,
      claim_validTo: safeClaimValidTo(c.claim_json),
    })),
    events: events.map((e) => ({ event_id: e.event_id, kind: e.kind })),
    deliveries: deliveries.map((d) => ({
      delivery_outcome: d.delivery_outcome,
      reject_reason: d.reject_reason,
      delivered_content_fp: d.delivered_content_fp,
    })),
  };
}

function safeCanonValidTo(canonicalJson) {
  try {
    const j = JSON.parse(canonicalJson || "{}");
    return j?.canonical?.validTo ?? null;
  } catch {
    return null;
  }
}

function safeClaimValidTo(claimJson) {
  try {
    const j = JSON.parse(claimJson || "{}");
    return j?.fields?.validTo ?? null;
  } catch {
    return null;
  }
}

export function statesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function freshV29Store(opts = {}) {
  const dbPath = path.join(os.tmpdir(), "iu-m291-" + Math.random().toString(16).slice(2) + ".sqlite");
  const shim = await createNodeSqliteD1Shim(dbPath);
  await migrateCentralOfferRegistryD1(shim.db);
  const store = createCentralOfferRegistryStore(shim.db, {
    allowTestHooks: opts.allowTestHooks !== false,
  });
  const cleanup = () => {
    try {
      shim.db.close?.();
      fs.unlinkSync(dbPath);
    } catch {
      /* ignore */
    }
  };
  return { shim, store, db: shim.db, cleanup };
}

export function monotonicClaim(sourceRecordId, rev, validTo, extra = {}) {
  return {
    source: OFFER_SOURCE.API,
    sourceRecordId,
    observedAt: extra.observedAt || "2026-11-01T10:00:00Z",
    meta: { sourceRevision: { revisionNumber: rev } },
    fields: { ...MATRIX_BASE_FIELDS, validTo: validTo ?? MATRIX_BASE_FIELDS.validTo, ...extra.fields },
    evidence: extra.evidence ?? { step: rev },
    ...extra,
  };
}

export function etagClaim(sourceRecordId, etag, validTo, extra = {}) {
  return {
    source: OFFER_SOURCE.API,
    sourceRecordId,
    observedAt: extra.observedAt || "2026-11-01T10:00:00Z",
    meta: { etag },
    fields: { ...MATRIX_BASE_FIELDS, validTo: validTo ?? MATRIX_BASE_FIELDS.validTo, ...extra.fields },
    evidence: extra.evidence ?? { etag },
    ...extra,
  };
}

export function timeClaim(sourceRecordId, sourceUpdatedAt, validTo) {
  return {
    source: OFFER_SOURCE.API,
    sourceRecordId,
    observedAt: "2026-11-01T10:00:00Z",
    sourceUpdatedAt,
    fields: { ...MATRIX_BASE_FIELDS, validTo },
    evidence: {},
  };
}

/** Shim db with batch only (no execTransaction) — mirrors Cloudflare D1 registry path. */
export function dbBatchOnlyFromShim(shimDb) {
  let batchCalls = 0;
  const wrapped = {
    prepare: (sql) => shimDb.prepare(sql),
    batch: async (stmts) => {
      batchCalls += 1;
      return shimDb.batch(stmts);
    },
    close: () => shimDb.close?.(),
    _batchCalls: () => batchCalls,
  };
  return wrapped;
}
