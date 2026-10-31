#!/usr/bin/env node
/**
 * Rebuild independent golden dataset JSON for all JOINED partners.
 * Overrides win over prior JSON expected sections (never copy robot button → expected).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadIndependentGoldenDatasetV9 } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

const stagingPath =
  process.env.IU_CJ_PHASE3Z_STAGING_PATH ||
  path.join(ROOT, "projects", "data", "iu-affiliate-cj-staging-v1.json");
const reviewPath =
  process.env.IU_CJ_PHASE3Z_REVIEW_PATH ||
  path.join(ROOT, "projects", "data", "iu-affiliate-cj-merchant-review-v9-final.json");
const outPath =
  process.env.IU_CJ_PHASE3Z_GOLDEN_OUT ||
  path.join(ROOT, "projects", "data", "iu-affiliate-cj-golden-dataset-v9-final.json");

const staging = readJson(stagingPath, null);
const prior = readJson(outPath, null);
const review = readJson(reviewPath, null);
const joined = (staging?.advertisers || []).filter(
  (a) => String(a.relationshipStatus || "").toLowerCase() === "joined"
);
const loaded = loadIndependentGoldenDatasetV9({ root: ROOT, joinedAdvertisers: joined });
const reviewByCid = new Map((review?.partners || []).map((p) => [String(p.advertiserCid), p]));
const priorByCid = new Map((prior?.records || []).map((r) => [String(r.advertiserCid), r]));

const records = loaded.records.map((g) => {
  const prev = priorByCid.get(g.advertiserCid) || {};
  const row = reviewByCid.get(g.advertiserCid) || {};
  const evidenceSources = [
    ...new Set([
      ...(g.evidenceSources || []),
      ...(prev.evidenceSources || []).filter((s) => !String(s).startsWith("robot_button:")),
      ...(row.evidenceSources || []).filter((s) => !String(s).startsWith("nav_hint:") || g.fromOverride),
      g.fromOverride ? "override_authoritative_section" : "independent_golden_json",
    ]),
  ].slice(0, 24);
  return {
    advertiserCid: g.advertiserCid,
    merchantIdentity: g.merchantIdentity || prev.merchantIdentity || row.merchantIdentity || null,
    merchantType: g.expectedMerchantType || prev.merchantType || row.merchantType || null,
    primaryAssortment: g.expectedPrimarySectionId
      ? {
          sectionId: g.expectedPrimarySectionId,
          group: row.primaryAssortment?.group || prev.primaryAssortment?.group || null,
        }
      : null,
    secondaryAssortments: prev.secondaryAssortments || row.secondaryAssortments || [],
    expectedSectionId: g.expectedPrimarySectionId,
    allowedMainLinkId: prev.allowedMainLinkId || row.selectedLinkId || null,
    suitableDestination: prev.suitableDestination || row.selectedDestination || null,
    forbiddenDestinationTypes:
      g.rejectDestinationTypes?.length
        ? g.rejectDestinationTypes
        : prev.forbiddenDestinationTypes || [
            "CHECKOUT",
            "CART",
            "AFFILIATE_SIGNUP",
            "NEWSLETTER",
            "LOGIN",
            "REGISTRATION",
            "EXTERNAL_TRACKER",
          ],
    rejectSectionIds: g.rejectSectionIds || [],
    preferCategoryReview: !!g.preferCategoryReview,
    regionalAuthorization: row.czAvailability || prev.regionalAuthorization || "UNKNOWN",
    evidenceSources,
    reviewedAt: new Date().toISOString(),
    expectedVerdict: g.preferCategoryReview
      ? "CATEGORY_REVIEW"
      : row.publicationReady
        ? "READY"
        : row.reviewStatus || prev.expectedVerdict || "REVIEW",
    independentOfRobotCopy: true,
    fromOverride: !!g.fromOverride,
    contentEvidence: {
      probeOk: row.merchantWebsiteEvidence?.probe?.ok ?? prev.contentEvidence?.probeOk ?? null,
      probeHttpStatus: row.merchantWebsiteEvidence?.probe?.httpStatus ?? null,
      probeTitle: row.merchantWebsiteEvidence?.probe?.title ?? null,
      navHints: row.officialNavigationEvidence || prev.contentEvidence?.navHints || [],
      reviewStatus: row.reviewStatus || null,
      destinationType: row.destinationType || null,
    },
    note: g.rationale || prev.note || null,
  };
});

const out = {
  schema: "iu-cj-golden-dataset-v9-final",
  generatedAt: new Date().toISOString(),
  coverage: records.length,
  overrideCount: records.filter((r) => r.fromOverride).length,
  snapshot: {
    stagingGeneratedAt: staging?.generatedAt || null,
    websitePid: String(process.env.IU_CJ_WEBSITE_PID || "101883843"),
    cjLinksInSnapshot: Array.isArray(staging?.links) ? staging.links.length : staging?.linkCount || null,
    note: "Independent golden: overrides authoritative; never copies robot button section into expected.",
  },
  sectionTruthCorrections: records.filter((r) => r.fromOverride && r.expectedSectionId).length,
  independentEvidenceRule:
    "Each record must include official_domain and/or probe_title/nav_hint — registry/cj_staging alone is insufficient. Override expected sections never rewritten from robot output.",
  records,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(
  JSON.stringify({
    ok: true,
    outPath,
    coverage: out.coverage,
    overrideCount: out.overrideCount,
    argos: records.find((r) => r.advertiserCid === "8010554")?.expectedSectionId,
    leo: records.find((r) => r.advertiserCid === "6130482")?.expectedSectionId,
  })
);
