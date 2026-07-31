/**
 * Pluggable CAP bulletin discovery — independent of parser.
 *
 * Modes:
 * - fixture: local XML fixtures
 * - configured_urls: conditional GET only on known bulletin URLs
 * - opendata_active_streams: ONE GET to open-data directory; select the newest
 *   file per CAP product stream (alert_cap_50_*, alert_cap_70_*, …). No fixed
 *   maxFiles / first-N / last-N. Does NOT download the historical archive.
 * - opendata_newest_file: alias → opendata_active_streams (legacy env value)
 * - confirmed_current_feed: reserved for a future officially confirmed current-only URL
 */
import { CHMI_OPENDATA_CAP_INDEX, CHMI_SYNC_UA } from "./config.mjs";
import { listCapXmlFromIndex } from "../iu-info-events-lib.mjs";

export function createNoopDiscovery() {
  return {
    type: "noop",
    async listLatest() {
      return [];
    },
    async fetchBody() {
      return { status: 501, headers: {}, body: null };
    },
  };
}

export function createFixtureDiscovery(files) {
  const list = files || [];
  return {
    type: "fixture",
    async listLatest() {
      return list.map((f) => ({ url: f.url || f.name, name: f.name, productKey: f.productKey || null }));
    },
    async fetchBody(url) {
      const f = list.find((x) => (x.url || x.name) === url || x.name === url);
      if (!f) return { status: 404, headers: {}, body: null };
      return {
        status: 200,
        headers: {
          etag: f.etag || `"${f.name}"`,
          "content-type": "application/xml",
          "last-modified": f.lastModified || "Wed, 01 Jul 2026 10:00:00 GMT",
        },
        body: f.xml,
      };
    },
  };
}

/**
 * Steady-state: only conditional GET against known bulletin URLs from sync state.
 */
export function createConfiguredUrlDiscovery(urls, opts = {}) {
  const list = (urls || []).map((u) => (typeof u === "string" ? { url: u, name: u } : u));
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const ua = opts.userAgent || CHMI_SYNC_UA;
  return {
    type: "configured_urls",
    async listLatest() {
      return list.slice();
    },
    async fetchBody(url, conditional = {}) {
      const headers = {
        "User-Agent": ua,
        Accept: "application/xml, text/xml;q=0.9",
        "Accept-Encoding": "gzip, br",
      };
      if (conditional.etag) headers["If-None-Match"] = conditional.etag;
      if (conditional.lastModified) headers["If-Modified-Since"] = conditional.lastModified;
      const res = await fetchImpl(url, { method: "GET", headers });
      const body = res.status === 304 ? null : await res.text();
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body,
      };
    },
  };
}

/**
 * Extract CAP product stream key from filename (e.g. alert_cap_50_290854.xml → "50").
 * Parallel streams (50 = meteo, 70 = drought/hydro, …) must all be processed.
 */
export function capProductKeyFromUrl(urlOrName) {
  const name = String(urlOrName || "").split("/").pop() || "";
  const m = name.match(/^alert_cap_(\d+)_/i);
  if (m) return m[1];
  const m2 = name.match(/cap[_-]?(\d{2,3})[_-]/i);
  if (m2) return m2[1];
  return name ? `file:${name}` : "unknown";
}

/**
 * From a full index listing, select the newest bulletin per product stream.
 * NO fixed maxFiles / first-N / last-N — returns one head per discovered stream.
 *
 * Product streams are derived from filenames (`alert_cap_{N}_*`). Keys are
 * data-driven: any new N is discovered automatically (no product whitelist).
 *
 * Algorithm:
 * 1. For each listed XML URL, compute productKey via capProductKeyFromUrl.
 * 2. Keep the entry with highest Apache mtime (tie-break: lexicographic name).
 * 3. Return all heads sorted by mtime desc — count == number of distinct streams.
 *
 * Lifecycle within a stream: ČHMÚ open-data publishes each product head as a
 * complete superseding CAP document (Alert/Update snapshot of current product
 * state). Sync therefore downloads one head per stream, not the full archive.
 * Full Alert→Update→Cancel replay is supported by lifecycle.mjs when multiple
 * documents are supplied (tests / future confirmed_current_feed).
 *
 * @param {{ url: string, mtime?: number }[]} listed
 * @returns {{ url: string, name: string, mtime: number, productKey: string }[]}
 */
export function selectLatestPerProductStream(listed) {
  const byProduct = new Map();
  for (const item of listed || []) {
    const url = item && item.url ? String(item.url) : "";
    if (!url) continue;
    const name = url.split("/").pop() || url;
    const productKey = capProductKeyFromUrl(name);
    const mtime = Number(item.mtime) || 0;
    const prev = byProduct.get(productKey);
    if (!prev) {
      byProduct.set(productKey, { url, name, mtime, productKey });
      continue;
    }
    if (mtime > prev.mtime || (mtime === prev.mtime && name > prev.name)) {
      byProduct.set(productKey, { url, name, mtime, productKey });
    }
  }
  return [...byProduct.values()].sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || String(a.productKey).localeCompare(String(b.productKey)));
}

/**
 * Recent bulletins per product stream (newest first), capped — for open-ended onset
 * ledger recovery only. Not a publish set; avoids full archive walk.
 */
