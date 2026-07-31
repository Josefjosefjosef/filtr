/**
 * Territory-level open-ended onset provenance from CAP revision chain.
 *
 * Walks ordered CAP documents (oldest → newest). For each continuing ORP under
 * the same open-ended hazard semantic key, keeps the earliest firstValidFrom.
 * Newly added ORPs get the onset from the revision that first introduced them.
 *
 * No incident-specific ORP lists or hardcoded times.
 */
import crypto from "crypto";
import { createGeoRegistry } from "./geo-registry.mjs";
import { processCapDocuments } from "./sync-core.mjs";
import { latestRevisionForThread } from "./revisions.mjs";
import {
  canonicalOrpKey,
  isPublishableChmiItem,
  mergeFeedItemsById,
  revisionsToFeed,
  splitOpenEndedByPriorTerritoryOnset,
  updateOpenEndedOrpOnsetLedger,
} from "./normalize-feed.mjs";

export { canonicalOrpKey };

export function canonicalizeLedgerOrpKeys(ledger) {
  const out = {};
  for (const [sem, bucket] of Object.entries(ledger || {})) {
    const next = {};
    for (const [orp, meta] of Object.entries(bucket || {})) {
      const key = canonicalOrpKey(orp);
      if (!key || !meta) continue;
      const prev = next[key];
      if (!prev) {
        next[key] = { ...meta, orpKey: key };
        continue;
      }
      const prevMs = Date.parse(prev.validFrom);
      const nextMs = Date.parse(meta.validFrom);
      if (Number.isFinite(prevMs) && Number.isFinite(nextMs) && nextMs < prevMs) {
        next[key] = { ...meta, orpKey: key };
      }
    }
    out[sem] = next;
  }
  return out;
}

/**
 * Build onset ledger from ordered CAP XML documents (sent ascending).
 * @param {{ xml: string, sourceUrl?: string }[]} docsAsc
 * @param {object} [opts]
 * @returns {{ ledger: object, steps: object[], itemsByStep: object[][] }}
 */
export function buildTerritoryOnsetLedgerFromOrderedDocuments(docsAsc, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const registry = opts.registry || createGeoRegistry();
  let ledger = opts.seedLedger && typeof opts.seedLedger === "object" ? { ...opts.seedLedger } : {};
  const steps = [];
  const itemsByStep = [];

  for (const doc of docsAsc || []) {
    if (!doc || !doc.xml) continue;
    const one = processCapDocuments([{ xml: doc.xml, sourceUrl: doc.sourceUrl || doc.name || "cap.xml" }], {
      registry,
      receivedAt: nowIso,
      config: opts.config,
    });
    const tids = [...new Set(one.report.revisions.map((r) => r.alert_thread_id))];
    const revs = tids.map((tid) => latestRevisionForThread(one.store, tid)).filter(Boolean);
    const items = mergeFeedItemsById(revisionsToFeed(revs, { nowIso })).filter((i) => isPublishableChmiItem(i));
    const before = JSON.stringify(ledger);
    ledger = canonicalizeLedgerOrpKeys(updateOpenEndedOrpOnsetLedger(ledger, items));
    const after = JSON.stringify(ledger);
    const openEnded = items.filter((i) => i.untilRevoked || (i.capV2 && i.capV2.untilRevoked));
    steps.push({
      sourceUrl: doc.sourceUrl || null,
      cap_message_id: revs[0] ? revs[0].cap_message_id : null,
      sent: revs[0] ? revs[0].sent : null,
      msgType: revs[0] ? revs[0].msgType : null,
      openEndedCount: openEnded.length,
      ledgerChanged: before !== after,
    });
    itemsByStep.push(items);
  }

  return { ledger, steps, itemsByStep };
}

/**
 * Apply revision-aware ledger to head publishable items.
 */
export function applyTerritoryOnsetLedgerToFeed(prevItems, headItems, ledger, opts = {}) {
  const canon = canonicalizeLedgerOrpKeys(ledger || {});
  return splitOpenEndedByPriorTerritoryOnset(prevItems || [], headItems || [], {
    nowIso: opts.nowIso,
    ledger: canon,
  });
}

/**
 * Stable hash of ledger for diagnostics (no secrets).
 */
export function ledgerFingerprint(ledger) {
  const canon = canonicalizeLedgerOrpKeys(ledger || {});
  const payload = Object.keys(canon)
    .sort()
    .map((sem) => {
      const b = canon[sem] || {};
      const rows = Object.keys(b)
        .sort()
        .map((orp) => `${orp}=${b[orp].validFrom || ""}`);
      return `${sem}:{${rows.join(",")}}`;
    })
    .join("|");
  return crypto.createHash("sha1").update(payload).digest("hex").slice(0, 16);
}
