/** CJ Affiliate published-ad archive (evidence + versions). D1-only; no new R2 bucket. */

import { sha256Hex } from "./backup";

import { newId } from "./admin-auth";

import type { Env } from "./types";

import {
  type AffiliateArchivePublishEventType,
  validateArchiveWritePolicy,
} from "./affiliate-ad-archive-publication-trust";

export type { AffiliateArchivePublishEventType };



export type AffiliateArchiveRecordRow = {

  record_id: string;

  partner_name: string;

  cj_advertiser_id: string | null;

  cj_identity_json: string;

  ad_type: string;

  published_text: string | null;

  snapshot_json: string;

  evidence_json: string;

  gate_decision_json: string;

  placement_key: string | null;

  published_at: string | null;

  ended_at: string | null;

  is_test: number;

  legal_hold: number;

  retention_class: string;

  content_hash: string;

  created_at: string;

  updated_at: string;

  idempotency_key: string | null;

};



export type AffiliateArchiveInsertInput = {

  partnerName: string;

  cjAdvertiserId?: string | null;

  cjIdentity?: Record<string, unknown>;

  adType: string;

  publishedText?: string | null;

  snapshot: Record<string, unknown>;

  evidence: Record<string, unknown>;

  gateDecision: Record<string, unknown>;

  placementKey?: string | null;

  publishedAt?: string | null;

  isTest?: boolean;

  legalHold?: boolean;

  idempotencyKey?: string | null;

  publishEventType?: AffiliateArchivePublishEventType;

  /** When false, production_publish is rejected (default). */

  productionSigningEnabled?: boolean;

  publicationProof?: unknown;

};



export type AffiliateArchiveRevisionInput = {

  snapshot: Record<string, unknown>;

  evidence: Record<string, unknown>;

  gateDecision: Record<string, unknown>;

  publishedText?: string | null;

  publishEventType?: AffiliateArchivePublishEventType;

  productionSigningEnabled?: boolean;

  publicationProof?: unknown;

};



const RECORD_COLS =

  "record_id, partner_name, cj_advertiser_id, cj_identity_json, ad_type, published_text, snapshot_json, evidence_json, gate_decision_json, placement_key, published_at, ended_at, is_test, legal_hold, retention_class, content_hash, created_at, updated_at, idempotency_key";



export function serializeAffiliateArchiveRecord(row: AffiliateArchiveRecordRow) {

  return {

    record_id: row.record_id,

    partner_name: row.partner_name,

    cj_advertiser_id: row.cj_advertiser_id,

    cj_identity: JSON.parse(row.cj_identity_json || "{}"),

    ad_type: row.ad_type,

    published_text: row.published_text,

    snapshot: JSON.parse(row.snapshot_json || "{}"),

    evidence: JSON.parse(row.evidence_json || "{}"),

    gate_decision: JSON.parse(row.gate_decision_json || "{}"),

    placement_key: row.placement_key,

    published_at: row.published_at,

    ended_at: row.ended_at,

    is_test: row.is_test === 1,

    legal_hold: row.legal_hold === 1,

    retention_class: row.retention_class,

    content_hash: row.content_hash,

    created_at: row.created_at,

    updated_at: row.updated_at,

    idempotency_key: row.idempotency_key,

  };

}



export {
  validateArchivePublishEvent,
  validateArchiveWritePolicy,
  validateTrustedPublicationProof,
  ARCHIVE_TRUSTED_PUBLICATION_ADAPTER_ENABLED,
  ARCHIVE_PUBLICATION_BLOCKED_STATUS,
} from "./affiliate-ad-archive-publication-trust";



/** Staging/import must never create publish evidence. */

export function rejectStagingAsPublishEvidence(sourceMarker: string | undefined): boolean {

  if (!sourceMarker) return false;

  const s = sourceMarker.toLowerCase();

  return s.includes("staging") || s.includes("import_only") || s.includes("preview_only");

}



export async function computeArchiveContentHash(

  snapshotJson: string,

  evidenceJson: string,

  gateJson: string

): Promise<string> {

  return sha256Hex(new TextEncoder().encode(snapshotJson + "|" + evidenceJson + "|" + gateJson));

}