export function selectRecentPerProductStream(listed, maxPerStream = 4) {
  // Cap raised so drought/fire revision chains (>6) remain recoverable on cold start.
  // Recent window is NOT the sole source of truth — prod-sync also walks CAP references.
  const n = Math.max(1, Math.min(24, Number(maxPerStream) || 4));
  const byProduct = new Map();
  for (const item of listed || []) {
    const url = item && item.url ? String(item.url) : "";
    if (!url) continue;
    const name = url.split("/").pop() || url;
    const productKey = capProductKeyFromUrl(name);
    const mtime = Number(item.mtime) || 0;
    if (!byProduct.has(productKey)) byProduct.set(productKey, []);
    byProduct.get(productKey).push({ url, name, mtime, productKey });
  }
  const out = [];
  for (const arr of byProduct.values()) {
    arr.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || String(b.name).localeCompare(String(a.name)));
    out.push(...arr.slice(0, n));
  }
  return out.sort((a, b) => (a.mtime || 0) - (b.mtime || 0) || String(a.name).localeCompare(String(b.name)));
}

/**
 * Discover current CAP product-stream heads from CHMI open-data directory listing.
 * Max 1 GET to index per cycle; never walks/downloads the full archive.
 * Completeness = every product stream's newest file, not a fixed N.
 */
export function createOpendataActiveStreamsDiscovery(opts = {}) {
  const indexUrl = opts.indexUrl || CHMI_OPENDATA_CAP_INDEX;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const ua = opts.userAgent || CHMI_SYNC_UA;
  /** @type {{ url: string, mtime?: number }[]} */
  let lastListed = [];
  return {
    type: "opendata_active_streams",
    role: "open_data_file_distribution_discovery_not_api",
    selection: "latest_per_product_stream",
    async listLatest() {
      const res = await fetchImpl(indexUrl, {
        method: "GET",
        headers: {
          "User-Agent": ua,
          Accept: "text/html,application/xhtml+xml;q=0.9",
        },
      });
      if (!res.ok) throw Object.assign(new Error("opendata_index_http_" + res.status), { code: "DISCOVERY_INDEX" });
      const html = await res.text();
      const listed = listCapXmlFromIndex(html, indexUrl);
      lastListed = listed;
      const selected = selectLatestPerProductStream(listed);
      if (!selected.length) {
        throw Object.assign(new Error("opendata_no_product_streams"), { code: "DISCOVERY_EMPTY" });
      }
      return selected;
    },
    /**
     * Bounded recent history for territory-onset ledger (not a publish set).
     * Oldest → newest within each product stream slice.
     */
    listRecentForOnsetLedger(maxPerStream = 6) {
      return selectRecentPerProductStream(lastListed, maxPerStream);
    },
    /** Full open-data listing from the last listLatest() call (for reference resolution). */
    getLastListed() {
      return lastListed.slice();
    },
    async fetchBody(url, conditional = {}) {
      const headers = {
        "User-Agent": ua,
        Accept: "application/xml, text/xml;q=0.9",
        "Accept-Encoding": "gzip, br",
      };
      if (conditional.etag) headers["If-None-Match"] = conditional.etag;
      if (conditional.lastModified) headers["If-Modified-Since"] = conditional.lastModified;
      const res = await fetchImpl(url, { method: "GET", headers });
      const body = res.status === 304 ? null : await res.text();
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        body,
      };
    },
  };
}

/** @deprecated Use createOpendataActiveStreamsDiscovery — kept as alias for callers. */
export function createOpendataNewestFileDiscovery(opts = {}) {
  return createOpendataActiveStreamsDiscovery(opts);
}

/**
 * Reserved for a future officially confirmed current-only feed URL.
 */
export function createConfirmedCurrentFeedDiscovery(feedUrl, opts = {}) {
  if (!feedUrl) {
    return {
      type: "confirmed_current_feed",
      async listLatest() {
        throw Object.assign(new Error("confirmed_feed_url_missing"), { code: "DISCOVERY_UNCONFIRMED" });
      },
      async fetchBody() {
        throw Object.assign(new Error("confirmed_feed_url_missing"), { code: "DISCOVERY_UNCONFIRMED" });
      },
    };
  }
  return createConfiguredUrlDiscovery([feedUrl], opts);
}

export function createUnconfirmedProductionDiscovery() {
  return {
    type: "unconfirmed_production",
    async listLatest() {
      throw Object.assign(new Error("chmi_discovery_unconfirmed"), {
        code: "DISCOVERY_UNCONFIRMED",
        message: "Official current CAP discovery not confirmed — refusing production poll",
      });
    },
    async fetchBody() {
      throw Object.assign(new Error("chmi_discovery_unconfirmed"), { code: "DISCOVERY_UNCONFIRMED" });
    },
  };
}

/**
 * Resolve discovery adapter from config / env.
 * Default: opendata_active_streams (all product-stream heads, no fixed file count).
 */
export function resolveDiscoveryAdapter(config = {}, opts = {}) {
  const kind = String(opts.kind || config.discoveryKind || process.env.IU_CHMI_CAP_V2_DISCOVERY || "opendata_active_streams");
  if (kind === "fixture") return createFixtureDiscovery(opts.files || []);
  if (kind === "configured_urls") return createConfiguredUrlDiscovery(opts.urls || config.configuredUrls || [], opts);
  if (kind === "confirmed_current_feed") {
    return createConfirmedCurrentFeedDiscovery(opts.feedUrl || config.confirmedFeedUrl || process.env.IU_CHMI_CAP_V2_CURRENT_FEED, opts);
  }
  // Legacy env value "opendata_newest_file" maps to active-streams (no maxFiles).
  if (kind === "opendata_active_streams" || kind === "opendata_newest_file") {
    return createOpendataActiveStreamsDiscovery({ ...opts });
  }
  if (kind === "noop") return createNoopDiscovery();
  return createUnconfirmedProductionDiscovery();
}
