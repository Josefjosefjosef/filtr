#!/usr/bin/env node
/**
 * Phase 3C — read-only live CJ audit (fetch ≠ publish).
 *
 * Requires IU_CJ_PAT + IU_CJ_PUBLISHER_CID + IU_CJ_WEBSITE_PID in env.
 * Writes sanitized report under %TEMP% (or IU_CJ_LIVE_AUDIT_OUT) — never into public assets.
 * Never sets liveEnabled, never writes managed-public, never arms publish.
 *
 * Empty result ≠ success: distinguishes auth/network/pagination/empty_verified.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CJ_ADVERTISER_LOOKUP_BASE,
  CJ_LINK_SEARCH_BASE,
  CJ_DEFAULT_RECORDS_PER_PAGE,
  clearCjEnvFromProcess,
  cjGet,
  finishNodeProcessAfterNetwork,
  parseAdvertiserBlocks,
  parseAdvertiserRecord,
  parseLinkBlocks,
  parseLinkRecord,
  parseListMeta,
  readJson,
} from "./iu-cj-affiliate-phase1-lib.mjs";
import { readCjPatFromEnv } from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import {
  buildPublisherProductsQuery,
  cjGraphql,
  isTrustedCjClickHost,
  parseAffiliateClickUrl,
  parseShoppingProductsGraphqlResponse,
} from "./iu-cj-affiliate-phase2-product-api.mjs";
import {
  CATALOG_RECORD_KIND,
  normalizeCjLinkToCatalogRecord,
} from "./iu-cj-affiliate-phase2-cj-link-search-catalog-normalize-v1.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID_DEFAULT = "101883843";

function redact(s, pat) {
  const p = String(pat || "");
  let out = String(s || "");
  if (p) out = out.split(p).join("[REDACTED_PAT]");
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAllPages({ baseUrl, queryBase, pat, parseBlocks, parseRecord, kind, maxPages }) {
  const pages = [];
  const records = [];
  let totalMatched = null;
  let page = 1;
  let incomplete = false;
  let lastHttp = null;
  const limit = Math.max(1, Math.min(50, Number(maxPages) || 30));

  while (page <= limit) {
    const url =
      baseUrl +
      "?" +
      queryBase +
      "&page-number=" +
      page +
      "&records-per-page=" +
      CJ_DEFAULT_RECORDS_PER_PAGE;
    const res = await cjGet(url, pat);
    lastHttp = {
      kind,
      page,
      status: res.status,
      ok: res.ok,
      authReason: res.auth?.reason || null,
      networkError: Boolean(res.networkError),
    };
    if (res.networkError) {
      return {
        ok: false,
        reason: "network_error",
        records,
        pages,
        totalMatched,
        incomplete: true,
        lastHttp,
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: "auth_failed_" + res.status,
        records,
        pages,
        totalMatched,
        incomplete: true,
        lastHttp,
      };
    }
    if (!res.ok || res.status >= 400) {
      return {
        ok: false,
        reason: "http_" + res.status,
        records,
        pages,
        totalMatched,
        incomplete: true,
        lastHttp,
      };
    }
    const meta = parseListMeta(res.body || "");
    if (totalMatched == null) totalMatched = meta.totalMatched;
    const blocks = parseBlocks(res.body || "");
    const pageRecords = blocks.map(parseRecord);
    records.push(...pageRecords);
    pages.push({
      page,
      recordsReturned: meta.recordsReturned || pageRecords.length,
      totalMatched: meta.totalMatched,
      parsed: pageRecords.length,
    });
    if (pageRecords.length === 0) {
      if ((meta.totalMatched || 0) > 0 && records.length < meta.totalMatched) {
        incomplete = true;
        return {
          ok: false,
          reason: "empty_page_before_complete",
          records,
          pages,
          totalMatched,
          incomplete,
          lastHttp,
        };
      }
      break;
    }
    if (totalMatched != null && records.length >= totalMatched) break;
    if (pageRecords.length < CJ_DEFAULT_RECORDS_PER_PAGE) break;
    page += 1;
    await sleep(100);
  }

  if (totalMatched != null && records.length < totalMatched && page > limit) {
    incomplete = true;
    return {
      ok: false,
      reason: "pagination_cap_incomplete",
      records,
      pages,
      totalMatched,
      incomplete,
      lastHttp,
    };
  }

  if (totalMatched === 0 && records.length === 0) {
    return {
      ok: true,
      reason: "empty_result_verified",
      records,
      pages,
      totalMatched: 0,
      incomplete: false,
      lastHttp,
      emptySuccess: true,
    };
  }

  return {
    ok: true,
    reason: "complete",
    records,
    pages,
    totalMatched,
    incomplete: false,
    lastHttp,
  };
}

function classifyLinkBucket(link, refDate) {
  const norm = normalizeCjLinkToCatalogRecord(link, {
    observedAt: refDate.toISOString(),
    websitePid: process.env.IU_CJ_WEBSITE_PID || WEBSITE_PID_DEFAULT,
    refDate,
  });
  return {
    recordKind: norm.recordKind,
    validationState: norm.validationState,
    blockers: norm.blockers || [],
    couponCode: norm.record?.couponCode || null,
    offerId: norm.record?.offerId || null,
    advertiserId: norm.record?.partnerId || null,
    affiliateUrlTrusted: isCjTrackingUrl(norm.record?.affiliateUrl) || isTrustedCjClickHost(norm.record?.affiliateUrl),
    clickMeta: parseAffiliateClickUrl(
      norm.record?.affiliateUrl,
      process.env.IU_CJ_WEBSITE_PID || WEBSITE_PID_DEFAULT
    ),
  };
}

function isExpired(link, ref) {
  const end = link.promotionEndDate;
  if (!end) return false;
  const t = Date.parse(String(end).replace(" ", "T"));
  if (!Number.isFinite(t)) return false;
  return t < ref.getTime();
}

export async function runPhase3cLiveReadonlyAudit(opts = {}) {
  const env = opts.env || process.env;
  const pat = readCjPatFromEnv(env);
  const publisherCid = String(env.IU_CJ_PUBLISHER_CID || "").trim();
  const websitePid = String(env.IU_CJ_WEBSITE_PID || "").trim();
  const outDir =
    opts.outDir ||
    env.IU_CJ_LIVE_AUDIT_OUT ||
    path.join(os.tmpdir(), "iu-cj-phase3c-live-audit");
  const refDate = opts.refDate || new Date();
  const maxAdvPages = Number(env.IU_CJ_LIVE_AUDIT_MAX_ADV_PAGES || 40);
  const maxLinkPages = Number(env.IU_CJ_LIVE_AUDIT_MAX_LINK_PAGES || 40);
  const productSampleLimit = Number(env.IU_CJ_LIVE_AUDIT_PRODUCT_PARTNERS || 5);

  const report = {
    schema: "iu-cj-phase3c-live-readonly-audit-v1",
    at: new Date().toISOString(),
    mode: "live_readonly",
    liveEnabledTouched: false,
    publishArmed: false,
    r2Write: false,
    credentialSource: env.IU_CJ_CREDENTIAL_SOURCE || "env",
    publisherCidConfigured: Boolean(publisherCid),
    websitePidConfigured: Boolean(websitePid),
    patConfigured: Boolean(pat),
    websitePidMatchesExpected: websitePid === WEBSITE_PID_DEFAULT,
    auth: null,
    advertisers: null,
    links: null,
    products: null,
    catalogCompare: null,
    rejectReasons: {},
    ok: false,
    reason: "not_started",
    note: "Read-only live audit. Not a production publish proof. PAT never stored in this report.",
  };

  if (!pat || !publisherCid || !websitePid) {
    report.reason = "credentials_missing";
    report.ok = false;
    fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, "phase3c-live-audit-report.json");
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n", "utf8");
    return { ok: false, report, reportPath: p };
  }

  // Auth probe: joined advertisers page 1 (CJ uses advertiser-ids=joined)
  const probeUrl =
    CJ_ADVERTISER_LOOKUP_BASE +
    "?requestor-cid=" +
    encodeURIComponent(publisherCid) +
    "&advertiser-ids=joined&records-per-page=1&page-number=1";
  const probe = await cjGet(probeUrl, pat);
  report.auth = {
    httpStatus: probe.status,
    authenticated: probe.auth?.authenticated === true || (probe.ok && probe.status === 200),
    reason: probe.auth?.reason || (probe.ok ? "http_ok" : "http_" + probe.status),
    networkError: Boolean(probe.networkError),
  };
  if (!report.auth.authenticated) {
    report.ok = false;
    report.reason = "auth_failed";
    fs.mkdirSync(outDir, { recursive: true });
    const p = path.join(outDir, "phase3c-live-audit-report.json");
    fs.writeFileSync(p, JSON.stringify(report, null, 2) + "\n", "utf8");
    return { ok: false, report, reportPath: p };
  }

  const adv = await fetchAllPages({
    baseUrl: CJ_ADVERTISER_LOOKUP_BASE,
    queryBase:
      "requestor-cid=" +
      encodeURIComponent(publisherCid) +
      "&advertiser-ids=joined",
    pat,
    parseBlocks: parseAdvertiserBlocks,
    parseRecord: parseAdvertiserRecord,
    kind: "advertiser_lookup_joined",
    maxPages: maxAdvPages,
  });
  const joined = (adv.records || []).filter((a) =>
    /joined/i.test(String(a.relationshipStatus || a.accountStatus || "")) || Boolean(a.advertiserId)
  );
  report.advertisers = {
    ok: adv.ok,
    reason: adv.reason,
    totalMatched: adv.totalMatched,
    fetched: (adv.records || []).length,
    joined: joined.length,
    incomplete: adv.incomplete === true,
    pages: (adv.pages || []).length,
    emptySuccess: adv.emptySuccess === true,
  };

  const couponLinks = await fetchAllPages({
    baseUrl: CJ_LINK_SEARCH_BASE,
    queryBase:
      "website-id=" +
      encodeURIComponent(websitePid) +
      "&advertiser-ids=joined&promotion-type=coupon",
    pat,
    parseBlocks: parseLinkBlocks,
    parseRecord: parseLinkRecord,
    kind: "link_search_coupon",
    maxPages: maxLinkPages,
  });
  const actionLinks = await fetchAllPages({
    baseUrl: CJ_LINK_SEARCH_BASE,
    queryBase:
      "website-id=" +
      encodeURIComponent(websitePid) +
      "&advertiser-ids=joined&promotion-type=" +
      encodeURIComponent("sale/discount"),
    pat,
    parseBlocks: parseLinkBlocks,
    parseRecord: parseLinkRecord,
    kind: "link_search_sale_discount",
    maxPages: Math.min(maxLinkPages, 20),
  });
  const links = {
    ok: couponLinks.ok && actionLinks.ok,
    reason: !couponLinks.ok
      ? couponLinks.reason
      : !actionLinks.ok
        ? actionLinks.reason
        : "complete",
    totalMatched: (couponLinks.totalMatched || 0) + (actionLinks.totalMatched || 0),
    records: [...(couponLinks.records || []), ...(actionLinks.records || [])],
    incomplete: couponLinks.incomplete === true || actionLinks.incomplete === true,
    pages: (couponLinks.pages || []).length + (actionLinks.pages || []).length,
    emptySuccess: couponLinks.emptySuccess === true && actionLinks.emptySuccess === true,
    coupon: {
      ok: couponLinks.ok,
      reason: couponLinks.reason,
      totalMatched: couponLinks.totalMatched,
      fetched: (couponLinks.records || []).length,
      incomplete: couponLinks.incomplete === true,
    },
    actions: {
      ok: actionLinks.ok,
      reason: actionLinks.reason,
      totalMatched: actionLinks.totalMatched,
      fetched: (actionLinks.records || []).length,
      incomplete: actionLinks.incomplete === true,
    },
  };

  const buckets = {
    coupon_with_code: 0,
    action_without_code: 0,
    product_offer: 0,
    incomplete: 0,
    invalid: 0,
    expired: 0,
    untrusted_affiliate_url: 0,
    duplicate_offer_ids: 0,
  };
  const seenOfferIds = new Set();
  const rejectReasons = {};
  function bumpReject(r) {
    rejectReasons[r] = (rejectReasons[r] || 0) + 1;
  }

  for (const link of links.records || []) {
    if (isExpired(link, refDate)) {
      buckets.expired += 1;
      bumpReject("expired");
    }
    if (link.linkId) {
      if (seenOfferIds.has(link.linkId)) {
        buckets.duplicate_offer_ids += 1;
        bumpReject("duplicate_offer_id");
      }
      seenOfferIds.add(link.linkId);
    }
    const c = classifyLinkBucket(link, refDate);
    if (buckets[c.recordKind] != null) buckets[c.recordKind] += 1;
    else buckets.incomplete += 1;
    if (!c.affiliateUrlTrusted && (c.clickMeta?.present || link.clickUrl)) {
      buckets.untrusted_affiliate_url += 1;
      bumpReject("untrusted_or_non_cj_tracking_url");
    }
    for (const b of c.blockers || []) bumpReject(b);
  }

  report.links = {
    ok: links.ok,
    reason: links.reason,
    totalMatched: links.totalMatched,
    fetched: (links.records || []).length,
    incomplete: links.incomplete === true,
    pages: links.pages,
    emptySuccess: links.emptySuccess === true,
    coupon: links.coupon,
    actions: links.actions,
    buckets,
  };
  report.rejectReasons = rejectReasons;

  // Product sample for first N joined advertisers that appear in managed-public or live joined
  const managedPath = path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json");
  const managed = readJson(managedPath, { partners: [] });
  const managedIds = new Set((managed.partners || []).map((p) => String(p.advertiserId)));
  const joinedIds = joined.map((a) => String(a.advertiserId)).filter(Boolean);
  const overlapIds = joinedIds.filter((id) => managedIds.has(id));
  const samplePartners = (
    overlapIds.length ? overlapIds : joinedIds
  ).slice(0, Math.max(productSampleLimit, 1));

  let productsOk = 0;
  let productsFail = 0;
  let withPhoto = 0;
  let withPrice = 0;
  let withCurrency = 0;
  let withTrustedClick = 0;
  let productTotal = 0;
  const productErrors = {};
  const productPartnerResults = [];

  for (const partnerId of samplePartners) {
    const q = buildPublisherProductsQuery(publisherCid, partnerId, websitePid, 5);
    const gql = await cjGraphql(q, pat);
    const parsed = parseShoppingProductsGraphqlResponse(gql);
    if (!parsed.ok) {
      productsFail += 1;
      productErrors[parsed.kind || "error"] = (productErrors[parsed.kind || "error"] || 0) + 1;
      productPartnerResults.push({
        advertiserId: partnerId,
        ok: false,
        kind: parsed.kind,
        httpStatus: parsed.httpStatus,
      });
      continue;
    }
    productsOk += 1;
    const list = parsed.resultList || [];
    productTotal += list.length;
    for (const item of list) {
      const img = item?.imageLink || item?.imageUrl;
      if (typeof img === "string" && /^https:\/\//i.test(img)) withPhoto += 1;
      const amount = item?.price?.amount ?? item?.price;
      if (amount != null && String(amount).trim() !== "") withPrice += 1;
      const cur = item?.price?.currency ?? item?.currency;
      if (cur) withCurrency += 1;
      const click = item?.linkCode?.clickUrl || item?.clickUrl;
      if (isTrustedCjClickHost(click) || isCjTrackingUrl(click)) withTrustedClick += 1;
    }
    productPartnerResults.push({
      advertiserId: partnerId,
      ok: true,
      kind: parsed.kind,
      count: list.length,
      totalCount: parsed.totalCount,
    });
  }

  report.products = {
    sampledPartners: samplePartners.length,
    partnersOk: productsOk,
    partnersFail: productsFail,
    productRows: productTotal,
    withPhoto,
    withPrice,
    withCurrency,
    withTrustedClick,
    errors: productErrors,
    partnerResults: productPartnerResults,
  };

  const overlapJoinedManaged = joined.filter((a) => managedIds.has(String(a.advertiserId))).length;
  report.catalogCompare = {
    managedPublicPartners: (managed.partners || []).length,
    liveJoinedAdvertisers: joined.length,
    overlapJoinedInManagedPublic: overlapJoinedManaged,
    managedNotInLiveJoinedSample: null,
  };

  const fatal =
    !adv.ok ||
    !links.ok ||
    adv.incomplete ||
    links.incomplete ||
    (adv.emptySuccess && links.emptySuccess === false && (links.totalMatched || 0) > 0 && (links.records || []).length === 0);

  report.ok = !fatal && report.auth.authenticated;
  report.reason = report.ok ? "live_readonly_audit_complete" : "live_readonly_audit_incomplete_or_error";
  if (adv.emptySuccess && links.emptySuccess) {
    report.ok = true;
    report.reason = "live_auth_ok_but_catalogs_empty_verified";
    report.note +=
      " Auth OK; both advertiser and link catalogs verified empty — not treated as silent success of populated inventory.";
  }

  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "phase3c-live-audit-report.json");
  const slimLinksPath = path.join(outDir, "phase3c-live-links-slim.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  // Slim link extract for offline UI fixture tests — no PAT; coupon codes only if present
  const slim = (links.records || []).slice(0, 200).map((l) => ({
    linkId: l.linkId,
    advertiserId: l.advertiserId,
    advertiserName: l.advertiserName,
    linkName: l.linkName,
    couponCode: l.couponCode || null,
    promotionType: l.promotionType,
    promotionStartDate: l.promotionStartDate,
    promotionEndDate: l.promotionEndDate,
    hasClickUrl: Boolean(l.clickUrl),
    clickTrusted: isTrustedCjClickHost(l.clickUrl) || isCjTrackingUrl(l.clickUrl),
  }));
  fs.writeFileSync(slimLinksPath, JSON.stringify({ at: report.at, count: slim.length, links: slim }, null, 2) + "\n", "utf8");

  return { ok: report.ok, report, reportPath, slimLinksPath, outDir };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runPhase3cLiveReadonlyAudit()
    .then(async (r) => {
      console.log(
        JSON.stringify({
          IU_CJ_PHASE3C_LIVE_READONLY_AUDIT: r.ok ? "OK" : "FAIL",
          reason: r.report.reason,
          reportPath: r.reportPath,
          auth: r.report.auth,
          advertisers: r.report.advertisers,
          links: {
            ok: r.report.links?.ok,
            reason: r.report.links?.reason,
            fetched: r.report.links?.fetched,
            totalMatched: r.report.links?.totalMatched,
            buckets: r.report.links?.buckets,
          },
          products: r.report.products
            ? {
                sampledPartners: r.report.products.sampledPartners,
                productRows: r.report.products.productRows,
                withPhoto: r.report.products.withPhoto,
                withPrice: r.report.products.withPrice,
                partnersFail: r.report.products.partnersFail,
              }
            : null,
          catalogCompare: r.report.catalogCompare,
          liveEnabledTouched: false,
          publishArmed: false,
        })
      );
      await finishNodeProcessAfterNetwork(r.ok ? 0 : 1);
    })
    .catch(async (e) => {
      console.error(redact(e && e.stack ? e.stack : String(e), readCjPatFromEnv(process.env)));
      await finishNodeProcessAfterNetwork(1);
    });
}