export function detectMaterialChangeFields(

  prevSnapshot: Record<string, unknown>,

  nextSnapshot: Record<string, unknown>

): string[] {

  const fields = [

    "publishedText",

    "couponCode",

    "customerDiscount",

    "conditionsSummary",

    "affiliateUrl",

    "imageUrl",

    "validTo",

    "productCards",

    "publicationEndedAt",

  ] as const;

  const changed: string[] = [];

  for (const f of fields) {

    const a = JSON.stringify(prevSnapshot[f] ?? null);

    const b = JSON.stringify(nextSnapshot[f] ?? null);

    if (a !== b) changed.push(f);

  }

  const prevCoupon = (prevSnapshot.coupon as Record<string, unknown> | undefined) ?? {};

  const nextCoupon = (nextSnapshot.coupon as Record<string, unknown> | undefined) ?? {};

  for (const key of ["couponCode", "customerDiscount", "conditionsSummary", "affiliateUrl", "validTo"] as const) {

    if (JSON.stringify(prevCoupon[key] ?? null) !== JSON.stringify(nextCoupon[key] ?? null)) {

      if (!changed.includes(key)) changed.push(key);

    }

  }

  return changed;

}



async function countVersions(env: Env, recordId: string): Promise<number> {

  const row = await env.DB!.prepare(

    "SELECT COUNT(*) AS c FROM affiliate_ad_archive_versions WHERE record_id = ?"

  )

    .bind(recordId)

    .first<{ c: number }>();

  return Number(row?.c ?? 0);

}



async function findByIdempotencyKey(env: Env, key: string) {

  const row = await env.DB!.prepare(`SELECT ${RECORD_COLS} FROM affiliate_ad_archive_records WHERE idempotency_key = ?`)

    .bind(key)

    .first<AffiliateArchiveRecordRow>();

  return row ? serializeAffiliateArchiveRecord(row) : null;

}



/** Atomic create: record + version 1 in one D1 batch (no partial orphan record). */

