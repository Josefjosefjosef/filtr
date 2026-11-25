#!/usr/bin/env node
/**
 * H-FRONTEND-PWA — edge/mobile/PWA readiness audit for large-catalog shard lazy-load.
 *
 * Extends the V51.8 frontend section-order audit (re-uses expectedOrder / auditSectionOrder).
 * Additive, read-only: static source analysis of sw.js, assets/iu-affiliate-phase2-offers-v1.js,
 * assets/iu-affiliate-catalog.js, manifest.json + in-memory synthetic payload budget.
 * No network, no D1/R2, no growth/email activation, no production files modified.
 *
 * CLI:
 *   node scripts/iu-cj-affiliate-phase3z-frontend-pwa-shard-lazyload-audit-v1.mjs            (selftest)
 *   node scripts/iu-cj-affiliate-phase3z-frontend-pwa-shard-lazyload-audit-v1.mjs --audit    (repo audit JSON)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectedOrder,
  auditSectionOrder,
} from "./iu-cj-affiliate-phase3z-frontend-section-order-audit-v51-8.mjs";
import {
  estimateLoadPath,
  listSectionShards,
  SECTION_SHARD_SOFT_MAX_BYTES,
} from "./iu-cj-affiliate-offers-pages-shards-v1.mjs";

export const FRONTEND_PWA_SHARD_LAZYLOAD_AUDIT_SCHEMA =
  "iu-cj-affiliate-phase3z-frontend-pwa-shard-lazyload-audit-v1";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Mobile fail-fast ceilings (ms) for first-paint shard/lean fetches. */
export const MAX_SHARD_TIMEOUT_MS = 5000;
export const MIN_MONOLITH_TIMEOUT_MS = 10000;
export const BUDGET_TIERS = Object.freeze([5000, 10000, 50000]);
export const LEAN_MAX_BYTES = 2_500_000;

/* ---------------------------------------------------------------- helpers */

function extractFunctionBody(src, name) {
  const re = new RegExp("function\\s+" + name + "\\s*\\([^)]*\\)\\s*\\{");
  const m = re.exec(src);
  if (!m) return null;
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(m.index, i + 1);
    }
  }
  return null;
}

function timeoutOf(body) {
  if (!body) return null;
  const m = /fetchJsonWithTimeout\([^;]*?,\s*(\d+)\s*\)/.exec(body);
  return m ? Number(m[1]) : null;
}

function mkChecks() {
  const checks = [];
  return {
    checks,
    /** severity: 'fail' blocks PASS; 'warn' is advisory. */
    add(id, group, ok, detail, severity = "fail") {
      checks.push({ id, group, ok: ok === true, severity, detail: detail ?? null });
    },
  };
}

/* ----------------------------------------------------------- audit pieces */

