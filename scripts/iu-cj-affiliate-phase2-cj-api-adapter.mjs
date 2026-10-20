/**

 * CJ Commission Junction API adapter — HTTP production path (execute arm required).

 */

import {

  CJ_ADVERTISER_LOOKUP_BASE,

  CJ_LINK_SEARCH_BASE,

  validatePatFormat,

  trimPat,

  buildCjAuthorizationHeader,

  classifyCjResponse,

  parseLinkBlocks,

  parseLinkRecord,

  parseListMeta,

  throttleCj,

} from "./iu-cj-affiliate-phase1-lib.mjs";



export const CJ_API_SECRET_NAMES = Object.freeze({

  pat: ["IU_CJ_PAT", "CJ_PERSONAL_ACCESS_TOKEN"],

  publisherCid: "IU_CJ_PUBLISHER_CID",

  websitePid: "IU_CJ_WEBSITE_PID",

});



export function resolveCjApiConfig(env = process.env) {

  const offline = env.IU_CJ_EMAIL_INGEST_OFFLINE === "1" || env.IU_CJ_GITHUB_INGEST_DRY_RUN === "1";

  const pat = trimPat(env.IU_CJ_PAT) || trimPat(env.CJ_PERSONAL_ACCESS_TOKEN) || null;

  const enabled = env.IU_CJ_CJ_API_ENABLED === "1" && !offline && pat;

  const httpExecuteArmed = env.IU_CJ_CJ_API_HTTP_EXECUTE === "1";

  return {

    enabled,

    httpExecuteArmed,

    offlineForced: offline,

    hasPat: Boolean(pat),

    publisherCid: env.IU_CJ_PUBLISHER_CID || null,

    websitePid: env.IU_CJ_WEBSITE_PID || null,

    bases: {

      advertiserLookup: CJ_ADVERTISER_LOOKUP_BASE,

      linkSearch: CJ_LINK_SEARCH_BASE,

    },

    recommendedSecretPlacement: {

      githubActions: ["IU_CJ_PAT", "IU_CJ_PUBLISHER_CID", "IU_CJ_WEBSITE_PID"],

      cloudflareWorker: "only if Worker must enrich feeds at edge; else keep PAT on GHA only",

      never: ["source code", "audit ZIP", "chat", "workflow logs"],

    },

  };

}



export function probeCjPatFormat(env = process.env) {

  const pat = trimPat(env.IU_CJ_PAT) || trimPat(env.CJ_PERSONAL_ACCESS_TOKEN) || "";

  if (!pat) {

    return { ok: false, state: "NOT_CONFIGURED", reason: "missing_pat_secret" };

  }

  const fmt = validatePatFormat(pat);

  if (!fmt.ok) {

    return { ok: false, state: "INVALID_FORMAT", reason: fmt.reason, safeMessage: fmt.safeMessage };

  }

  return { ok: true, state: "FORMAT_OK", patSha256Prefix: null };

}



export async function cjApiHttpGet(url, env = process.env, options = {}) {

  const config = resolveCjApiConfig(env);

  const testBase = options.testBaseUrl || null;

  const mayFetch = (config.enabled && config.httpExecuteArmed) || testBase;

  if (!mayFetch) {

    return { ok: false, blocked: true, reason: "cj_api_http_not_armed_or_disabled" };

  }

  const pat = trimPat(env.IU_CJ_PAT) || trimPat(env.CJ_PERSONAL_ACCESS_TOKEN) || options.testPat || "";

  const fmt = validatePatFormat(pat);

  if (!fmt.ok) {

    return { ok: false, blocked: true, reason: "pat_format_invalid", detail: fmt.reason };

  }

  const finalUrl = testBase ? url.replace(CJ_LINK_SEARCH_BASE, testBase + "/link-search") : url;

  await throttleCj();

  const timeoutMs = Number(env.IU_CJ_FETCH_TIMEOUT_MS || 30_000);

  const controller = new AbortController();

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {

    const res = await fetch(finalUrl, {

      method: "GET",

      signal: controller.signal,

      headers: { Authorization: buildCjAuthorizationHeader(pat), Accept: "application/xml,text/xml,*/*" },

    });

    const body = await res.text();

    const auth = classifyCjResponse(body, res.status);

    const ok = res.ok && auth.authenticated === true && !auth.reason?.includes("unknown_shape");

    return { ok, status: res.status, body, auth, networkError: false, emptyData: ok && body.length < 40 };

  } catch (e) {

    return { ok: false, status: 0, body: "", auth: { authenticated: false, reason: "network_error" }, networkError: true, safe: String(e?.message || "").slice(0, 80) };

  } finally {

    clearTimeout(timer);

  }

}



export async function cjLinkSearchPage(pageNumber, env = process.env, options = {}) {

  const config = resolveCjApiConfig(env);

  if (!config.websitePid && !options.testBaseUrl) {

    return { ok: false, blocked: true, reason: "missing_website_pid" };

  }

  const qs = new URLSearchParams({

    "website-id": config.websitePid || "test-pid",

    "advertiser-ids": "joined",

    "link-type": options.linkType || "coupon",

    "page-number": String(pageNumber),

    "records-per-page": "10",

  });

  const url = CJ_LINK_SEARCH_BASE + "?" + qs.toString();

  const res = await cjApiHttpGet(url, env, options);

  if (!res.ok) return res;

  const meta = parseListMeta(res.body);

  const links = parseLinkBlocks(res.body).map(parseLinkRecord);

  if (links.length === 0 && res.emptyData) {

    return { ok: false, reason: "cj_api_empty_suspicious", status: res.status };

  }

  return { ok: true, meta, links, status: res.status };

}



export function describeCjApiDomains() {

  return {

    productFeedsAndLinks: "link-search API — product deep links, not customer discounts by default",

    coupons: "link-search with linkType=coupon — verify customer-facing discount vs publisher commission",

    commissions: "reporting APIs — publisher revenue, not storefront price",

    advertisersAndMarkets: "advertiser-lookup + CID in message evidence",

    offerValidity: "email evidence + CJ link metadata cross-check (future)",

    v15Contract: "grantsFromDocumentEvidence required before any publication",

    doNotConflate: "publisher_commission != customer_coupon_percent",

  };

}


