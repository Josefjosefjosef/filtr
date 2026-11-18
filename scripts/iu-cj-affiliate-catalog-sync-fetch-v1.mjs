#!/usr/bin/env node
/**
 * Phase 2C / 3C — Job 1: fetch CJ Advertiser Lookup + Link Search → staging JSON only.
 * Uses XML Accept + pagination (CJ APIs are XML). Never writes public catalog / policy / guards / main.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  resolveCjApiConfig,
  readCjPatFromEnv,
  CJ_API_SECRET_NAMES,
} from "./iu-cj-affiliate-phase2-cj-api-adapter.mjs";
import { assertAllowedDataWrite, WEBSITE_PID } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  CJ_ADVERTISER_LOOKUP_BASE,
  CJ_LINK_SEARCH_BASE,
  CJ_DEFAULT_RECORDS_PER_PAGE,
  cjGet,
  parseAdvertiserBlocks,
  parseAdvertiserRecord,
  parseLinkBlocks,
  parseLinkRecord,
  parseListMeta,
} from "./iu-cj-affiliate-phase1-lib.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function redact(s) {
  const pat = readCjPatFromEnv(process.env);
  if (!pat) return String(s || "");
  return String(s || "").split(pat).join("[REDACTED_PAT]");
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryBackoffMs(attempt, env = process.env) {
  const base = Math.max(250, Number(env.IU_CJ_SYNC_FETCH_RETRY_BASE_MS) || 1000);
  const cap = Math.max(base, Number(env.IU_CJ_SYNC_FETCH_RETRY_CAP_MS) || 15000);
  const exp = Math.min(cap, base * Math.pow(2, Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * Math.min(750, Math.floor(exp * 0.25) + 1));
  return Math.min(cap, exp + jitter);
}

function isRetryableFetchFailure(res) {
  if (!res) return true;
  if (res.networkError) return true;
  const status = Number(res.status) || 0;
  if (status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  if (status === 0) return true;
  return false;
}

async function cjGetWithRetry(url, pat, { kind, page, audit, env = process.env } = {}) {
  const maxAttempts = Math.max(1, Math.min(6, Number(env.IU_CJ_SYNC_FETCH_RETRY_MAX) || 4));
  let last = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await cjGet(url, pat);
    last = res;
    audit.http.push({
      kind,
      page,
      attempt: attempt + 1,
      status: res.status,
      ok: res.ok,
      networkError: Boolean(res.networkError),
      authReason: res.auth?.reason || null,
      retryable: isRetryableFetchFailure(res),
    });
    if (res.ok && !res.networkError) return res;
    if (res.status === 401 || res.status === 403) return res;
    if (!isRetryableFetchFailure(res)) return res;
    if (attempt + 1 >= maxAttempts) break;
    const wait = retryBackoffMs(attempt, env);
    audit.http.push({
      kind,
      page,
      attempt: attempt + 1,
      event: "retry_backoff",
      waitMs: wait,
    });
    await sleepMs(wait);
  }
  return last;
}

async function fetchPagedXml({ baseUrl, queryBase, pat, parseBlocks, parseRecord, kind, maxPages, audit, env }) {
  const records = [];
  let page = 1;
  let totalMatched = null;
  const limit = Math.max(1, Math.min(60, Number(maxPages) || 40));
  const runEnv = env || process.env;

  while (page <= limit) {
    const url =
      baseUrl +
      "?" +
      queryBase +
      "&page-number=" +
      page +
      "&records-per-page=" +
      CJ_DEFAULT_RECORDS_PER_PAGE;
    const res = await cjGetWithRetry(url, pat, { kind, page, audit, env: runEnv });
    if (res.networkError) {
      return { ok: false, reason: "network_error", records, totalMatched, incomplete: true };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "auth_" + res.status, records, totalMatched, incomplete: true };
    }
    if (!res.ok || res.status >= 400) {
      return { ok: false, reason: "http_" + res.status, records, totalMatched, incomplete: true };
    }
    const meta = parseListMeta(res.body || "");
    if (totalMatched == null) totalMatched = meta.totalMatched;
    const pageRecords = parseBlocks(res.body || "").map(parseRecord);
    records.push(...pageRecords);
    if (pageRecords.length === 0) {
      if ((totalMatched || 0) > 0 && records.length < totalMatched) {
        return { ok: false, reason: "empty_page_before_complete", records, totalMatched, incomplete: true };
      }
      break;
    }
    if (totalMatched != null && records.length >= totalMatched) break;
    if (pageRecords.length < CJ_DEFAULT_RECORDS_PER_PAGE) break;
    page += 1;
  }

  if (totalMatched != null && records.length < totalMatched) {
    return { ok: false, reason: "pagination_incomplete", records, totalMatched, incomplete: true };
  }
  if (totalMatched === 0 && records.length === 0) {
    return { ok: true, reason: "empty_result_verified", records, totalMatched: 0, incomplete: false, emptySuccess: true };
  }
  return { ok: true, reason: "complete", records, totalMatched, incomplete: false };
}

export async function runCatalogSyncFetch(opts = {}) {
  const env = opts.env || process.env;
  const cfg = resolveCjApiConfig(env);
  const outDir = opts.outDir || path.join(ROOT, "projects", "data");
  const stagingPath = path.join(outDir, "iu-affiliate-cj-staging-v1.json");
  const auditPath = path.join(outDir, "iu-affiliate-cj-sync-audit-v1.json");
  assertAllowedDataWrite(stagingPath);
  assertAllowedDataWrite(auditPath);

  const execute = env.IU_CJ_SYNC_HTTP_EXECUTE === "1" && Boolean(readCjPatFromEnv(env));
  const maxAdvPages = Number(env.IU_CJ_SYNC_MAX_ADV_PAGES || 40);
  const maxLinkPages = Number(env.IU_CJ_SYNC_MAX_LINK_PAGES || 40);

  const audit = {
    version: 2,
    at: new Date().toISOString(),
    mode: execute ? "live_fetch_xml_paginated" : "dry_staging_shape",
    websitePid: env.IU_CJ_WEBSITE_PID || WEBSITE_PID,
    publisherCidConfigured: Boolean(env.IU_CJ_PUBLISHER_CID || cfg.publisherCid),
    patConfigured: Boolean(readCjPatFromEnv(env) || cfg.hasPat),
    secretNames: CJ_API_SECRET_NAMES,
    http: [],
    errors: [],
    note: "PAT never logged; fetch writes staging only (not public catalog). XML Accept + pagination.",
  };

  let advertisers = [];
  let links = [];
  let apiOutage = false;
  let emptyVerified = false;

  if (!execute) {
    audit.errors.push("dry_run_no_http");
  } else {
    const pat = readCjPatFromEnv(env);
    const publisherCid = String(env.IU_CJ_PUBLISHER_CID || cfg.publisherCid || "");
    const websitePid = String(env.IU_CJ_WEBSITE_PID || WEBSITE_PID);
    try {
      const adv = await fetchPagedXml({
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
        audit,
        env,
      });
      if (!adv.ok) {
        apiOutage = true;
        audit.errors.push("advertiser_lookup:" + adv.reason);
      } else {
        advertisers = adv.records;
        if (adv.emptySuccess) emptyVerified = true;
        audit.advertiserTotalMatched = adv.totalMatched;
        audit.advertiserUniqueIds = new Set(
          (adv.records || []).map((r) => String(r.advertiserId || "")).filter(Boolean),
        ).size;
        audit.advertiserPaginationComplete =
          Number(adv.totalMatched) === Number(adv.records?.length || 0) &&
          audit.advertiserUniqueIds === Number(adv.records?.length || 0);
        audit.cjRelationshipStatusNote =
          "Advertiser Lookup returns relationship-status joined|notjoined only; ENDED is inferred when a prior managed/policy CID is absent from joined.";
      }

      // Confirm suspected ENDED CIDs (managed/policy leftover) via explicit ID lookup — never invent statuses.
      const confirmIds = String(env.IU_CJ_SYNC_CONFIRM_ADVERTISER_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s));
      if (confirmIds.length > 0 && !apiOutage) {
        const conf = await fetchPagedXml({
          baseUrl: CJ_ADVERTISER_LOOKUP_BASE,
          queryBase:
            "requestor-cid=" +
            encodeURIComponent(publisherCid) +
            "&advertiser-ids=" +
            encodeURIComponent(confirmIds.join(",")),
          pat,
          parseBlocks: parseAdvertiserBlocks,
          parseRecord: parseAdvertiserRecord,
          kind: "advertiser_lookup_confirm_ids",
          maxPages: Math.min(5, maxAdvPages),
          audit,
          env,
        });
        audit.confirmAdvertiserIds = confirmIds;
        if (conf.ok) {
          audit.confirmAdvertisers = conf.records.map((r) => ({
            advertiserId: r.advertiserId,
            relationshipStatus: r.relationshipStatus,
            accountStatus: r.accountStatus,
          }));
        } else {
          audit.errors.push("advertiser_lookup_confirm:" + conf.reason);
        }
      }

      // Coupons (offers) + Text Links (partner button click URLs). Never invent click URLs.
      const lsCoupon = await fetchPagedXml({
        baseUrl: CJ_LINK_SEARCH_BASE,
        queryBase:
          "website-id=" +
          encodeURIComponent(websitePid) +
          "&advertiser-ids=joined&promotion-type=coupon",
        pat,
        parseBlocks: parseLinkBlocks,
        parseRecord: parseLinkRecord,
        kind: "link_search_coupon_joined",
        maxPages: maxLinkPages,
        audit,
        env,
      });
      const lsText = await fetchPagedXml({
        baseUrl: CJ_LINK_SEARCH_BASE,
        queryBase:
          "website-id=" +
          encodeURIComponent(websitePid) +
          "&advertiser-ids=joined&link-type=" +
          encodeURIComponent("Text Link"),
        pat,
        parseBlocks: parseLinkBlocks,
        parseRecord: parseLinkRecord,
        kind: "link_search_text_joined",
        maxPages: maxLinkPages,
        audit,
        env,
      });
      // V51.8: one link stream can fail transiently while the other succeeds with valid rows
      // (run 43855141956: 195 advertisers + 715 links still marked apiOutage). Fail-closed only
      // when BOTH streams fail or advertiser lookup failed; otherwise mark incompleteStreams.
      const incompleteStreams = [];
      if (!lsCoupon.ok) {
        incompleteStreams.push("link_search_coupon:" + lsCoupon.reason);
        audit.errors.push("link_search_coupon:" + lsCoupon.reason);
      }
      if (!lsText.ok) {
        incompleteStreams.push("link_search_text:" + lsText.reason);
        audit.errors.push("link_search_text:" + lsText.reason);
      }
      if (!lsCoupon.ok && !lsText.ok) {
        apiOutage = true;
      }
      if (lsCoupon.ok || lsText.ok) {
        const byId = new Map();
        for (const L of [...(lsCoupon.ok ? lsCoupon.records : []), ...(lsText.ok ? lsText.records : [])]) {
          const lid = String(L.linkId || L.id || "");
          if (lid && !byId.has(lid)) byId.set(lid, L);
        }
        links = [...byId.values()];
        audit.linkTotalMatchedCoupon = lsCoupon.ok ? lsCoupon.totalMatched : null;
        audit.linkTotalMatchedText = lsText.ok ? lsText.totalMatched : null;
        audit.linkTotalMatched = links.length;
        audit.incompleteStreams = incompleteStreams;
        audit.fetchComplete = incompleteStreams.length === 0 && !apiOutage;
        if (
          lsCoupon.ok &&
          lsCoupon.emptySuccess &&
          lsText.ok &&
          lsText.emptySuccess &&
          emptyVerified
        ) {
          audit.errors.push("empty_result_verified_both");
        } else if (
          links.length === 0 &&
          ((lsCoupon.ok && (lsCoupon.totalMatched || 0) > 0) ||
            (lsText.ok && (lsText.totalMatched || 0) > 0))
        ) {
          apiOutage = true;
          audit.errors.push("link_search_empty_but_total_matched");
        }
      }

      // Optional targeted probe (comma-separated CIDs) — all link types, no invented URLs.
      const probeIds = String(env.IU_CJ_SYNC_PROBE_ADVERTISER_IDS || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => /^\d+$/.test(s));
      if (probeIds.length > 0) {
        const lsProbe = await fetchPagedXml({
          baseUrl: CJ_LINK_SEARCH_BASE,
          queryBase:
            "website-id=" +
            encodeURIComponent(websitePid) +
            "&advertiser-ids=" +
            encodeURIComponent(probeIds.join(",")),
          pat,
          parseBlocks: parseLinkBlocks,
          parseRecord: parseLinkRecord,
          kind: "link_search_probe_advertisers",
          maxPages: Math.min(10, maxLinkPages),
          audit,
          env,
        });
        audit.probeAdvertiserIds = probeIds;
        if (!lsProbe.ok) {
          audit.errors.push("link_search_probe:" + lsProbe.reason);
          // Probe failure does not mark full apiOutage when coupon/text already succeeded.
        } else {
          const byId = new Map(links.map((L) => [String(L.linkId || L.id || ""), L]));
          for (const L of lsProbe.records) {
            const lid = String(L.linkId || L.id || "");
            if (lid && !byId.has(lid)) {
              byId.set(lid, L);
              links.push(L);
            }
          }
          audit.linkTotalMatchedProbe = lsProbe.totalMatched;
          audit.linkTotalMatched = links.length;
        }
      }
    } catch (e) {
      apiOutage = true;
      audit.errors.push("fetch_exception:" + redact(e && e.message ? e.message : String(e)));
    }
  }

  const staging = {
    version: 2,
    generatedAt: new Date().toISOString(),
    websitePid: String(env.IU_CJ_WEBSITE_PID || WEBSITE_PID),
    apiOutage,
    fetchComplete: audit.fetchComplete !== false && !apiOutage,
    incompleteStreams: Array.isArray(audit.incompleteStreams) ? audit.incompleteStreams : [],
    advertisers,
    links,
    source: execute ? "cj_api_xml" : "dry_run",
    transport: "application/xml",
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(stagingPath, JSON.stringify(staging, null, 2) + "\n", "utf8");
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");

  return {
    ok: !execute || !apiOutage,
    apiOutage,
    stagingPath,
    auditPath,
    counts: { advertisers: advertisers.length, links: links.length },
    mode: audit.mode,
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runCatalogSyncFetch()
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(redact(e && e.stack ? e.stack : String(e)));
      process.exit(1);
    });
}
