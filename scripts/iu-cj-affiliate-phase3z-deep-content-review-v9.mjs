#!/usr/bin/env node
/**
 * Phase 3Z V9 — deep-content merchant review for all JOINED partners.
 * Uses weighted assortment evidence (title/nav/h1/main); never footer/cookie noise.
 * Does not invent READY: CONTENT_VERIFIED only when high-trust assortment signals exist
 * or curated merchant evidence override is present with successful probe.
 *
 * Env:
 *   IU_CJ_PHASE3Z_STAGING_PATH — staging JSON (required)
 *   IU_CJ_PHASE3Z_REGISTRY_PATH — optional partner registry for destination/publish fields
 *   IU_CJ_PHASE3Z_REVIEW_OUT — output path (default projects/data/iu-affiliate-cj-merchant-review-v9-final.json)
 *   IU_CJ_PHASE3Z_REVIEW_CONCURRENCY — default 3
 *   IU_CJ_PHASE3Z_REVIEW_SPACING_MS — default 400
 *   IU_CJ_PHASE3Z_REVIEW_LIMIT — 0 = all
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MERCHANT_EVIDENCE_OVERRIDES,
  probeMerchantHomepage,
  extractWeightedAssortmentEvidence,
  classifyDestinationType,
  GOLDEN_DATASET_V9,
} from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hostOf(url) {
  try {
    return new URL(String(url).startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export async function buildDeepContentReview({
  staging,
  registry = null,
  concurrency = 3,
  spacingMs = 400,
  limit = 0,
  websitePid = "101883843",
} = {}) {
  const joined = (staging?.advertisers || []).filter(
    (a) => String(a.relationshipStatus || "").toLowerCase() === "joined"
  );
  const regById = new Map((registry?.partners || []).map((p) => [String(p.advertiserId), p]));
  const max = limit > 0 ? Math.min(joined.length, limit) : joined.length;
  const queue = joined.slice(0, max);
  const results = new Array(queue.length);
  let i = 0;

  async function worker() {
    while (i < queue.length) {
      const idx = i++;
      const adv = queue[idx];
      const advertiserCid = String(adv.advertiserId || "");
      const ov = MERCHANT_EVIDENCE_OVERRIDES[advertiserCid] || null;
      const reg = regById.get(advertiserCid) || null;
      const programUrl = String(adv.programUrl || ov?.officialDomains?.[0] || "");
      const probeUrl = programUrl
        ? programUrl.startsWith("http")
          ? programUrl
          : "https://" + programUrl
        : "";
      let probe = null;
      if (probeUrl) {
        probe = await probeMerchantHomepage(probeUrl, {
          timeoutMs: 10000,
          merchantIdentity: ov?.merchantIdentity || adv.advertiserName || null,
        });
        if (spacingMs) await sleep(spacingMs);
      }
      const evidence = probe?.assortmentEvidence || null;
      const navHints = (evidence?.significantGroups || []).map((g) => g.group);
      const contentVerified =
        evidence?.contentVerified === true ||
        (ov && probe?.ok === true && Boolean(probe?.title));
      // WAF/403: identity only — never CONTENT_VERIFIED.
      const waf =
        probe && (probe.httpStatus === 403 || String(probe.error || "").includes("403"));
      let reviewStatus = "NOT_VERIFIED";
      let grade = "NOT_VERIFIED";
      const blockers = [];
      if (waf && ov) {
        reviewStatus = "IDENTITY_VERIFIED_WAF";
        grade = "IDENTITY_VERIFIED_WAF";
        blockers.push("http_403_bot_waf_suspected");
      } else if (contentVerified) {
        reviewStatus = "CONTENT_VERIFIED";
        grade = "CONTENT_VERIFIED";
      } else if (probe?.ok && probe?.title && !evidence?.contentVerified) {
        reviewStatus = "IDENTITY_VERIFIED";
        grade = "IDENTITY_TITLE_ONLY";
        blockers.push("assortment_not_significant_from_high_trust_regions");
      } else if (!probeUrl) {
        blockers.push("missing_program_url");
      } else if (probe?.error) {
        blockers.push("probe_error:" + probe.error);
      } else {
        blockers.push("insufficient_website_evidence");
      }

      const dest = reg?.selectedDestination || null;
      const destinationType =
        reg?.destinationType || (dest ? classifyDestinationType(dest, reg?.selectedLinkName || "") : null);

      results[idx] = {
        advertiserCid,
        merchantIdentity: ov?.merchantIdentity || adv.advertiserName || null,
        advertiserCidBound: true,
        officialDomains: ov?.officialDomains || (hostOf(programUrl) ? [hostOf(programUrl)] : []),
        brandDomains: ov?.brandDomains || [],
        merchantType: ov?.merchantType || reg?.merchantType || null,
        primaryAssortment:
          ov?.primaryAssortment ||
          evidence?.primaryAssortment ||
          reg?.assortmentProfile?.primaryAssortment ||
          null,
        secondaryAssortments:
          ov?.secondaryAssortments ||
          evidence?.secondaryAssortments ||
          (reg?.assortmentProfile?.secondaryAssortment
            ? [reg.assortmentProfile.secondaryAssortment]
            : []),
        significantAssortmentGroups:
          ov?.significantAssortmentGroups ||
          (evidence?.significantGroups || []).map((g) => g.group) ||
          [],
        officialNavigationEvidence: navHints,
        merchantWebsiteEvidence: {
          programUrl: programUrl || null,
          probe: probe
            ? {
                url: probe.url,
                ok: probe.ok,
                httpStatus: probe.httpStatus,
                title: probe.title,
                navHints,
                assortmentEvidence: evidence
                  ? {
                      contentVerified: evidence.contentVerified,
                      primaryAssortment: evidence.primaryAssortment,
                      significantGroups: evidence.significantGroups,
                      regionsUsed: evidence.regionsUsed,
                      note: evidence.note,
                    }
                  : null,
                error: probe.error,
                fetchedAt: probe.fetchedAt,
              }
            : null,
          grade,
        },
        czAvailability: ov?.czAffinityOverride ? "YES" : "UNKNOWN",
        confidence: ov?.confidence || (contentVerified ? "medium" : "low"),
        lastReviewedAt: new Date().toISOString(),
        reviewStatus,
        reviewBlockers: blockers,
        expectedSectionId: ov?.primaryAssortment?.sectionId || reg?.sectionId || null,
        selectedLinkId: reg?.selectedLinkId || null,
        selectedDestination: dest,
        destinationType,
        publishability: reg?.publishability || null,
        holdReason: reg?.holdReason || null,
        taxonomyGap: ov?.taxonomyGap || null,
        evidenceSources: [
          ...(ov?.evidenceSources || []),
          ...(probe?.title ? ["probe_title:" + probe.title] : []),
          ...(probe?.httpStatus != null ? ["probe_http:" + probe.httpStatus] : []),
          ...navHints.map((h) => "nav_hint:" + h),
          "weighted_assortment_evidence_v9",
          "snapshot:stagingGeneratedAt:" + String(staging?.generatedAt || ""),
        ],
        sectionTruthApplied: Boolean(ov?.primaryAssortment?.sectionId),
        sectionTruthReason: ov?.rationale || null,
      };
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, () => worker());
  await Promise.all(workers);

  const contentVerifiedCount = results.filter((r) => r.reviewStatus === "CONTENT_VERIFIED").length;
  const notContentVerified = results.filter((r) => r.reviewStatus !== "CONTENT_VERIFIED");

  // Golden / override section truth coverage
  const golden = GOLDEN_DATASET_V9.map((g) => {
    const row = results.find((r) => r.advertiserCid === g.advertiserCid);
    const actual = row?.expectedSectionId || row?.primaryAssortment?.sectionId || null;
    const match =
      g.preferCategoryReview
        ? actual == null || g.expectedPrimarySectionId == null
        : actual === g.expectedPrimarySectionId;
    return {
      advertiserCid: g.advertiserCid,
      merchantIdentity: g.merchantIdentity,
      expected: g.expectedPrimarySectionId,
      actual,
      match,
      preferCategoryReview: g.preferCategoryReview,
    };
  });

  return {
    schema: "iu-cj-merchant-review-v9-final",
    generatedAt: new Date().toISOString(),
    stagingGeneratedAt: staging?.generatedAt || null,
    websitePid,
    total: results.length,
    sectionTruthCorrections: golden.filter((g) => g.match).length,
    sectionTruthTotal: golden.length,
    contentVerified: contentVerifiedCount,
    notContentVerified: notContentVerified.length,
    partners: results,
    goldenSectionTruth: golden,
    note: "Weighted title/nav/h1/main assortment; footer/cookie/ads stripped. CONTENT_VERIFIED requires high-trust signals.",
  };
}

async function main() {
  const stagingPath =
    process.env.IU_CJ_PHASE3Z_STAGING_PATH ||
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-staging-v1.json");
  const registryPath =
    process.env.IU_CJ_PHASE3Z_REGISTRY_PATH ||
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json");
  const outPath =
    process.env.IU_CJ_PHASE3Z_REVIEW_OUT ||
    path.join(ROOT, "projects", "data", "iu-affiliate-cj-merchant-review-v9-final.json");
  const staging = readJson(stagingPath, null);
  if (!staging?.advertisers?.length) {
    console.error(JSON.stringify({ ok: false, reason: "STAGING_EMPTY", stagingPath }));
    process.exit(1);
  }
  const registry = readJson(registryPath, null);
  const review = await buildDeepContentReview({
    staging,
    registry,
    concurrency: Number(process.env.IU_CJ_PHASE3Z_REVIEW_CONCURRENCY || 3),
    spacingMs: Number(process.env.IU_CJ_PHASE3Z_REVIEW_SPACING_MS || 400),
    limit: Number(process.env.IU_CJ_PHASE3Z_REVIEW_LIMIT || 0) || 0,
    websitePid: String(process.env.IU_CJ_WEBSITE_PID || "101883843"),
  });
  writeJson(outPath, review);
  console.log(
    JSON.stringify({
      ok: true,
      outPath,
      total: review.total,
      contentVerified: review.contentVerified,
      notContentVerified: review.notContentVerified,
      sectionTruth: review.sectionTruthCorrections + "/" + review.sectionTruthTotal,
      abbyy: review.partners.find((p) => p.advertiserCid === "2624620")?.officialNavigationEvidence,
      paragon: review.partners.find((p) => p.advertiserCid === "4686326")?.officialNavigationEvidence,
      argos: review.partners.find((p) => p.advertiserCid === "8010554")?.officialNavigationEvidence,
    })
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
