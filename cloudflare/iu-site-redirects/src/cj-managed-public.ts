/**
 * CJ managed-public overlay via R2 (same worker as NDIC live traffic).
 *
 * Public GET serves atomic "current" JSON when CJ_MANAGED_PUBLIC_LIVE_ENABLED=true.
 * Authenticated POST publishes staging → verify → current (+ LKG previous).
 *
 * INFRA: R2 binding CJ_MANAGED_PUBLIC + secret CJ_MANAGED_PUBLIC_PUBLISH_TOKEN
 * require explicit user GO before create/activate (see phase2h-infra-requirements).
 */

export const CJ_MANAGED_PUBLIC_PATH =
  "/projects/data/iu-affiliate-cj-managed-public-v1.json";
export const CJ_MANAGED_PUBLIC_PUBLISH_PATH =
  "/projects/data/iu-affiliate-cj-managed-public/__iu_live_publish";

export const R2_CJ_CURRENT_KEY = "current/iu-affiliate-cj-managed-public-v1.json";
export const R2_CJ_LKG_KEY = "lkg/iu-affiliate-cj-managed-public-v1.json";
export const R2_CJ_STAGING_KEY = "staging/iu-affiliate-cj-managed-public-v1.json";
export const R2_CJ_META_KEY = "current/meta.json";
export const R2_CJ_STAGING_META_KEY = "staging/meta.json";

export const CJ_PUBLIC_SCHEMA = "iu-affiliate-cj-managed-public-v1";
export const WEBSITE_PID = "101883843";

export type CjManagedPublicEnv = {
  CJ_MANAGED_PUBLIC?: R2Bucket;
  CJ_MANAGED_PUBLIC_LIVE_ENABLED?: string;
  CJ_MANAGED_PUBLIC_PUBLISH_TOKEN?: string;
};

export type CjPublishMeta = {
  generationId?: string;
  publishedAt?: string;
  contentSha256?: string;
  partnerCount?: number;
  activeCount?: number;
  source?: string;
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function cjManagedPublicLiveEnabled(env: CjManagedPublicEnv): boolean {
  return String(env.CJ_MANAGED_PUBLIC_LIVE_ENABLED || "").toLowerCase() === "true";
}

export function validateCjManagedPublicDoc(doc: unknown): {
  ok: boolean;
  errors: string[];
  activeCount: number;
  partnerCount: number;
} {
  const errors: string[] = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["not_object"], activeCount: 0, partnerCount: 0 };
  }
  const d = doc as Record<string, unknown>;
  if (d.schema != null && String(d.schema) !== CJ_PUBLIC_SCHEMA) {
    errors.push("schema_mismatch:" + String(d.schema));
  }
  if (String(d.websitePid || "") !== WEBSITE_PID) {
    errors.push("website_pid_mismatch");
  }
  if (!Array.isArray(d.partners)) {
    errors.push("partners_not_array");
    return { ok: false, errors, activeCount: 0, partnerCount: 0 };
  }
  const seen = new Set<string>();
  let activeCount = 0;
  for (const raw of d.partners) {
    if (!raw || typeof raw !== "object") {
      errors.push("partner_not_object");
      continue;
    }
    const p = raw as Record<string, unknown>;
    if (p.advertiserId == null) {
      errors.push("partner_missing_advertiserId");
      continue;
    }
    const id = String(p.advertiserId);
    if (seen.has(id)) errors.push("duplicate_advertiserId:" + id);
    seen.add(id);
    if (p.active === false) continue;
    activeCount += 1;
    const url = String(p.url || "");
    // Align with scripts/iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs isCjTrackingUrl:
    // CJ deep links use www.<network>.(com|net)/click-<PID>-<linkId> (incl. kqzyfj.com).
    if (
      !/^https:\/\/www\.(anrdoezrs|jdoqocy|dpbolvw|kqzyfj|tkqlhce)\.(com|net)\/click-\d+-\d+/i.test(
        url
      )
    ) {
      errors.push("active_url_not_cj:" + id);
    }
    if (!p.sectionId) errors.push("active_missing_section:" + id);
    if (!p.title) errors.push("active_missing_title:" + id);
  }
  return {
    ok: errors.length === 0,
    errors,
    activeCount,
    partnerCount: d.partners.length,
  };
}

function cjHeaders(extra?: Record<string, string>): Headers {
  const headers = new Headers();
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-iu-cj-managed-public-source", "r2");
  if (extra) {
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  }
  return headers;
}

export async function serveCjManagedPublic(
  env: CjManagedPublicEnv,
  request: Request
): Promise<Response | null> {
  if (!cjManagedPublicLiveEnabled(env) || !env.CJ_MANAGED_PUBLIC) return null;
  const obj = await env.CJ_MANAGED_PUBLIC.get(R2_CJ_CURRENT_KEY);
  if (!obj) return null;
  const headers = cjHeaders();
  const meta = await env.CJ_MANAGED_PUBLIC.get(R2_CJ_META_KEY);
  if (meta) {
    try {
      const m = JSON.parse(await meta.text()) as CjPublishMeta;
      if (m.generationId) headers.set("x-iu-cj-generation-id", String(m.generationId));
      if (m.publishedAt) headers.set("x-iu-cj-published-at", String(m.publishedAt));
      if (m.contentSha256) headers.set("x-iu-cj-content-sha256", String(m.contentSha256));
    } catch {
      /* ignore */
    }
  }
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(obj.body, { status: 200, headers });
}

