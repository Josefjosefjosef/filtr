import {
  handleBulkExportAffiliateArchive,
  handleExportAffiliateArchive,
  handleGetAffiliateArchive,
  handleGetAffiliateArchiveEvidence,
  handleListAffiliateArchive,
  handleSimulateAffiliateArchiveTestPublish,
} from "./admin-affiliate-archive";
import type { Env } from "./types";

/** CJ affiliate archive admin API routes (wired only from index-cj-affiliate-archive.ts). */
export async function routeAffiliateArchiveAdminApi(
  request: Request,
  env: Env,
  url: URL,
  method: string,
  path: string
): Promise<Response | null> {
  if (path === "/v1/admin/affiliate-archive" && method === "GET") {
    return handleListAffiliateArchive(request, env, url);
  }
  if (path === "/v1/admin/affiliate-archive/simulate-test-publish" && method === "POST") {
    return handleSimulateAffiliateArchiveTestPublish(request, env);
  }
  if (path === "/v1/admin/affiliate-archive/export/bulk" && method === "POST") {
    return handleBulkExportAffiliateArchive(request, env);
  }
  const affArchExportMatch = path.match(/^\/v1\/admin\/affiliate-archive\/([^/]+)\/export$/);
  if (affArchExportMatch && method === "GET") {
    return handleExportAffiliateArchive(request, env, affArchExportMatch[1]!);
  }
  const affArchEvidenceMatch = path.match(/^\/v1\/admin\/affiliate-archive\/([^/]+)\/evidence$/);
  if (affArchEvidenceMatch && method === "GET") {
    return handleGetAffiliateArchiveEvidence(request, env, affArchEvidenceMatch[1]!);
  }
  const affArchIdMatch = path.match(/^\/v1\/admin\/affiliate-archive\/([^/]+)$/);
  if (affArchIdMatch && method === "GET") {
    return handleGetAffiliateArchive(request, env, affArchIdMatch[1]!);
  }
  return null;
}
