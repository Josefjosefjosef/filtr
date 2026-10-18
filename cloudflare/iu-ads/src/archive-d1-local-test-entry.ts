/**
 * Local-only Wrangler entry for affiliate archive D1 batch verification (not deployed).
 */
import {
  appendAffiliateArchiveMaterialVersion,
  insertAffiliateArchiveRecordAtomic,
  listAffiliateArchiveVersions,
} from "./affiliate-ad-archive-lib";
import type { Env } from "./types";

function guard(env: Env): Response | null {
  if (env.IU_ARCHIVE_LOCAL_TEST !== "1") {
    return new Response(JSON.stringify({ error: "local_test_disabled" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!env.DB) {
    return new Response(JSON.stringify({ error: "db_missing" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

const testInsertPayload = {
  partnerName: "Wrangler Test",
  adType: "affiliate_coupon",
  snapshot: { couponCode: "WDL1" },
  evidence: { source: "test_simulation", marker: "test_simulation_only" },
  gateDecision: { publicationReady: false },
  placementKey: "aff-auto-moto",
  isTest: true,
  idempotencyKey: "wrangler-idem-1",
  publishEventType: "test_simulation" as const,
  productionSigningEnabled: false,
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const blocked = guard(env);
    if (blocked) return blocked;
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, worker: "archive-d1-local-test" });
    }
    if (url.pathname === "/test/insert-ok" && request.method === "POST") {
      const key = url.searchParams.get("idempotency_key") || testInsertPayload.idempotencyKey;
      const out = await insertAffiliateArchiveRecordAtomic(env, { ...testInsertPayload, idempotencyKey: key });
      return Response.json(out);
    }
    if (url.pathname === "/test/insert-prod-blocked" && request.method === "POST") {
      const out = await insertAffiliateArchiveRecordAtomic(env, {
        partnerName: "Blocked Prod",
        adType: "affiliate_coupon",
        snapshot: { couponCode: "BAD" },
        evidence: {
          source: "forged",
          publicationProof: {
            publicationEventId: "fake-1",
            publishedRecordIdentity: "fake",
            publishedAtIso: new Date().toISOString(),
            placementKey: "aff-auto-moto",
            gateDecisionVerified: true,
            publishProcessSuccess: true,
            trustedSource: "iu_cj_trusted_publish_adapter_v1",
          },
        },
        gateDecision: { publicationReady: true },
        placementKey: "aff-auto-moto",
        isTest: false,
        publishEventType: "production_publish",
        productionSigningEnabled: false,
      });
      return Response.json(out);
    }
    if (url.pathname === "/test/counts" && request.method === "GET") {
      const r = await env.DB!.prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_records").first<{ c: number }>();
      const v = await env.DB!.prepare("SELECT COUNT(*) AS c FROM affiliate_ad_archive_versions").first<{ c: number }>();
      return Response.json({ records: Number(r?.c ?? 0), versions: Number(v?.c ?? 0) });
    }
    if (url.pathname === "/test/create-record" && request.method === "POST") {
      const key = url.searchParams.get("idempotency_key") || "wrangler-create-" + Date.now();
      const out = await insertAffiliateArchiveRecordAtomic(env, { ...testInsertPayload, idempotencyKey: key });
      return Response.json(out);
    }
    if (url.pathname === "/test/material-revision" && request.method === "POST") {
      const recordId = url.searchParams.get("record_id") || "";
      const marker = url.searchParams.get("marker") || "rev";
      const createdAt = url.searchParams.get("created_at") || new Date().toISOString();
      if (!recordId) {
        return Response.json({ ok: false, reason: "missing_record_id" }, { status: 400 });
      }
      const out = await appendAffiliateArchiveMaterialVersion(env, recordId, {
        snapshot: { couponCode: "WDL-" + marker, marker, createdAt },
        evidence: { source: "test_simulation", marker: "test_simulation_only", rev: marker, createdAt },
        gateDecision: { publicationReady: false },
        publishEventType: "material_change",
        productionSigningEnabled: false,
      });
      return Response.json(out);
    }
    if (url.pathname === "/test/versions" && request.method === "GET") {
      const recordId = url.searchParams.get("record_id") || "";
      if (!recordId) {
        return Response.json({ ok: false, reason: "missing_record_id" }, { status: 400 });
      }
      const versions = await listAffiliateArchiveVersions(env, recordId);
      return Response.json({ ok: true, versions });
    }
    return new Response(JSON.stringify({ error: "not_found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};
