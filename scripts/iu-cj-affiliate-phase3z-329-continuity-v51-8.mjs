#!/usr/bin/env node
/**
 * V51.8-c5 — reconstruct continuity for the original 329 miss identities.
 * Never equate different miss windows (329 vs 305 vs 170) as the same population.
 */
import fs from "node:fs";
import path from "node:path";

export const CONTINUITY_STATUS = Object.freeze({
  CURRENT_SOURCE_VERIFIED: "CURRENT_SOURCE_VERIFIED",
  CURRENT_LIVE: "CURRENT_LIVE",
  CURRENT_CATALOG_RETAINED: "CURRENT_CATALOG_RETAINED",
  CURRENT_PUBLICATION_HOLD: "CURRENT_PUBLICATION_HOLD",
  HISTORICALLY_RECOVERED: "HISTORICALLY_RECOVERED",
  CONFIRMED_REMOVED: "CONFIRMED_REMOVED",
  PARTNER_ENDED: "PARTNER_ENDED",
  IDENTITY_REKEYED_VERIFIED: "IDENTITY_REKEYED_VERIFIED",
  IDENTITY_COLLISION: "IDENTITY_COLLISION",
  HISTORICAL_ONLY: "HISTORICAL_ONLY",
  UNKNOWN: "UNKNOWN",
});

export function compoundKey(advertiserId, productId) {
  return String(advertiserId || "") + "|" + String(productId || "");
}

export function normalizeKey(k) {
  return String(k || "")
    .replace(/\|+/g, "|")
    .replace(/\/+$/, "")
    .trim()
    .toLowerCase();
}

function collectDocKeys(doc) {
  const map = new Map();
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      if (!p) continue;
      const raw = compoundKey(p.advertiserId, p.productId);
      const n = normalizeKey(raw);
      if (!map.has(n)) {
        map.set(n, {
          raw,
          product: p,
          hold:
            p.lkgPublicHold === true ||
            p.publicationEligibility === "PUBLICATION_HOLD" ||
            p.publicOffer === false,
          retained: p.lkgCarried === true || p.catalogStatus === "CATALOG_RETAINED",
        });
      }
    }
  }
  return map;
}

function collectMissKeys(missDoc) {
  const map = new Map();
  for (const r of missDoc?.rows || []) {
    const raw = r.compoundIdentity || r.sourceIdentity || compoundKey(r.advertiserId, r.productId);
    map.set(normalizeKey(raw), { raw, row: r });
  }
  return map;
}

/**
 * @param {object} input
 * @param {object} input.original329 — ledger with rows[]
 * @param {object} [input.liveDoc]
 * @param {object} [input.lkgDoc]
 * @param {object} [input.currentMiss]
 * @param {object[]} [input.historicalMissLedgers] — [{name,at,sha,rows|doc}]
 * @param {object[]} [input.historicalOffers] — [{name,at,sha,doc}]
 */
