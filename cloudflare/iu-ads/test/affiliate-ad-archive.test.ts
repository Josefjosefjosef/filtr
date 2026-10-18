import { describe, expect, it } from "vitest";

import { createIuAdsSchemaDb } from "./helpers/apply-iu-ads-migrations";

import { d1FromSqlite } from "./helpers/d1-sqlite-shim";

import {

  appendAffiliateArchiveMaterialVersion,

  endAffiliateArchivePublication,

  getAffiliateArchiveRecord,

  insertAffiliateArchiveRecordAtomic,

  isAffiliateArchiveProtected,

  listAffiliateArchiveRecords,

  validateArchivePublishEvent,

} from "../src/affiliate-ad-archive-lib";

import { buildAffiliateArchiveExportZip } from "../src/affiliate-ad-archive-zip";

import { unzipSync } from "fflate";



function baseInput(overrides: Record<string, unknown> = {}) {

  return {

    partnerName: "Autohotarek.cz",

    cjAdvertiserId: "991001",

    adType: "affiliate_coupon",

    publishedText: "TEST kupon INT",

    snapshot: { couponCode: "TEST", previewOnly: true },

    evidence: { source: "test_simulation", path: "fixtures/pipeline-parity-v29-2" },

    gateDecision: { publicationReady: false, blockers: ["test_gate"] },

    placementKey: "aff-auto-moto",

    isTest: true,

    idempotencyKey: "idem-test-1",

    publishEventType: "test_simulation" as const,

    productionSigningEnabled: false,

    ...overrides,

  };

}



