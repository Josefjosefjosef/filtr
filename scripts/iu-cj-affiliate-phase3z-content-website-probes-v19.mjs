#!/usr/bin/env node
/**
 * Phase 3Z V19 — content-tier website probes (not HTTP-status alone).
 *
 * Tiers:
 *  HTTP_REACHABLE | REDIRECT_RESOLVED | CONTENT_FETCHED |
 *  ASSORTMENT_EVIDENCE_EXTRACTED | MERCHANT_IDENTITY_VERIFIED |
 *  CONTENT_REVIEW_COMPLETED | BLOCKED_OR_UNAVAILABLE
 *
 * 3xx alone never counts as CONTENT_REVIEW_COMPLETED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeMerchantHomepage } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

export const CONTENT_PROBE_SCHEMA = "iu-cj-affiliate-phase3z-content-website-probes-v19";

/**
 * V20 exclusive review outcomes (exactly one per partner):
 *  BLOCKED_OR_UNAVAILABLE | HTTP_REACHABLE_ONLY | CONTENT_FETCHED_TITLE_ONLY |
 *  CONTENT_REVIEW_WITH_ASSORTMENT
 *
 * CONTENT_REVIEW_COMPLETED (strict) requires ASSORTMENT_EVIDENCE_EXTRACTED.
 * Title-only HTTP success is NEVER assortment verification.
 */
function classifyProbe(probe, opts = {}) {
  const tiers = [];
  const status = probe.httpStatus;
  const err = String(probe.error || "");
  const sig = probe.assortmentEvidence?.significantGroups || [];
  const hasTitle = Boolean(probe.title && String(probe.title).trim().length >= 3);
  const httpOk =
    (probe.ok && status >= 200 && status < 400) || (status >= 200 && status < 400 && !err);

  if (httpOk) tiers.push("HTTP_REACHABLE");
  if (opts.redirectFollowed && probe.ok) tiers.push("REDIRECT_RESOLVED");
  if (hasTitle || sig.length > 0) tiers.push("CONTENT_FETCHED");
  if (sig.length > 0) tiers.push("ASSORTMENT_EVIDENCE_EXTRACTED");
  if (opts.merchantIdentityVerified) tiers.push("MERCHANT_IDENTITY_VERIFIED");

  // Redirect-only without body content.
  if (status >= 300 && status < 400 && !hasTitle && sig.length === 0) {
    return {
      tiers: ["HTTP_REACHABLE", "BLOCKED_OR_UNAVAILABLE"],
      contentReviewCompleted: false,
      assortmentEvidenceExtracted: false,
      exclusiveOutcome: "BLOCKED_OR_UNAVAILABLE",
      note: "redirect_without_content_body",
    };
  }

  const blockedHard =
    !probe.ok ||
    /timeout|blocked|403|451|captcha|cloudflare|ECONN|ENOTFOUND|cert/i.test(err) ||
    probe.reason === "missing_program_url";

  let exclusiveOutcome = "UNCLASSIFIED";
  if (blockedHard && sig.length === 0 && !hasTitle) {
    tiers.push("BLOCKED_OR_UNAVAILABLE");
    exclusiveOutcome = "BLOCKED_OR_UNAVAILABLE";
  } else if (sig.length > 0) {
    tiers.push("CONTENT_REVIEW_COMPLETED");
    exclusiveOutcome = "CONTENT_REVIEW_WITH_ASSORTMENT";
  } else if (hasTitle) {
    // Title fetched — not assortment verification.
    exclusiveOutcome = "CONTENT_FETCHED_TITLE_ONLY";
  } else if (httpOk) {
    exclusiveOutcome = "HTTP_REACHABLE_ONLY";
  } else {
    tiers.push("BLOCKED_OR_UNAVAILABLE");
    exclusiveOutcome = "BLOCKED_OR_UNAVAILABLE";
  }

  const published = String(opts.publishedSectionId || "");
  const primary = probe.assortmentEvidence?.primaryAssortment?.sectionId || null;
  if (published && primary && published === primary) {
    tiers.push("CATEGORY_SUPPORTED_BY_EVIDENCE");
  }

  return {
    tiers: [...new Set(tiers)],
    contentReviewCompleted: exclusiveOutcome === "CONTENT_REVIEW_WITH_ASSORTMENT",
    assortmentEvidenceExtracted: sig.length > 0,
    exclusiveOutcome,
    note:
      exclusiveOutcome === "CONTENT_FETCHED_TITLE_ONLY"
        ? "title_only_not_assortment_verification"
        : exclusiveOutcome === "HTTP_REACHABLE_ONLY"
          ? "http_ok_without_title_or_assortment"
          : null,
  };
}

