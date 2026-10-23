#!/usr/bin/env node
/**
 * Phase 2C PR B — Job 1: fetch CJ Advertiser Lookup + Link Search → staging JSON only.
 * Never writes public catalog / policy / guards / main.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function redact(s) {
  const pat = readCjPatFromEnv(process.env);
  if (!pat) return String(s || "");
  return String(s || "").split(pat).join("[REDACTED_PAT]");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, pat) {
  const res = await fetch(url, {
    headers: {
      Authorization: "Bearer " + pat,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { status: res.status, ok: res.ok, body };
}

export async function runCatalogSyncFetch(opts = {}) {
  const env = opts.env || process.env;
  const cfg = resolveCjApiConfig(env);
  const outDir = opts.outDir || path.join(ROOT, "projects", "data");
  const stagingPath = path.join(outDir, "iu-affiliate-cj-staging-v1.json");
  const auditPath = path.join(outDir, "iu-affiliate-cj-sync-audit-v1.json");
  assertAllowedDataWrite(stagingPath);
  assertAllowedDataWrite(auditPath);

  const execute = env.IU_CJ_SYNC_HTTP_EXECUTE === "1" && cfg.hasPat;
  const spacingMs = Number(env.IU_CJ_SYNC_REQ_SPACING_MS || 2400);

  const audit = {
    version: 1,
    at: new Date().toISOString(),
    mode: execute ? "live_fetch" : "dry_staging_shape",
    websitePid: env.IU_CJ_WEBSITE_PID || WEBSITE_PID,
    publisherCidConfigured: Boolean(env.IU_CJ_PUBLISHER_CID || cfg.publisherCid),
    patConfigured: cfg.hasPat,
    secretNames: CJ_API_SECRET_NAMES,
    http: [],
    errors: [],
    note: "PAT never logged; fetch writes staging only (not public catalog).",
  };

  let advertisers = [];
  let links = [];
  let apiOutage = false;

  if (!execute) {
    audit.errors.push("dry_run_no_http");
  } else {
    const pat = readCjPatFromEnv(env);
    try {
      const advUrl =
        (cfg.bases?.advertiserLookup || "https://advertiser-lookup.api.cj.com/v3/advertiser-lookup") +
        "?requestor-cid=" +
        encodeURIComponent(String(env.IU_CJ_PUBLISHER_CID || cfg.publisherCid || "")) +
        "&records-per-page=100";
      const adv = await fetchJson(advUrl, pat);
      audit.http.push({ kind: "advertiser_lookup", status: adv.status, ok: adv.ok });
      if (!adv.ok || adv.status >= 500 || adv.status === 401) {
        apiOutage = true;
        audit.errors.push("advertiser_lookup_outage:" + adv.status);
      } else {
        advertisers = Array.isArray(adv.body?.advertisers)
          ? adv.body.advertisers
          : Array.isArray(adv.body)
            ? adv.body
            : [];
      }
      await sleep(spacingMs);

      const linkUrl =
        (cfg.bases?.linkSearch || "https://link-search.api.cj.com/v2/link-search") +
        "?website-id=" +
        encodeURIComponent(String(env.IU_CJ_WEBSITE_PID || WEBSITE_PID)) +
        "&records-per-page=100";
      const ls = await fetchJson(linkUrl, pat);
      audit.http.push({ kind: "link_search", status: ls.status, ok: ls.ok });
      if (!ls.ok || ls.status >= 500 || ls.status === 401 || !ls.body) {
        apiOutage = true;
        audit.errors.push("link_search_outage:" + ls.status);
      } else {
        links = Array.isArray(ls.body?.links) ? ls.body.links : [];
        if (links.length === 0 && ls.ok) {
          apiOutage = true;
          audit.errors.push("link_search_empty_response");
        }
      }
    } catch (e) {
      apiOutage = true;
      audit.errors.push("fetch_exception:" + redact(e && e.message ? e.message : String(e)));
    }
  }

  const staging = {
    version: 1,
    generatedAt: new Date().toISOString(),
    websitePid: String(env.IU_CJ_WEBSITE_PID || WEBSITE_PID),
    apiOutage,
    advertisers,
    links,
    source: execute ? "cj_api" : "dry_run",
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(stagingPath, JSON.stringify(staging, null, 2) + "\n", "utf8");
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");

  return {
    ok: true,
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
      process.exit(0);
    })
    .catch((e) => {
      console.error(redact(e && e.stack ? e.stack : String(e)));
      process.exit(1);
    });
}
