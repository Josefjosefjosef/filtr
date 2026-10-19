/** D1 central offer registry v28 — confirmed state vs delivery history, CAS generation gate. */
import { reconcileOfferClaims } from "./iu-cj-affiliate-phase2-central-offer-conflict-v19.mjs";
import { computeOfferIdentityKey, offerIdFromIdentityKey } from "./iu-cj-affiliate-phase2-central-offer-identity-v23.mjs";
import { validateSourceClaim } from "./iu-cj-affiliate-phase2-central-offer-model-v19.mjs";
import { eventForInvalidClaim } from "./iu-cj-affiliate-phase2-central-offer-events-v19.mjs";
import {
  eventForClaimMoveV25,
  eventForClaimTransitionV25,
  eventForConflictTransitionV25,
  eventForStaleRevisionV25,
} from "./iu-cj-affiliate-phase2-central-offer-events-v25.mjs";
import {
  claimContentFingerprint,
  normalizedClaimFingerprint,
  sourceEvidenceFingerprint,
  nextClaimSequence,
  conflictsFingerprint,
  eventDetailFingerprint,
} from "./iu-cj-affiliate-phase2-central-offer-claim-fingerprint-v25.mjs";
import {
  evaluateSourceRevisionOrderV26,
  applyConfirmedRevisionMeta,
  extractRevisionDescriptor,
} from "./iu-cj-affiliate-phase2-central-offer-source-revision-v26.mjs";
import {
  revisionRankFromDescriptor,
  computeClaimAcceptDecision,
  sqlConfirmedStateAcceptExpression,
} from "./iu-cj-affiliate-phase2-central-offer-revision-rank-v28.mjs";
import {
  buildDeliveryRecord,
  buildDeliveryInsertStmt,
  deliveryIdempotencyKey,
} from "./iu-cj-affiliate-phase2-central-offer-delivery-v28.mjs";
import {
  assertRegistryAtomicDb,
  registryBatch,
  revisionConflictError,
} from "./iu-cj-affiliate-phase2-central-offer-d1-transaction-v21.mjs";

export const CENTRAL_OFFER_SQL_V20 = Object.freeze({
  idxClaimsOfferId: `CREATE INDEX IF NOT EXISTS idx_central_claims_offer_id ON central_offer_source_claims(offer_id)`,
});

export const CENTRAL_OFFER_SQL_V21 = Object.freeze({
  migrateRevision: `ALTER TABLE central_offers ADD COLUMN revision INTEGER NOT NULL DEFAULT 0`,
});

