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

function classifyProbe(probe, opts = {}) {
  const tiers = [];
  const status = probe.httpStatus;
  const err = String(probe.error || "");
  if (probe.ok && status >= 200 && status < 300) tiers.push("HTTP_REACHABLE");
  if (status >= 300 && status < 400) tiers.push("HTTP_REACHABLE"); // provisional
  if (opts.redirectFollowed && probe.ok) tiers.push("REDIRECT_RESOLVED");
  if (probe.title || (probe.assortmentEvidence && (probe.assortmentEvidence.significantGroups || []).length)) {
    tiers.push("CONTENT_FETCHED");
  }
  const sig = probe.assortmentEvidence?.significantGroups || [];
  if (sig.length > 0) tiers.push("ASSORTMENT_EVIDENCE_EXTRACTED");
  if (opts.merchantIdentityVerified) tiers.push("MERCHANT_IDENTITY_VERIFIED");
  if (
    tiers.includes("CONTENT_FETCHED") &&
    (tiers.includes("ASSORTMENT_EVIDENCE_EXTRACTED") || (probe.title && String(probe.title).length >= 3))
  ) {
    tiers.push("CONTENT_REVIEW_COMPLETED");
  }
  if (!probe.ok || /timeout|blocked|403|451|captcha|cloudflare|ECONN|ENOTFOUND|cert/i.test(err)) {
    if (!tiers.includes("CONTENT_REVIEW_COMPLETED")) tiers.push("BLOCKED_OR_UNAVAILABLE");
  }
  // Redirect-only without content is NOT content review.
  if (status >= 300 && status < 400 && !probe.title && !(sig.length > 0)) {
    return {
      tiers: ["HTTP_REACHABLE", "BLOCKED_OR_UNAVAILABLE"],
      contentReviewCompleted: false,
      note: "redirect_without_content_body",
    };
  }
  return {
    tiers: [...new Set(tiers)],
    contentReviewCompleted: tiers.includes("CONTENT_REVIEW_COMPLETED"),
    note: null,
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

  const contentVerified = results.filter((r) => r.contentReviewCompleted).length;
  const blocked = results.filter((r) => (r.tiers || []).includes("BLOCKED_OR_UNAVAILABLE")).length;
  const redirectOnly = results.filter((r) => r.note === "redirect_without_content_body").length;

  return {
    schema: CONTENT_PROBE_SCHEMA,
    generatedAt: new Date().toISOString(),
    counts: {
      partners: results.length,
      contentReviewCompleted: contentVerified,
      blockedOrUnavailable: blocked,
      redirectWithoutContent: redirectOnly,
      httpReachable: results.filter((r) => (r.tiers || []).includes("HTTP_REACHABLE")).length,
      assortmentExtracted: results.filter((r) =>
        (r.tiers || []).includes("ASSORTMENT_EVIDENCE_EXTRACTED")
      ).length,
    },
    HTTP_REDIRECTS_NOT_COUNTED_AS_CONTENT_VERIFICATION: true,
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
