#!/usr/bin/env node
/**
 * Individual product reconciliation between two offers-public snapshots.
 * Explains unique/hold deltas without cosmetic restore of unavailable products.
 */
import fs from "node:fs";
import path from "node:path";

export const SHRINKAGE_RECONCILE_SCHEMA = "iu-cj-affiliate-phase3z-catalog-shrinkage-reconcile-v51-8";

function productKey(p) {
  const a = String(p?.advertiserId || "").trim();
  const id = String(p?.productId || p?.id || "").trim();
  if (!a || !id) return null;
  const variant = String(p?.productVariant || "").trim();
  return variant ? a + "|" + id + "|" + variant : a + "|" + id;
}

function indexOffers(doc) {
  const byKey = new Map();
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) {
      const key = productKey(p);
      if (!key || byKey.has(key)) continue;
      byKey.set(key, {
        key,
        advertiserId: String(p.advertiserId || ""),
        productId: String(p.productId || p.id || ""),
        productVariant: String(p.productVariant || "").trim() || null,
        currency: p.currency || null,
        title: p.title || p.name || null,
        lkgCarried: p.lkgCarried === true,
        hold:
          p.lkgPublicHold === true || p.publicationHold === true || p.lkgHold === true,
        availability: p.availability ?? p.availabilityClass ?? null,
        freshnessStatus: p.freshnessStatus || null,
        refreshResult: p.refreshResult || null,
        publicationClass: p.publicationClass || null,
        affiliateUrl: p.affiliateUrl || p.linkUrl || null,
        lastVerifiedAt: p.lastVerifiedAt || p.lastSuccessfulRefreshAt || p.fetchedAt || null,
        currentPrice: p.currentPrice ?? p.price ?? null,
      });
    }
  }
  return byKey;
}

function availClass(v) {
  if (v === false || v === "OUT_OF_STOCK" || v === "unavailable") return "OUT_OF_STOCK";
  if (v === true || v === "IN_STOCK" || v === "available") return "IN_STOCK";
  return String(v || "UNKNOWN");
}

/**
 * @param {object} prevDoc
 * @param {object} nextDoc
 */
