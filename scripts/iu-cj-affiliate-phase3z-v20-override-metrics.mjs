#!/usr/bin/env node
/**
 * V20 — precise override / VERIFIED_SAFE_CHANGE metrics (no ambiguous double-counting).
 *
 * Definitions:
 *  OVERRIDE_APPLIED            — merchant evidence override present for advertiser
 *  CATEGORY_CHANGE_RECOMMENDED — override target != published section
 *  CATEGORY_CHANGE_APPROVED    — recommended + high confidence + not blocked by hysteresis policy
 *  CATEGORY_CHANGE_PUBLISHED   — published section already equals override target (or was moved)
 *  CATEGORY_UNCHANGED          — published equals registry/current with no pending move
 *
 * VERIFIED_SAFE_CHANGE (legacy V18 dry-run label) ≡ OVERRIDE_APPLIED.
 * It is NOT a count of category moves.
 */
import { MERCHANT_EVIDENCE_OVERRIDES } from "./iu-cj-affiliate-phase3z-merchant-evidence-v9.mjs";

export const OVERRIDE_METRIC_DEFS = Object.freeze({
  OVERRIDE_APPLIED:
    "Merchant evidence override record exists for advertiserId (independent of whether a move is needed).",
  CATEGORY_CHANGE_RECOMMENDED: "Override primary section differs from currently published section.",
  CATEGORY_CHANGE_APPROVED:
    "Recommended change has high confidence and is allowed past hysteresis (publish gate).",
  CATEGORY_CHANGE_PUBLISHED: "Published catalog section already matches override primary section.",
  CATEGORY_UNCHANGED: "No recommended section change relative to published.",
  VERIFIED_SAFE_CHANGE_LEGACY:
    "V18 dry-run synonym for OVERRIDE_APPLIED — NOT a pending or executed category move.",
});

export function classifyOverridePartner({ advertiserId, publishedSectionId = null, override = null } = {}) {
  const id = String(advertiserId || "");
  const ev = override || MERCHANT_EVIDENCE_OVERRIDES[id] || null;
  if (!ev) {
    return {
      advertiserId: id,
      OVERRIDE_APPLIED: false,
      CATEGORY_CHANGE_RECOMMENDED: false,
      CATEGORY_CHANGE_APPROVED: false,
      CATEGORY_CHANGE_PUBLISHED: false,
      CATEGORY_UNCHANGED: true,
      VERIFIED_SAFE_CHANGE_LEGACY: false,
      kind: "NO_OVERRIDE",
      targetSection: null,
      publishedSectionId,
    };
  }
  const target = ev.primaryAssortment?.sectionId || null;
  const published = publishedSectionId || null;
  const matches = Boolean(target && published && target === published);
  const recommended = Boolean(target && published && target !== published);
  const noButton = !published;
  let kind = "OVERRIDE_ALREADY_MATCHES_PUBLISHED";
  if (noButton) kind = "OVERRIDE_NO_PUBLIC_BUTTON";
  else if (recommended) kind = "OVERRIDE_RECOMMENDS_CHANGE";
  return {
    advertiserId: id,
    OVERRIDE_APPLIED: true,
    CATEGORY_CHANGE_RECOMMENDED: recommended,
    CATEGORY_CHANGE_APPROVED: false, // V20: never auto-approve without separate gate
    CATEGORY_CHANGE_PUBLISHED: matches,
    CATEGORY_UNCHANGED: matches || noButton,
    VERIFIED_SAFE_CHANGE_LEGACY: true,
    kind,
    targetSection: target,
    publishedSectionId: published,
  };
}

/**
 * Reconcile V18-style kind buckets. kindSum MUST equal unique OVERRIDE_APPLIED count.
 */
export function reconcileOverrideMetrics(rows = []) {
  const applied = rows.filter((r) => r.OVERRIDE_APPLIED);
  const byKind = {};
  for (const r of applied) {
    byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  }
  const kindSum = Object.values(byKind).reduce((a, b) => a + b, 0);
  const uniqueIds = new Set(applied.map((r) => r.advertiserId));
  return {
    OVERRIDE_APPLIED: applied.length,
    uniqueAdvertiserIds: uniqueIds.size,
    byKind,
    kindSum,
    CATEGORY_CHANGE_RECOMMENDED: applied.filter((r) => r.CATEGORY_CHANGE_RECOMMENDED).length,
    CATEGORY_CHANGE_APPROVED: applied.filter((r) => r.CATEGORY_CHANGE_APPROVED).length,
    CATEGORY_CHANGE_PUBLISHED: applied.filter((r) => r.CATEGORY_CHANGE_PUBLISHED).length,
    CATEGORY_UNCHANGED: applied.filter((r) => r.CATEGORY_UNCHANGED).length,
    VERIFIED_SAFE_CHANGE_LEGACY: applied.length,
    consistent: kindSum === applied.length && uniqueIds.size === applied.length,
    v18DiscrepancyExplained:
      "V18 reported VERIFIED_SAFE_CHANGE=26 from dry-run label filter, but OVERRIDE_APPLIED partners were 27 (kindSum 23+1+3). Correct unique override count is OVERRIDE_APPLIED.",
  };
}

export function buildAllOverrideMetrics(publishedById = new Map()) {
  const rows = Object.keys(MERCHANT_EVIDENCE_OVERRIDES).map((id) =>
    classifyOverridePartner({
      advertiserId: id,
      publishedSectionId: publishedById.get(id) || null,
    })
  );
  return { rows, summary: reconcileOverrideMetrics(rows), defs: OVERRIDE_METRIC_DEFS };
}
