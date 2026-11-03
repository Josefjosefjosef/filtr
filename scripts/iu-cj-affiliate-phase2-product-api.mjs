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
 * Documented CJ Product Details Search limits
 * (https://docs.cj.com/docs/productfeed-api-search):
 * - default ≤ 1 000 records
 * - max 10 000 per query (offset+limit)
 * - >10 000 → page token or Subscription Query
 * The former robot Math.min(10,…) was an artificial repo cap, not a CJ API hard max.
 */
export const CJ_PRODUCT_SEARCH_DEFAULT_LIMIT = 1000;
export const CJ_PRODUCT_SEARCH_MAX_LIMIT = 10000;
export const CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT = 100;
/** CJ docs show 1-based offset for the first page. */
export const CJ_PRODUCT_SEARCH_OFFSET_FIRST = 1;

export function clampProductSearchLimit(limit, fallback = CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT) {
  const n = Number(limit);
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(1, Math.min(CJ_PRODUCT_SEARCH_MAX_LIMIT, Math.floor(base)));
}

/**
 * Normalize cjGraphql() payload for shoppingProducts (catalog + probes).
 * @returns {{ ok: boolean, kind: string, httpStatus: number, resultList: object[]|null, totalCount: number|null, count: number|null, limit: number|null, page: string|null, gqlErrors: object[], errorDetail?: string }}
 */
export function parseShoppingProductsGraphqlResponse(res) {
  const httpStatus = Number(res?.status || 0);
  const gqlErrors = Array.isArray(res?.gqlErrors) ? res.gqlErrors : [];
  const emptyMeta = { count: null, limit: null, page: null };
  if (res?.patFormatRejected) {
    return { ok: false, kind: "pat_format_rejected", httpStatus, resultList: null, totalCount: null, ...emptyMeta, gqlErrors, errorDetail: res.patFormatReason };
  }
  if (res?.networkError) {
    return { ok: false, kind: "network_error", httpStatus, resultList: null, totalCount: null, ...emptyMeta, gqlErrors, errorDetail: res.network?.reason || "network_error" };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return { ok: false, kind: "http_auth", httpStatus, resultList: null, totalCount: null, ...emptyMeta, gqlErrors, errorDetail: "http_" + httpStatus };
  }
  if (httpStatus >= 400) {
    return { ok: false, kind: "http_error", httpStatus, resultList: null, totalCount: null, ...emptyMeta, gqlErrors, errorDetail: "http_" + httpStatus };
  }
  if (res?.jsonParseError) {
    return { ok: false, kind: "json_parse_error", httpStatus, resultList: null, totalCount: null, ...emptyMeta, gqlErrors, errorDetail: res.jsonParseError };
  }
  if (gqlErrors.length > 0) {
    return { ok: false, kind: "graphql_error", httpStatus, resultList: null, totalCount: null, ...emptyMeta, gqlErrors, errorDetail: gqlErrors[0]?.message || "graphql_error" };
  }
  const block = res?.json?.data?.shoppingProducts ?? res?.json?.data?.products;
  if (block == null) {
    if (res?.json?.data != null) {
      return { ok: false, kind: "graphql_shape_unexpected", httpStatus, resultList: null, totalCount: null, ...emptyMeta, gqlErrors, errorDetail: "missing_shoppingProducts_block" };
    }
    return { ok: false, kind: "empty_data", httpStatus, resultList: null, totalCount: null, ...emptyMeta, gqlErrors, errorDetail: "graphql_data_null" };
  }
  const list = Array.isArray(block.resultList) ? block.resultList : null;
  const pageToken =
    block.page != null && String(block.page).trim() !== "" ? String(block.page) : null;
  const count = block.count != null ? Number(block.count) : list ? list.length : null;
  const limit = block.limit != null ? Number(block.limit) : null;
  if (list === null) {
    return {
      ok: false,
      kind: "graphql_shape_unexpected",
      httpStatus,
      resultList: null,
      totalCount: block.totalCount ?? null,
      count,
      limit,
      page: pageToken,
      gqlErrors,
      errorDetail: "resultList_not_array",
    };
  }
  if (list.length === 0) {
    return {
      ok: true,
      kind: "empty_catalog",
      httpStatus,
      resultList: [],
      totalCount: block.totalCount ?? 0,
      count: count ?? 0,
      limit,
      page: pageToken,
      gqlErrors,
      errorDetail: null,
    };
  }
  return {
    ok: true,
    kind: "success",
    httpStatus,
    resultList: list,
    totalCount: block.totalCount ?? list.length,
    count: count ?? list.length,
    limit,
    page: pageToken,
    gqlErrors,
    errorDetail: null,
  };
}

/**
 * Build shoppingProducts GraphQL selection.
 * Supports documented pagination args: limit (≤10000), offset (≤10k window), page token (>10k).
 * Do NOT pass offset together with page (CJ docs).
 *
 * V30.1: selection stays on fields proven in production (`totalCount` + `resultList`).
 * Requesting `count`/`limit`/`page` as response fields caused HTTP 400 on ads.api.cj.com
 * (feeds inventory still OK). Page-token continuation therefore relies on args only when
 * the API returns usable continuation via totalCount vs fetched length.
 */
export function buildPublisherProductsQuery(companyId, partnerId, websitePid, limit = CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT, opts = {}) {
  const cid = String(companyId).replace(/"/g, "");
  const pid = String(partnerId).replace(/"/g, "");
  const wp = String(websitePid).replace(/"/g, "");
  const lim = clampProductSearchLimit(limit, CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT);
  const parts = [
    `companyId: "${cid}"`,
    `partnerIds: ["${pid}"]`,
    `partnerStatus: JOINED`,
    `limit: ${lim}`,
  ];
  const pageTok = opts.page != null && String(opts.page).trim() !== "" ? String(opts.page).replace(/"/g, "") : null;
  if (pageTok) {
    parts.push(`page: "${pageTok}"`);
  } else if (opts.offset != null && Number.isFinite(Number(opts.offset))) {
    // Omit offset=0/1-first when explicitly disabled; first page should omit offset entirely.
    const off = Math.max(0, Math.floor(Number(opts.offset)));
    if (off > 0) parts.push(`offset: ${off}`);
  }
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

export function buildShoppingProductFeedsQuery(companyId, partnerId, limit = 50, opts = {}) {
  const cid = String(companyId).replace(/"/g, "");
  const pid = String(partnerId).replace(/"/g, "");
  const lim = clampProductSearchLimit(limit, 50);
  const parts = [`companyId: "${cid}"`, `partnerIds: ["${pid}"]`, `limit: ${lim}`];
  if (opts.offset != null && Number.isFinite(Number(opts.offset))) {
    parts.push(`offset: ${Math.max(0, Math.floor(Number(opts.offset)))}`);
  }
  return `query { shoppingProductFeeds(${parts.join(", ")}) { totalCount count resultList { adId feedName advertiserId productCount lastUpdated sourceFeedType currency language advertiserCountry advertiserName } } }`;
}

export async function probeShoppingProductFeeds(env, partnerId, opts = {}) {
  if (!env.publisherCid) {
    return { ok: false, status: 0, feeds: [], totalCount: null, api: "graphql_shoppingProductFeeds" };
  }
  const pageLimit = clampProductSearchLimit(opts.limit ?? 50, 50);
  const query = buildShoppingProductFeedsQuery(env.publisherCid, partnerId, pageLimit, opts);
  const res = await cjGraphql(query, env.pat);
  const block = res.json?.data?.shoppingProductFeeds;
  const list = Array.isArray(block?.resultList) ? block.resultList : res.ok ? [] : null;
  return {
    ...res,
    api: "graphql_shoppingProductFeeds",
    feeds: list || [],
    totalCount: block?.totalCount ?? null,
    count: block?.count ?? (list ? list.length : null),
    feedListNull: list === null,
  };
}

/**
 * Inventory all shoppingProductFeeds pages for one partner (offset pagination).
 */
export async function inventoryShoppingProductFeedsForPartner(env, partnerId, opts = {}) {
  const pageSize = clampProductSearchLimit(opts.pageSize ?? 50, 50);
  const maxPages = Math.max(1, Math.min(200, Number(opts.maxPages) || 40));
  const feeds = [];
  const pages = [];
  let offset = CJ_PRODUCT_SEARCH_OFFSET_FIRST;
  let totalCount = null;
  let complete = false;
  let truncated = false;
  let error = null;
  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const res = await probeShoppingProductFeeds(env, partnerId, { limit: pageSize, offset });
    if (!res.ok && res.feedListNull) {
      error = res.auth?.reason || "feeds_query_failed";
      break;
    }
    const batch = Array.isArray(res.feeds) ? res.feeds : [];
    totalCount = res.totalCount != null ? Number(res.totalCount) : totalCount;
    pages.push({
      pageIdx,
      offset,
      got: batch.length,
      totalCount,
    });
    for (const f of batch) feeds.push(f);
    if (batch.length === 0) {
      complete = true;
      break;
    }
    if (Number.isFinite(totalCount) && feeds.length >= totalCount) {
      complete = true;
      break;
    }
    if (batch.length < pageSize) {
      complete = true;
      break;
    }
    offset += pageSize;
  }
  if (!complete && !error) truncated = true;
  return {
    ok: !error,
    partnerId: String(partnerId),
    feeds,
    feedCount: feeds.length,
    declaredProductCount: feeds.reduce((s, f) => s + (Number(f.productCount) || 0), 0),
    totalCount,
    complete,
    truncated,
    error,
    pages,
  };
}

/**
 * Fetch one shoppingProducts page (offset or page-token mode).
 */
export async function fetchShoppingProductsPage(env, partnerId, opts = {}) {
  if (!env.publisherCid) {
    return {
      ok: false,
      kind: "missing_publisher_company_id",
      resultList: [],
      totalCount: null,
      count: null,
      limit: null,
      page: null,
    };
  }
  const limit = clampProductSearchLimit(opts.limit ?? CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT);
  const qOpts = {};
  if (opts.page) qOpts.page = opts.page;
  else if (opts.offset != null) qOpts.offset = opts.offset;
  if (opts.adIds?.length) qOpts.adIds = opts.adIds;
  if (opts.keywords?.length) qOpts.keywords = opts.keywords;
  const query = "query " + buildPublisherProductsQuery(env.publisherCid, partnerId, env.websitePid, limit, qOpts);
  const res = await cjGraphql(query, env.pat);
  const parsed = parseShoppingProductsGraphqlResponse(res);
  return {
    ...parsed,
    api: "graphql_products",
    requestedLimit: limit,
    requestedOffset: opts.offset ?? null,
    requestedPage: opts.page ?? null,
  };
}

/**
 * Paginate all available shoppingProducts for one JOINED partner.
 * Uses offset+limit while cumulative < 10000; then page tokens when needed.
 * Never treats a partial page set as a complete catalog (complete=false).
 */
export async function fetchAllShoppingProductsForPartner(env, partnerId, opts = {}) {
  const pageSize = clampProductSearchLimit(
    opts.pageSize ?? CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT,
    CJ_PRODUCT_SEARCH_PAGE_SIZE_DEFAULT
  );
  const maxPages = Math.max(1, Math.min(500, Number(opts.maxPages) || 100));
  const stopAfterCount =
    opts.stopAfterCount != null && Number.isFinite(Number(opts.stopAfterCount)) && Number(opts.stopAfterCount) > 0
      ? Math.floor(Number(opts.stopAfterCount))
      : null;
  const startOffset =
    opts.resumeOffset != null && Number.isFinite(Number(opts.resumeOffset))
      ? Math.max(CJ_PRODUCT_SEARCH_OFFSET_FIRST, Math.floor(Number(opts.resumeOffset)))
      : CJ_PRODUCT_SEARCH_OFFSET_FIRST;
  const rows = [];
  const pageLog = [];
  const seenIds = new Set();
  let totalCount = null;
  let complete = false;
  let truncated = false;
  let repeatedCursor = false;
  let incompleteResponse = false;
  let stoppedEarlyForBudget = false;
  let error = null;
  let mode = "offset";
  let offset = startOffset;
  let pageToken = opts.resumePage || null;
  let prevPageToken = null;

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const req =
      mode === "page" || pageToken
        ? { limit: Math.min(pageSize, CJ_PRODUCT_SEARCH_MAX_LIMIT), page: pageToken, adIds: opts.adIds }
        : pageIdx === 0 && offset <= CJ_PRODUCT_SEARCH_OFFSET_FIRST
          ? { limit: pageSize, adIds: opts.adIds } // first page: omit offset (avoids http_400 on some schemas)
          : { limit: pageSize, offset, adIds: opts.adIds };
    if (pageToken) mode = "page";
    const parsed = await fetchShoppingProductsPage(env, partnerId, req);
    pageLog.push({
      pageIdx,
      mode,
      offset: req.offset ?? null,
      pageTokenPresent: Boolean(req.page),
      ok: parsed.ok === true,
      kind: parsed.kind,
      got: (parsed.resultList || []).length,
      totalCount: parsed.totalCount,
      count: parsed.count,
      nextPage: parsed.page ? "present" : null,
    });
    if (!parsed.ok) {
      error = parsed.errorDetail || parsed.kind || "page_failed";
      incompleteResponse = true;
      break;
    }
    if (parsed.totalCount != null) totalCount = Number(parsed.totalCount);
    const batch = parsed.resultList || [];
    let newInPage = 0;
    for (const row of batch) {
      const id = row?.id != null ? String(row.id) : null;
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      rows.push(row);
      newInPage += 1;
    }
    if (batch.length > 0 && newInPage === 0) {
      repeatedCursor = true;
      incompleteResponse = true;
      error = "repeated_or_stale_cursor";
      break;
    }
    if (stopAfterCount != null && rows.length >= stopAfterCount) {
      stoppedEarlyForBudget = true;
      // Not a technical loss of API paging — intentional presentation/runtime budget stop.
      complete = Number.isFinite(totalCount) ? rows.length >= totalCount : false;
      truncated = !complete;
      break;
    }
    if (mode === "offset" && Number.isFinite(totalCount) && totalCount > CJ_PRODUCT_SEARCH_MAX_LIMIT && offset + batch.length - 1 >= CJ_PRODUCT_SEARCH_MAX_LIMIT) {
      // Switch to page-token mode for remainder when CJ returns a continuation token.
      if (parsed.page) {
        mode = "page";
        pageToken = parsed.page;
        prevPageToken = parsed.page;
        continue;
      }
    }
    if (mode === "page") {
      if (!parsed.page || parsed.page === prevPageToken) {
        if (Number.isFinite(totalCount) && rows.length >= totalCount) complete = true;
        else if (batch.length === 0) complete = true;
        else if (!parsed.page) complete = Number.isFinite(totalCount) ? rows.length >= totalCount : batch.length < pageSize;
        else {
          repeatedCursor = true;
          error = "repeated_page_token";
          incompleteResponse = true;
        }
        break;
      }
      prevPageToken = parsed.page;
      pageToken = parsed.page;
      if (Number.isFinite(totalCount) && rows.length >= totalCount) {
        complete = true;
        break;
      }
      continue;
    }
    // offset mode
    if (batch.length === 0) {
      complete = true;
      break;
    }
    if (Number.isFinite(totalCount) && rows.length >= totalCount) {
      complete = true;
      break;
    }
    if (batch.length < pageSize) {
      complete = true;
      break;
    }
    offset += pageSize;
    if (offset > CJ_PRODUCT_SEARCH_MAX_LIMIT && !parsed.page) {
      // Cannot continue past 10k without page token.
      truncated = true;
      incompleteResponse = true;
      error = "needs_page_token_or_subscription_above_10k";
      break;
    }
  }
  if (!complete && !error) {
    truncated = true;
    incompleteResponse = true;
  }
  return {
    ok: !error || rows.length > 0,
    partnerId: String(partnerId),
    resultList: rows,
    fetchedCount: rows.length,
    totalCount,
    complete,
    truncated,
    repeatedCursor,
    incompleteResponse,
    stoppedEarlyForBudget,
    error,
    pageLog,
    checkpoint: {
      nextOffset: complete || stoppedEarlyForBudget ? null : offset,
      nextPage: complete || stoppedEarlyForBudget ? null : pageToken,
      mode,
    },
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
