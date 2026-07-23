import { resolveFeatureFlags, isPublicDeliveryActive } from "./feature-flags";
import { emptyPublicDelivery, sanitizePublicAds, assertNoForbiddenPublicKeys } from "./isolation";
import { parseAccessQuery, verifyObjectAccess } from "./signed-access";
import type { Env, PublicDeliveryResponse } from "./types";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE });
}

async function pingDb(env: Env): Promise<boolean> {
  if (!env.DB) return false;
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return true;
  } catch {
    return false;
  }
}

function corsHeaders(env: Env): HeadersInit {
  const origin = env.CORS_ALLOW_ORIGIN || "https://infouzel.cz";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const flags = resolveFeatureFlags(env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...corsHeaders(env), ...NO_STORE } });
    }

    if (path === "/health" || path === "/") {
      const dbOk = await pingDb(env);
      const creativesBound = !!env.CREATIVES;
      const documentsBound = !!env.DOCUMENTS;
      const r2Ok = creativesBound && documentsBound;
      return json(
        {
          ok: dbOk,
          service: "infouzel-ads",
          mode: "ads-business",
          storageMode: dbOk ? "d1" : env.DB ? "unavailable" : "unbound",
          schemaVersion: "0002",
          safeMode: flags.safeMode,
          publicDeliveryEnabled: flags.publicDeliveryEnabled,
          adminApiEnabled: flags.adminApiEnabled,
          clientApiEnabled: flags.clientApiEnabled,
          r2: {
            creativesBound,
            documentsBound,
            ready: r2Ok,
            privateDocumentsPublicUrl: false,
          },
          storesIp: false,
          storesFingerprint: false,
          storesFullUserAgent: false,
          personalizedAds: false,
          retargeting: false,
          profiling: false,
          contextualAdsOnly: true,
        },
        dbOk ? 200 : 503
      );
    }

    if (path === "/v1/public/ads/delivery") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      const active = isPublicDeliveryActive(flags);
      const body: PublicDeliveryResponse = emptyPublicDelivery(active, flags.safeMode);
      if (!active) {
        const headers = { ...NO_STORE, ...corsHeaders(env) };
        return new Response(JSON.stringify(body), { status: 200, headers });
      }
      body.ads = sanitizePublicAds([]);
      const leaks = assertNoForbiddenPublicKeys(body);
      if (leaks.length) return json({ error: "isolation_violation", leaks }, 500);
      const headers = { ...NO_STORE, ...corsHeaders(env) };
      return new Response(JSON.stringify(body), { status: 200, headers });
    }

    // Private document / creative stream — signed query only; never permanent public R2 URL.
    if (path === "/v1/objects/get") {
      if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
      if (!env.ADS_R2_SIGNING_SECRET) return json({ error: "signing_not_configured" }, 503);
      const access = parseAccessQuery(url);
      if (!access) return json({ error: "invalid_access" }, 400);
      const verified = await verifyObjectAccess(env.ADS_R2_SIGNING_SECRET, access);
      if (!verified.ok) return json({ error: "access_denied", reason: verified.reason }, 403);
      const bucket = access.bucket === "DOCUMENTS" ? env.DOCUMENTS : env.CREATIVES;
      if (!bucket) return json({ error: "bucket_unbound" }, 503);
      const obj = await bucket.get(access.objectKey);
      if (!obj) return json({ error: "not_found" }, 404);
      const headers = new Headers();
      headers.set("Cache-Control", "no-store");
      headers.set("X-Content-Type-Options", "nosniff");
      if (obj.httpMetadata?.contentType) headers.set("Content-Type", obj.httpMetadata.contentType);
      return new Response(obj.body, { status: 200, headers });
    }

    if (path.startsWith("/v1/admin")) {
      if (!flags.adminApiEnabled || flags.safeMode) {
        return json({ error: "admin_api_disabled", safeMode: flags.safeMode }, 503);
      }
      return json({ error: "not_implemented" }, 501);
    }

    if (path.startsWith("/v1/client")) {
      if (!flags.clientApiEnabled || flags.safeMode) {
        return json({ error: "client_api_disabled", safeMode: flags.safeMode }, 503);
      }
      return json({ error: "not_implemented" }, 501);
    }

    return json({ error: "not_found" }, 404);
  },
};
