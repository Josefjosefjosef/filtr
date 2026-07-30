/**
 * CAP lifecycle assembly — process ordered Alert → Update → Cancel documents
 * into the current active feed set (latest revision per alert_thread_id).
 *
 * Used by architecture validation and by sync when multiple docs of one stream
 * are available. CHMI open-data typically publishes one complete superseding
 * head per product stream; this module proves full lifecycle still works when
 * multiple messages are supplied in sent-order.
 */
import { getChmiCapV2Config } from "./config.mjs";
import { createGeoRegistry } from "./geo-registry.mjs";
import { isPublishableChmiItem, mergeFeedItemsById, revisionsToFeed } from "./normalize-feed.mjs";
import { latestRevisionForThread } from "./revisions.mjs";
import { processCapDocuments } from "./sync-core.mjs";

/**
 * @param {{ xml: string, sourceUrl?: string, name?: string }[]} docsAsc
 *   Documents sorted by CAP `sent` ascending (oldest first).
 * @param {object} [opts]
 */
export function assembleActiveStateFromOrderedDocuments(docsAsc, opts = {}) {
  const config = opts.config || getChmiCapV2Config({ IU_CHMI_CAP_V2_MODE: "active" });
  const registry = opts.registry || createGeoRegistry();
  const receivedAt = opts.receivedAt || new Date().toISOString();
  const result = processCapDocuments(docsAsc || [], { config, registry, receivedAt });
  const threadIds = [...new Set(result.report.revisions.map((r) => r.alert_thread_id))];
  const latest = threadIds.map((tid) => latestRevisionForThread(result.store, tid)).filter(Boolean);
  const items = mergeFeedItemsById(revisionsToFeed(latest, { nowIso: receivedAt }));
  const active = items.filter((i) => i && i.status === "aktivni");
  const scheduled = items.filter((i) => i && i.status === "naplanovano");
  const cancelled = items.filter((i) => i && i.status === "zruseno");
  const ended = items.filter((i) => i && i.status === "ukonceno");
  const invalid = items.filter((i) => i && i.status === "nezaraditelne");
  const publishable = items.filter((i) => isPublishableChmiItem(i));
  return {
    store: result.store,
    report: result.report,
    latestRevisions: latest,
    items,
    active,
    scheduled,
    cancelled,
    ended,
    invalid,
    publishable,
    threadCount: threadIds.length,
    /** Temporally in-force only (validFrom <= now < validTo). */
    activeCount: active.length,
    scheduledCount: scheduled.length,
    expiredCount: ended.length,
    cancelledCount: cancelled.length,
    invalidCount: invalid.length,
    publishableCount: publishable.length,
  };
}

/**
 * Group index listings by product stream key (no selection / no limit).
 * @param {{ url: string, mtime?: number }[]} listed
 * @param {(url: string) => string} productKeyFn
 */
export function groupListedByProductStream(listed, productKeyFn) {
  const map = new Map();
  for (const item of listed || []) {
    const url = item && item.url ? String(item.url) : "";
    if (!url) continue;
    const key = productKeyFn(url);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ ...item, url, productKey: key });
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => (a.mtime || 0) - (b.mtime || 0) || String(a.url).localeCompare(String(b.url)));
  }
  return map;
}
