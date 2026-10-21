/** Approved product feed registry — SSRF-safe URL gate, audit record shape (no auto-publish). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertFetchAllowed, isPrivateOrBlockedHost, normalizeHost } from "./iu-cj-affiliate-phase2-offer-landing-lib.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_APPROVED_FEEDS_REGISTRY = path.join(
  scriptsDir,
  "fixtures",
  "cj-phase2-approved-product-feeds-v1.json"
);

export function loadApprovedProductFeedRegistry(registryPath = DEFAULT_APPROVED_FEEDS_REGISTRY) {
  const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const feeds = Array.isArray(raw.feeds) ? raw.feeds : [];
  return { schemaVersion: raw.schemaVersion ?? 1, feeds };
}

export function resolveApprovedFeedById(registry, feedId) {
  const id = String(feedId || "").trim();
  return (registry.feeds || []).find((f) => String(f.feedId) === id) || null;
}

export async function validateApprovedFeedSourceUrl(feedEntry) {
  const url = String(feedEntry?.sourceUrl || "").trim();
  if (!url) return { ok: false, reason: "missing_source_url" };
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, reason: "https_required", url };
  }
  const suffixes = (feedEntry.allowedHostSuffixes || []).map((s) => normalizeHost(s));
  return assertFetchAllowed(url, { allowedHostSuffixes: suffixes });
}

export async function validateRedirectTargetAllowed(redirectUrl, feedEntry) {
  const url = String(redirectUrl || "").trim();
  if (!url) return { ok: false, reason: "missing_redirect_url" };
  const suffixes = (feedEntry?.allowedHostSuffixes || []).map((s) => normalizeHost(s));
  const gate = await assertFetchAllowed(url, { allowedHostSuffixes: suffixes.length ? suffixes : undefined });
  if (!gate.ok) return gate;
  try {
    const host = normalizeHost(new URL(url).hostname);
    if (isPrivateOrBlockedHost(host)) {
      return { ok: false, reason: "redirect_private_host", host };
    }
  } catch {
    return { ok: false, reason: "redirect_url_invalid" };
  }
  return { ok: true, reason: "ok" };
}

export function buildFeedImportAuditRecord(feedEntry, stats = {}) {
  return {
    feedId: feedEntry.feedId,
    partnerKey: feedEntry.partnerKey,
    partnerIdentity: feedEntry.partnerIdentity,
    sourceUrl: feedEntry.sourceUrl,
    format: feedEntry.format,
    allowedUsage: feedEntry.allowedUsage || [],
    publishable: false,
    lastSuccessfulImportAt: stats.lastSuccessfulImportAt || null,
    receivedCount: Number(stats.receivedCount ?? 0),
    rejectedCount: Number(stats.rejectedCount ?? 0),
    duplicateCount: Number(stats.duplicateCount ?? 0),
    errors: stats.errors || [],
    warnings: stats.warnings || [],
    dataOrigin: stats.dataOrigin || "approved_feed_registry",
    importChecksum: stats.importChecksum || null,
  };
}

export function resolveApprovedFeedHttpExecuteGate(env = process.env) {
  const offline =
    env.IU_CJ_EMAIL_INGEST_OFFLINE === "1" ||
    env.IU_CJ_GITHUB_INGEST_DRY_RUN === "1" ||
    env.IU_CJ_UNATTENDED_IMPORT_OFFLINE !== "0";
  const armed = env.IU_CJ_APPROVED_FEED_HTTP_EXECUTE === "1" && env.IU_CJ_CJ_API_HTTP_EXECUTE === "1";
  return {
    allowed: !offline && armed && env.IU_CJ_LIVE_INGEST_APPROVED === "1",
    offlineForced: offline,
    armed,
    publishable: false,
  };
}

export async function auditApprovedFeedRegistry(registryPath = DEFAULT_APPROVED_FEEDS_REGISTRY) {
  const registry = loadApprovedProductFeedRegistry(registryPath);
  const results = [];
  for (const feed of registry.feeds) {
    const urlGate = await validateApprovedFeedSourceUrl(feed);
    results.push({
      feedId: feed.feedId,
      urlOk: urlGate.ok === true,
      urlReason: urlGate.reason || null,
      publishable: false,
    });
  }
  const allOk = results.every((r) => r.urlOk);
  return { ok: allOk, registryVersion: registry.schemaVersion, feeds: results, publishable: false };
}
