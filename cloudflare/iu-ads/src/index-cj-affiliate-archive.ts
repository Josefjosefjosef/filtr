/**
 * CJ affiliate archive Worker entry — deploy only via Deploy IU Ads CJ affiliate archive workflow.
 */
import coreIndex from "./index.ts";
import { finalizeSecurityHeaders } from "./security-headers";
import { resolveFeatureFlags } from "./feature-flags";
import { routeAffiliateArchiveAdminApi } from "./admin-affiliate-archive-routes";
import type { Env } from "./types";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: NO_STORE });
}

function isCjAffiliateArchiveEnabled(env: Env): boolean {
  const v = (env.ADS_CJ_AFFILIATE_ARCHIVE_ENABLED || "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

async function fetchWithCjArchive(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method;

  if (path.startsWith("/v1/admin/affiliate-archive")) {
    if (!isCjAffiliateArchiveEnabled(env)) {
      return json({ error: "cj_affiliate_archive_disabled" }, 503);
    }
    const flags = resolveFeatureFlags(env);
    if (!flags.adminApiEnabled) {
      return json({ error: "admin_api_disabled" }, 503);
    }
    if (!env.ADS_SESSION_SECRET || !env.ADS_PASSWORD_PEPPER) {
      return json({ error: "auth_not_configured" }, 503);
    }
    const routed = await routeAffiliateArchiveAdminApi(request, env, url, method, path);
    const inner = routed || json({ error: "not_found" }, 404);
    return finalizeSecurityHeaders(request, inner);
  }

  return coreIndex.fetch(request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return fetchWithCjArchive(request, env);
  },

  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void | Promise<void> {
    return coreIndex.scheduled(controller, env, ctx);
  },
};