export const CENTRAL_OFFER_SQL = Object.freeze({
  migrateOffers: `CREATE TABLE IF NOT EXISTS central_offers (
    offer_id TEXT PRIMARY KEY,
    identity_key TEXT NOT NULL UNIQUE,
    network TEXT NOT NULL,
    advertiser_id TEXT,
    market TEXT,
    offer_type TEXT,
    conflict_state TEXT NOT NULL,
    publishability_state TEXT NOT NULL,
    block_reason TEXT,
    canonical_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0
  )`,
  migrateClaims: `CREATE TABLE IF NOT EXISTS central_offer_source_claims (
    claim_id TEXT PRIMARY KEY,
    offer_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_record_id TEXT NOT NULL,
    claim_json TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    source_updated_at TEXT,
    UNIQUE(source, source_record_id)
  )`,
  migrateConflictLog: `CREATE TABLE IF NOT EXISTS central_offer_conflict_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id TEXT NOT NULL,
    conflict_type TEXT NOT NULL,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  migrateEvents: `CREATE TABLE IF NOT EXISTS central_registry_events (
    event_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    partner_key TEXT,
    detail_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  migrateCheckpoint: `CREATE TABLE IF NOT EXISTS offer_registry_checkpoint (
    batch_name TEXT PRIMARY KEY,
    cursor_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
});

export async function migrateCentralOfferRegistryD1(db) {
  for (const sql of Object.values(CENTRAL_OFFER_SQL)) {
    try {
      await db.prepare(sql).run();
    } catch {
      /* exists */
    }
  }
  for (const sql of Object.values(CENTRAL_OFFER_SQL_V20)) {
    await db.prepare(sql).run();
  }
  try {
    await db.prepare(CENTRAL_OFFER_SQL_V21.migrateRevision).run();
  } catch {
    /* exists */
  }
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS d1_batch_invariant_abort (
          must_be_one INTEGER NOT NULL CHECK (must_be_one = 1)
        )`
      )
      .run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_registry_events ADD COLUMN detail_fingerprint TEXT").run();
  } catch {
    /* exists */
  }
  try {
    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_central_registry_events_detail_fp ON central_registry_events(event_id, detail_fingerprint)"
      )
      .run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_revision_key TEXT").run();
  } catch {
    /* exists */
  }
  try {
    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_central_claims_confirmed_rev ON central_offer_source_claims(source, source_record_id, confirmed_revision_key)"
      )
      .run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_rev_schema TEXT").run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_rev_num INTEGER").run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_rev_ms INTEGER").run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN claim_accept INTEGER").run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_gen INTEGER NOT NULL DEFAULT 0").run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN confirmed_content_fp TEXT").run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN legacy_rev_unverified INTEGER NOT NULL DEFAULT 0").run();
  } catch {
    /* exists */
  }
  try {
    await db.prepare("ALTER TABLE central_offer_source_claims ADD COLUMN last_delivery_observed_at TEXT").run();
  } catch {
    /* exists */
  }
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS central_offer_claim_deliveries (
          delivery_id TEXT PRIMARY KEY,
          claim_id TEXT NOT NULL,
          source TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          delivery_outcome TEXT NOT NULL,
          reject_reason TEXT,
          delivered_rev_key TEXT,
          delivered_content_fp TEXT NOT NULL,
          delivery_json TEXT NOT NULL,
          event_id TEXT,
          idempotency_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE(idempotency_key)
        )`
      )
      .run();
  } catch {
    /* exists */
  }
  try {
    await db
      .prepare(
        "CREATE INDEX IF NOT EXISTS idx_claim_deliveries_claim_id ON central_offer_claim_deliveries(claim_id)"
      )
      .run();
  } catch {
    /* exists */
  }
  try {
    await db
      .prepare(
        "UPDATE central_offer_source_claims SET legacy_rev_unverified = 1 WHERE confirmed_rev_schema IS NULL"
      )
      .run();
  } catch {
    /* exists */
  }
  return { ok: true, version: 14 };
}

function claimId(source, sourceRecordId) {
  return `${source}:${sourceRecordId}`;
}

function mergeClaimList(existing, input) {
  const sk = `${input.source}:${input.sourceRecordId}`;
  const claimPayload = {
    source: input.source,
    sourceRecordId: input.sourceRecordId,
    observedAt: input.observedAt,
    sourceUpdatedAt: input.sourceUpdatedAt || null,
    fields: input.fields,
    evidence: input.evidence,
    meta: input.meta || {},
  };
  const claim = { ...claimPayload, fields: input.fields, evidence: input.evidence, meta: input.meta || {} };
  const list = existing.filter((c) => `${c.source}:${c.sourceRecordId}` !== sk);
  list.push(claim);
  return { list, claimPayload };
}

function emptyReconciled() {
  return {
    canonical: {},
    conflicts: [],
    conflictState: "none",
    publishabilityState: "not_evaluated",
    blockReason: null,
    publishable: false,
    evidenceBySource: {},
  };
}

export function createCentralOfferRegistryStore(db, storeOptions = {}) {
  assertRegistryAtomicDb(db);
  const memoryEvents = [];
  const defaultReferenceTime = storeOptions.referenceTime ?? null;
  const maxRevisionRetries = storeOptions.maxRevisionRetries ?? 8;
  const testHooks = storeOptions.testHooks ?? null;
  const allowTestHooks = storeOptions.allowTestHooks === true;

  async function loadClaimsForOffer(offerId) {
    const rows = await db
      .prepare("SELECT claim_json FROM central_offer_source_claims WHERE offer_id = ? ORDER BY observed_at ASC")
      .bind(offerId)
      .all();
    return (rows?.results || []).map((r) => JSON.parse(r.claim_json));
  }

  function buildEventInsertStmt(ev) {
    const detailFp = eventDetailFingerprint(ev.detail);
    return db
      .prepare(
        "INSERT OR IGNORE INTO central_registry_events (event_id, kind, partner_key, detail_json, created_at, detail_fingerprint) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(ev.eventId, ev.kind, ev.partnerKey ?? null, JSON.stringify(ev.detail), ev.createdAt, detailFp);
  }

  function legacyFingerprintFromStoredRow(row) {
    if (!row) return null;
    if (row.detail_fingerprint && String(row.detail_fingerprint).length > 0) {
      return String(row.detail_fingerprint);
    }
    try {
      return eventDetailFingerprint(JSON.parse(row.detail_json || "{}"));
    } catch {
      return null;
    }
  }

  function buildEventCollisionInvariantStmt(ev, legacyStoredFp) {
    const newFp = eventDetailFingerprint(ev.detail);
    const legacyFp = legacyStoredFp ?? newFp;
    return db
      .prepare(
        `INSERT INTO d1_batch_invariant_abort (must_be_one)
         SELECT CASE
           WHEN NOT EXISTS (SELECT 1 FROM central_registry_events WHERE event_id = ?) THEN 1
           WHEN (SELECT detail_fingerprint FROM central_registry_events WHERE event_id = ? LIMIT 1) = ? THEN 1
           WHEN (
             ((SELECT detail_fingerprint FROM central_registry_events WHERE event_id = ? LIMIT 1) IS NULL
               OR (SELECT detail_fingerprint FROM central_registry_events WHERE event_id = ? LIMIT 1) = '')
             AND ? = ?
           ) THEN 1
           ELSE 0
         END`
      )
      .bind(ev.eventId, ev.eventId, newFp, ev.eventId, ev.eventId, legacyFp, newFp);
  }

  async function assertEventCollisionSafe(ev) {
    const row = await db
      .prepare("SELECT detail_fingerprint, detail_json FROM central_registry_events WHERE event_id = ? LIMIT 1")
      .bind(ev.eventId)
      .first();
    if (!row) return { ok: true, legacyStoredFp: null };
    const newFp = eventDetailFingerprint(ev.detail);
    if (row.detail_fingerprint && String(row.detail_fingerprint).length > 0) {
      if (row.detail_fingerprint !== newFp) {
        return { ok: false, reason: "event_id_collision" };
      }
      return { ok: true, legacyStoredFp: row.detail_fingerprint };
    }
    const legacyFp = legacyFingerprintFromStoredRow(row);
    if (legacyFp == null) {
      return { ok: false, reason: "legacy_event_collision_unverifiable" };
    }
    if (legacyFp !== newFp) {
      return { ok: false, reason: "legacy_event_collision" };
    }
    return { ok: true, legacyStoredFp: legacyFp };
  }

  async function persistEvent(ev) {
    memoryEvents.push(ev);
    await buildEventInsertStmt(ev).run();
  }

  async function runStatements(stmts) {
    const cap = assertRegistryAtomicDb(db);
    if (cap.hasExecTransaction) {
      const results = [];
      for (const s of stmts) {
        try {
          results.push(await s.run());
        } catch (e) {
          if (/CHECK constraint failed/i.test(String(e?.message || e)) && /d1_batch_invariant_abort/i.test(String(e?.message || e))) {
            const err = revisionConflictError();
            throw err;
          }
          throw e;
        }
      }
      return results;
    }
    try {
      return await registryBatch(db, stmts);
    } catch (e) {
      if (/CHECK constraint failed/i.test(String(e?.message || e)) || /d1_batch_invariant_abort/i.test(String(e?.message || e))) {
        throw revisionConflictError();
      }
      throw e;
    }
  }

  function buildCanonicalUpdateStmt(offerId, reconciled, ts, revision) {
    return db
      .prepare(
        `UPDATE central_offers SET conflict_state=?, publishability_state=?, block_reason=?, canonical_json=?, advertiser_id=?, market=?, offer_type=?, updated_at=?, revision=revision+1
         WHERE offer_id=? AND revision=?`
      )
      .bind(
        reconciled.conflictState,
        reconciled.publishabilityState,
        reconciled.blockReason ?? null,
        JSON.stringify({ canonical: reconciled.canonical, evidenceBySource: reconciled.evidenceBySource }),
        reconciled.canonical.advertiserId || reconciled.canonical.cjCid || null,
        reconciled.canonical.market ?? null,
        reconciled.canonical.offerType ?? null,
        ts,
        offerId,
        revision
      );
  }

  function buildRevisionInvariantStmt(offerId, expectedRevision) {
    return db
      .prepare(
        `INSERT INTO d1_batch_invariant_abort (must_be_one)
         SELECT CASE WHEN (SELECT revision FROM central_offers WHERE offer_id = ? LIMIT 1) = ? THEN 1 ELSE 0 END`
      )
      .bind(offerId, expectedRevision);
  }

  function appendConflictLogStmts(stmts, offerId, reconciled, ts) {
    for (const c of reconciled.conflicts) {
      stmts.push(
        db
          .prepare(
            "INSERT INTO central_offer_conflict_log (offer_id, conflict_type, detail_json, created_at) VALUES (?, ?, ?, ?)"
          )
          .bind(offerId, c.type, JSON.stringify(c), ts)
      );
    }
  }

  async function registerAttempt(input, referenceTime, hookOverride = null) {
    const activeHooks = hookOverride || testHooks;
    const { identityKey, ambiguous, identityMode } = computeOfferIdentityKey(input.fields, input.sourceRecordId, {
      source: input.source,
    });
    const offerId = offerIdFromIdentityKey(identityKey);
    const ts = new Date().toISOString();
    const cid = claimId(input.source, input.sourceRecordId);
    const sk = `${input.source}:${input.sourceRecordId}`;

    const prior = await db
      .prepare(
        "SELECT offer_id, claim_json, confirmed_gen, confirmed_content_fp, legacy_rev_unverified, evidence_json, confirmed_rev_schema, confirmed_rev_num, confirmed_rev_ms, confirmed_revision_key, source_updated_at, observed_at FROM central_offer_source_claims WHERE source = ? AND source_record_id = ?"
      )
      .bind(input.source, input.sourceRecordId)
      .first();
    let priorGen = prior?.confirmed_gen != null ? Number(prior.confirmed_gen) : 0;
    if (allowTestHooks && input.__forcePriorGenForCas != null && Number.isFinite(Number(input.__forcePriorGenForCas))) {
      priorGen = Math.trunc(Number(input.__forcePriorGenForCas));
    }
    const oldOfferId = prior?.offer_id || null;
    let priorClaimJson = null;
    try {
      priorClaimJson = prior?.claim_json ? JSON.parse(prior.claim_json) : null;
    } catch {
      priorClaimJson = null;
    }

    const existing = await db
      .prepare("SELECT offer_id, revision FROM central_offers WHERE identity_key = ?")
      .bind(identityKey)
      .first();
    const boundOfferId = existing?.offer_id || offerId;

    const contentFp = claimContentFingerprint(input);
    const normFp = normalizedClaimFingerprint(input);
    const evidenceFp = sourceEvidenceFingerprint(input);
    const revEval = evaluateSourceRevisionOrderV26(priorClaimJson, input, contentFp, priorClaimJson?.meta?.contentFingerprint);
    const acceptDecision = computeClaimAcceptDecision(revEval);
    const confirmedOfferId = prior?.offer_id || boundOfferId;
    const persistOfferId = acceptDecision.accept ? boundOfferId : confirmedOfferId;
    const offerAssignmentChanged = Boolean(acceptDecision.accept && oldOfferId && oldOfferId !== boundOfferId);
    const priorClaims = await loadClaimsForOffer(confirmedOfferId);

    let effectiveInput = input;
    if (revEval.stale && priorClaimJson) {
      effectiveInput = {
        ...input,
        fields: priorClaimJson.fields,
        evidence: priorClaimJson.evidence,
        meta: { ...(input.meta || {}), staleReplay: true },
      };
    }

    const { list, claimPayload } = mergeClaimList(priorClaims, effectiveInput);
    if (revEval.stale && priorClaimJson) {
      claimPayload.fields = priorClaimJson.fields;
      claimPayload.evidence = priorClaimJson.evidence;
    }
    applyConfirmedRevisionMeta(claimPayload, priorClaimJson, input, revEval, ts);

    const incomingRank = revisionRankFromDescriptor(claimPayload.meta?.confirmedRevision || extractRevisionDescriptor(input));
    let claimAccept = acceptDecision.accept && !acceptDecision.idempotent ? 1 : 0;
    if (prior && !incomingRank.confirmedRevSchema) {
      claimAccept = 0;
    }

    const priorContent = priorClaimJson?.meta?.contentFingerprint ?? null;
    const priorEvFp = priorClaimJson?.meta?.evidenceFingerprint ?? null;
    const contentChangedFromPrior = priorContent !== contentFp || priorEvFp !== evidenceFp;
    const allowMaterialEvent =
      !revEval.stale && !revEval.incomparable && (!revEval.ambiguous || contentChangedFromPrior);
    const transition = nextClaimSequence(
      priorClaimJson,
      contentFp,
      evidenceFp,
      offerAssignmentChanged,
      allowMaterialEvent
    );
    claimPayload.meta = {
      ...(claimPayload.meta || {}),
      claimSequence: transition.claimSequence,
      contentFingerprint: transition.contentFingerprint,
      evidenceFingerprint: transition.evidenceFingerprint,
      normalizedFingerprint: normFp,
    };
    const claimInList = list.find((c) => `${c.source}:${c.sourceRecordId}` === sk);
    if (claimInList) {
      claimInList.meta = { ...(claimInList.meta || {}), ...claimPayload.meta };
    }
    let reconciled = reconcileOfferClaims(list, { referenceTime, identityAmbiguous: ambiguous });
    if (revEval.publishBlockReason || revEval.ambiguous || revEval.incomparable || revEval.sameRevisionContentConflict) {
      reconciled = {
        ...reconciled,
        publishable: false,
        publishabilityState: revEval.sameRevisionContentConflict ? "blocked_conflict" : "blocked_missing_evidence",
        blockReason: revEval.publishBlockReason || reconciled.blockReason || "source_revision_blocked",
      };
    }
    let priorConflictsFp = "";
    const canonOfferId = persistOfferId;
    const canonRow = await db.prepare("SELECT revision, canonical_json FROM central_offers WHERE offer_id = ?").bind(canonOfferId).first();
    const targetRevision = canonRow?.revision ?? existing?.revision ?? 0;
    if (canonRow) {
      const priorCanonRow = canonRow;
      try {
        const parsed = JSON.parse(priorCanonRow?.canonical_json || "{}");
        priorConflictsFp = conflictsFingerprint(parsed?.conflicts || []);
      } catch {
        priorConflictsFp = "";
      }
    }
    const newConflictsFp = conflictsFingerprint(reconciled.conflicts);
    const conflictHistoryChange = newConflictsFp !== priorConflictsFp;

    let oldReconciled = null;
    let oldRevision = null;
    if (acceptDecision.accept && oldOfferId && oldOfferId !== boundOfferId) {
      const oldRow = await db.prepare("SELECT revision FROM central_offers WHERE offer_id = ?").bind(oldOfferId).first();
      oldRevision = oldRow?.revision ?? 0;
      const oldClaimsRaw = await loadClaimsForOffer(oldOfferId);
      const oldClaimsAfter = oldClaimsRaw.filter((c) => `${c.source}:${c.sourceRecordId}` !== sk);
      oldReconciled = oldClaimsAfter.length
        ? reconcileOfferClaims(oldClaimsAfter, { referenceTime, identityAmbiguous: false })
        : emptyReconciled();
    }

    if (activeHooks?.abortBeforeWrite) {
      const err = new Error("registry_test_abort");
      err.reason = "registry_test_abort";
      throw err;
    }

    const stateAccept = sqlConfirmedStateAcceptExpression(priorGen);
    const confirmedContentFp = normalizedClaimFingerprint(effectiveInput);
    const confirmedClaimJson =
      claimAccept === 1 ? JSON.stringify(claimPayload) : prior?.claim_json || JSON.stringify(claimPayload);
    const confirmedEvidenceJson =
      claimAccept === 1
        ? JSON.stringify(claimPayload.evidence ?? input.evidence)
        : prior?.evidence_json || JSON.stringify(claimPayload.evidence ?? input.evidence);
    const confirmedRevKey =
      incomingRank.confirmedRevSchema === "etag"
        ? `etag:${claimPayload.meta?.confirmedRevision?.etag || claimPayload.meta?.confirmedRevision?.token || "unknown"}`
        : incomingRank.confirmedRevSchema === "monotonic"
          ? `monotonic:${incomingRank.confirmedRevNum}`
          : incomingRank.confirmedRevSchema === "time"
            ? `time:${incomingRank.confirmedRevMs}`
            : null;

    const writeBatch = [
      db
        .prepare(
          `INSERT INTO central_offers (offer_id, identity_key, network, advertiser_id, market, offer_type, conflict_state, publishability_state, block_reason, canonical_json, created_at, updated_at, revision)
           VALUES (?, ?, ?, ?, ?, ?, 'none', 'not_evaluated', NULL, '{}', ?, ?, 0)
           ON CONFLICT(identity_key) DO NOTHING`
        )
        .bind(
          offerId,
          identityKey,
          input.fields.network || "CJ",
          input.fields.advertiserId || input.fields.cjCid || null,
          input.fields.market || null,
          input.fields.offerType || null,
          ts,
          ts
        ),
      db
        .prepare(
          `INSERT INTO central_offer_source_claims (claim_id, offer_id, source, source_record_id, claim_json, evidence_json, observed_at, source_updated_at, confirmed_revision_key, confirmed_rev_schema, confirmed_rev_num, confirmed_rev_ms, claim_accept, confirmed_gen, confirmed_content_fp, legacy_rev_unverified, last_delivery_observed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
           ON CONFLICT(source, source_record_id) DO UPDATE SET
             offer_id=CASE WHEN ${stateAccept} THEN excluded.offer_id ELSE central_offer_source_claims.offer_id END,
             claim_json=CASE WHEN ${stateAccept} THEN excluded.claim_json ELSE central_offer_source_claims.claim_json END,
             evidence_json=CASE WHEN ${stateAccept} THEN excluded.evidence_json ELSE central_offer_source_claims.evidence_json END,
             observed_at=CASE WHEN ${stateAccept} THEN excluded.observed_at ELSE central_offer_source_claims.observed_at END,
             source_updated_at=CASE WHEN ${stateAccept} THEN excluded.source_updated_at ELSE central_offer_source_claims.source_updated_at END,
             confirmed_revision_key=CASE WHEN ${stateAccept} THEN excluded.confirmed_revision_key ELSE central_offer_source_claims.confirmed_revision_key END,
             confirmed_rev_schema=CASE WHEN ${stateAccept} THEN excluded.confirmed_rev_schema ELSE central_offer_source_claims.confirmed_rev_schema END,
             confirmed_rev_num=CASE WHEN ${stateAccept} THEN excluded.confirmed_rev_num ELSE central_offer_source_claims.confirmed_rev_num END,
             confirmed_rev_ms=CASE WHEN ${stateAccept} THEN excluded.confirmed_rev_ms ELSE central_offer_source_claims.confirmed_rev_ms END,
             confirmed_content_fp=CASE WHEN ${stateAccept} THEN excluded.confirmed_content_fp ELSE central_offer_source_claims.confirmed_content_fp END,
             confirmed_gen=CASE WHEN ${stateAccept} THEN central_offer_source_claims.confirmed_gen + 1 ELSE central_offer_source_claims.confirmed_gen END,
             claim_accept=excluded.claim_accept,
             last_delivery_observed_at=excluded.last_delivery_observed_at`
        )
        .bind(
          cid,
          persistOfferId,
          input.source,
          input.sourceRecordId,
          confirmedClaimJson,
          confirmedEvidenceJson,
          claimAccept === 1 ? input.observedAt : prior?.observed_at || input.observedAt,
          claimAccept === 1 ? input.sourceUpdatedAt || null : prior?.source_updated_at ?? priorClaimJson?.sourceUpdatedAt ?? null,
          confirmedRevKey,
          incomingRank.confirmedRevSchema,
          incomingRank.confirmedRevNum,
          incomingRank.confirmedRevMs,
          claimAccept,
          claimAccept === 1 ? priorGen + 1 : priorGen,
          claimAccept === 1 ? confirmedContentFp : prior?.confirmed_content_fp || confirmedContentFp,
          input.observedAt
        ),
    ];

    const deliveryOutcome = acceptDecision.accept
      ? acceptDecision.idempotent
        ? "idempotent_repeat"
        : "accepted"
      : acceptDecision.reason || "rejected";
    const deliveryPayload = {
      fields: input.fields,
      evidence: input.evidence,
      meta: { revisionOutcome: claimPayload.meta?.revisionOutcome, descriptor: extractRevisionDescriptor(input) },
    };
    const idemKey = deliveryIdempotencyKey(
      input.source,
      input.sourceRecordId,
      contentFp,
      confirmedRevKey,
      deliveryOutcome
    );
    const priorDelivery = await db
      .prepare("SELECT delivered_content_fp FROM central_offer_claim_deliveries WHERE idempotency_key = ? LIMIT 1")
      .bind(idemKey)
      .first();
    if (priorDelivery && priorDelivery.delivered_content_fp !== contentFp) {
      return { ok: false, reason: "delivery_idempotency_collision", safe: idemKey };
    }
    const deliveryRec = buildDeliveryRecord({
      claimId: cid,
      source: input.source,
      sourceRecordId: input.sourceRecordId,
      observedAt: input.observedAt,
      outcome: deliveryOutcome,
      rejectReason: acceptDecision.accept ? null : acceptDecision.reason,
      revKey: confirmedRevKey,
      contentFp,
      payload: deliveryPayload,
      eventId: null,
      createdAt: ts,
    });
    writeBatch.push(buildDeliveryInsertStmt(db, deliveryRec));

    if (claimAccept === 1) {
      writeBatch.push(buildCanonicalUpdateStmt(canonOfferId, reconciled, ts, targetRevision));
      appendConflictLogStmts(writeBatch, canonOfferId, reconciled, ts);

      if (oldReconciled && oldOfferId) {
        writeBatch.push(buildCanonicalUpdateStmt(oldOfferId, oldReconciled, ts, oldRevision));
        appendConflictLogStmts(writeBatch, oldOfferId, oldReconciled, ts);
      }
    }

    if (activeHooks?.abortAfterClaimInBatch) {
      writeBatch.push(db.prepare("INSERT INTO __registry_v27_test_abort_table__ (x) VALUES (1)").bind());
    }

    const claimEvents = [];
    if (revEval.stale) {
      claimEvents.push(eventForStaleRevisionV25(input, boundOfferId, identityKey, transition));
    } else if (transition.materialChange && claimAccept === 1) {
      if (offerAssignmentChanged && oldOfferId) {
        claimEvents.push(eventForClaimMoveV25(input, oldOfferId, boundOfferId, identityKey, transition));
      }
      claimEvents.push(
        eventForClaimTransitionV25(input, boundOfferId, identityKey, identityMode, transition, claimPayload.meta.revisionOutcome)
      );
    }

    let conflictEv = null;
    if (claimAccept === 1 && conflictHistoryChange && (reconciled.conflicts.length || priorConflictsFp)) {
      const partnerKey = reconciled.canonical.cjCid || reconciled.canonical.advertiserId || null;
      conflictEv = eventForConflictTransitionV25(
        boundOfferId,
        reconciled.conflicts,
        partnerKey,
        `${input.source}:${input.sourceRecordId}`,
        targetRevision + 1,
        input.observedAt
      );
    }

    let collisionEv = null;
    if (activeHooks?.forceEventIdCollision) {
      collisionEv = eventForClaimTransitionV25(
        { ...input, fields: { ...input.fields, couponCode: "COLLISION_FORCE" } },
        boundOfferId,
        identityKey,
        identityMode,
        transition,
        "collision_test"
      );
      collisionEv.eventId = activeHooks.forceEventIdCollision;
    }

    const eventsToWrite = [...claimEvents, ...(conflictEv ? [conflictEv] : []), ...(collisionEv ? [collisionEv] : [])];
    const eventLegacyFp = new Map();
    for (const ev of eventsToWrite) {
      const safe = await assertEventCollisionSafe(ev);
      if (!safe.ok) {
        return { ok: false, reason: safe.reason === "event_id_collision" ? "registry_write_failed" : safe.reason, safe: safe.reason };
      }
      eventLegacyFp.set(ev.eventId, safe.legacyStoredFp);
    }

    for (const ev of claimEvents) {
      writeBatch.push(buildEventInsertStmt(ev));
      writeBatch.push(buildEventCollisionInvariantStmt(ev, eventLegacyFp.get(ev.eventId)));
    }
    if (conflictEv) {
      writeBatch.push(buildEventInsertStmt(conflictEv));
      writeBatch.push(buildEventCollisionInvariantStmt(conflictEv, eventLegacyFp.get(conflictEv.eventId)));
    }

    if (activeHooks?.abortBeforeMandatoryEventInBatch) {
      writeBatch.push(db.prepare("INSERT INTO __registry_v27_event_abort_table__ (x) VALUES (1)").bind());
    }

    if (collisionEv) {
      writeBatch.push(buildEventInsertStmt(collisionEv));
      writeBatch.push(buildEventCollisionInvariantStmt(collisionEv, eventLegacyFp.get(collisionEv.eventId)));
    }

    if (claimAccept === 1) {
      writeBatch.push(buildRevisionInvariantStmt(canonOfferId, targetRevision + 1));
      if (oldReconciled && oldOfferId) {
        writeBatch.push(buildRevisionInvariantStmt(oldOfferId, oldRevision + 1));
      }
    }

    await runStatements(writeBatch);
    for (const ev of claimEvents) {
      memoryEvents.push(ev);
    }

    if (claimAccept === 1 && prior) {
      const afterGen = (
        await db
          .prepare("SELECT confirmed_gen FROM central_offer_source_claims WHERE source = ? AND source_record_id = ?")
          .bind(input.source, input.sourceRecordId)
          .first()
      )?.confirmed_gen;
      if (Number(afterGen) !== priorGen + 1) {
        const err = new Error("registry_cas_conflict");
        err.reason = "registry_cas_conflict";
        throw err;
      }
    }

    return {
      ok: true,
      offerId: persistOfferId,
      identityKey,
      identityAmbiguous: ambiguous,
      identityMode,
      conflictState: reconciled.conflictState,
      publishabilityState: reconciled.publishabilityState,
      publishable: reconciled.publishable,
      blockReason: reconciled.blockReason,
      conflicts: reconciled.conflicts,
      canonical: reconciled.canonical,
      claimsCount: list.length,
      oldOfferId: oldOfferId && oldOfferId !== boundOfferId ? oldOfferId : null,
      claimSequence: transition.claimSequence,
      materialChange: transition.materialChange,
      revisionOutcome: claimPayload.meta.revisionOutcome,
      confirmedRevision: claimPayload.meta?.confirmedRevision ?? null,
      lastDelivery: claimPayload.meta?.lastDelivery ?? null,
    };
  }

  async function registerSourceClaim(input) {
    const v = validateSourceClaim(input);
    if (!v.ok) {
      const ev = eventForInvalidClaim(v.reason, input?.source);
      await persistEvent(ev);
      return { ok: false, reason: v.reason, event: ev };
    }

    const referenceTime = input.referenceTime ?? defaultReferenceTime;
    let hookOverride = null;
    if (allowTestHooks && typeof input.__registryTestHook === "string") {
      if (input.__registryTestHook === "abortBeforeWrite") hookOverride = { abortBeforeWrite: true };
      if (input.__registryTestHook === "abortAfterClaimInBatch") hookOverride = { abortAfterClaimInBatch: true };
      if (input.__registryTestHook === "abortBeforeMandatoryEventInBatch") {
        hookOverride = { abortBeforeMandatoryEventInBatch: true };
      }
      if (input.__registryTestHook === "forceEventIdCollision" && input.__forceEventId) {
        hookOverride = { ...(hookOverride || {}), forceEventIdCollision: String(input.__forceEventId) };
      }
    }

    const cap = assertRegistryAtomicDb(db);
    for (let attempt = 0; attempt < maxRevisionRetries; attempt++) {
      try {
        if (cap.hasExecTransaction) {
          return await db.execTransaction(async () => registerAttempt(input, referenceTime, hookOverride));
        }
        return await registerAttempt(input, referenceTime, hookOverride);
      } catch (e) {
        if (e?.reason === "registry_revision_conflict") continue;
        if (e?.reason === "registry_cas_conflict") continue;
        if (e?.reason === "registry_test_abort") throw e;
        return { ok: false, reason: "registry_write_failed", safe: String(e?.message || e).slice(0, 120) };
      }
    }
    return { ok: false, reason: "registry_concurrency_exhausted" };
  }

  async function getOffer(offerId) {
    const row = await db.prepare("SELECT * FROM central_offers WHERE offer_id = ?").bind(offerId).first();
    if (!row) return null;
    return { ...row, canonical: JSON.parse(row.canonical_json || "{}") };
  }

  async function setCheckpoint(batchName, cursor) {
    const ts = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO offer_registry_checkpoint (batch_name, cursor_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(batch_name) DO UPDATE SET cursor_json=excluded.cursor_json, updated_at=excluded.updated_at"
      )
      .bind(batchName, JSON.stringify(cursor), ts)
      .run();
  }

  return {
    registerSourceClaim,
    getOffer,
    setCheckpoint,
    _memoryEvents: memoryEvents,
  };
}
