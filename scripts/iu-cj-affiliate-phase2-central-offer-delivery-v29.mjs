/** Delivery history layer (v28) — separate from confirmed claim row. */
import { createHash } from "node:crypto";

export function deliveryIdempotencyKey(source, sourceRecordId, contentFp, revKey, outcome) {
  const raw = [source, sourceRecordId, contentFp || "", revKey || "", outcome || ""].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function deliveryIdFromKey(idempotencyKey) {
  return "dlv:" + idempotencyKey;
}

export function buildDeliveryRecord({
  claimId,
  source,
  sourceRecordId,
  observedAt,
  outcome,
  rejectReason,
  revKey,
  contentFp,
  payload,
  eventId,
  createdAt,
}) {
  const idempotencyKey = deliveryIdempotencyKey(source, sourceRecordId, contentFp, revKey, outcome);
  return {
    deliveryId: deliveryIdFromKey(idempotencyKey),
    idempotencyKey,
    claimId,
    source,
    sourceRecordId,
    observedAt,
    deliveryOutcome: outcome,
    rejectReason: rejectReason || null,
    deliveredRevKey: revKey || null,
    deliveredContentFp: contentFp,
    deliveryJson: JSON.stringify(payload),
    eventId: eventId || null,
    createdAt,
  };
}

export function buildDeliveryInsertStmt(db, rec) {
  return db
    .prepare(
      `INSERT INTO central_offer_claim_deliveries (delivery_id, claim_id, source, source_record_id, observed_at, delivery_outcome, reject_reason, delivered_rev_key, delivered_content_fp, delivery_json, event_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`
    )
    .bind(
      rec.deliveryId,
      rec.claimId,
      rec.source,
      rec.sourceRecordId,
      rec.observedAt,
      rec.deliveryOutcome,
      rec.rejectReason,
      rec.deliveredRevKey,
      rec.deliveredContentFp,
      rec.deliveryJson,
      rec.eventId,
      rec.idempotencyKey,
      rec.createdAt
    );
}

export function buildDeliveryCollisionCheckStmt(db, idempotencyKey, contentFp) {
  return db
    .prepare(
      `SELECT delivered_content_fp AS fp FROM central_offer_claim_deliveries WHERE idempotency_key = ? LIMIT 1`
    )
    .bind(idempotencyKey);
}
