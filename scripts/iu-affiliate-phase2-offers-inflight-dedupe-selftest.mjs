/**
 * Selftest + measurement harness: in-flight dedupe, generation-aware invalidation, stale-render guard
 * for assets/iu-affiliate-phase2-offers-v1.js (vm sandbox, mock fetch over REAL shard files).
 *
 * Default: runs against the repo asset and ASSERTS dedupe invariants.
 * IU_OFFERS_JS=<path>  → measure-only mode for an arbitrary build (e.g. origin/main "before"); never asserts.
 * IU_OFFERS_REPORT=<path> → also write metrics JSON to that path.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const measureOnly = Boolean(process.env.IU_OFFERS_JS);
const jsPath = process.env.IU_OFFERS_JS || path.join(root, "assets", "iu-affiliate-phase2-offers-v1.js");
const code = fs.readFileSync(jsPath, "utf8").replace(/^\uFEFF/, "");
const dataDir = path.join(root, "projects", "data");
const shardDir = path.join(dataDir, "iu-affiliate-cj-offers-sections-v1");
const SHARD_BASE = "/projects/data/iu-affiliate-cj-offers-sections-v1/";
const LEAN = "/projects/data/iu-affiliate-cj-offers-pages-v1.json";
const FULL = "/projects/data/iu-affiliate-cj-offers-public-v1.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** mocks: urlPath → (callIndex) => { status, body } ; otherwise real file under repo root. */
function makeEnv({ mocks = {}, withMount = false, delayMs = 15 } = {}) {
  const log = [];
  let pending = 0;
  const calls = Object.create(null);
  const clears = { n: 0 };
  const mount = {
    hidden: true,
    set innerHTML(v) {
      if (v === "") clears.n++;
    },
    get innerHTML() {
      return "";
    },
  };
  const view = { appendChild() {}, querySelector: () => null };
  const doc = {
    getElementById(id) {
      if (!withMount) return null;
      if (id === "iuAffiliateView") return view;
      if (id === "iuAffiliatePhase2Offers") return mount;
      return null;
    },
    querySelector: () => null,
    createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {} }),
    head: { appendChild() {} },
    body: { appendChild() {} },
  };
  async function fetchMock(url) {
    const p = String(url).split("?")[0];
    calls[p] = (calls[p] || 0) + 1;
    pending++;
    try {
      await sleep(delayMs);
      let status = 200;
      let text = null;
      if (mocks[p]) {
        const r = mocks[p](calls[p]);
        status = r.status;
        text = JSON.stringify(r.body ?? {});
      } else {
        const file = path.join(root, p.replace(/^\//, ""));
        if (fs.existsSync(file) && fs.statSync(file).isFile()) text = fs.readFileSync(file, "utf8");
        else status = 404;
      }
      const bytes = text == null ? 0 : Buffer.byteLength(text);
      log.push({ url: p, status, bytes });
      return { ok: status >= 200 && status < 300, status, json: async () => JSON.parse(text) };
    } finally {
      pending--;
    }
  }
  const win = {};
  const ctx = vm.createContext({
    window: win,
    document: doc,
    location: { hostname: "www.infouzel.cz", search: "" },
    fetch: fetchMock,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    Promise,
    Date,
    Number,
    String,
    Object,
    Math,
    JSON,
    encodeURIComponent,
  });
  win.window = win;
  vm.runInContext(code, ctx, { filename: jsPath });
  return {
    win,
    log,
    calls,
    clears,
    async idle() {
      for (let i = 0; i < 3; i++) {
        while (pending > 0) await sleep(5);
        await sleep(20);
      }
    },
    count: (re) => log.filter((e) => re.test(e.url)).length,
    bytes: (re) => log.filter((e) => re.test(e.url)).reduce((a, e) => a + e.bytes, 0),
  };
}

const shardKeys = fs
  .readdirSync(shardDir)
  .filter((f) => f.endsWith(".json") && !f.includes("__p"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const CONCURRENT_CALLERS = 3;
const metrics = {
  schema: "iu-affiliate-phase2-offers-inflight-dedupe-selftest",
  build: measureOnly ? jsPath : "repo-asset",
  categories: shardKeys.length,
  concurrentCallersPerCategory: CONCURRENT_CALLERS,
};

// S1: concurrent callers per category (all categories), then a repeat pass after settle.
{
  const env = makeEnv();
  for (const k of shardKeys) for (let i = 0; i < CONCURRENT_CALLERS; i++) env.win.iuAffiliatePhase2OffersRender(k);
  await env.idle();
  const shardFetches = env.log.filter((e) => e.url.startsWith(SHARD_BASE));
  const uniq = new Map();
  for (const e of shardFetches) uniq.set(e.url, e.bytes);
  const totalBytes = shardFetches.reduce((a, e) => a + e.bytes, 0);
  const uniqueBytes = [...uniq.values()].reduce((a, b) => a + b, 0);
  const afterConcurrent = env.log.length;
  for (const k of shardKeys) env.win.iuAffiliatePhase2OffersRender(k);
  await env.idle();
  metrics.s1_concurrent_all_categories = {
    shardRequests: shardFetches.length,
    uniqueShardUrls: uniq.size,
    duplicateRequests: shardFetches.length - uniq.size,
    totalBytes,
    uniqueBytes,
    extraBytes: totalBytes - uniqueBytes,
    extraMB: Number(((totalBytes - uniqueBytes) / 1048576).toFixed(3)),
    requestsOnRepeatPassAfterCache: env.log.length - afterConcurrent,
  };
}

// S3: failing shard, concurrent callers → fallback storm?
{
  const env = makeEnv({
    mocks: {
      [SHARD_BASE + "aff-test-fail.json"]: () => ({ status: 500 }),
      [LEAN]: () => ({ status: 500 }),
      [FULL]: () => ({ status: 500 }),
    },
  });
  for (let i = 0; i < CONCURRENT_CALLERS; i++) env.win.iuAffiliatePhase2OffersRender("aff-test-fail");
  await env.idle();
  const concurrentPhase = {
    shardRequests: env.count(/aff-test-fail\.json$/),
    leanRequests: env.count(/pages-v1\.json$/),
    fullRequests: env.count(/offers-public-v1\.json$/),
  };
  env.win.iuAffiliatePhase2OffersRender("aff-test-fail"); // later retry after failure settled
  await env.idle();
  metrics.s3_failed_shard_concurrent = {
    concurrentPhase,
    afterLaterRetry: {
      shardRequests: env.count(/aff-test-fail\.json$/),
      leanRequests: env.count(/pages-v1\.json$/),
      fullRequests: env.count(/offers-public-v1\.json$/),
    },
  };
}

// S4: generation advance invalidates older cached sections; older-generation response never replaces newer.
{
  const mk = (k, gen) => ({ liveEnabled: false, generationId: gen, sections: [{ sectionKey: k, products: [] }] });
  const env = makeEnv({
    mocks: {
      [SHARD_BASE + "aff-gen-a.json"]: () => ({ status: 200, body: mk("aff-gen-a", "2026-01-01T00:00:00Z") }),
      [SHARD_BASE + "aff-gen-b.json"]: () => ({ status: 200, body: mk("aff-gen-b", "2026-01-02T00:00:00Z") }),
      [SHARD_BASE + "aff-gen-old.json"]: () => ({ status: 200, body: mk("aff-gen-old", "2025-12-01T00:00:00Z") }),
    },
  });
  const r = env.win.iuAffiliatePhase2OffersRender;
  r("aff-gen-a");
  await env.idle();
  r("aff-gen-a"); // cached
  await env.idle();
  const aAfterCache = env.count(/aff-gen-a\.json$/);
  r("aff-gen-b"); // newer generation → A stale
  await env.idle();
  r("aff-gen-a"); // must refetch under new generation
  await env.idle();
  const aAfterBump = env.count(/aff-gen-a\.json$/);
  r("aff-gen-old"); // older generation: must not poison cache
  await env.idle();
  r("aff-gen-b");
  await env.idle();
  metrics.s4_generation = {
    aFetchesAfterCachedRepeat: aAfterCache,
    aFetchesAfterGenerationBump: aAfterBump,
    bFetchesAfterOlderGenResponse: env.count(/aff-gen-b\.json$/),
    oldGenFetches: env.count(/aff-gen-old\.json$/),
  };
}

// S5: invalidate mid-flight → in-flight response must not be cached (API exists only in new build).
{
  const mk = { liveEnabled: false, generationId: "2026-01-01T00:00:00Z", sections: [{ sectionKey: "aff-inv", products: [] }] };
  const env = makeEnv({ mocks: { [SHARD_BASE + "aff-inv.json"]: () => ({ status: 200, body: mk }) }, delayMs: 40 });
  if (typeof env.win.iuAffiliatePhase2OffersInvalidate === "function") {
    env.win.iuAffiliatePhase2OffersRender("aff-inv");
    await sleep(10);
    env.win.iuAffiliatePhase2OffersInvalidate();
    await env.idle();
    env.win.iuAffiliatePhase2OffersRender("aff-inv"); // must refetch (first response was stale)
    await env.idle();
    env.win.iuAffiliatePhase2OffersRender("aff-inv"); // now cached
    await env.idle();
    metrics.s5_invalidate_inflight = { supported: true, shardRequests: env.count(/aff-inv\.json$/) };
  } else {
    metrics.s5_invalidate_inflight = { supported: false };
  }
}

// S6: latest render wins — two quick renders of different sections paint only once.
{
  const mk = (k) => ({ liveEnabled: false, sections: [{ sectionKey: k, products: [] }] });
  const env = makeEnv({
    withMount: true,
    mocks: {
      [SHARD_BASE + "aff-r1.json"]: () => ({ status: 200, body: mk("aff-r1") }),
      [SHARD_BASE + "aff-r2.json"]: () => ({ status: 200, body: mk("aff-r2") }),
    },
  });
  env.win.iuAffiliatePhase2OffersRender("aff-r1");
  env.win.iuAffiliatePhase2OffersRender("aff-r2");
  await env.idle();
  metrics.s6_render_paints = { paintPasses: env.clears.n };
}

if (process.env.IU_OFFERS_REPORT) fs.writeFileSync(process.env.IU_OFFERS_REPORT, JSON.stringify(metrics, null, 2));

if (!measureOnly) {
  const assert = (c, m) => {
    if (!c) {
      console.error("FAIL: " + m);
      console.error(JSON.stringify(metrics, null, 2));
      process.exit(1);
    }
  };
  const s1 = metrics.s1_concurrent_all_categories;
  assert(s1.duplicateRequests === 0, "no duplicate shard requests under concurrency");
  assert(s1.extraBytes === 0, "no extra bytes");
  assert(s1.requestsOnRepeatPassAfterCache === 0, "cache hit after settle");
  const s3 = metrics.s3_failed_shard_concurrent;
  const s3c = s3.concurrentPhase;
  assert(s3c.shardRequests === 1, "failed shard fetched once");
  assert(s3c.leanRequests === 1 && s3c.fullRequests === 1, "fallback chain deduped");
  assert(s3.afterLaterRetry.shardRequests === 1, "sticky shard failure: no shard retry storm");
  assert(s3.afterLaterRetry.fullRequests === 1, "full monolith not retried after publicFailed");
  const s4 = metrics.s4_generation;
  assert(s4.aFetchesAfterCachedRepeat === 1, "cached before bump");
  assert(s4.aFetchesAfterGenerationBump === 2, "generation bump invalidates cached section");
  assert(s4.bFetchesAfterOlderGenResponse === 1, "older-generation response does not invalidate newer cache");
  assert(metrics.s5_invalidate_inflight.supported && metrics.s5_invalidate_inflight.shardRequests === 2, "invalidate mid-flight not cached");
  assert(metrics.s6_render_paints.paintPasses === 1, "latest render wins");
}

console.log(JSON.stringify({ ok: true, ...metrics }));
