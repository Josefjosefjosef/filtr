/**
 * V51.8 — individual INVALID_FEED case audit (offline; no secrets).
 * Reads offers-sync audit / partner registry error rows and emits one record per advertiser.
 */
import fs from "node:fs";
import path from "node:path";
import { buildPartnerFetchErrorAudit, classifyPartnerFetchError } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

export const INVALID_FEED_CASE_AUDIT_SCHEMA =
  "iu-cj-affiliate-phase3z-invalid-feed-case-audit-v51-8";

function collectErrorRows(root) {
  const out = [];
  const seen = new Set();
  function push(row) {
    if (!row || typeof row !== "object") return;
    const key = [
      row.advertiserId || row.partnerId || "",
      row.feedId || "",
      row.redactedError || row.error || row.message || "",
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(row);
  }
  // Prefer dedicated full error-case list when present (not truncated sample).
  const preferred = root?.productMeta?.partnerFetchErrorCases;
  if (Array.isArray(preferred) && preferred.length) {
    for (const row of preferred) {
      const errText = String(row?.error || row?.redactedError || "");
      const cls = row?.errorClass || (errText ? classifyPartnerFetchError(errText) : null);
      if (cls === "INVALID_FEED" || /http_400/i.test(errText)) push(row);
    }
    if (out.length) return out;
  }
  // funnelFetchMeta is the complete per-advertiser map (not capped at 40).
  const funnel = root?.productMeta?.funnelFetchMeta;
  if (funnel && typeof funnel === "object") {
    for (const [advertiserId, row] of Object.entries(funnel)) {
      if (!row || typeof row !== "object") continue;
      push({ advertiserId, ...row });
    }
    const invalidOnly = out.filter((row) => {
      const errText = String(row.error || row.redactedError || "");
      const cls = row.errorClass || (errText ? classifyPartnerFetchError(errText) : null);
      return cls === "INVALID_FEED" || /http_400/i.test(errText);
    });
    if (invalidOnly.length) return invalidOnly;
    out.length = 0;
  }
  function walk(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 8) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    const errText = String(node.error || node.redactedError || node.message || "");
    const cls = node.errorClass || (errText ? classifyPartnerFetchError(errText) : null);
    if (cls === "INVALID_FEED" || /http_400/i.test(errText)) push(node);
    for (const [k, v] of Object.entries(node)) {
      if (k === "products" || k === "sections" || k === "items") continue;
      if (v && typeof v === "object") walk(v, depth + 1);
    }
  }
  walk(root);
  return out;
}

export function auditInvalidFeedCases(input = {}) {
  const rows = collectErrorRows(input);
  const cases = rows.map((row, idx) => {
    const errText = String(row.error || row.redactedError || row.message || "");
    const base = buildPartnerFetchErrorAudit(errText, {
      endpoint: row.endpoint || row.api || "shoppingProducts",
    });
    const advertiserId = row.advertiserId || row.partnerId || row.cid || null;
    const feedId = row.feedId || row.productFeedId || null;
    return {
      caseId: idx + 1,
      advertiserId: advertiserId != null ? String(advertiserId) : null,
      feedId: feedId != null ? String(feedId) : null,
      endpoint: base.endpoint,
      httpStatus: base.httpStatus ?? row.httpStatus ?? null,
      errorClass: base.errorClass,
      redactedError: base.redactedError || null,
      lastSuccessAt: row.lastSuccessAt || row.lastOkAt || row.lastFetchedAt || null,
      retryCount: row.retryCount ?? row.retries ?? null,
      rootCause: base.likelyExternal
        ? "EXTERNAL_CJ_GRAPHQL_OR_FEED"
        : "POSSIBLE_IMPLEMENTATION",
      impactProducts: row.impactProducts ?? row.affectedProducts ?? null,
      impactUpdates: "LKG_RETAIN_PRIOR; partner skipped this run; others continue",
      external: base.likelyExternal === true,
      fixableInRepo: base.likelyExternal !== true,
      continueOtherPartners: true,
    };
  });
  const byClass = {};
  for (const c of cases) {
    byClass[c.errorClass] = (byClass[c.errorClass] || 0) + 1;
  }
  return {
    schema: INVALID_FEED_CASE_AUDIT_SCHEMA,
    at: new Date().toISOString(),
    totalCases: cases.length,
    byClass,
    allExternal: cases.every((c) => c.external === true),
    implementationFixNeeded: cases.some((c) => c.fixableInRepo === true),
    cases,
    note: "INVALID_FEED http_400 from CJ GraphQL is treated as external; LKG retained; sync continues for other partners.",
  };
}

export function writeInvalidFeedCaseAudit(outPath, input) {
  const report = auditInvalidFeedCases(input);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return report;
}

const isDirectRun = process.argv[1] && path.basename(process.argv[1]).includes(
  "iu-cj-affiliate-phase3z-invalid-feed-case-audit-v51-8.mjs",
);
if (isDirectRun) {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    console.error("Usage: node iu-cj-affiliate-phase3z-invalid-feed-case-audit-v51-8.mjs <audit.json> <out.json>");
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(inPath, "utf8"));
  const report = writeInvalidFeedCaseAudit(outPath, input);
  console.log(
    JSON.stringify({
      INVALID_FEED_CASE_AUDIT: "OK",
      totalCases: report.totalCases,
      byClass: report.byClass,
      allExternal: report.allExternal,
      outPath,
    }),
  );
}
