#!/usr/bin/env node
/** CJ publisher product search via documented GraphQL (ads.api.cj.com/query). */
import {
  buildCjAuthorizationHeader,
  serializeFetchFailure,
  throttleCj,
  validatePatForCjImport,
} from "./iu-cj-affiliate-phase1-lib.mjs";

export const CJ_GRAPHQL_PRODUCT_URL = "https://ads.api.cj.com/query";
/** Legacy REST host; DNS ENOTFOUND in current CJ infra — do not use for new probes. */
export const CJ_LEGACY_PRODUCT_SEARCH_HOST = "product-search.api.cj.com";

/**
 * CJ click paths observed in production:
 * - /click-{websitePid}-{linkId}
 * - /click-{websitePid}-{advertiserId}-{linkId} (Link Search live XML)
 * Optional query/path suffix after the numeric id trail is allowed.
 */
const CLICK_URL_RE = /^https?:\/\/[^/]+\/click-(\d+)-(\d+)(?:-(\d+))?(?:[/?]|$)/i;

/** Documented CJ click redirect host suffixes (not arbitrary third-party domains). */
export const CJ_TRUSTED_CLICK_HOST_SUFFIXES = [
  "anrdoezrs.net",
  "kqzyfj.com",
  "tkqlhce.com",
  "jdoqocy.com",
  "qksrv.net",
  "emjcd.com",
  "dpbolvw.net",
  "apmebf.com",
  "cj.dotomi.com",
];

export function isTrustedCjClickHost(clickUrl) {
  try {
    const h = new URL(String(clickUrl)).hostname.toLowerCase().replace(/^www\./, "");
    return CJ_TRUSTED_CLICK_HOST_SUFFIXES.some((s) => h === s || h.endsWith("." + s));
  } catch {
    return false;
  }
}

export function parseAffiliateClickUrl(clickUrl, expectedWebsitePid) {
  const raw = String(clickUrl || "").trim();
  if (!raw) {
    return {
      present: false,
      documentedFormat: false,
      trustedClickHost: false,
      websitePidInUrl: null,
      advertiserIdInUrl: null,
      linkIdInUrl: null,
      matchesExpectedWebsitePid: false,
    };
  }
  const m = raw.match(CLICK_URL_RE);
  const trustedClickHost = isTrustedCjClickHost(raw);
  if (!m) {
    return {
      present: true,
      documentedFormat: false,
      trustedClickHost,
      websitePidInUrl: null,
      advertiserIdInUrl: null,
      linkIdInUrl: null,
      matchesExpectedWebsitePid: false,
    };
  }
  const pid = m[1];
  const threeSegment = Boolean(m[3]);
  const advertiserIdInUrl = threeSegment ? m[2] : null;
  const linkId = threeSegment ? m[3] : m[2];
  const exp = String(expectedWebsitePid || "").trim();
  const structureOk = true;
  return {
    present: true,
    documentedFormat: structureOk && trustedClickHost,
    trustedClickHost,
    websitePidInUrl: pid,
    advertiserIdInUrl,
    linkIdInUrl: linkId,
    matchesExpectedWebsitePid: Boolean(exp && pid === exp),
  };
}

/**
 * Normalize cjGraphql() payload for shoppingProducts (catalog + probes).
 * @returns {{ ok: boolean, kind: string, httpStatus: number, resultList: object[]|null, totalCount: number|null, gqlErrors: object[], errorDetail?: string }}
 */
export function parseShoppingProductsGraphqlResponse(res) {
  const httpStatus = Number(res?.status || 0);
  const gqlErrors = Array.isArray(res?.gqlErrors) ? res.gqlErrors : [];
  if (res?.patFormatRejected) {
    return { ok: false, kind: "pat_format_rejected", httpStatus, resultList: null, totalCount: null, gqlErrors, errorDetail: res.patFormatReason };
  }
  if (res?.networkError) {
    return { ok: false, kind: "network_error", httpStatus, resultList: null, totalCount: null, gqlErrors, errorDetail: res.network?.reason || "network_error" };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { ok: false, kind: "http_auth", httpStatus, resultList: null, totalCount: null, gqlErrors, errorDetail: "http_" + httpStatus };
  }
  if (httpStatus >= 400) {
    return { ok: false, kind: "http_error", httpStatus, resultList: null, totalCount: null, gqlErrors, errorDetail: "http_" + httpStatus };
  }
  if (res?.jsonParseError) {
    return { ok: false, kind: "json_parse_error", httpStatus, resultList: null, totalCount: null, gqlErrors, errorDetail: res.jsonParseError };
  }
  if (gqlErrors.length > 0) {
    return { ok: false, kind: "graphql_error", httpStatus, resultList: null, totalCount: null, gqlErrors, errorDetail: gqlErrors[0]?.message || "graphql_error" };
  }
  const block = res?.json?.data?.shoppingProducts ?? res?.json?.data?.products;
  if (block == null) {
    if (res?.json?.data != null) {
      return { ok: false, kind: "graphql_shape_unexpected", httpStatus, resultList: null, totalCount: null, gqlErrors, errorDetail: "missing_shoppingProducts_block" };
    }
    return { ok: false, kind: "empty_data", httpStatus, resultList: null, totalCount: null, gqlErrors, errorDetail: "graphql_data_null" };
  }
  const list = Array.isArray(block.resultList) ? block.resultList : null;
  if (list === null) {
    return { ok: false, kind: "graphql_shape_unexpected", httpStatus, resultList: null, totalCount: block.totalCount ?? null, gqlErrors, errorDetail: "resultList_not_array" };
  }
  if (list.length === 0) {
    return { ok: true, kind: "empty_catalog", httpStatus, resultList: [], totalCount: block.totalCount ?? 0, gqlErrors, errorDetail: null };
  }
  return { ok: true, kind: "success", httpStatus, resultList: list, totalCount: block.totalCount ?? list.length, gqlErrors, errorDetail: null };
}

