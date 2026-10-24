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

async function fetchPagedXml({ baseUrl, queryBase, pat, parseBlocks, parseRecord, kind, maxPages, audit }) {
  const records = [];
  let page = 1;
  let totalMatched = null;
  const limit = Math.max(1, Math.min(60, Number(maxPages) || 40));

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
    audit.http.push({
      kind,
      page,
      status: res.status,
      ok: res.ok,
      networkError: Boolean(res.networkError),
      authReason: res.auth?.reason || null,
    });
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
      });
      if (!adv.ok) {
        apiOutage = true;
        audit.errors.push("advertiser_lookup:" + adv.reason);
      } else {
        advertisers = adv.records;
        if (adv.emptySuccess) emptyVerified = true;
        audit.advertiserTotalMatched = adv.totalMatched;
      }

      const ls = await fetchPagedXml({
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
      });
      if (!ls.ok) {
        apiOutage = true;
        audit.errors.push("link_search:" + ls.reason);
      } else {
        links = ls.records;
        audit.linkTotalMatched = ls.totalMatched;
        if (ls.emptySuccess && emptyVerified) {
          audit.errors.push("empty_result_verified_both");
        } else if (!ls.emptySuccess && links.length === 0 && (ls.totalMatched || 0) > 0) {
          apiOutage = true;
          audit.errors.push("link_search_empty_but_total_matched");
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
