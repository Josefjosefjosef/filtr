/**
 * Pluggable NDIC discovery — fixture / configured authenticated PULL.
 * Credentials never embedded in URLs; Basic Auth via headers only.
 */
import { assertAllowedPullUrl, NDIC_SYNC_UA } from "./config.mjs";

export function createFixtureDiscovery(files) {
  const list = files || [];
  return {
    type: "fixture",
    async listLatest() {
      return list.map((f) => ({
        url: f.url || f.name,
        name: f.name,
        kind: f.kind || "datex",
      }));
    },
    async fetchBody(url) {
      const f = list.find((x) => (x.url || x.name) === url || x.name === url);
      if (!f) return { status: 404, headers: {}, body: null };
      return {
        status: 200,
        headers: {
          etag: f.etag || `"${f.name}"`,
          "content-type": f.contentType || "application/xml",
          "last-modified": f.lastModified || "Wed, 01 Jul 2026 10:00:00 GMT",
        },
        body: f.body != null ? f.body : f.xml,
      };
    },
  };
}

/**
 * Authenticated HTTP PULL (cz-ndic_pull-v1.1): GET + Basic Auth + conditional headers.
 */
export function createAuthenticatedPullDiscovery(opts = {}) {
  const url = assertAllowedPullUrl(opts.url);
  const user = String(opts.user || "");
  const pass = String(opts.pass || "");
  if (!user || !pass) {
    throw Object.assign(new Error("pull_credentials_missing"), { code: "PULL_CREDS_MISSING" });
  }
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const ua = opts.userAgent || NDIC_SYNC_UA;
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");

  return {
    type: "authenticated_pull",
    async listLatest() {
      return [{ url, name: "ndic-datex-common-pull", kind: "datex" }];
    },
    async fetchBody(_url, conditional = {}) {
      const headers = {
        "User-Agent": ua,
        Accept: "application/xml, text/xml, application/zip, */*;q=0.1",
        "Accept-Encoding": "gzip, br",
        Authorization: `Basic ${token}`,
      };
      if (conditional.etag) headers["If-None-Match"] = conditional.etag;
      if (conditional.lastModified) headers["If-Modified-Since"] = conditional.lastModified;
      const res = await fetchImpl(url, { method: "GET", headers, redirect: "error" });
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
 * @param {object} config — getNdicDatexV1Config()
 * @param {{ kind?: string, files?: object[], fetchImpl?: Function }} [opts]
 */
export function resolveDiscoveryAdapter(config, opts = {}) {
  const kind = opts.kind || (opts.files ? "fixture" : config.hasPullCredentials ? "authenticated_pull" : "noop");
  if (kind === "fixture") return createFixtureDiscovery(opts.files || []);
  if (kind === "authenticated_pull") {
    return createAuthenticatedPullDiscovery({
      url: config.pullUrl,
      user: config.pullUser,
      pass: config.pullPass,
      userAgent: config.userAgent,
      fetchImpl: opts.fetchImpl,
    });
  }
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