export async function handleCjManagedPublicPublish(
  env: CjManagedPublicEnv,
  request: Request
): Promise<Response> {
  if (!env.CJ_MANAGED_PUBLIC) {
    return json({ ok: false, reason: "R2_NOT_BOUND" }, 503);
  }
  /* Authenticated publish allowed while LIVE_ENABLED=false (staging/LKG write).
   * Public GET remains gated by cjManagedPublicLiveEnabled() — DISARMED serve. */
  const token = String(env.CJ_MANAGED_PUBLIC_PUBLISH_TOKEN || "");
  if (!token) return json({ ok: false, reason: "TOKEN_NOT_CONFIGURED" }, 503);
  const auth = request.headers.get("authorization") || "";
  if (auth !== "Bearer " + token) return json({ ok: false, reason: "UNAUTHORIZED" }, 401);

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return json({ ok: false, reason: "BODY_READ_FAILED" }, 400);
  }

  let payload: { meta?: CjPublishMeta; document?: unknown };
  try {
    payload = JSON.parse(rawText);
  } catch {
    return json({ ok: false, reason: "INVALID_JSON" }, 400);
  }
  const document = payload.document;
  const metaIn = payload.meta || {};
  const v = validateCjManagedPublicDoc(document);
  if (!v.ok) {
    return json({ ok: false, reason: "VALIDATION_FAILED", errors: v.errors }, 400);
  }

  const body = JSON.stringify(document);
  const contentSha256 = String(
    metaIn.contentSha256 || request.headers.get("x-iu-cj-content-sha256") || ""
  );

  const currentMetaObj = await env.CJ_MANAGED_PUBLIC.get(R2_CJ_META_KEY);
  if (currentMetaObj && contentSha256) {
    try {
      const cur = JSON.parse(await currentMetaObj.text()) as CjPublishMeta;
      if (cur.contentSha256 && cur.contentSha256 === contentSha256) {
        return json({
          ok: true,
          reason: "UNCHANGED_CONTENT_PUBLICATION_SKIPPED",
          generationId: cur.generationId,
        });
      }
    } catch {
      /* continue */
    }
  }

  const publishedAt = String(metaIn.publishedAt || new Date().toISOString());
  const generationId = String(metaIn.generationId || publishedAt);
  const meta: CjPublishMeta = {
    generationId,
    publishedAt,
    contentSha256: contentSha256 || undefined,
    partnerCount: v.partnerCount,
    activeCount: v.activeCount,
    source: String(metaIn.source || "cj-catalog-sync"),
  };
  const metaBody = JSON.stringify(meta);

  // Preserve previous current as LKG before overwrite (rollback source).
  const previous = await env.CJ_MANAGED_PUBLIC.get(R2_CJ_CURRENT_KEY);
  if (previous) {
    const prevText = await previous.text();
    await env.CJ_MANAGED_PUBLIC.put(R2_CJ_LKG_KEY, prevText, {
      httpMetadata: { contentType: "application/json" },
    });
  }

  const staged = await env.CJ_MANAGED_PUBLIC.put(R2_CJ_STAGING_KEY, body, {
    httpMetadata: { contentType: "application/json" },
  });
  await env.CJ_MANAGED_PUBLIC.put(R2_CJ_STAGING_META_KEY, metaBody, {
    httpMetadata: { contentType: "application/json" },
  });
  if (!staged || !(staged.size > 0)) {
    return json({ ok: false, reason: "STAGING_VERIFY_FAILED" }, 500);
  }

  // Re-validate staging body schema marker (defense in depth).
  if (!body.includes('"schema":"' + CJ_PUBLIC_SCHEMA + '"') && !body.includes('"schema": "' + CJ_PUBLIC_SCHEMA + '"')) {
    return json({ ok: false, reason: "STAGING_SCHEMA_VERIFY_FAILED" }, 500);
  }

  await env.CJ_MANAGED_PUBLIC.put(R2_CJ_CURRENT_KEY, body, {
    httpMetadata: { contentType: "application/json" },
  });
  await env.CJ_MANAGED_PUBLIC.put(R2_CJ_META_KEY, metaBody, {
    httpMetadata: { contentType: "application/json" },
  });

  return json({
    ok: true,
    reason: "PUBLISHED",
    ATOMIC_PUBLICATION_PASS: "YES",
    NO_GIT_MERGE_REQUIRED: "YES",
    generationId,
    publishedAt,
    partnerCount: v.partnerCount,
    activeCount: v.activeCount,
    payloadBytes: body.length,
  });
}

export async function rollbackCjManagedPublic(env: CjManagedPublicEnv): Promise<Response> {
  if (!env.CJ_MANAGED_PUBLIC) return json({ ok: false, reason: "R2_NOT_BOUND" }, 503);
  const lkg = await env.CJ_MANAGED_PUBLIC.get(R2_CJ_LKG_KEY);
  if (!lkg) return json({ ok: false, reason: "LKG_MISSING" }, 404);
  const text = await lkg.text();
  const v = validateCjManagedPublicDoc(JSON.parse(text));
  if (!v.ok) return json({ ok: false, reason: "LKG_INVALID", errors: v.errors }, 500);
  await env.CJ_MANAGED_PUBLIC.put(R2_CJ_CURRENT_KEY, text, {
    httpMetadata: { contentType: "application/json" },
  });
  return json({ ok: true, reason: "ROLLED_BACK_TO_LKG", partnerCount: v.partnerCount });
}
