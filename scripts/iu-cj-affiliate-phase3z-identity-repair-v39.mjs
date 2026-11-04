#!/usr/bin/env node
/**
 * V39 — safe identity repair for productIds miss probes.
 * productId is NOT globally unique across advertisers. Bare omitPartner hit on a
 * different advertiserId is a COLLISION, not proof of remapping.
 */
export const IDENTITY_REPAIR_DECISION = Object.freeze({
  APPLY_REMAP: "APPLY_REMAP",
  HOLD_COLLISION: "HOLD_COLLISION",
  HOLD_INSUFFICIENT_EVIDENCE: "HOLD_INSUFFICIENT_EVIDENCE",
  KEEP_PENDING: "KEEP_PENDING",
});

/**
 * Normalize title for weak similarity checks.
 */
export function normalizeTitle(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Token Jaccard similarity in [0,1].
 */
export function titleSimilarity(a, b) {
  const ta = new Set(normalizeTitle(a).split(/\s+/).filter((t) => t.length > 2));
  const tb = new Set(normalizeTitle(b).split(/\s+/).filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Decide whether a probe identityRepair may be applied.
 * @param {object} row miss audit row (or probe)
 * @param {object} opts
 * @param {Set<string>|string[]} [opts.joinedAdvertiserIds]
 * @param {string} [opts.probeTitle] title from CJ hit under new advertiser
 * @param {number} [opts.minTitleSimilarity=0.55]
 */
export function decideIdentityRepair(row = {}, opts = {}) {
  const repair = row.identityRepair || row.probe?.identityRepair || null;
  const oldAdv = String(repair?.oldAdvertiserId || row.advertiserId || "");
  const newAdv = String(repair?.newAdvertiserId || "");
  const oldPid = String(repair?.oldProductId || row.productId || "");
  const newPid = String(repair?.newProductId || row.productId || "");
  const joined = opts.joinedAdvertiserIds instanceof Set
    ? opts.joinedAdvertiserIds
    : new Set(opts.joinedAdvertiserIds || []);
  const minSim = Number.isFinite(opts.minTitleSimilarity) ? opts.minTitleSimilarity : 0.55;

  if (!repair || !oldAdv || !newAdv) {
    return {
      decision: IDENTITY_REPAIR_DECISION.HOLD_INSUFFICIENT_EVIDENCE,
      applyRemap: false,
      cause: "NO_REPAIR_PAYLOAD",
      note: "No identityRepair candidate — keep pending.",
    };
  }
  if (oldAdv === newAdv && oldPid === newPid) {
    return {
      decision: IDENTITY_REPAIR_DECISION.HOLD_INSUFFICIENT_EVIDENCE,
      applyRemap: false,
      cause: "NO_CHANGE",
      note: "Repair payload has no identity change.",
    };
  }
  // Same productId under a different advertiser without stronger proof = collision.
  if (oldPid && newPid && oldPid === newPid && oldAdv !== newAdv) {
    const sim = titleSimilarity(row.title || row.publishedTitle || "", opts.probeTitle || "");
    const newJoined = joined.size === 0 ? null : joined.has(newAdv);
    const strong =
      sim >= minSim &&
      newJoined === true &&
      Boolean(opts.probeTitle) &&
      Boolean(row.title || row.publishedTitle);
    if (!strong) {
      return {
        decision: IDENTITY_REPAIR_DECISION.HOLD_COLLISION,
        applyRemap: false,
        cause: "PRODUCT_ID_CROSS_ADVERTISER_COLLISION",
        titleSimilarity: sim,
        newAdvertiserJoined: newJoined,
        note:
          "omitPartnerIds hit another advertiser with the same productId — not sufficient to remap. Hold; do not create duplicates.",
      };
    }
    return {
      decision: IDENTITY_REPAIR_DECISION.APPLY_REMAP,
      applyRemap: true,
      cause: "VERIFIED_IDENTITY_CHANGE",
      titleSimilarity: sim,
      note: "Remap allowed: JOINED new advertiser + strong title match.",
    };
  }
  // Different productId requires explicit verification flags.
  if (opts.confirmedByOwner === true || opts.confirmedByCjLinkIdentity === true) {
    return {
      decision: IDENTITY_REPAIR_DECISION.APPLY_REMAP,
      applyRemap: true,
      cause: "EXPLICIT_CONFIRMATION",
      note: "Remap allowed via explicit confirmation flag.",
    };
  }
  return {
    decision: IDENTITY_REPAIR_DECISION.HOLD_INSUFFICIENT_EVIDENCE,
    applyRemap: false,
    cause: "UNVERIFIED_PRODUCT_ID_CHANGE",
    note: "ProductId change without explicit confirmation — keep pending.",
  };
}

/**
 * Evaluate a list of REPAIR_IDENTITY rows (offline / audit).
 */
export function evaluateIdentityRepairBatch(rows = [], opts = {}) {
  const out = [];
  let apply = 0;
  let holdCollision = 0;
  let holdOther = 0;
  for (const row of rows) {
    const d = decideIdentityRepair(row, opts);
    out.push({
      sourceIdentity: row.sourceIdentity || `${row.advertiserId}|${row.productId}`,
      advertiserId: row.advertiserId,
      productId: row.productId,
      title: row.title || null,
      proposed: row.probe?.identityRepair || row.identityRepair || null,
      ...d,
    });
    if (d.applyRemap) apply += 1;
    else if (d.decision === IDENTITY_REPAIR_DECISION.HOLD_COLLISION) holdCollision += 1;
    else holdOther += 1;
  }
  return {
    schema: "iu-cj-affiliate-phase3z-identity-repair-v39",
    counts: {
      input: rows.length,
      APPLY_REMAP: apply,
      HOLD_COLLISION: holdCollision,
      HOLD_OTHER: holdOther,
    },
    rows: out,
    note: "Never remap on productId-only cross-advertiser omitPartner hit.",
  };
}

/**
 * Apply only APPLY_REMAP rows onto doc products (rewrite advertiserId/productId).
 * Non-apply rows stay; optional hidePrice for collisions when aged.
 */
export function applyVerifiedIdentityRepairsToDoc(doc, repairEval, opts = {}) {
  const byKey = new Map((repairEval?.rows || []).filter((r) => r.applyRemap).map((r) => [r.sourceIdentity, r]));
  let remapped = 0;
  let skipped = 0;
  const sections = [];
  for (const sec of doc?.sections || []) {
    const products = [];
    for (const p of sec.products || []) {
      const key = String(p.advertiserId || "") + "|" + String(p.productId || "");
      const hit = byKey.get(key);
      if (!hit?.proposed?.newAdvertiserId) {
        products.push(p);
        continue;
      }
      // Avoid duplicate if target identity already exists in same section
      const targetKey = hit.proposed.newAdvertiserId + "|" + (hit.proposed.newProductId || p.productId);
      const dup = (sec.products || []).some(
        (q) => String(q.advertiserId) + "|" + String(q.productId) === targetKey
      );
      if (dup) {
        skipped += 1;
        products.push({
          ...p,
          missDecision: "KEEP_PENDING",
          identityRepairBlocked: "TARGET_ALREADY_PRESENT",
        });
        continue;
      }
      remapped += 1;
      products.push({
        ...p,
        advertiserId: String(hit.proposed.newAdvertiserId),
        productId: String(hit.proposed.newProductId || p.productId),
        previousIdentity: key,
        identityRepairedAt: opts.nowIso || new Date().toISOString(),
        missDecision: "RECOVERED",
        refreshReason: "identity_remapped_v39_verified",
      });
    }
    sections.push({ ...sec, products });
  }
  return { doc: { ...doc, sections }, stats: { remapped, skipped } };
}