export async function insertAffiliateArchiveRecordAtomic(env: Env, input: AffiliateArchiveInsertInput) {

  if (!env.DB) return { ok: false as const, reason: "db_missing" };

  if (input.idempotencyKey) {
    const existingEarly = await findByIdempotencyKey(env, input.idempotencyKey);
    if (existingEarly) {
      const vc = await countVersions(env, existingEarly.record_id);
      return {
        ok: true as const,
        record: existingEarly,
        idempotentReplay: true as const,
        versionCount: vc,
      };
    }
  }

  const isTest = input.isTest === true;

  const publishEventType = input.publishEventType ?? (isTest ? "test_simulation" : "production_publish");

  const publicationProof =

    input.publicationProof ?? (input.evidence as { publicationProof?: unknown }).publicationProof;

  const policy = validateArchiveWritePolicy({

    mode: "insert",

    isTest,

    publishEventType,

    evidence: input.evidence,

    gateDecision: input.gateDecision,

    publicationProof,

    productionSigningEnabled: input.productionSigningEnabled ?? false,

    placementKey: input.placementKey,

  });

  if (!policy.ok) {

    return {

      ok: false as const,

      reason: policy.reason,

      blockStatus: policy.blockStatus,

    };

  }

  const effectiveIsTest = policy.testOnly ? true : isTest;



  const evidenceSource = String((input.evidence as { source?: unknown }).source ?? "");

  if (rejectStagingAsPublishEvidence(evidenceSource) && !effectiveIsTest) {

    return { ok: false as const, reason: "staging_not_publish_evidence" };

  }



  if (input.idempotencyKey) {

    const existing = await findByIdempotencyKey(env, input.idempotencyKey);

    if (existing) {

      const vc = await countVersions(env, existing.record_id);

      return { ok: true as const, record: existing, idempotentReplay: true as const, versionCount: vc };

    }

  }



  const now = new Date().toISOString();

  const recordId = newId("aar");

  const versionId = newId("aav");

  const snapshotJson = JSON.stringify(input.snapshot);

  const evidenceJson = JSON.stringify(input.evidence);

  const gateJson = JSON.stringify(input.gateDecision);

  const contentHash = await computeArchiveContentHash(snapshotJson, evidenceJson, gateJson);

  const cjIdentityJson = JSON.stringify(input.cjIdentity || {});

  const changeFieldsJson = JSON.stringify([]);



  try {

    await env.DB.batch([

      env.DB.prepare(

        `INSERT INTO affiliate_ad_archive_records (

          record_id, partner_name, cj_advertiser_id, cj_identity_json, ad_type, published_text,

          snapshot_json, evidence_json, gate_decision_json, placement_key, published_at, ended_at,

          is_test, legal_hold, retention_class, content_hash, created_at, updated_at, idempotency_key

        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`

      ).bind(

        recordId,

        input.partnerName,

        input.cjAdvertiserId ?? null,

        cjIdentityJson,

        input.adType,

        input.publishedText ?? null,

        snapshotJson,

        evidenceJson,

        gateJson,

        input.placementKey ?? null,

        input.publishedAt ?? now,

        null,

        effectiveIsTest ? 1 : 0,

        input.legalHold ? 1 : 0,

        "archive_evidence",

        contentHash,

        now,

        now,

        input.idempotencyKey ?? null

      ),

      env.DB.prepare(

        `INSERT INTO affiliate_ad_archive_versions (

          version_id, record_id, version_no, snapshot_json, evidence_json, gate_decision_json,

          content_hash, created_at, publish_event_type, change_fields_json

        ) VALUES (?,?,?,?,?,?,?,?,?,?)`

      ).bind(

        versionId,

        recordId,

        1,

        snapshotJson,

        evidenceJson,

        gateJson,

        contentHash,

        now,

        publishEventType === "initial" ? "test_simulation" : publishEventType,

        changeFieldsJson

      ),

    ]);

  } catch (e) {

    if (input.idempotencyKey) {

      const existing = await findByIdempotencyKey(env, input.idempotencyKey);

      if (existing) {

        const vc = await countVersions(env, existing.record_id);

        return { ok: true as const, record: existing, idempotentReplay: true as const, versionCount: vc };

      }

    }

    return { ok: false as const, reason: "batch_insert_failed", detail: String(e) };

  }



  const row = await env.DB.prepare(`SELECT ${RECORD_COLS} FROM affiliate_ad_archive_records WHERE record_id = ?`)

    .bind(recordId)

    .first<AffiliateArchiveRecordRow>();

  return row

    ? { ok: true as const, record: serializeAffiliateArchiveRecord(row), idempotentReplay: false as const, versionCount: 1 }

    : { ok: false as const, reason: "insert_failed" };

}



/** Backward-compatible alias. */

export async function insertAffiliateArchiveRecord(env: Env, input: AffiliateArchiveInsertInput) {

  const out = await insertAffiliateArchiveRecordAtomic(env, {

    ...input,

    publishEventType: input.publishEventType ?? (input.isTest === true ? "test_simulation" : "production_publish"),

  });

  if (!out.ok) return out;

  return { ok: true as const, record: out.record };

}