export function reconstruct329Continuity(input = {}) {
  const origRows = input.original329?.rows || [];
  const live = collectDocKeys(input.liveDoc);
  const lkg = collectDocKeys(input.lkgDoc);
  const curMiss = collectMissKeys(input.currentMiss);
  const histMiss = [];
  for (const h of input.historicalMissLedgers || []) {
    histMiss.push({
      name: h.name,
      at: h.at || null,
      sha: h.sha || null,
      keys: collectMissKeys(h.doc || h),
    });
  }
  const histOffers = [];
  for (const h of input.historicalOffers || []) {
    histOffers.push({
      name: h.name,
      at: h.at || null,
      sha: h.sha || null,
      keys: collectDocKeys(h.doc),
    });
  }

  const timelines = [];
  const counts = {
    CURRENT_LIVE: 0,
    CURRENT_PUBLICATION_HOLD: 0,
    CURRENT_CATALOG_RETAINED: 0,
    CURRENT_SOURCE_VERIFIED: 0,
    HISTORICALLY_RECOVERED: 0,
    HISTORICAL_ONLY: 0,
    IDENTITY_COLLISION: 0,
    CONFIRMED_REMOVED: 0,
    UNKNOWN: 0,
  };

  for (const r of origRows) {
    const raw = r.compoundIdentity || compoundKey(r.advertiserId, r.productId);
    const n = normalizeKey(raw);
    const liveHit = live.get(n) || null;
    const lkgHit = lkg.get(n) || null;
    const missHit = curMiss.get(n) || null;
    const histMissHits = histMiss
      .filter((h) => h.keys.has(n))
      .map((h) => ({ name: h.name, at: h.at, sha: h.sha, decision: h.keys.get(n)?.row?.decision }));
    const histOfferHits = histOffers
      .filter((h) => h.keys.has(n))
      .map((h) => ({ name: h.name, at: h.at, sha: h.sha }));

    let status = CONTINUITY_STATUS.UNKNOWN;
    let confidence = "low";
    if (liveHit) {
      if (liveHit.hold) {
        status = CONTINUITY_STATUS.CURRENT_PUBLICATION_HOLD;
        confidence = "high";
      } else if (liveHit.retained) {
        status = CONTINUITY_STATUS.CURRENT_CATALOG_RETAINED;
        confidence = "high";
      } else {
        status = CONTINUITY_STATUS.CURRENT_LIVE;
        confidence = "high";
      }
    } else if (missHit) {
      if (missHit.row?.decision === "HOLD_COLLISION") {
        status = CONTINUITY_STATUS.IDENTITY_COLLISION;
        confidence = "medium";
      } else if (missHit.row?.decision === "REMOVE_CONFIRMED") {
        status = CONTINUITY_STATUS.CONFIRMED_REMOVED;
        confidence = "high";
      } else if (r.decision === "RECOVERED" || missHit.row?.decision === "RECOVERED") {
        status = CONTINUITY_STATUS.HISTORICALLY_RECOVERED;
        confidence = "medium";
      } else {
        status = CONTINUITY_STATUS.CURRENT_SOURCE_VERIFIED;
        confidence = "medium";
      }
    } else if (lkgHit) {
      status = lkgHit.hold
        ? CONTINUITY_STATUS.CURRENT_PUBLICATION_HOLD
        : CONTINUITY_STATUS.CURRENT_CATALOG_RETAINED;
      confidence = "medium";
    } else if (histOfferHits.length || histMissHits.length) {
      status =
        r.decision === "RECOVERED"
          ? CONTINUITY_STATUS.HISTORICALLY_RECOVERED
          : CONTINUITY_STATUS.HISTORICAL_ONLY;
      confidence = "medium";
    } else if (r.decision === "RECOVERED") {
      // Recovered at ledger time but no longer locatable in available snapshots.
      status = CONTINUITY_STATUS.HISTORICALLY_RECOVERED;
      confidence = "low";
    }

    counts[status] = (counts[status] || 0) + 1;
    timelines.push({
      compoundIdentity: raw,
      advertiserId: r.advertiserId,
      productId: r.productId,
      originalDecision: r.decision || null,
      originalCause: r.cause || null,
      originalClassId: r.classId || null,
      continuityStatus: status,
      confidence,
      rootCauseVerified: r.cause && r.cause !== "CAUSE_NOT_YET_VERIFIED" && r.cause !== "UNKNOWN",
      evidence: {
        inLive: !!liveHit,
        inCurrentMiss: !!missHit,
        inLkgDoc: !!lkgHit,
        historicalMissHits: histMissHits,
        historicalOfferHits: histOfferHits,
      },
    });
  }

  const unknown = timelines.filter((t) => t.continuityStatus === CONTINUITY_STATUS.UNKNOWN);
  const rootVerified = timelines.filter((t) => t.rootCauseVerified === true);

  // Population metadata for semantic honesty
  const populations = {
    original329: {
      name: "original_329_unmatched_ledger",
      purpose: "historical_problem_set",
      uniqueIdentities: origRows.length,
      filter: "miss_ledger_v51_8_authoritative",
    },
    currentMiss: {
      name: "current_miss_ledger",
      purpose: "current_miss_window",
      uniqueIdentities: curMiss.size,
      filter: "latest_miss_products_v38",
      note: "NOT the same population as original329; do not subtract counts.",
    },
  };

  return {
    schema: "iu-cj-affiliate-phase3z-329-continuity-v51.8-c5",
    at: new Date().toISOString(),
    populations,
    summary: {
      originalCount: origRows.length,
      byStatus: counts,
      unknownCount: unknown.length,
      rootCausesVerifiedCount: rootVerified.length,
      historicallyPreserved: origRows.length,
      currentStatusVerified: timelines.filter((t) =>
        [
          CONTINUITY_STATUS.CURRENT_LIVE,
          CONTINUITY_STATUS.CURRENT_PUBLICATION_HOLD,
          CONTINUITY_STATUS.CURRENT_CATALOG_RETAINED,
          CONTINUITY_STATUS.CURRENT_SOURCE_VERIFIED,
          CONTINUITY_STATUS.CONFIRMED_REMOVED,
          CONTINUITY_STATUS.IDENTITY_COLLISION,
        ].includes(t.continuityStatus)
      ).length,
    },
    timelines,
  };
}

export function assertPopulationNotEquated(a, b) {
  if (!a || !b) return { ok: true, reason: "missing_population" };
  if (a.purpose && b.purpose && a.purpose !== b.purpose && a.uniqueIdentities !== b.uniqueIdentities) {
    return {
      ok: false,
      reason: "DISTINCT_POPULATIONS_MUST_NOT_BE_SUBTRACTED",
      a,
      b,
    };
  }
  return { ok: true };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` || process.argv[1]?.endsWith("329-continuity-v51-8.mjs")) {
  // optional CLI no-op
}
