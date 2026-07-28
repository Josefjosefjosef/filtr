/**
 * Pluggable CAP bulletin discovery.
 * Production HTML directory listing is NOT treated as a standard API.
 * Wire a confirmed official current-feed adapter only after CHMI confirmation / rollout.
 */
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

/**
 * @param {{ name: string, url?: string, xml: string, etag?: string, lastModified?: string }[]} files
 */
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
 * Placeholder for a future confirmed official current-bulletin endpoint.
 * Intentionally throws if used — must not silently fall back to archive crawl.
 */
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