export function buildPublisherProductsQuery(companyId, partnerId, websitePid, limit = 3, opts = {}) {
  const cid = String(companyId).replace(/"/g, "");
  const pid = String(partnerId).replace(/"/g, "");
  const wp = String(websitePid).replace(/"/g, "");
  const lim = Math.max(1, Math.min(10, Number(limit) || 3));
  const parts = [
    `companyId: "${cid}"`,
    `partnerIds: ["${pid}"]`,
    `partnerStatus: JOINED`,
    `limit: ${lim}`,
  ];
  if (opts.adIds?.length) {
    parts.push(`adIds: [${opts.adIds.map((id) => `"${String(id).replace(/"/g, "")}"`).join(", ")}]`);
  }
  if (opts.keywords?.length) {
    parts.push(`keywords: [${opts.keywords.map((k) => `"${String(k).replace(/"/g, "").slice(0, 40)}"`).join(", ")}]`);
  }
  return `{ shoppingProducts(${parts.join(", ")}) { totalCount resultList { advertiserId id title description availability price { amount currency } imageLink linkCode(pid: "${wp}") { clickUrl } } } }`;
}

export function buildTravelProductsQuery(companyId, partnerId, websitePid, limit = 3, adIds = []) {
  const cid = String(companyId).replace(/"/g, "");
  const pid = String(partnerId).replace(/"/g, "");
  const wp = String(websitePid).replace(/"/g, "");
  const lim = Math.max(1, Math.min(5, Number(limit) || 3));
  const adPart = adIds.length ? `, adIds: [${adIds.map((id) => `"${id}"`).join(", ")}]` : "";
  return `{ travelExperienceProducts(companyId: "${cid}", partnerIds: ["${pid}"], partnerStatus: JOINED, limit: ${lim}${adPart}) { totalCount resultList { advertiserId id title description price { amount currency } imageLink linkCode(pid: "${wp}") { clickUrl } } } }`;
}

export async function cjGraphql(query, pat) {
  const patCheck = validatePatForCjImport(pat);
  if (!patCheck.ok) {
    return {
      ok: false,
      status: 0,
      networkError: false,
      patFormatRejected: true,
      patFormatReason: patCheck.reason,
      json: null,
      auth: { authenticated: false, reason: "pat_format_rejected", httpStatus: 0 },
    };
  }
  await throttleCj();
  const timeoutMs = Number(process.env.IU_CJ_FETCH_TIMEOUT_MS || 120000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const authorization = buildCjAuthorizationHeader(pat);
  try {
    const res = await fetch(CJ_GRAPHQL_PRODUCT_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    const body = await res.text();
    let json = null;
    let jsonParseError = null;
    try {
      json = JSON.parse(body);
    } catch (parseErr) {
      json = null;
      jsonParseError = String(parseErr?.message || "json_parse_failed").slice(0, 120);
    }
    let gqlErrors = Array.isArray(json?.errors)
      ? json.errors.map((e) => ({
          message: String(e?.message || "").slice(0, 300),
          extensionsCode: e?.extensions?.code ? String(e.extensions.code) : null,
        }))
      : [];
    if (gqlErrors.length === 0 && res.status >= 400 && body.trim()) {
      gqlErrors = [{ message: body.trim().slice(0, 300), extensionsCode: "http_" + res.status }];
    }
    const authenticated =
      res.status !== 401 &&
      res.status !== 403 &&
      !gqlErrors.some((e) => /not authenticated|unauthorized|forbidden/i.test(String(e?.message || "")));
    return {
      ok: res.ok && gqlErrors.length === 0 && json?.data != null,
      status: res.status,
      networkError: false,
      json,
      gqlErrors,
      auth: {
        authenticated,
        reason: res.status === 401 ? "not_authenticated" : res.status === 403 ? "not_authorized" : gqlErrors.length ? "graphql_error" : "json_ok",
        httpStatus: res.status,
      },
      bodySnippet: body.slice(0, 300),
      jsonParseError,
    };
  } catch (err) {
    const network = serializeFetchFailure(err, CJ_GRAPHQL_PRODUCT_URL);
    return {
      ok: false,
      status: 0,
      networkError: true,
      network,
      json: null,
      gqlErrors: [],
      auth: { authenticated: false, reason: "network_error", httpStatus: 0 },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function mapGraphqlProductRow(row, websitePid) {
  const price = row?.price || {};
  const click = row?.linkCode?.clickUrl || "";
  const affiliate = parseAffiliateClickUrl(click, websitePid);
  const title = row?.title != null ? String(row.title) : "";
  const desc = row?.description != null ? String(row.description) : "";
  return {
    productId: row?.id != null ? String(row.id) : null,
    advertiserId: row?.advertiserId != null ? String(row.advertiserId) : null,
    name: title || null,
    variant: null,
    description: desc || null,
    price: price.amount != null ? String(price.amount) : null,
    currency: price.currency != null ? String(price.currency) : null,
    availability: row?.availability != null ? String(row.availability) : null,
    imageUrl: row?.imageLink != null ? String(row.imageLink) : null,
    affiliateClickUrl: click || null,
    affiliateLink: affiliate,
    imageUsageRights: "not_verified",
    imageUrlPresent: Boolean(String(row?.imageLink || "").trim()),
    fieldsMissing: [
      !title && "name",
      price.amount == null && "price",
      !price.currency && "currency",
      row?.availability == null && "availability",
      !String(row?.imageLink || "").trim() && "imageUrl",
      !affiliate.documentedFormat && "affiliate_click_url_format",
    ].filter(Boolean),
  };
}

/** Classify probe outcome for tests and audit (no PAT required when input is synthetic). */
export function classifyProductProbeOutcome(probe) {
  if (probe.patFormatRejected) return { kind: "pat_format_rejected", httpLayer: false };
  if (probe.networkError) {
    const code = probe.network?.causeCode || probe.network?.reason || "network_error";
    return { kind: "transport_error", httpLayer: false, causeCode: code };
  }
  if (probe.status >= 400) return { kind: "http_error", httpLayer: true, httpStatus: probe.status };
  if (probe.gqlErrors?.length) return { kind: "api_graphql_error", httpLayer: true, httpStatus: probe.status };
  const list = probe.products || [];
  if (!probe.ok) return { kind: "api_error", httpLayer: true, httpStatus: probe.status };
  if (list.length === 0) return { kind: "empty_result", httpLayer: true, httpStatus: probe.status };
  return { kind: "success_with_products", httpLayer: true, httpStatus: probe.status, count: list.length };
}

export function buildShoppingProductFeedsQuery(companyId, partnerId, limit = 5) {
  const cid = String(companyId).replace(/"/g, "");
  const pid = String(partnerId).replace(/"/g, "");
  const lim = Math.max(1, Math.min(10, Number(limit) || 5));
  return `query { shoppingProductFeeds(companyId: "${cid}", partnerIds: ["${pid}"], limit: ${lim}) { totalCount resultList { adId feedName advertiserId productCount lastUpdated sourceFeedType currency language } } }`;
}

export async function probeShoppingProductFeeds(env, partnerId) {
  if (!env.publisherCid) {
    return { ok: false, status: 0, feeds: [], totalCount: null, api: "graphql_shoppingProductFeeds" };
  }
  const query = buildShoppingProductFeedsQuery(env.publisherCid, partnerId, 5);
  const res = await cjGraphql(query, env.pat);
  const block = res.json?.data?.shoppingProductFeeds;
  const list = Array.isArray(block?.resultList) ? block.resultList : res.ok ? [] : null;
  return {
    ...res,
    api: "graphql_shoppingProductFeeds",
    feeds: list || [],
    totalCount: block?.totalCount ?? null,
    feedListNull: list === null,
  };
}

export async function probePublisherProductsGraphql(env, partnerId, limit = 3, opts = {}) {
  if (!env.publisherCid) {
    return {
      ok: false,
      status: 0,
      networkError: false,
      api: "graphql_products",
      error: "missing_publisher_company_id",
      products: [],
      totalCount: null,
    };
  }
  const query = "query " + buildPublisherProductsQuery(env.publisherCid, partnerId, env.websitePid, limit, opts);
  const res = await cjGraphql(query, env.pat);
  if (res.networkError || res.patFormatRejected || !res.ok) {
    return {
      ...res,
      api: "graphql_products",
      products: [],
      totalCount: null,
      parseError: null,
    };
  }
  const block = res.json?.data?.shoppingProducts ?? res.json?.data?.products;
  const list = Array.isArray(block?.resultList) ? block.resultList : null;
  if (list === null) {
    return {
      ...res,
      api: "graphql_products",
      products: [],
      totalCount: null,
      parseError: "graphql_shopping_products_shape_unexpected",
    };
  }
  const products = list.map((row) => mapGraphqlProductRow(row, env.websitePid));
  return {
    ...res,
    api: "graphql_products",
    products,
    totalCount: block?.totalCount ?? null,
    parseError: null,
  };
}