describe("affiliate ad archive", () => {

  it("stores test publish with evidence and blocks protected delete policy", async () => {

    const db = createIuAdsSchemaDb();

    const env = { DB: d1FromSqlite(db) };

    const inserted = await insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: "idem-policy-1" }));

    expect(inserted.ok).toBe(true);

    if (!inserted.ok) return;

    expect(inserted.record.is_test).toBe(true);

    expect(isAffiliateArchiveProtected(inserted.record)).toBe(true);

    inserted.record.legal_hold = false;

    expect(isAffiliateArchiveProtected({ retention_class: "import_staging" })).toBe(false);

    const listed = await listAffiliateArchiveRecords(env, { partner: "Autohotarek.cz" });

    expect(listed.length).toBe(1);

    const got = await getAffiliateArchiveRecord(env, inserted.record.record_id);

    expect((got?.evidence as { source?: string }).source).toBe("test_simulation");

  });



  it("atomic batch creates record and version 1", async () => {

    const db = createIuAdsSchemaDb();

    const env = { DB: d1FromSqlite(db) };

    const out = await insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: "idem-atomic-1" }));

    expect(out.ok).toBe(true);

    if (!out.ok) return;

    expect(out.versionCount).toBe(1);

    const versions = db.prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_versions WHERE record_id = ?").get(

      out.record.record_id

    ) as { c: number };

    expect(Number(versions.c)).toBe(1);

  });



  it("rolls back entire operation when version insert fails", async () => {

    const db = createIuAdsSchemaDb();

    db.exec("DROP TABLE affiliate_ad_archive_versions");

    const env = { DB: d1FromSqlite(db) };

    const out = await insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: "idem-rollback-1" }));

    expect(out.ok).toBe(false);

    const count = db.prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_records").get() as { c: number };

    expect(Number(count.c)).toBe(0);

  });



  it("idempotent replay does not duplicate versions", async () => {

    const db = createIuAdsSchemaDb();

    const env = { DB: d1FromSqlite(db) };

    const key = "idem-replay-1";

    const a = await insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: key }));

    const b = await insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: key }));

    expect(a.ok && b.ok).toBe(true);

    if (!a.ok || !b.ok) return;

    expect(b.idempotentReplay).toBe(true);

    expect(a.record.record_id).toBe(b.record.record_id);

    const versions = db

      .prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_versions WHERE record_id = ?")

      .get(a.record.record_id) as { c: number };

    expect(Number(versions.c)).toBe(1);

  });



  it("concurrent idempotent create keeps single record", async () => {

    const db = createIuAdsSchemaDb();

    const env = { DB: d1FromSqlite(db) };

    const key = "idem-concurrent-1";

    const results = await Promise.all([

      insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: key })),

      insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: key })),

    ]);

    expect(results.every((r) => r.ok)).toBe(true);

    const records = db.prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_records WHERE idempotency_key = ?").get(key) as {

      c: number;

    };

    expect(Number(records.c)).toBe(1);

  });



  it("concurrent material revisions allocate distinct sequential version numbers", async () => {

    const db = createIuAdsSchemaDb();

    const env = { DB: d1FromSqlite(db) };

    const created = await insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: "idem-concurrent-rev-1" }));

    expect(created.ok).toBe(true);

    if (!created.ok) return;

    const n = 10;

    const results = await Promise.all(

      Array.from({ length: n }, (_, i) =>

        appendAffiliateArchiveMaterialVersion(env, created.record.record_id, {

          snapshot: { couponCode: "TEST-" + i, marker: "m" + i },

          evidence: { source: "test_simulation", marker: "test_simulation_only", rev: i },

          gateDecision: { publicationReady: false },

        })

      )

    );

    expect(results.every((r) => r.ok && !("skipped" in r && r.skipped))).toBe(true);

    const rows = db

      .prepare(

        "SELECT version_no, snapshot_json FROM affiliate_ad_archive_versions WHERE record_id = ? ORDER BY version_no ASC"

      )

      .all(created.record.record_id) as { version_no: number; snapshot_json: string }[];

    expect(rows.length).toBe(n + 1);

    const nums = rows.map((r) => r.version_no);

    expect(nums).toEqual(Array.from({ length: n + 1 }, (_, i) => i + 1));

    const v1 = JSON.parse(rows[0].snapshot_json);

    expect(v1.couponCode).toBe("TEST");

    expect(new Set(rows.map((r) => r.snapshot_json)).size).toBe(rows.length);

  });



  it("appends material version and ends publication", async () => {

    const db = createIuAdsSchemaDb();

    const env = { DB: d1FromSqlite(db) };

    const created = await insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: "idem-lifecycle-1" }));

    expect(created.ok).toBe(true);

    if (!created.ok) return;

    const rev = await appendAffiliateArchiveMaterialVersion(env, created.record.record_id, {

      snapshot: { couponCode: "TEST2", previewOnly: true },

      evidence: { source: "test_simulation", rev: 2 },

      gateDecision: { publicationReady: false },

    });

    expect(rev.ok).toBe(true);

    if (!rev.ok) return;

    expect(rev.skipped).toBe(false);

    const ended = await endAffiliateArchivePublication(env, created.record.record_id, {});

    expect(ended.ok).toBe(true);

    if (!ended.ok) return;

    expect(ended.record.ended_at).toBeTruthy();

    const versionCount = db

      .prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_versions WHERE record_id = ?")

      .get(created.record.record_id) as { c: number };

    expect(Number(versionCount.c)).toBeGreaterThanOrEqual(3);

  });



  it("rejects production publish when trusted adapter disabled", () => {

    const gate = validateArchivePublishEvent({

      publishEventType: "production_publish",

      gateDecision: { publicationReady: true },

      productionSigningEnabled: false,

      evidence: { source: "forged" },

      publicationProof: {

        publicationEventId: "x",

        publishedRecordIdentity: "y",

        publishedAtIso: "2026-01-01T00:00:00.000Z",

        placementKey: "aff-auto-moto",

        gateDecisionVerified: true,

        publishProcessSuccess: true,

        trustedSource: "iu_cj_trusted_publish_adapter_v1",

      },

      placementKey: "aff-auto-moto",

    });

    expect(gate.ok).toBe(false);

    if (!gate.ok) expect(gate.reason).toBe("blocked_awaiting_trusted_adapter");

  });



  it("export zip contains manifest and checksums", async () => {

    const db = createIuAdsSchemaDb();

    const env = { DB: d1FromSqlite(db) };

    const created = await insertAffiliateArchiveRecordAtomic(env, baseInput({ idempotencyKey: "idem-zip-1" }));

    expect(created.ok).toBe(true);

    if (!created.ok) return;

    const zip = await buildAffiliateArchiveExportZip({

      record: created.record,

      versions: [{ version_no: 1, content_hash: created.record.content_hash }],

      pdfBytes: new TextEncoder().encode("%PDF-1.4 test"),

    });

    const files = unzipSync(zip);

    const names = Object.keys(files);

    expect(names.some((n) => n.endsWith("manifest.json"))).toBe(true);

    expect(names.some((n) => n.endsWith("SHA256SUMS.txt"))).toBe(true);

    expect(names.some((n) => n.endsWith("record.json"))).toBe(true);

  });

});