export function auditServiceWorker(swSrc, c) {
  const src = String(swSrc || "");
  const fnBody = extractFunctionBody(src, "isAffiliateOffersPublicDataPath");
  c.add("sw_network_only_fn_defined", "sw", Boolean(fnBody));
  const b = fnBody || "";
  c.add("sw_covers_monolith", "sw", b.includes("iu-affiliate-cj-offers-public-v1.json"));
  c.add("sw_covers_lkg", "sw", b.includes("iu-affiliate-cj-offers-public-lkg-v1.json"));
  c.add("sw_covers_lean_pages", "sw", b.includes("iu-affiliate-cj-offers-pages-v1.json"));
  c.add("sw_covers_section_shards", "sw", b.includes("iu-affiliate-cj-offers-sections-v1/"));
  c.add(
    "sw_shard_fn_no_cache_storage",
    "sw",
    Boolean(fnBody) && !/caches\.|\.put\(|\.addAll\(|\.text\(|JSON\.parse/.test(b),
  );

  const pass = /isAffiliateOffersPublicDataPath\(path\)\)\s*\{\s*event\.respondWith\(\s*fetch\(\s*event\.request\s*,\s*\{\s*cache:\s*["']no-store["']\s*\}\s*\)\s*\)/.test(
    src,
  );
  c.add("sw_shard_passthrough_no_store", "sw", pass);

  const listenerIdx = src.indexOf('addEventListener("fetch"');
  const passIdx = src.indexOf("isAffiliateOffersPublicDataPath(path)", listenerIdx);
  const dataIdx = src.indexOf("handleDataRequest(", listenerIdx);
  c.add(
    "sw_shard_passthrough_before_data_handler",
    "sw",
    listenerIdx >= 0 && passIdx > listenerIdx && (dataIdx < 0 || passIdx < dataIdx),
    { listenerIdx, passIdx, dataIdx },
  );

  const shell = extractFunctionBody(src, "getAppShellUrls") || "";
  const warm = extractFunctionBody(src, "getOfflineWarmUrls") || "";
  c.add("sw_app_shell_fn_found", "sw", shell.length > 0 && warm.length > 0);
  c.add(
    "sw_shards_not_precached",
    "sw",
    shell.length > 0 && !/offers|affiliate/i.test(shell) && !/offers-(public|pages|sections)/i.test(warm),
  );
  c.add("sw_img_cache_bounded", "sw", /IMG_OFFLINE_MAX_ENTRIES\s*=\s*\d+/.test(src));
  c.add("sw_offline_doc_fallback", "sw", /OFFLINE_DOC_CACHE\s*=/.test(src) && /HTML_LAST_GOOD_CACHE\s*=/.test(src));
  c.add("sw_cross_origin_passthrough", "sw", /url\.origin\s*===\s*self\.location\.origin/.test(src));
}

export function auditShardClient(clientSrc, catalogSrc, c) {
  const src = String(clientSrc || "");
  const cat = String(catalogSrc || "");

  c.add(
    "client_paths",
    "client",
    /OFFERS_PAGES_LEAN_PATH\s*=\s*"\/projects\/data\/iu-affiliate-cj-offers-pages-v1\.json"/.test(src) &&
      /OFFERS_SECTION_BASE\s*=\s*"\/projects\/data\/iu-affiliate-cj-offers-sections-v1\/"/.test(src),
  );

  const fetchPublic = extractFunctionBody(src, "fetchOffersPublic") || "";
  const iShard = fetchPublic.indexOf("fetchOffersSectionShard");
  const iLean = fetchPublic.indexOf("fetchOffersPagesLean");
  const iFull = fetchPublic.indexOf("fetchOffersPublicFull");
  c.add(
    "client_fallback_chain_shard_lean_full",
    "client",
    iShard >= 0 && iLean > iShard && iFull > iLean,
    { iShard, iLean, iFull },
  );

  const fj = extractFunctionBody(src, "fetchJsonWithTimeout") || "";
  c.add(
    "client_abort_controller_timeout",
    "client",
    /new AbortController/.test(fj) && /\.abort\(\)/.test(fj) && /clearTimeout/.test(fj) && /signal/.test(fj),
  );
  c.add("client_no_store_fetch", "client", /cache:\s*["']no-store["']/.test(fj));

  const tShard = timeoutOf(extractFunctionBody(src, "fetchOffersSectionShard"));
  const tLean = timeoutOf(extractFunctionBody(src, "fetchOffersPagesLean"));
  const tFull = timeoutOf(extractFunctionBody(src, "fetchOffersPublicFull"));
  c.add("client_shard_timeout_mobile_fail_fast", "client", tShard != null && tShard <= MAX_SHARD_TIMEOUT_MS, { tShard });
  c.add("client_lean_timeout_mobile_fail_fast", "client", tLean != null && tLean <= MAX_SHARD_TIMEOUT_MS, { tLean });
  c.add(
    "client_monolith_last_resort_only",
    "client",
    tFull != null && tFull >= MIN_MONOLITH_TIMEOUT_MS && /publicFailed/.test(extractFunctionBody(src, "fetchOffersPublicFull") || ""),
    { tFull },
  );

  c.add(
    "client_generation_fail_closed",
    "client",
    /offers_generation_mismatch/.test(src) && /assertSameCatalogGeneration/.test(src),
  );
  c.add("client_safe_section_key", "client", /function isSafeSectionKey/.test(src) && /bad_section_key/.test(src));
  c.add(
    "client_paged_shard_naming",
    "client",
    /"__p"/.test(src) && /pageCount/.test(src) && /for\s*\(\s*var p = 2\s*;\s*p <= pageCount/.test(src),
  );
  c.add(
    "client_pages_parallel",
    "client",
    /Promise\.all\(jobs\)/.test(extractFunctionBody(src, "fetchOffersSectionShard") || ""),
  );
  c.add(
    "client_section_memoized_fail_and_cache",
    "client",
    /sectionCached\[sectionKey\]/.test(src) && /sectionFailed\[sectionKey\]/.test(src),
  );

  // Lazy-load contract: shards are fetched per opened category, never eagerly for all sections.
  const eagerLoop = /for\s*\([^)]*\)\s*\{[^}]*fetchOffersSectionShard\(/.test(src) || /\.forEach\([^)]*fetchOffersSectionShard/.test(src);
  c.add("client_no_eager_all_section_fetch", "lazy", !eagerLoop);
  c.add(
    "lazy_on_category_open",
    "lazy",
    /iuAffiliatePhase2OffersRender\(\s*cat\.id\s*\)/.test(cat) && /ensurePhase2OffersScript/.test(cat),
  );
  c.add(
    "lazy_script_loaded_on_demand",
    "lazy",
    /function ensurePhase2OffersScript/.test(cat),
  );

  // Advisory (non-blocking) improvements.
  c.add(
    "advisory_viewport_deferral",
    "advisory",
    /IntersectionObserver/.test(src),
    "No IntersectionObserver in shard client: fetch is category-open driven (acceptable).",
    "warn",
  );
  c.add(
    "advisory_retry_backoff",
    "advisory",
    /retry|backoff/i.test(src),
    "No retry/backoff after shard failure: sectionFailed latches until reload.",
    "warn",
  );
}

export function auditManifest(manifest, c) {
  const m = manifest && typeof manifest === "object" ? manifest : {};
  const icons = Array.isArray(m.icons) ? m.icons : [];
  const has = (size, purpose) =>
    icons.some((i) => i && i.sizes === size && String(i.purpose || "any").includes(purpose));
  c.add("manifest_standalone", "manifest", m.display === "standalone");
  c.add("manifest_start_scope", "manifest", m.start_url === "/" && m.scope === "/");
  c.add("manifest_theme_colors", "manifest", Boolean(m.theme_color) && Boolean(m.background_color));
  c.add(
    "manifest_icons_installable",
    "manifest",
    has("192x192", "any") && has("512x512", "any") && has("512x512", "maskable"),
  );
}

/** Deterministic synthetic catalog (in-memory only; never written). */
export function buildSyntheticOffersDoc(totalProducts, sectionCount = 40) {
  const sections = [];
  const per = Math.ceil(totalProducts / sectionCount);
  let n = 0;
  for (let s = 0; s < sectionCount && n < totalProducts; s++) {
    const products = [];
    for (let i = 0; i < per && n < totalProducts; i++, n++) {
      products.push({
        id: "p" + n,
        title: "Synthetic product " + n + " " + "x".repeat(40),
        url: "https://example.invalid/p/" + n,
        imageUrl: "https://example.invalid/i/" + n + ".jpg",
        price: 100 + (n % 900),
        currency: "CZK",
        advertiser: "adv" + (n % 50),
      });
    }
    sections.push({ sectionKey: "sec-" + s, coupons: [], products });
  }
  return {
    schema: "iu-affiliate-cj-offers-public-v1",
    version: 1,
    updatedAt: "2026-11-25T00:00:00.000Z",
    snapshotId: "2026-11-25T00:00:00.000Z",
    liveEnabled: false,
    ok: true,
    sections,
    stats: { uniqueProducts: totalProducts },
  };
}

export function auditBudget(c, tiers = BUDGET_TIERS) {
  const rows = [];
  for (const total of tiers) {
    const doc = buildSyntheticOffersDoc(total);
    const est = estimateLoadPath(doc);
    const shards = listSectionShards(doc);
    const pageNamesOk = shards.every((s) =>
      s.pageIndex === 0 ? s.fileName === s.sectionKey + ".json" : s.fileName === s.sectionKey + "__p" + (s.pageIndex + 1) + ".json",
    );
    rows.push({
      products: total,
      leanBytes: est.leanBytes,
      shardCount: est.shardCount,
      maxShardBytes: est.maxShardBytes,
      maxShardNeedsBytesPerMs: est.maxShardNeedsBytesPerMs,
      fullBytes: est.fullBytes,
      safe: est.architectureSafeFor10k,
      pageNamesOk,
    });
    c.add(
      "budget_" + total + "_max_shard_under_soft_max",
      "budget",
      est.maxShardBytes <= SECTION_SHARD_SOFT_MAX_BYTES,
      { maxShardBytes: est.maxShardBytes, softMax: SECTION_SHARD_SOFT_MAX_BYTES },
    );
    c.add("budget_" + total + "_lean_under_cap", "budget", est.leanBytes < LEAN_MAX_BYTES, { leanBytes: est.leanBytes });
    c.add("budget_" + total + "_page_names_match_client", "budget", pageNamesOk);
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  c.add(
    "budget_lean_size_catalog_independent",
    "budget",
    first && last && last.leanBytes <= first.leanBytes * 1.25,
    { smallLean: first && first.leanBytes, largeLean: last && last.leanBytes },
  );
  c.add(
    "budget_monolith_unsafe_confirmed",
    "budget",
    last && last.fullBytes > SECTION_SHARD_SOFT_MAX_BYTES * 2,
    { fullBytes: last && last.fullBytes },
  );
  return rows;
}

/** Section render order contract (V51.8) is preserved by shard UI. */
export function auditSectionOrderContract(c) {
  const ok = auditSectionOrder([...expectedOrder]);
  c.add("section_order_contract_pass", "order", ok.status === "PASS");
  const bad = auditSectionOrder([...expectedOrder].reverse());
  c.add("section_order_contract_detects_reorder", "order", bad.status === "FAIL");
}

/**
 * Pure audit over provided sources.
 * @param {{ swSrc: string, clientSrc: string, catalogSrc: string, manifest: object, tiers?: number[] }} input
 */
export function auditFrontendPwaShardLazyload(input) {
  const c = mkChecks();
  auditServiceWorker(input.swSrc, c);
  auditShardClient(input.clientSrc, input.catalogSrc, c);
  auditManifest(input.manifest, c);
  const budget = auditBudget(c, input.tiers);
  auditSectionOrderContract(c);
  const failed = c.checks.filter((x) => !x.ok && x.severity === "fail");
  const warnings = c.checks.filter((x) => !x.ok && x.severity === "warn");
  return {
    schema: FRONTEND_PWA_SHARD_LAZYLOAD_AUDIT_SCHEMA,
    ok: failed.length === 0,
    status: failed.length === 0 ? "PASS" : "FAIL",
    checkCount: c.checks.length,
    failed: failed.map((f) => f.id),
    warnings: warnings.map((w) => w.id),
    budget,
    checks: c.checks,
  };
}

export function loadRepoSources(root = repoRoot) {
  const rd = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
  return {
    swSrc: rd("sw.js"),
    clientSrc: rd("assets", "iu-affiliate-phase2-offers-v1.js"),
    catalogSrc: rd("assets", "iu-affiliate-catalog.js"),
    manifest: JSON.parse(rd("manifest.json")),
  };
}

/* --------------------------------------------------------------- selftest */

export function runFrontendPwaShardLazyloadSelftest() {
  const t = [];
  const check = (name, cond, detail) => t.push({ name, ok: cond === true, detail: detail ?? null });

  const src = loadRepoSources();
  const small = { ...src, tiers: [5000, 10000] };
  const real = auditFrontendPwaShardLazyload({ ...src });
  check("repo_audit_pass", real.status === "PASS", real.failed);
  check("repo_audit_has_checks", real.checkCount >= 35, real.checkCount);
  check("repo_budget_tiers_present", real.budget.length === BUDGET_TIERS.length, real.budget);

  const mutate = (key, from, to) => {
    const s = { ...small, [key]: typeof from === "string" ? src[key].replace(from, to) : from(src[key]) };
    return auditFrontendPwaShardLazyload(s);
  };

  // SW regressions → must FAIL
  const swNoSections = mutate("swSrc", 'name.startsWith("iu-affiliate-cj-offers-sections-v1/")', "false");
  check("neg_sw_missing_sections_coverage", swNoSections.failed.includes("sw_covers_section_shards"), swNoSections.failed);
  const swNoPass = mutate("swSrc", "isAffiliateOffersPublicDataPath(path)", "false /*x*/");
  check("neg_sw_missing_passthrough", swNoPass.failed.includes("sw_shard_passthrough_no_store"), swNoPass.failed);
  const swPrecache = mutate("swSrc", "`${BASE}assets/app.css`,", "`${BASE}assets/app.css`,\n    `${BASE}projects/data/iu-affiliate-cj-offers-pages-v1.json`,");
  check("neg_sw_shard_precached", swPrecache.failed.includes("sw_shards_not_precached"), swPrecache.failed);

  // Client regressions → must FAIL
  const clMono = mutate("clientSrc", "fetchJsonWithTimeout(src, 20000)", "fetchJsonWithTimeout(src, 1000)");
  check("neg_client_monolith_short_timeout", clMono.failed.includes("client_monolith_last_resort_only"), clMono.failed);
  const clSlow = mutate("clientSrc", "fetchJsonWithTimeout(src, 2500)", "fetchJsonWithTimeout(src, 60000)");
  check("neg_client_slow_shard_timeout", clSlow.failed.includes("client_shard_timeout_mobile_fail_fast"), clSlow.failed);
  const clGen = mutate("clientSrc", "offers_generation_mismatch", "ok");
  check("neg_client_no_generation_guard", clGen.failed.includes("client_generation_fail_closed"), clGen.failed);
  const clEager = mutate(
    "clientSrc",
    (s) => s + "\nfor (var i = 0; i < keys.length; i++) { fetchOffersSectionShard(keys[i]); }\n",
    null,
  );
  check("neg_client_eager_all_sections", clEager.failed.includes("client_no_eager_all_section_fetch"), clEager.failed);
  const catNoLazy = mutate("catalogSrc", "iuAffiliatePhase2OffersRender(cat.id)", "noop()");
  check("neg_catalog_not_on_demand", catNoLazy.failed.includes("lazy_on_category_open"), catNoLazy.failed);

  // Manifest regressions → must FAIL
  const mf = auditFrontendPwaShardLazyload({ ...small, manifest: { ...src.manifest, display: "browser" } });
  check("neg_manifest_not_standalone", mf.failed.includes("manifest_standalone"), mf.failed);
  const mfIcons = auditFrontendPwaShardLazyload({ ...small, manifest: { ...src.manifest, icons: [] } });
  check("neg_manifest_no_icons", mfIcons.failed.includes("manifest_icons_installable"), mfIcons.failed);

  // Budget math on a deliberately tiny soft-max is exercised via estimateLoadPath contract
  const tiny = estimateLoadPath(buildSyntheticOffersDoc(2000), { softMaxBytes: 1000 });
  check("neg_budget_soft_max_violation_detected", tiny.maxShardBytes > 1000 && tiny.architectureSafeFor10k === false, {
    maxShardBytes: tiny.maxShardBytes,
  });

  // Section-order contract is wired
  check("section_order_reexport_wired", expectedOrder.length === 4 && auditSectionOrder([...expectedOrder]).ok === true);

  const failed = t.filter((x) => !x.ok);
  return {
    schema: FRONTEND_PWA_SHARD_LAZYLOAD_AUDIT_SCHEMA + "-selftest",
    ok: failed.length === 0,
    failed: failed.map((f) => f.name),
    checks: t,
    repoAudit: {
      status: real.status,
      checkCount: real.checkCount,
      warnings: real.warnings,
      budget: real.budget,
    },
  };
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  return path.resolve(arg) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  if (process.argv.includes("--audit")) {
    const r = auditFrontendPwaShardLazyload(loadRepoSources());
    console.log(JSON.stringify({ IU_CJ_FRONTEND_PWA_SHARD_LAZYLOAD_AUDIT: r.status, ...r }, null, 2));
    if (!r.ok) process.exit(1);
  } else {
    const r = runFrontendPwaShardLazyloadSelftest();
    console.log(
      JSON.stringify(
        { IU_CJ_FRONTEND_PWA_SHARD_LAZYLOAD_AUDIT_SELFTEST: r.ok ? "PASS" : "FAIL", ...r },
        null,
        2,
      ),
    );
    if (!r.ok) process.exit(1);
  }
}
