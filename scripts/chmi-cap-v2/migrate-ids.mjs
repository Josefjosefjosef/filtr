/**
 * Migration of legacy ie-chmi-* user states → stable v2 ids (dry-run safe).
 */
import { foldCs } from "../iu-info-events-lib.mjs";

/**
 * @typedef {'certain'|'probable'|'ambiguous'|'none'} MatchConfidence
 */

/**
 * @param {object} legacyItem — old feed item
 * @param {object[]} v2Items — new normalized items
 * @returns {{ confidence: MatchConfidence, v2Id: string|null, reasons: string[] }}
 */
export function matchLegacyToV2(legacyItem, v2Items) {
  const reasons = [];
  const legId = String(legacyItem.id || "");
  const legTitle = foldCs(legacyItem.title || "");
  const legRegion = foldCs((legacyItem.region && legacyItem.region.name) || "");
  const legSent = String(legacyItem.publishedAtSource || legacyItem.publishedAt || "").slice(0, 16);
  const legIdent =
    (legacyItem.identifier && String(legacyItem.identifier)) ||
    (String(legacyItem.url || "").match(/[?&]id=([^&]+)/) || [])[1] ||
    "";

  const candidates = [];
  for (const v of v2Items || []) {
    let score = 0;
    const rs = [];
    if (legIdent && String(v.capV2 && v.capV2.cap_message_id || "").includes(decodeURIComponent(legIdent))) {
      score += 5;
      rs.push("identifier");
    }
    const vt = foldCs(v.title || "");
    if (legTitle && vt && (vt.includes(legTitle.slice(0, 40)) || legTitle.includes(vt.slice(0, 40)))) {
      score += 2;
      rs.push("title");
    }
    const vr = foldCs((v.region && v.region.name) || "");
    if (legRegion && vr && (vr.includes(legRegion) || legRegion.includes(vr))) {
      score += 2;
      rs.push("region");
    }
    const vs = String(v.publishedAtSource || v.publishedAt || "").slice(0, 16);
    if (legSent && vs && legSent === vs) {
      score += 1;
      rs.push("time");
    }
    if (String(v.sourceId) === "chmi" && String(legacyItem.sourceId) === "chmi") {
      score += 1;
      rs.push("source");
    }
    if (score > 0) candidates.push({ v, score, rs });
  }

  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return { confidence: "none", v2Id: null, reasons: ["no_candidate"], legacyId: legId };
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return {
      confidence: "ambiguous",
      v2Id: null,
      reasons: ["tied_score", ...candidates[0].rs],
      legacyId: legId,
      tied: candidates.slice(0, 3).map((c) => c.v.id),
    };
  }
  const top = candidates[0];
  if (top.score >= 6 || (top.rs.includes("identifier") && top.score >= 5)) {
    return { confidence: "certain", v2Id: top.v.id, reasons: top.rs, legacyId: legId, score: top.score };
  }
  if (top.score >= 4) {
    return { confidence: "probable", v2Id: top.v.id, reasons: top.rs, legacyId: legId, score: top.score };
  }
  return { confidence: "ambiguous", v2Id: null, reasons: ["low_score", ...top.rs], legacyId: legId, score: top.score };
}

/**
 * Dry-run migration of localStorage-like state maps.
 * @param {{ read: string[], saved: string[], hidden: string[] }} legacyStates
 * @param {object[]} legacyItems
 * @param {object[]} v2Items
 * @param {{ applyProbable?: boolean }} [opts]
 */
export function migrateUserStatesDryRun(legacyStates, legacyItems, v2Items, opts = {}) {
  const applyProbable = !!opts.applyProbable;
  const byId = new Map((legacyItems || []).map((i) => [i.id, i]));
  const audit = [];
  const next = { read: new Set(), saved: new Set(), hidden: new Set() };
  const counts = {
    certain: 0,
    probable: 0,
    ambiguous: 0,
    none: 0,
    preservedUnmapped: 0,
  };

  function mapSet(kind, ids) {
    for (const id of ids || []) {
      const item = byId.get(id);
      if (!item) {
        next[kind].add(id);
        counts.preservedUnmapped += 1;
        audit.push({ kind, legacyId: id, confidence: "none", action: "preserve_orphan" });
        continue;
      }
      const m = matchLegacyToV2(item, v2Items);
      counts[m.confidence] += 1;
      if (m.confidence === "certain" || (m.confidence === "probable" && applyProbable)) {
        next[kind].add(m.v2Id);
        audit.push({ kind, legacyId: id, v2Id: m.v2Id, confidence: m.confidence, action: "map", reasons: m.reasons });
      } else {
        next[kind].add(id);
        audit.push({ kind, legacyId: id, v2Id: null, confidence: m.confidence, action: "keep_legacy", reasons: m.reasons });
      }
    }
  }

  mapSet("read", legacyStates.read || []);
  mapSet("saved", legacyStates.saved || []);
  mapSet("hidden", legacyStates.hidden || []);

  return {
    dryRun: true,
    counts,
    before: {
      read: (legacyStates.read || []).length,
      saved: (legacyStates.saved || []).length,
      hidden: (legacyStates.hidden || []).length,
    },
    after: {
      read: next.read.size,
      saved: next.saved.size,
      hidden: next.hidden.size,
    },
    next: {
      read: [...next.read],
      saved: [...next.saved],
      hidden: [...next.hidden],
    },
    audit,
    rollback: "discard next; keep legacy localStorage keys unchanged",
  };
}