export function reconcileCatalogShrinkage(prevDoc, nextDoc, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const prev = indexOffers(prevDoc);
  const next = indexOffers(nextDoc);
  const added = [];
  const removed = [];
  const updated = [];
  const newlyHeld = [];
  const restoredFromHold = [];
  const availabilityChanged = [];
  const lkgCleared = [];
  const lkgNew = [];

  for (const [key, n] of next.entries()) {
    const p = prev.get(key);
    if (!p) {
      added.push(n);
      continue;
    }
    const changes = [];
    if (p.hold !== n.hold) changes.push("hold");
    if (p.lkgCarried !== n.lkgCarried) changes.push("lkgCarried");
    if (availClass(p.availability) !== availClass(n.availability)) changes.push("availability");
    if (String(p.currentPrice) !== String(n.currentPrice)) changes.push("price");
    if (String(p.currency || "") !== String(n.currency || "")) changes.push("currency");
    if (changes.length) {
      updated.push({ key, changes, prev: p, next: n });
    }
    if (!p.hold && n.hold) newlyHeld.push({ key, reason: n.publicationClass || n.freshnessStatus || "hold", next: n });
    if (p.hold && !n.hold) restoredFromHold.push({ key, next: n });
    if (availClass(p.availability) !== availClass(n.availability)) {
      availabilityChanged.push({
        key,
        from: availClass(p.availability),
        to: availClass(n.availability),
      });
    }
    if (p.lkgCarried && !n.lkgCarried) lkgCleared.push(key);
    if (!p.lkgCarried && n.lkgCarried) lkgNew.push(key);
  }
  for (const [key, p] of prev.entries()) {
    if (!next.has(key)) removed.push(p);
  }

  const prevUnique = prev.size;
  const nextUnique = next.size;
  const prevHold = [...prev.values()].filter((x) => x.hold).length;
  const nextHold = [...next.values()].filter((x) => x.hold).length;

  const holdReasons = {};
  for (const h of newlyHeld) {
    const r = String(h.reason || "UNKNOWN");
    holdReasons[r] = (holdReasons[r] || 0) + 1;
  }
  const removedReasons = {};
  for (const r of removed) {
    const k =
      availClass(r.availability) === "OUT_OF_STOCK"
        ? "REMOVED_WHILE_OUT_OF_STOCK_OR_UNAVAILABLE"
        : r.lkgCarried
          ? "REMOVED_WAS_LKG_CARRIED"
          : r.hold
            ? "REMOVED_WAS_HOLD"
            : "REMOVED_OTHER";
    removedReasons[k] = (removedReasons[k] || 0) + 1;
  }

  return {
    schema: SHRINKAGE_RECONCILE_SCHEMA,
    at: nowIso,
    prev: {
      source: opts.prevSource || null,
      updatedAt: prevDoc?.updatedAt || null,
      unique: prevUnique,
      hold: prevHold,
      stats: prevDoc?.stats || null,
    },
    next: {
      source: opts.nextSource || null,
      updatedAt: nextDoc?.updatedAt || null,
      unique: nextUnique,
      hold: nextHold,
      stats: nextDoc?.stats || null,
    },
    deltas: {
      uniqueDelta: nextUnique - prevUnique,
      holdDelta: nextHold - prevHold,
      added: added.length,
      removed: removed.length,
      updated: updated.length,
      newlyHeld: newlyHeld.length,
      restoredFromHold: restoredFromHold.length,
      availabilityChanged: availabilityChanged.length,
      lkgCleared: lkgCleared.length,
      lkgNew: lkgNew.length,
    },
    holdReasons,
    removedReasons,
    // Full inventories for audit (not samples-only).
    added,
    removed,
    newlyHeld,
    restoredFromHold,
    availabilityChanged,
    lkgClearedKeys: lkgCleared,
    lkgNewKeys: lkgNew,
    updatedSample: updated.slice(0, 80),
    note:
      "Hold rise driven by availability/protective classes must not be force-cleared. Removals require identity+cause evidence.",
  };
}

async function main() {
  const prevUrl =
    process.env.IU_CJ_OFFERS_PREV_URL ||
    process.env.IU_CJ_OFFERS_PREV_PATH ||
    "";
  const nextUrl =
    process.env.IU_CJ_OFFERS_PUBLIC_URL ||
    "https://infouzel.cz/projects/data/iu-affiliate-cj-offers-public-v1.json";
  const outPath =
    process.env.IU_CJ_SHRINKAGE_RECONCILE_OUT ||
    path.join(process.env.TEMP || "/tmp", "iu-catalog-shrinkage-reconcile-v51-8.json");

  async function load(src) {
    if (!src) return null;
    if (/^https?:\/\//i.test(src)) return (await fetch(src)).json();
    return JSON.parse(fs.readFileSync(src, "utf8"));
  }

  const nextDoc = await load(nextUrl);
  let prevDoc = prevUrl ? await load(prevUrl) : null;
  if (!prevDoc) {
    // Fallback: compare against TEMP snapshot if provided via env only.
    throw new Error("IU_CJ_OFFERS_PREV_URL or IU_CJ_OFFERS_PREV_PATH required");
  }
  const doc = reconcileCatalogShrinkage(prevDoc, nextDoc, {
    prevSource: prevUrl,
    nextSource: nextUrl,
  });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        deltas: doc.deltas,
        holdReasons: doc.holdReasons,
        removedReasons: doc.removedReasons,
      },
      null,
      2,
    ),
  );
}

const isDirect =
  process.argv[1] &&
  process.argv[1]
    .replace(/\\/g, "/")
    .endsWith("iu-cj-affiliate-phase3z-catalog-shrinkage-reconcile-v51-8.mjs");
if (isDirect) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