function loadPartnersFromCatalog(root) {
  const catalogJs = fs.readFileSync(path.join(root, "assets", "iu-affiliate-catalog.js"), "utf8");
  const parsed = parseAffiliateCatalogOrdered(catalogJs);
  const out = [];
  for (const s of parsed.sections || []) {
    for (const it of s.items || []) {
      if (!it.url || !isCjTrackingUrl(it.url)) continue;
      out.push({
        advertiserId: String(it.advertiserId || ""),
        name: String(it.title || it.label || it.name || ""),
        sectionId: String(s.sectionId || s.id || ""),
        clickUrl: String(it.url || ""),
      });
    }
  }
  return out;
}

function loadProgramUrls(partnersPath) {
  const map = new Map();
  if (!partnersPath || !fs.existsSync(partnersPath)) return map;
  const raw = JSON.parse(fs.readFileSync(partnersPath, "utf8"));
  const list = Array.isArray(raw) ? raw : Array.isArray(raw.partners) ? raw.partners : [];
  for (const p of list) {
    const id = String(p.advertiserId || p.advertiserCid || "");
    if (!id) continue;
    const url =
      p.programUrl ||
      p.websiteUrl ||
      p.officialUrl ||
      p.merchantUrl ||
      (Array.isArray(p.officialDomains) && p.officialDomains[0]
        ? "https://" + String(p.officialDomains[0]).replace(/^https?:\/\//, "")
        : null);
    if (url) map.set(id, String(url));
  }
  return map;
}

export async function runContentWebsiteProbes(opts = {}) {
  const root = opts.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const partners = opts.partners || loadPartnersFromCatalog(root);
  const programUrls = loadProgramUrls(opts.partnersInventoryPath);
  const concurrency = Math.max(1, Number(opts.concurrency || 4));
  const timeoutMs = Number(opts.timeoutMs || 10000);
  const results = [];
  let i = 0;

  async function one(p) {
    const programUrl = programUrls.get(p.advertiserId) || null;
    const probeUrl = programUrl || null;
    const base = {
      advertiserId: p.advertiserId,
      name: p.name,
      publishedSectionId: p.sectionId,
      programUrl: probeUrl,
      clickUrlHost: (() => {
        try {
          return new URL(p.clickUrl).hostname;
        } catch {
          return null;
        }
      })(),
    };
    if (!probeUrl) {
      results.push({
        ...base,
        ok: false,
        tiers: ["BLOCKED_OR_UNAVAILABLE"],
        contentReviewCompleted: false,
        assortmentEvidenceExtracted: false,
        exclusiveOutcome: "BLOCKED_OR_UNAVAILABLE",
        reason: "missing_program_url",
        httpStatus: null,
        title: null,
        bytes: 0,
      });
      return;
    }
    const started = probeUrl;
    const probe = await probeMerchantHomepage(probeUrl, {
      timeoutMs,
      merchantIdentity: p.name,
    });
    const redirectFollowed = String(probe.url || "") !== String(started);
    const identity =
      Boolean(probe.title) &&
      String(p.name || "")
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .some((w) => String(probe.title).toLowerCase().includes(w.toLowerCase().slice(0, 6)));
    const classified = classifyProbe(probe, {
      redirectFollowed,
      merchantIdentityVerified: identity,
      publishedSectionId: p.sectionId,
    });
    results.push({
      ...base,
      finalUrl: probe.url || probeUrl,
      redirectFollowed,
      ok: probe.ok === true,
      httpStatus: probe.httpStatus,
      title: probe.title,
      error: probe.error || null,
      navHints: probe.navHints || [],
      assortmentPrimarySection: probe.assortmentEvidence?.primaryAssortment?.sectionId || null,
      assortmentGroups: (probe.assortmentEvidence?.significantGroups || []).map((g) => g.group).slice(0, 8),
      tiers: classified.tiers,
      contentReviewCompleted: classified.contentReviewCompleted,
      assortmentEvidenceExtracted: classified.assortmentEvidenceExtracted === true,
      exclusiveOutcome: classified.exclusiveOutcome,
      note: classified.note,
    });
  }

  const queue = [];
  for (const p of partners) {
    const job = one(p).then(() => {
      queue.splice(queue.indexOf(job), 1);
    });
    queue.push(job);
    i += 1;
    if (queue.length >= concurrency) await Promise.race(queue);
    if (opts.limit && i >= opts.limit) break;
  }
  await Promise.all(queue);

  const exclusiveCounts = {};
  for (const r of results) {
    const k = r.exclusiveOutcome || "UNCLASSIFIED";
    exclusiveCounts[k] = (exclusiveCounts[k] || 0) + 1;
  }
  const exclusiveSum = Object.values(exclusiveCounts).reduce((a, b) => a + b, 0);
  const contentVerified = results.filter((r) => r.contentReviewCompleted).length;
  const blocked = results.filter((r) => r.exclusiveOutcome === "BLOCKED_OR_UNAVAILABLE").length;
  const titleOnly = results.filter((r) => r.exclusiveOutcome === "CONTENT_FETCHED_TITLE_ONLY").length;
  const httpOnly = results.filter((r) => r.exclusiveOutcome === "HTTP_REACHABLE_ONLY").length;
  const redirectOnly = results.filter((r) => r.note === "redirect_without_content_body").length;
  const completenessOk = exclusiveSum === results.length && !exclusiveCounts.UNCLASSIFIED;

  return {
    schema: CONTENT_PROBE_SCHEMA,
    generatedAt: new Date().toISOString(),
    counts: {
      partners: results.length,
      contentReviewCompleted: contentVerified,
      contentReviewWithAssortment: contentVerified,
      contentFetchedTitleOnly: titleOnly,
      httpReachableOnly: httpOnly,
      blockedOrUnavailable: blocked,
      redirectWithoutContent: redirectOnly,
      httpReachable: results.filter((r) => (r.tiers || []).includes("HTTP_REACHABLE")).length,
      assortmentExtracted: results.filter((r) => r.assortmentEvidenceExtracted === true).length,
      exclusiveSum,
      exclusiveCounts,
    },
    HTTP_REDIRECTS_NOT_COUNTED_AS_CONTENT_VERIFICATION: true,
    ASSORTMENT_EVIDENCE_EXPLICITLY_DISTINGUISHED: true,
    TOTAL_PARTNERS_EQUALS_EXCLUSIVE_OUTCOMES: completenessOk,
    results,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() ===
    fileURLToPath(import.meta.url).toLowerCase();

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const outDir = process.env.IU_CJ_V19_PROBE_OUT || path.join(process.env.TEMP || "/tmp", "iu-v19-audit");
  fs.mkdirSync(outDir, { recursive: true });
  const partnersInventoryPath =
    process.env.IU_CJ_V19_PARTNERS_PATH ||
    path.join(process.env.TEMP || "/tmp", "iu-v18-zip", "01-all-partners.json");
  const limitEnv = process.env.IU_CJ_V19_PROBE_LIMIT;
  const finalReport = await runContentWebsiteProbes({
    root,
    partnersInventoryPath,
    concurrency: Number(process.env.IU_CJ_V19_PROBE_CONCURRENCY || 5),
    timeoutMs: Number(process.env.IU_CJ_V19_PROBE_TIMEOUT_MS || 10000),
    limit: limitEnv ? Number(limitEnv) : undefined,
  });
  const outPath = path.join(outDir, "12-content-website-probes-v19.json");
  fs.writeFileSync(outPath, JSON.stringify(finalReport, null, 2), "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        counts: finalReport.counts,
        HTTP_REDIRECTS_NOT_COUNTED_AS_CONTENT_VERIFICATION:
          finalReport.HTTP_REDIRECTS_NOT_COUNTED_AS_CONTENT_VERIFICATION,
      },
      null,
      2
    )
  );
}
