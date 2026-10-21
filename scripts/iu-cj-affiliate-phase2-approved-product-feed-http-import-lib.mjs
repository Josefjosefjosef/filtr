/**
 * Approved product feed HTTP import (staging-ready, mock-first).
 * No auto-publish. Live fetch only when multi-gate allows; offline requires mockFetch.
 */
import {
  buildFeedImportAuditRecord,
  resolveApprovedFeedById,
  resolveApprovedFeedHttpExecuteGate,
  validateApprovedFeedSourceUrl,
  validateRedirectTargetAllowed,
  loadApprovedProductFeedRegistry,
} from "./iu-cj-affiliate-phase2-approved-product-feed-lib.mjs";
import {
  classifyProductFeedHttpStatus,
  evaluateZeroProductResult,
} from "./iu-cj-affiliate-phase2-unattended-import-cycle-lib-v1.mjs";
import { parseShoppingProductsGraphqlResponse } from "./iu-cj-affiliate-phase2-product-api.mjs";

export const FEED_HTTP_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 3,
  timeoutMs: 30_000,
});

function stableProductKey(row) {
  const id = String(row?.id || row?.sku || row?.productId || "").trim();
  const title = String(row?.title || row?.name || "").trim().slice(0, 120);
  return id || title || null;
}

export function parseApprovedFeedBody(format, bodyText, contentType = "") {
  const fmt = String(format || "").trim();
  const text = String(bodyText || "");
  if (!text.trim()) {
    return { ok: false, reason: "empty_body", products: [], total: 0 };
  }
  if (fmt === "cj_graphql_shopping_products") {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid_json", products: [], total: 0 };
    }
    const parsed = parseShoppingProductsGraphqlResponse({
      ok: true,
      status: 200,
      gqlErrors: json.errors || [],
      json,
    });
    if (!parsed.ok) {
      return { ok: false, reason: parsed.kind || "parse_failed", products: [], total: 0 };
    }
    const list = parsed.resultList || [];
    const total = Number(parsed.totalCount ?? list.length);
    return { ok: true, reason: parsed.kind || "ok", products: list, total, emptyCatalog: parsed.kind === "empty_catalog" };
  }
  if (fmt === "json" || /json/i.test(contentType)) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid_json", products: [], total: 0 };
    }
    const products = Array.isArray(json?.products)
      ? json.products
      : Array.isArray(json?.items)
        ? json.items
        : [];
    return { ok: true, reason: "ok", products, total: products.length };
  }
  return { ok: false, reason: "unsupported_format", products: [], total: 0 };
}

export function dedupeProductRows(rows) {
  const seen = new Set();
  const unique = [];
  let duplicateCount = 0;
  for (const row of rows || []) {
    const key = stableProductKey(row);
    if (!key) continue;
    if (seen.has(key)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }
  return { unique, duplicateCount, receivedCount: (rows || []).length };
}

export async function importApprovedProductFeedHttp(options = {}) {
  const env = options.env || process.env;
  const gate = resolveApprovedFeedHttpExecuteGate(env);
  const registry = options.registry || loadApprovedProductFeedRegistry(options.registryPath);
  const feedEntry =
    options.feedEntry ||
    resolveApprovedFeedById(registry, options.feedId || registry.feeds?.[0]?.feedId);
  if (!feedEntry) {
    return { ok: false, phase: "registry", reason: "feed_not_found", publishable: false };
  }

  const urlGate = await validateApprovedFeedSourceUrl(feedEntry);
  if (!urlGate.ok) {
    return { ok: false, phase: "url", publishable: false, ...urlGate };
  }

  const mockFetch = options.mockFetch;
  if (!mockFetch) {
    if (gate.offlineForced || !gate.allowed) {
      return {
        ok: false,
        phase: "gate",
        reason: gate.offlineForced ? "offline_requires_mock_fetch" : "http_execute_not_armed",
        publishable: false,
        gate,
      };
    }
    return { ok: false, phase: "gate", reason: "live_fetch_not_implemented_in_repo", publishable: false, gate };
  }

  let response;
  try {
    response = await mockFetch(feedEntry.sourceUrl, {
      method: "GET",
      redirect: "manual",
      signal: options.signal,
    });
  } catch (err) {
    return {
      ok: false,
      phase: "fetch",
      reason: "network_error",
      detail: String(err?.message || err),
      publishable: false,
    };
  }

  const status = Number(response.status ?? 0);
  const httpClass = classifyProductFeedHttpStatus(status);
  if (!httpClass.ok) {
    return { ok: false, phase: "http", publishable: false, status, ...httpClass };
  }

  if (status >= 300 && status < 400) {
    const location = response.headers?.get?.("location") || response.headers?.location;
    const redirectGate = await validateRedirectTargetAllowed(location, feedEntry);
    if (!redirectGate.ok) {
      return { ok: false, phase: "redirect", publishable: false, status, ...redirectGate };
    }
    if ((options.redirectDepth ?? 0) >= FEED_HTTP_LIMITS.maxRedirects) {
      return { ok: false, phase: "redirect", reason: "too_many_redirects", publishable: false };
    }
    return importApprovedProductFeedHttp({
      ...options,
      feedEntry: { ...feedEntry, sourceUrl: location },
      redirectDepth: (options.redirectDepth ?? 0) + 1,
    });
  }

  const buf = await response.arrayBuffer();
  if (buf.byteLength > FEED_HTTP_LIMITS.maxBytes) {
    return {
      ok: false,
      phase: "body",
      reason: "body_too_large",
      bytes: buf.byteLength,
      publishable: false,
    };
  }

  const contentType = response.headers?.get?.("content-type") || "";
  const parsed = parseApprovedFeedBody(feedEntry.format, Buffer.from(buf).toString("utf8"), contentType);
  if (!parsed.ok) {
    return { ok: false, phase: "parse", publishable: false, ...parsed };
  }

  const zeroEval = evaluateZeroProductResult(parsed.total);
  if (!zeroEval.ok) {
    return { ok: false, phase: "parse", publishable: false, ...zeroEval };
  }

  const dedupe = dedupeProductRows(parsed.products);
  const audit = buildFeedImportAuditRecord(feedEntry, {
    receivedCount: dedupe.receivedCount,
    rejectedCount: Math.max(0, dedupe.receivedCount - dedupe.unique.length),
    duplicateCount: dedupe.duplicateCount,
    importChecksum: options.importChecksum || null,
    dataOrigin: "approved_feed_http_mock",
    lastSuccessfulImportAt: new Date().toISOString(),
    errors: zeroEval.emptyFeed ? ["empty_feed_zero_products"] : [],
  });

  return {
    ok: true,
    phase: "complete",
    publishable: false,
    emptyFeed: zeroEval.emptyFeed === true,
    productCount: dedupe.unique.length,
    audit,
    gate,
  };
}
