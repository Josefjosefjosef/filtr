import { describe, expect, it } from "vitest";
import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";
import { d1FromSqlite } from "./helpers/d1-sqlite-shim";
import {
  insertAffiliateArchiveRecordAtomic,
  appendAffiliateArchiveMaterialVersion,
  endAffiliateArchivePublication,
} from "../src/affiliate-ad-archive-lib";
import {
  validateArchiveWritePolicy,
  validateTrustedPublicationProof,
  ARCHIVE_PUBLICATION_BLOCKED_STATUS,
} from "../src/affiliate-ad-archive-publication-trust";

const fakeProof = {
  publicationEventId: "pub-ev-1",
  publishedRecordIdentity: "offer-abc",
  publishedAtIso: "2026-10-01T12:00:00.000Z",
  placementKey: "aff-auto-moto",
  gateDecisionVerified: true,
  publishProcessSuccess: true,
  trustedSource: "iu_cj_trusted_publish_adapter_v1",
};

const testEvidence = { source: "test_simulation", marker: "test_simulation_only" };

describe("affiliate archive publication trust", () => {
  it("rejects isTest false without trusted adapter", async () => {
    const db = createIuAdsSchemaDb();
    const env = { DB: d1FromSqlite(db) };
    const before = db.prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_records").get() as { c: number };
    const out = await insertAffiliateArchiveRecordAtomic(env, {
      partnerName: "Forged",
      adType: "affiliate_coupon",
      snapshot: {},
      evidence: { ...fakeProof, source: "forged" },
      gateDecision: { publicationReady: true },
      placementKey: "aff-auto-moto",
      isTest: false,
      publishEventType: "production_publish",
      productionSigningEnabled: false,
      publicationProof: fakeProof,
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("blocked_awaiting_trusted_adapter");
    const after = db.prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_records").get() as { c: number };
    expect(Number(after.c)).toBe(Number(before.c));
  });

  it("rejects initial and material_change without trust (policy)", () => {
    for (const t of ["initial", "material_change", "publication_ended"] as const) {
      const p = validateArchiveWritePolicy({
        mode: t === "publication_ended" ? "end" : t === "material_change" ? "revision" : "insert",
        publishEventType: t,
        evidence: { source: "forged" },
        gateDecision: { publicationReady: true },
        productionSigningEnabled: false,
        placementKey: "aff-auto-moto",
        publicationProof: fakeProof,
      });
      expect(p.ok).toBe(false);
      if (!p.ok) expect(p.blockStatus).toBe(ARCHIVE_PUBLICATION_BLOCKED_STATUS);
    }
  });

  it("rejects forged publication proof fields", () => {
    const gate = validateTrustedPublicationProof(
      { ...fakeProof, publishProcessSuccess: false },
      { placementKey: "aff-auto-moto", gateDecision: { publicationReady: true }, productionSigningEnabled: true }
    );
    expect(gate.ok).toBe(false);
  });

  it("allows test simulation only with markers", async () => {
    const db = createIuAdsSchemaDb();
    const env = { DB: d1FromSqlite(db) };
    const out = await insertAffiliateArchiveRecordAtomic(env, {
      partnerName: "Test",
      adType: "affiliate_coupon",
      snapshot: { couponCode: "T1" },
      evidence: testEvidence,
      gateDecision: { publicationReady: false },
      placementKey: "aff-auto-moto",
      isTest: true,
      idempotencyKey: "neg-test-1",
      publishEventType: "test_simulation",
    });
    expect(out.ok).toBe(true);
  });

  it("rejects direct library prod path and idempotent replay does not upgrade", async () => {
    const db = createIuAdsSchemaDb();
    const env = { DB: d1FromSqlite(db) };
    const key = "neg-idem-prod";
    const test = await insertAffiliateArchiveRecordAtomic(env, {
      partnerName: "Test",
      adType: "affiliate_coupon",
      snapshot: {},
      evidence: testEvidence,
      gateDecision: {},
      placementKey: "aff-auto-moto",
      isTest: true,
      idempotencyKey: key,
      publishEventType: "test_simulation",
    });
    expect(test.ok).toBe(true);
    const prodAttempt = await insertAffiliateArchiveRecordAtomic(env, {
      partnerName: "Test",
      adType: "affiliate_coupon",
      snapshot: {},
      evidence: { source: "forged", publicationProof: fakeProof },
      gateDecision: { publicationReady: true },
      placementKey: "aff-auto-moto",
      isTest: false,
      idempotencyKey: key,
      publishEventType: "production_publish",
      publicationProof: fakeProof,
    });
    expect(prodAttempt.ok).toBe(true);
    if (prodAttempt.ok) expect(prodAttempt.record.is_test).toBe(true);
    const versions = db
      .prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_versions WHERE record_id = ?")
      .get(test.ok ? test.record.record_id : "") as { c: number };
    expect(Number(versions.c)).toBe(1);
  });

  it("blocks material_change on non-test record (none exist) via missing test markers", async () => {
    const db = createIuAdsSchemaDb();
    const env = { DB: d1FromSqlite(db) };
    const created = await insertAffiliateArchiveRecordAtomic(env, {
      partnerName: "Test",
      adType: "affiliate_coupon",
      snapshot: { couponCode: "A" },
      evidence: testEvidence,
      gateDecision: {},
      placementKey: "aff-auto-moto",
      isTest: true,
      idempotencyKey: "neg-rev-1",
      publishEventType: "test_simulation",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rev = await appendAffiliateArchiveMaterialVersion(env, created.record.record_id, {
      snapshot: { couponCode: "B" },
      evidence: testEvidence,
      gateDecision: {},
      publishEventType: "material_change",
    });
    expect(rev.ok).toBe(true);
    const end = await endAffiliateArchivePublication(env, created.record.record_id, {
      evidence: testEvidence,
    });
    expect(end.ok).toBe(true);
  });
});