export async function appendAffiliateArchiveMaterialVersion(

  env: Env,

  recordId: string,

  input: AffiliateArchiveRevisionInput

) {

  if (!env.DB) return { ok: false as const, reason: "db_missing" };

  const existing = await getAffiliateArchiveRecord(env, recordId);

  if (!existing) return { ok: false as const, reason: "not_found" };

  if (existing.ended_at) return { ok: false as const, reason: "publication_ended" };



  const publishEventType = input.publishEventType ?? "material_change";

  const publicationProof =

    input.publicationProof ?? (input.evidence as { publicationProof?: unknown }).publicationProof;

  const policy = validateArchiveWritePolicy({

    mode: "revision",

    existingRecordIsTest: existing.is_test,

    publishEventType,

    evidence: input.evidence,

    gateDecision: input.gateDecision,

    publicationProof,

    productionSigningEnabled: input.productionSigningEnabled ?? false,

    placementKey: existing.placement_key,

  });

  if (!policy.ok) {

    return { ok: false as const, reason: policy.reason, blockStatus: policy.blockStatus };

  }



  const changed = detectMaterialChangeFields(existing.snapshot, input.snapshot);

  if (!changed.length && publishEventType !== "publication_ended") {

    return { ok: true as const, record: existing, skipped: true as const, reason: "no_material_change" };

  }



  const now = new Date().toISOString();

  const snapshotJson = JSON.stringify(input.snapshot);

  const evidenceJson = JSON.stringify(input.evidence);

  const gateJson = JSON.stringify(input.gateDecision);

  const contentHash = await computeArchiveContentHash(snapshotJson, evidenceJson, gateJson);

  const effectiveChanged = changed.length ? changed : publishEventType === "publication_ended" ? ["publicationEnded"] : [];

  const changeFieldsJson = JSON.stringify(effectiveChanged);

  const MAX_REVISION_RETRIES = 5;

  let lastError: unknown;

  let assignedVersionNo: number | null = null;

  for (let attempt = 0; attempt < MAX_REVISION_RETRIES; attempt++) {

    const versionId = newId("aav");

    try {

      await env.DB.batch([

        env.DB.prepare(

          `UPDATE affiliate_ad_archive_records SET

            version_seq = version_seq + 1,

            published_text = ?, snapshot_json = ?, evidence_json = ?, gate_decision_json = ?,

            content_hash = ?, updated_at = ?

           WHERE record_id = ? AND ended_at IS NULL`

        ).bind(

          input.publishedText ?? existing.published_text,

          snapshotJson,

          evidenceJson,

          gateJson,

          contentHash,

          now,

          recordId

        ),

        env.DB.prepare(

          `INSERT INTO affiliate_ad_archive_versions (

            version_id, record_id, version_no, snapshot_json, evidence_json, gate_decision_json,

            content_hash, created_at, publish_event_type, change_fields_json

          )

          SELECT ?, ?, r.version_seq, ?, ?, ?, ?, ?, ?, ?

          FROM affiliate_ad_archive_records r

          WHERE r.record_id = ?`

        ).bind(

          versionId,

          recordId,

          snapshotJson,

          evidenceJson,

          gateJson,

          contentHash,

          now,

          publishEventType,

          changeFieldsJson,

          recordId

        ),

      ]);

      const inserted = await env.DB.prepare(

        "SELECT version_no, snapshot_json FROM affiliate_ad_archive_versions WHERE version_id = ?"

      )

        .bind(versionId)

        .first<{ version_no: number; snapshot_json: string }>();

      if (!inserted) {

        lastError = new Error("version_row_missing_after_batch");

        continue;

      }

      assignedVersionNo = Number(inserted.version_no);

      break;

    } catch (e) {

      lastError = e;

      const msg = String(e);

      if (attempt < MAX_REVISION_RETRIES - 1 && /UNIQUE|constraint|SQLITE_CONSTRAINT/i.test(msg)) {

        await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));

        continue;

      }

      return { ok: false as const, reason: "batch_revision_failed", detail: msg };

    }

  }

  if (assignedVersionNo == null) {

    const endedCheck = await getAffiliateArchiveRecord(env, recordId);

    if (endedCheck?.ended_at) return { ok: false as const, reason: "publication_ended" };

    return { ok: false as const, reason: "batch_revision_failed", detail: String(lastError) };

  }



  const row = await getAffiliateArchiveRecord(env, recordId);

  return row

    ? {

        ok: true as const,

        record: row,

        skipped: false as const,

        versionNo: assignedVersionNo,

        changedFields: changed,

      }

    : { ok: false as const, reason: "update_failed" };

}



