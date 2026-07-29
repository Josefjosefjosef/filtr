/**
 * Pluggable CAP bulletin discovery — independent of parser.
 *
 * Modes:
 * - fixture: local XML fixtures
 * - configured_urls: conditional GET only on known bulletin URLs (preferred for steady-state)
 * - opendata_newest_file: ONE GET to open-data directory solely to discover newest filename(s),
 *   then conditional GET on those XML files. This is open-data file distribution discovery,
 *   NOT treated as a REST/HTML API contract and never crawls the full archive.
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
      return list.map((f) => ({ url: f.url || f.name, name: f.name }));
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
 * Discover newest N CAP XML files from CHMI open-data directory listing.
 * Max 1 GET to index per cycle; never walks full archive (slice to maxFiles).
 */
export function createOpendataNewestFileDiscovery(opts = {}) {
  const indexUrl = opts.indexUrl || CHMI_OPENDATA_CAP_INDEX;
  const maxFiles = Math.max(1, Number(opts.maxFiles || 1));
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const ua = opts.userAgent || CHMI_SYNC_UA;
  return {
    type: "opendata_newest_file",
    role: "open_data_file_distribution_discovery_not_api",
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
      const listed = listCapXmlFromIndex(html, indexUrl).slice(0, maxFiles);
      return listed.map((x) => ({ url: x.url, name: String(x.url || "").split("/").pop(), mtime: x.mtime || 0 }));
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
 * Default production path uses opendata_newest_file (1 newest bulletin) until confirmed_current_feed URL is set.
 */
export function resolveDiscoveryAdapter(config = {}, opts = {}) {
  const kind = String(opts.kind || config.discoveryKind || process.env.IU_CHMI_CAP_V2_DISCOVERY || "opendata_newest_file");
  if (kind === "fixture") return createFixtureDiscovery(opts.files || []);
  if (kind === "configured_urls") return createConfiguredUrlDiscovery(opts.urls || config.configuredUrls || [], opts);
  if (kind === "confirmed_current_feed") {
    return createConfirmedCurrentFeedDiscovery(opts.feedUrl || config.confirmedFeedUrl || process.env.IU_CHMI_CAP_V2_CURRENT_FEED, opts);
  }
  if (kind === "opendata_newest_file") {
    return createOpendataNewestFileDiscovery({
      ...opts,
      maxFiles: opts.maxFiles || Number(process.env.IU_CHMI_CAP_V2_MAX_FILES || 15),
    });
  }
  if (kind === "noop") return createNoopDiscovery();
  return createUnconfirmedProductionDiscovery();
}
