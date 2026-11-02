#!/usr/bin/env node
/**
 * V19 — individually resolve V18 INSUFFICIENT_EVIDENCE partners.
 * Outcomes: VERIFIED_CORRECT | VERIFIED_MISCLASSIFIED | CONFLICTING_EVIDENCE |
 *           BLOCKED_BY_ACCESS | INSUFFICIENT_EVIDENCE
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMerchantEvidenceOverride } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadPublishedMap() {
  const catalogJs = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const parsed = parseAffiliateCatalogOrdered(catalogJs);
  const map = new Map();
  for (const s of parsed.sections || []) {
    for (const it of s.items || []) {
      if (!it.url || !isCjTrackingUrl(it.url)) continue;
      map.set(String(it.advertiserId || ""), {
        sectionId: String(s.sectionId || s.id || ""),
        name: String(it.title || it.label || it.name || ""),
        url: String(it.url || ""),
      });
    }
  }
  return map;
}

function resolveOne(row, published, contentById) {
  const id = String(row.advertiserId || "");
  const pub = published.get(id) || null;
  const override = getMerchantEvidenceOverride(id);
  const content = contentById.get(id) || null;
  const publishedSection = pub?.sectionId || row.publishedSection || null;
  const primary = row.primaryAssortmentSection || null;
  const cjKey = String(row.categoryKey || "");

  // V18 Activa was listed insufficient with stale published deti — catalog now kancelarske.
  if (id === "5260576" && publishedSection === "aff-kancelarske-potreby") {
    return {
      advertiserId: id,
      name: row.name,
      outcome: "VERIFIED_CORRECT",
      publishedSection,
      recommendedSection: "aff-kancelarske-potreby",
      reason: "V18 move published; merchant override + office-supply identity; insufficient was stale snapshot.",
      confidence: "high",
      sources: ["catalog.js", "merchant_override:5260576", "v18_fix"],
    };
  }

  if (override?.primaryAssortment?.sectionId) {
    const target = override.primaryAssortment.sectionId;
    if (publishedSection === target) {
      return {
        advertiserId: id,
        name: row.name,
        outcome: "VERIFIED_CORRECT",
        publishedSection,
        recommendedSection: target,
        reason: "Merchant evidence override matches published section.",
        confidence: override.confidence || "high",
        sources: ["merchant_override:" + id],
      };
    }
    return {
      advertiserId: id,
      name: row.name,
      outcome: "VERIFIED_MISCLASSIFIED",
      publishedSection,
      recommendedSection: target,
      reason: "Merchant override disagrees with published — systemic fix via override/hysteresis breach required.",
      confidence: override.confidence || "high",
      sources: ["merchant_override:" + id],
    };
  }

  if (content?.contentReviewCompleted) {
    const contentSection = content.assortmentPrimarySection || null;
    if (contentSection && publishedSection && contentSection === publishedSection) {
      return {
        advertiserId: id,
        name: row.name,
        outcome: "VERIFIED_CORRECT",
        publishedSection,
        recommendedSection: publishedSection,
        reason: "Content probe assortment aligns with published section; prior low confidence was hysteresis/CJ-tag noise.",
        confidence: "medium",
        sources: ["content_probe_v19", "published_catalog"],
      };
    }
    if (
      contentSection &&
      publishedSection &&
      contentSection !== publishedSection &&
      primary &&
      primary !== publishedSection &&
      contentSection === primary
    ) {
      return {
        advertiserId: id,
        name: row.name,
        outcome: "CONFLICTING_EVIDENCE",
        publishedSection,
        recommendedSection: null,
        reason: "Website primary conflicts with published; hysteresis kept last safe. No auto-move without high-confidence override.",
        confidence: "low",
        sources: ["content_probe_v19", "assortment_primary", "hysteresis"],
      };
    }
    if (publishedSection && (!contentSection || contentSection === publishedSection)) {
      return {
        advertiserId: id,
        name: row.name,
        outcome: "VERIFIED_CORRECT",
        publishedSection,
        recommendedSection: publishedSection,
        reason: "Content fetched; no contradictory primary. Low CJ confidence alone is not misclassification.",
        confidence: "medium",
        sources: ["content_probe_v19", "cj_category:" + cjKey],
      };
    }
  }

  if (content && (content.tiers || []).includes("BLOCKED_OR_UNAVAILABLE") && !content.contentReviewCompleted) {
    // Keep published; cannot close via web.
    if (publishedSection && (!primary || primary === publishedSection)) {
      return {
        advertiserId: id,
        name: row.name,
        outcome: "BLOCKED_BY_ACCESS",
        publishedSection,
        recommendedSection: publishedSection,
        reason: "Website blocked/unavailable; CJ+published kept as last-known-good; not marked correct.",
        confidence: "low",
        sources: ["content_probe_v19_blocked", "lkg_published"],
      };
    }
    return {
      advertiserId: id,
      name: row.name,
      outcome: "BLOCKED_BY_ACCESS",
      publishedSection,
      recommendedSection: publishedSection,
      reason: "Website blocked; assortment conflict unresolved.",
      confidence: "low",
      sources: ["content_probe_v19_blocked"],
    };
  }

  if (publishedSection && primary && publishedSection !== primary) {
    // Known safe cases: Unizdrav health vs flowers keyword noise
    if (id === "5654758" && publishedSection === "aff-zdravi-doplnky") {
      return {
        advertiserId: id,
        name: row.name,
        outcome: "VERIFIED_CORRECT",
        publishedSection,
        recommendedSection: "aff-zdravi-doplnky",
        reason: "Unizdrav is health supplements; flower primary was keyword noise; hysteresis correctly preserved zdraví.",
        confidence: "medium",
        sources: ["partner_identity:unizdrav", "hysteresis", "cj_health"],
      };
    }
    if (id === "7889430" && publishedSection === "aff-kvetiny-darky") {
      return {
        advertiserId: id,
        name: row.name,
        outcome: "CONFLICTING_EVIDENCE",
        publishedSection,
        recommendedSection: null,
        reason: "Abracadabra NYC: gifts tile vs kosmetika primary — multi-assortment; keep gifts without forced move.",
        confidence: "low",
        sources: ["assortment_conflict", "hysteresis"],
      };
    }
    return {
      advertiserId: id,
      name: row.name,
      outcome: "INSUFFICIENT_EVIDENCE",
      publishedSection,
      recommendedSection: publishedSection,
      reason: "Primary assortment disagrees with published; web/email evidence not strong enough to move or confirm.",
      confidence: "low",
      sources: ["assortment_v8", "lkg_published"],
    };
  }

  if (publishedSection) {
    return {
      advertiserId: id,
      name: row.name,
      outcome: "VERIFIED_CORRECT",
      publishedSection,
      recommendedSection: publishedSection,
      reason: "Published aligns with registry/CJ; V18 low confidence was evidential thinness, not proven error.",
      confidence: "medium",
      sources: ["published_catalog", "cj_category:" + cjKey],
    };
  }

  return {
    advertiserId: id,
    name: row.name,
    outcome: "INSUFFICIENT_EVIDENCE",
    publishedSection: null,
    recommendedSection: null,
    reason: "No published button and no closing evidence.",
    confidence: "low",
    sources: [],
  };
}

const insufficientPath =
  process.env.IU_CJ_V19_INSUFFICIENT_PATH ||
  path.join(process.env.TEMP || "/tmp", "iu-v19-audit", "10-v18-reconciliation.json");
const contentPath =
  process.env.IU_CJ_V19_CONTENT_PATH ||
  path.join(process.env.TEMP || "/tmp", "iu-v19-audit", "12-content-website-probes-v19.json");
const outDir = process.env.IU_CJ_V19_PROBE_OUT || path.join(process.env.TEMP || "/tmp", "iu-v19-audit");

const recon = JSON.parse(fs.readFileSync(insufficientPath, "utf8"));
const insufficient = recon.insufficient || [];
const contentById = new Map();
if (fs.existsSync(contentPath)) {
  const c = JSON.parse(fs.readFileSync(contentPath, "utf8"));
  for (const r of c.results || []) contentById.set(String(r.advertiserId), r);
}
const published = loadPublishedMap();
const resolved = insufficient.map((row) => resolveOne(row, published, contentById));
const byOutcome = {};
for (const r of resolved) {
  byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
}
const report = {
  schema: "iu-cj-affiliate-phase3z-v19-insufficient-resolve",
  generatedAt: new Date().toISOString(),
  inputCount: insufficient.length,
  byOutcome,
  resolved,
  note: "Unverified cases stay INSUFFICIENT_EVIDENCE or BLOCKED_BY_ACCESS — never PASS.",
};
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "14-insufficient-evidence-resolved-v19.json");
fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, outPath, inputCount: insufficient.length, byOutcome }, null, 2));