export async function endAffiliateArchivePublication(

  env: Env,

  recordId: string,

  input: { evidence?: Record<string, unknown>; gateDecision?: Record<string, unknown>; endedAt?: string }

) {

  if (!env.DB) return { ok: false as const, reason: "db_missing" };

  const existing = await getAffiliateArchiveRecord(env, recordId);

  if (!existing) return { ok: false as const, reason: "not_found" };

  if (existing.ended_at) return { ok: true as const, record: existing, alreadyEnded: true as const };



  const now = input.endedAt ?? new Date().toISOString();

  const evidence = input.evidence ?? existing.evidence;

  const gateDecision = input.gateDecision ?? existing.gate_decision;

  const snapshot = { ...existing.snapshot, publicationEndedAt: now };

  const revision = await appendAffiliateArchiveMaterialVersion(env, recordId, {

    snapshot,

    evidence: { ...evidence, publicationEndedAt: now },

    gateDecision,

    publishEventType: "publication_ended",

  });

  if (!revision.ok) return revision;



  await env.DB.prepare("UPDATE affiliate_ad_archive_records SET ended_at = ?, updated_at = ? WHERE record_id = ?")

    .bind(now, now, recordId)

    .run();



  const row = await getAffiliateArchiveRecord(env, recordId);

  return row ? { ok: true as const, record: row } : { ok: false as const, reason: "end_failed" };

}



export async function listAffiliateArchiveRecords(

  env: Env,

  filters: {

    partner?: string;

    adType?: string;

    isTest?: boolean;

    placementKey?: string;

    publishedFrom?: string;

    publishedTo?: string;

    ended?: "active" | "ended" | "all";

    limit?: number;

    offset?: number;

  }

) {

  if (!env.DB) return [];

  const where: string[] = [];

  const binds: unknown[] = [];

  if (filters.partner) {

    where.push("partner_name = ?");

    binds.push(filters.partner);

  }

  if (filters.adType) {

    where.push("ad_type = ?");

    binds.push(filters.adType);

  }

  if (filters.placementKey) {

    where.push("placement_key = ?");

    binds.push(filters.placementKey);

  }

  if (filters.isTest === true) where.push("is_test = 1");

  if (filters.isTest === false) where.push("is_test = 0");

  if (filters.publishedFrom) {

    where.push("published_at >= ?");

    binds.push(filters.publishedFrom);

  }

  if (filters.publishedTo) {

    where.push("published_at <= ?");

    binds.push(filters.publishedTo);

  }

  if (filters.ended === "active") where.push("ended_at IS NULL");

  if (filters.ended === "ended") where.push("ended_at IS NOT NULL");

  const limit = Math.min(200, filters.limit ?? 50);

  const offset = filters.offset ?? 0;

  const sql =

    `SELECT ${RECORD_COLS} FROM affiliate_ad_archive_records` +

    (where.length ? " WHERE " + where.join(" AND ") : "") +

    " ORDER BY published_at DESC LIMIT ? OFFSET ?";

  binds.push(limit, offset);

  const res = await env.DB.prepare(sql).bind(...binds).all<AffiliateArchiveRecordRow>();

  return (res.results ?? []).map(serializeAffiliateArchiveRecord);

}



export async function getAffiliateArchiveRecord(env: Env, recordId: string) {

  if (!env.DB) return null;

  const row = await env.DB.prepare(`SELECT ${RECORD_COLS} FROM affiliate_ad_archive_records WHERE record_id = ?`)

    .bind(recordId)

    .first<AffiliateArchiveRecordRow>();

  return row ? serializeAffiliateArchiveRecord(row) : null;

}



export async function listAffiliateArchiveVersions(env: Env, recordId: string) {

  if (!env.DB) return [];

  const res = await env.DB.prepare(

    `SELECT version_id, record_id, version_no, content_hash, created_at, publish_event_type, change_fields_json

     FROM affiliate_ad_archive_versions WHERE record_id = ? ORDER BY version_no ASC`

  )

    .bind(recordId)

    .all<{

      version_id: string;

      record_id: string;

      version_no: number;

      content_hash: string;

      created_at: string;

      publish_event_type: string;

      change_fields_json: string;

    }>();

  return (res.results ?? []).map((r) => ({

    version_id: r.version_id,

    record_id: r.record_id,

    version_no: r.version_no,

    content_hash: r.content_hash,

    created_at: r.created_at,

    publish_event_type: r.publish_event_type,

    change_fields: JSON.parse(r.change_fields_json || "[]"),

  }));

}



/** Records with legal_hold or archive_evidence must not be bulk-deleted by retention sweeps. */

export function isAffiliateArchiveProtected(row: { legal_hold?: boolean; retention_class?: string }) {

  if (row.legal_hold) return true;

  return row.retention_class === "archive_evidence";

}


