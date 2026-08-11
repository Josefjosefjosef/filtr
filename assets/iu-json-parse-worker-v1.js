/**
 * Off-main-thread JSON fetch/parse for InfoUzel multi‑MB datasets.
 * - No credentials beyond same-origin fetch defaults requested by caller flags
 * - No eval / no dynamic code
 * - Fail-closed: posts { ok:false, error }
 */
/* eslint-disable no-restricted-globals */
"use strict";

function omitItemsBySourceId(data, omitSourceIds) {
  if (!data || typeof data !== "object") return data;
  const omit = Array.isArray(omitSourceIds) ? omitSourceIds.map(String) : [];
  if (!omit.length || !Array.isArray(data.items)) return data;
  const drop = new Set(omit);
  const kept = [];
  for (let i = 0; i < data.items.length; i++) {
    const it = data.items[i];
    const sid = String((it && it.sourceId) || "");
    if (drop.has(sid)) continue;
    kept.push(it);
  }
  data.items = kept;
  data.itemCount = kept.length;
  data.omittedSourceIds = omit.slice();
  data.parsedOffMainThread = true;
  return data;
}

/** Slim traffic snapshot for main-thread transfer (drop history; optional card cap). */
function slimTrafficSnapshot(data, maxCards) {
  if (!data || typeof data !== "object") return data;
  const n = Number(maxCards);
  const cap = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  const cards = Array.isArray(data.cards)
    ? data.cards
    : Array.isArray(data.projections)
      ? data.projections
      : [];
  function cardSortMs(card) {
    const iso = String(
      (card && (card.lastMeaningfulChangeAt || card.sourceUpdatedAt || card.downloadedAt)) || ""
    );
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  }
  const ordered = cards.slice();
  ordered.sort(function (a, b) {
    const d = cardSortMs(b) - cardSortMs(a);
    if (d !== 0) return d;
    return String((a && a.publicEventId) || "").localeCompare(String((b && b.publicEventId) || ""));
  });
  const kept = cap == null ? ordered : ordered.slice(0, cap);
  const slim = {
    schema: data.schema || null,
    snapshotVersion: data.snapshotVersion || null,
    schemaVersion: data.schemaVersion || null,
    generatedAt: data.generatedAt || null,
    sourceFreshness: data.sourceFreshness || null,
    eventCount: data.eventCount != null ? data.eventCount : null,
    feedCount: data.feedCount != null ? data.feedCount : null,
    cardCount: data.cardCount != null ? data.cardCount : cards.length,
    publicationEnabled: data.publicationEnabled === true,
    publicApiEnabled: data.publicApiEnabled === true,
    trafficUiEnabled: data.trafficUiEnabled !== false,
    cards: kept,
    historyItems: [],
    historyCount: 0,
    parsedOffMainThread: true,
    cardsCappedTo: cap,
  };
  return slim;
}

self.onmessage = function (ev) {
  const msg = (ev && ev.data) || {};
  const requestId = msg.requestId;
  const respond = function (payload) {
    try {
      self.postMessage(Object.assign({ requestId: requestId }, payload));
    } catch (err) {
      try {
        self.postMessage({
          requestId: requestId,
          ok: false,
          error: "postMessage_failed:" + String((err && err.message) || err),
        });
      } catch (_) {}
    }
  };

  if (!msg || (msg.type !== "fetchJsonFilter" && msg.type !== "fetchTrafficSnapshotSlim")) {
    respond({ ok: false, error: "bad_type" });
    return;
  }
  const url = String(msg.url || "");
  if (!url || url.indexOf("javascript:") === 0 || url.indexOf("data:") === 0) {
    respond({ ok: false, error: "bad_url" });
    return;
  }

  const started = Date.now();
  fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then(function (res) {
      if (!res || !res.ok) throw new Error("http_" + (res ? res.status : 0));
      return res.text().then(function (text) {
        const parseStarted = Date.now();
        const data = JSON.parse(text);
        const parseMs = Date.now() - parseStarted;
        let out = data;
        if (msg.type === "fetchTrafficSnapshotSlim") {
          out = slimTrafficSnapshot(data, msg.maxCards);
        } else {
          out = omitItemsBySourceId(data, msg.omitSourceIds);
        }
        respond({
          ok: true,
          data: out,
          meta: {
            fetchParseTotalMs: Date.now() - started,
            parseMs: parseMs,
            bytes: typeof text === "string" ? text.length : 0,
            itemCount: out && Array.isArray(out.items) ? out.items.length : null,
            cardCount: out && Array.isArray(out.cards) ? out.cards.length : null,
          },
        });
      });
    })
    .catch(function (err) {
      respond({ ok: false, error: String((err && err.message) || err || "worker_fetch_failed") });
    });
};
