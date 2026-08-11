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
    async fetchBody(url, conditional = {}) {
      const f = list.find((x) => (x.url || x.name) === url || x.name === url);
      if (!f) {
        return {
          status: 404,
          headers: {},
          body: null,
          observability: { ifNoneMatchSent: false, ifModifiedSinceSent: false, bytesRead: 0 },
        };
      }
      const ifNoneMatchSent = Boolean(conditional && conditional.etag);
      const ifModifiedSinceSent = Boolean(conditional && conditional.lastModified);
      if (
        f.status === 304 ||
        (ifNoneMatchSent && f.etag && conditional.etag === f.etag) ||
        (ifModifiedSinceSent &&
          f.lastModified &&
          conditional.lastModified === f.lastModified &&
          f.unchanged === true)
      ) {
        return {
          status: 304,
          headers: {
            etag: f.etag || `"${f.name}"`,
            "last-modified": f.lastModified || "Wed, 01 Jul 2026 10:00:00 GMT",
          },
          body: null,
          observability: {
            ifNoneMatchSent,
            ifModifiedSinceSent,
            bytesRead: 0,
            contentLengthHeader: null,
            requestStartedAt: new Date().toISOString(),
            headersReceivedAt: new Date().toISOString(),
            downloadFinishedAt: new Date().toISOString(),
            requestDurationMs: 0,
            downloadDurationMs: 0,
            totalDurationMs: 0,
          },
        };
      }
      const body = f.body != null ? f.body : f.xml;
      const bytesRead = body == null ? 0 : Buffer.byteLength(String(body), "utf8");
      return {
        status: f.status != null ? Number(f.status) : 200,
        headers: {
          etag: f.etag || `"${f.name}"`,
          "content-type": f.contentType || "application/xml",
          "last-modified": f.lastModified || "Wed, 01 Jul 2026 10:00:00 GMT",
          "content-length": f.contentLength != null ? String(f.contentLength) : String(bytesRead),
        },
        body,
        observability: {
          ifNoneMatchSent,
          ifModifiedSinceSent,
          bytesRead,
          contentLengthHeader: bytesRead,
          requestStartedAt: new Date().toISOString(),
          headersReceivedAt: new Date().toISOString(),
          downloadFinishedAt: new Date().toISOString(),
          requestDurationMs: 0,
          downloadDurationMs: 0,
          totalDurationMs: 0,
        },
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
      const ifNoneMatchSent = Boolean(conditional.etag);
      const ifModifiedSinceSent = Boolean(conditional.lastModified);
      if (ifNoneMatchSent) headers["If-None-Match"] = conditional.etag;
      if (ifModifiedSinceSent) headers["If-Modified-Since"] = conditional.lastModified;
      const requestStartedAt = new Date().toISOString();
      const requestStartedMono = Number(process.hrtime.bigint() / 1000000n);
      const res = await fetchImpl(url, { method: "GET", headers, redirect: "error" });
      const headersReceivedAt = new Date().toISOString();
      const headersReceivedMono = Number(process.hrtime.bigint() / 1000000n);
      const headerMap = Object.fromEntries(res.headers.entries());
      const body = res.status === 304 ? null : await res.text();
      const downloadFinishedAt = new Date().toISOString();
      const downloadFinishedMono = Number(process.hrtime.bigint() / 1000000n);
      const bytesRead = body == null ? 0 : Buffer.byteLength(String(body), "utf8");
      return {
        status: res.status,
        headers: headerMap,
        body,
        observability: {
          requestStartedAt,
          headersReceivedAt,
          downloadFinishedAt,
          requestDurationMs: Math.max(0, headersReceivedMono - requestStartedMono),
          downloadDurationMs: Math.max(0, downloadFinishedMono - headersReceivedMono),
          totalDurationMs: Math.max(0, downloadFinishedMono - requestStartedMono),
          ifNoneMatchSent,
          ifModifiedSinceSent,
          bytesRead,
          contentLengthHeader:
            headerMap["content-length"] != null && Number.isFinite(Number(headerMap["content-length"]))
              ? Number(headerMap["content-length"])
              : null,
        },
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
