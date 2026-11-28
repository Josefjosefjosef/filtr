#!/usr/bin/env node
/**
 * CJ affiliate — FULL individual product inventory export (v1).
 *
 * Streams / shards the complete identity universe (deferred ledger + durable catalog shards +
 * current public offers + retry queue + optional LKG / previous snapshots) into
 * PRODUCT_INVENTORY_INDIVIDUAL_partNN.jsonl.gz. There is NO hard row cap: the optional
 * IU_CJ_INV_MAX_ROWS env is for tests only and forces a SAMPLE_NOT_FULL completeness label.
 *
 * Rules:
 *  - never invent fields: unknown => null + missingFields/missingReason (never coerced to 0)
 *  - every identity gets EXACTLY ONE primaryState (priority below); secondary flags are multi-ok
 *  - states without a per-identity evidence source report count=null (not 0) in the balance
 *
 * Outputs (OUT dir, never the repo): see OUTPUT_FILES. Read-only on all inputs.
 *
 * Env (CLI): IU_CJ_INV_OUT_DIR, IU_CJ_INV_LEDGER, IU_CJ_INV_CATALOG_MANIFEST, IU_CJ_INV_OFFERS,
 *   IU_CJ_INV_PREV_OFFERS, IU_CJ_INV_RETRY_QUEUE, IU_CJ_INV_PREV_RETRY_QUEUE, IU_CJ_INV_LKG_SNAPSHOT,
 *   IU_CJ_INV_HISTORICAL_CATALOG, IU_CJ_INV_PARTITION_ROWS (default 50000), IU_CJ_INV_MAX_ROWS (tests only).
 *
 * Run (large inputs): node --max-old-space-size=8192 scripts/iu-cj-affiliate-product-inventory-full-export-v1.mjs
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

export const SCHEMA = "iu-cj-affiliate-product-inventory-full-export-v1";
export const DEFAULT_PARTITION_ROWS = 50000;

export const OUTPUT_FILES = Object.freeze({
  partPrefix: "PRODUCT_INVENTORY_INDIVIDUAL_part",
  manifest: "PRODUCT_INVENTORY_INDIVIDUAL_MANIFEST.json",
  summary: "PRODUCT_INVENTORY_FULL_SUMMARY.json",
  balance: "PRODUCT_INVENTORY_IDENTITY_BALANCE.json",
  completeness: "PRODUCT_INVENTORY_EXPORT_COMPLETENESS.json",
  diff: "HOLD_RETRY_LKG_INDIVIDUAL_DIFF.json",
});

/** Exclusive assignment order (extends the V51.8 balance contract). First match wins. */
export const PRIMARY_STATE_PRIORITY = Object.freeze([
  "published",
  "invalid",
  "technical_failure",
  "hold",
  "retry",
  "lkg",
  "blocked_growth_only",
  "eligible_new",
  "unavailable",
  "duplicate",
  "identity_collision",
  "unsuitable_cz_market",
  "missing_business_data",
  "ended_partnership",
  "external_cj_restriction",
  "pending_verification",
  "unknown_with_reason",
]);

/** States the classifier can actually evidence per identity, with the evidence basis. */
export const STATE_EVALUATION = Object.freeze({
  published: { evaluated: true, basis: "current offers: publicationReady && !hold && publishable!==false" },
  invalid: { evaluated: true, basis: "retry queue INVALID_DATA (non-collision) — retry-queue scope only" },
  technical_failure: { evaluated: false, missingReason: "NO_PER_IDENTITY_TECHNICAL_FAILURE_EVIDENCE_IN_SOURCES" },
  hold: { evaluated: true, basis: "current offers lkgPublicHold===true || publicationEligibility==PUBLICATION_HOLD" },
  retry: { evaluated: true, basis: "retry queue RETRY_SCHEDULED — retry-queue scope only" },
  lkg: { evaluated: true, basis: "offers lkgCarried (not visible/hold) or LKG snapshot only" },
  blocked_growth_only: { evaluated: true, basis: "deferred membership AND title+price+affiliateUrl all present; ledger key alone is pending_verification" },
  eligible_new: { evaluated: true, basis: "offers.publicGrowthBudget.keptNew (measured); classifier never promotes deferred rows" },
  unavailable: { evaluated: true, basis: "current offers record with out-of-stock/unavailable availability — offers scope only" },
  duplicate: { evaluated: true, basis: "duplicate key occurrences across ledger/shards measured; duplicates collapse into one identity" },
  identity_collision: { evaluated: true, basis: "retry queue collision/INVALID_DATA — retry-queue scope only" },
  unsuitable_cz_market: { evaluated: false, missingReason: "NO_PER_IDENTITY_CZ_TARGETING_EVIDENCE (currency is only a secondary flag)" },
  missing_business_data: { evaluated: true, basis: "title/currentPrice/affiliateUrl absent in available record" },
  ended_partnership: { evaluated: false, missingReason: "PARTNER_REGISTRY_HAS_ONLY_JOINED_PARTNERS_NO_ENDED_EVIDENCE_PER_IDENTITY" },
  external_cj_restriction: { evaluated: false, missingReason: "NO_PER_IDENTITY_EXTERNAL_CJ_RESTRICTION_EVIDENCE_IN_SOURCES" },
  pending_verification: { evaluated: true, basis: "known in catalog/prev-offers but absent from current offers and deferred ledger, or offers NOT_IN_SCAN_WINDOW" },
  unknown_with_reason: { evaluated: true, basis: "residual with explicit reason" },
});

const F = Object.freeze({
  LEDGER: 1,
  SHARD: 2,
  OFFERS: 4,
  RETRY: 8,
  PREV_OFFERS: 16,
  LKG_SNAP: 32,
  HIST: 64,
  DEF_SAMPLE: 128,
  EMITTED: 256,
});

const CORE_FIELDS = ["sectionKey", "partnerName", "title", "currentPrice", "originalPrice", "currency", "availabilityClass", "freshnessStatus", "lastVerifiedAt"];

const splitKey = (key) => {
  const i = key.indexOf("|");
  return i < 0 ? { advertiserId: null, productId: null } : { advertiserId: key.slice(0, i), productId: key.slice(i + 1) };
};
const nn = (v) => (v === undefined || v === "" ? null : v);
const keyOfProduct = (p) => {
  const k = p.productKey || p.compositeKey || p.compositeId;
  if (k) return String(k);
  if (p.advertiserId != null && p.productId != null) return `${p.advertiserId}|${p.productId}`;
  return null;
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/** Stream the ledger `keys` array line by line; falls back to JSON.parse for compact/other layouts. */
export async function streamLedger(file, onKey) {
  const meta = {};
  let inKeys = false;
  let rows = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!inKeys) {
      if (/^"keys"\s*:\s*\[\s*$/.test(t)) {
        inKeys = true;
        continue;
      }
      const m = t.match(/^"(schema|updatedAt|runId|catalogGeneration|deferredNewCount|reason|preferredCurrency)"\s*:\s*(.*?),?$/);
      if (m) {
        try {
          meta[m[1]] = JSON.parse(m[2]);
        } catch {
          /* ignore malformed meta line */
        }
      }
      continue;
    }
    if (t.startsWith("]")) break;
    const m = t.match(/^"(.*)",?$/);
    if (m) {
      rows += 1;
      onKey(m[1]);
    }
  }
  if (rows === 0) {
    const j = readJson(file);
    const arr = Array.isArray(j.keys) ? j.keys : Array.isArray(j) ? j : [];
    for (const k of arr) {
      rows += 1;
      onKey(typeof k === "string" ? k : keyOfProduct(k));
    }
    for (const k of ["schema", "updatedAt", "runId", "catalogGeneration", "deferredNewCount", "reason", "preferredCurrency"]) if (j[k] !== undefined) meta[k] = j[k];
  }
  return { rows, meta };
}

/** key -> compact offers record (aggregated over placements). */
export function extractOffersProducts(offers) {
  const m = new Map();
  for (const s of offers?.sections || []) {
    for (const p of s.products || []) {
      const key = keyOfProduct(p);
      if (!key) continue;
      const holdFlag = p.lkgPublicHold === true || p.publicationEligibility === "PUBLICATION_HOLD";
      const e = m.get(key);
      if (e) {
        e.occurrences += 1;
        e.hold = e.hold || holdFlag;
        e.ready = e.ready || p.publicationReady === true;
        e.lkgCarried = e.lkgCarried || p.lkgCarried === true;
        continue;
      }
      m.set(key, {
        occurrences: 1,
        hold: holdFlag,
        holdKnown: p.lkgPublicHold !== undefined || p.publicationEligibility !== undefined,
        ready: p.publicationReady === true,
        publishable: p.publishable,
        lkgCarried: p.lkgCarried === true,
        lkgCarriedKnown: p.lkgCarried !== undefined,
        availabilityClass: nn(p.availabilityClass),
        freshnessStatus: nn(p.freshnessStatus),
        freshnessReason: nn(p.freshnessReason),
        refreshResult: nn(p.refreshResult),
        sectionKey: nn(p.sectionKey),
        partnerName: nn(p.partnerName),
        title: nn(p.title),
        currentPrice: nn(p.currentPrice),
        originalPrice: nn(p.originalPrice),
        currency: nn(p.currency),
        hasAffiliateUrl: !!p.affiliateUrl,
        lastVerifiedAt: nn(p.lastVerifiedAt || p.verifiedAt),
      });
    }
  }
  return m;
}

function extractRetryQueue(q) {
  const m = new Map();
  for (const [k, i] of Object.entries(q?.items || {})) {
    m.set(i.key || k, { status: nn(i.status), closed: i.closed === true, closedReason: nn(i.closedReason), apiResult: nn(i.apiResult) });
  }
  return m;
}

/** Pure per-identity classifier — exactly one primaryState + secondary flags. */
export function classifyIdentity(ev) {
  const o = ev.offers || null;
  const rq = ev.retry || null;
  const secondary = [];
  if (ev.inLedger) secondary.push("inDeferredLedger");
  if (ev.inShard) secondary.push("inDurableCatalog");
  if (o) secondary.push("inCurrentOffers");
  if (ev.inPrevOffers) secondary.push("inPrevOffersSnapshot");
  if (ev.inLkgSnap) secondary.push("inLkgSnapshot");
  if (ev.inHist) secondary.push("inHistoricalCatalogSnapshot");
  if (ev.inDefSample) secondary.push("inCurrentDeferredSample");
  if (rq?.status) secondary.push(`retryQueue:${rq.status}`);
  if (o?.lkgCarried) secondary.push("lkgCarried");
  if (o && o.occurrences > 1) secondary.push("multiPlacement");
  if (ev.currency && ev.preferredCurrency && ev.currency !== ev.preferredCurrency) secondary.push("currencyNotPreferred");
  if (ev.availabilityClass === "PREORDER" || ev.availabilityClass === "BACKORDER") secondary.push(`availability:${ev.availabilityClass}`);

  const cand = new Map(); // state -> reason
  const visible = !!o && !o.hold && o.ready === true && o.publishable !== false;
  if (visible) cand.set("published", "VISIBLE_IN_CURRENT_OFFERS");
  if (rq?.status === "INVALID_DATA") {
    const collision = /collision/i.test(`${rq.closedReason || ""} ${rq.apiResult || ""}`);
    cand.set(collision ? "identity_collision" : "invalid", `RETRY_QUEUE_${rq.closedReason || rq.status}`);
  }
  if (rq?.status === "RETRY_SCHEDULED") cand.set("retry", "RETRY_QUEUE_RETRY_SCHEDULED");
  if (o?.hold) cand.set("hold", "CURRENT_OFFERS_PUBLICATION_HOLD");
  if ((o?.lkgCarried && !visible && !o.hold) || (ev.inLkgSnap && !o)) cand.set("lkg", o ? "OFFERS_LKG_CARRIED_NOT_VISIBLE" : "ONLY_IN_LKG_SNAPSHOT");
  if (o && !visible && !o.hold) {
    const unavailable = /^(OUT_OF_STOCK|UNAVAILABLE|DISCONTINUED)$/i.test(o.availabilityClass || "") || /^AVAILABILITY_/i.test(o.freshnessReason || "");
    if (unavailable) cand.set("unavailable", `OFFERS_${o.availabilityClass || o.freshnessReason}`);
    else if (o.refreshResult === "NOT_IN_SCAN_WINDOW") cand.set("pending_verification", "OFFERS_NOT_IN_SCAN_WINDOW");
    else cand.set("unknown_with_reason", `OFFERS_NOT_READY_${o.freshnessReason || "REASON_ABSENT"}`);
  }
  const dataComplete = ev.hasTitle === true && ev.hasPrice === true && ev.hasUrl === true;
  const hasRecord = ev.inShard || !!o;
  if (ev.inLedger || ev.inDefSample) {
    if (!dataComplete && hasRecord) cand.set("missing_business_data", "TITLE_PRICE_OR_URL_ABSENT");
    else if (!dataComplete) cand.set("pending_verification", "HISTORICAL_DEFERRED_UNVERIFIED_NO_SOURCE_RECORD");
    else cand.set("blocked_growth_only", ev.inDefSample && !ev.inLedger ? "CURRENT_DEFERRED_SAMPLE" : "DEFERRED_LEDGER_CUMULATIVE_BUDGET");
  }
  if (!cand.size) {
    if (ev.inShard || ev.inPrevOffers) cand.set("pending_verification", "NOT_IN_CURRENT_OFFERS_NOR_DEFERRED_LEDGER_REVERIFY_REQUIRED");
    else if (ev.inHist) cand.set("unknown_with_reason", "ONLY_IN_STALE_HISTORICAL_CATALOG_SNAPSHOT");
    else cand.set("unknown_with_reason", "NO_CLASSIFYING_EVIDENCE");
  }
  const primaryState = PRIMARY_STATE_PRIORITY.find((s) => cand.has(s));
  return { primaryState, stateReason: cand.get(primaryState), secondaryFlags: secondary };
}

function buildRow(key, u, rec, shardId, ctx) {
  const o = ctx.offers.get(key) || null;
  const { advertiserId, productId } = splitKey(key);
  const src = {};
  for (const f of CORE_FIELDS) src[f] = nn(o?.[f]) ?? nn(rec?.[f]);
  if (o) src.lastVerifiedAt = nn(o.lastVerifiedAt) ?? nn(rec?.priceVerifiedAt) ?? nn(rec?.lastSuccessfulRefreshAt);
  else src.lastVerifiedAt = nn(rec?.priceVerifiedAt) ?? nn(rec?.lastSuccessfulRefreshAt);
  const hasRecord = !!rec || !!o;
  const ev = {
    inLedger: !!(u.f & F.LEDGER),
    inShard: !!(u.f & F.SHARD),
    offers: o,
    retry: ctx.retry.get(key) || null,
    inPrevOffers: !!(u.f & F.PREV_OFFERS),
    inLkgSnap: !!(u.f & F.LKG_SNAP),
    inHist: !!(u.f & F.HIST),
    inDefSample: !!(u.f & F.DEF_SAMPLE),
    currency: src.currency,
    preferredCurrency: ctx.preferredCurrency,
    availabilityClass: src.availabilityClass,
    hasTitle: src.title != null,
    hasPrice: src.currentPrice != null,
    hasUrl: o ? o.hasAffiliateUrl : !!rec?.affiliateUrl,
  };
  const c = classifyIdentity(ev);
  const missingFields = CORE_FIELDS.filter((f) => src[f] == null);
  if (!ev.hasUrl) missingFields.push("affiliateUrl");
  return {
    key,
    advertiserId,
    productId,
    primaryState: c.primaryState,
    stateReason: c.stateReason,
    secondaryFlags: c.secondaryFlags,
    shard: shardId ?? null,
    ...src,
    missingFields,
    missingReason: missingFields.length ? (hasRecord ? "FIELD_ABSENT_IN_SOURCE_RECORD" : "NO_PRODUCT_RECORD_IN_ANY_SOURCE_ONLY_IDENTITY_KEY_KNOWN") : null,
  };
}

function offersExtras(offers) {
  const g = offers?.publicGrowthBudget || {};
  return {
    updatedAt: nn(offers?.updatedAt),
    snapshotId: nn(offers?.snapshotId),
    statsUniqueProducts: nn(offers?.stats?.uniqueProducts),
    statsUniquePublicEligible: nn(offers?.stats?.uniquePublicEligible),
    statsLkgCarriedProducts: nn(offers?.stats?.lkgCarriedProducts),
    statsLkgPublicHoldProducts: nn(offers?.stats?.lkgPublicHoldProducts),
    growth: {
      deferredNew: nn(g.deferredNew),
      newCandidates: nn(g.newCandidates),
      keptNew: nn(g.keptNew),
      allowedNew: nn(g.allowedNew),
      cumulativeRemaining: nn(g.cumulativeRemaining),
      uncappedMode: nn(g.uncappedMode),
      deferredNewKeysPersistedInOffers: nn(g.deferredNewKeysPersistedInOffers),
      sample: Array.isArray(g.deferredDecisionLedgerSample) ? g.deferredDecisionLedgerSample : [],
    },
  };
}

const tally = (arr) => arr.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {});

/** Best-effort hold / retry / LKG diff between two consecutive snapshots (null where unknown). */
export function buildHoldRetryLkgDiff({ prevOffers, curOffers, prevRetry, curRetry, meta }) {
  const state = (r, f, known) => (!r ? null : r[known] ? r[f] === true : null);
  const flagDiff = (field, known) => {
    const out = { enteredFromKnownPrev: [], enteredNewToSnapshot: [], exited: [], exitedAbsentFromCurrent: [], stayed: [], unknownPrevFlag: [] };
    for (const [k, c] of curOffers) {
      const p = prevOffers.get(k);
      const cv = state(c, field, known);
      if (cv !== true) continue;
      if (!p) out.enteredNewToSnapshot.push(k);
      else {
        const pv = state(p, field, known);
        if (pv === null) out.unknownPrevFlag.push(k);
        else if (pv) out.stayed.push(k);
        else out.enteredFromKnownPrev.push(k);
      }
    }
    for (const [k, p] of prevOffers) {
      if (state(p, field, known) !== true) continue;
      const c = curOffers.get(k);
      if (!c) out.exitedAbsentFromCurrent.push(k);
      else if (state(c, field, known) === false) out.exited.push(k);
    }
    return { counts: Object.fromEntries(Object.entries(out).map(([n, a]) => [n, a.length])), ...out };
  };
  const hold = prevOffers && curOffers ? flagDiff("hold", "holdKnown") : null;
  const lkg = prevOffers && curOffers ? flagDiff("lkgCarried", "lkgCarriedKnown") : null;
  let retry = null;
  if (prevRetry && curRetry) {
    const transitions = [];
    const keys = new Set([...prevRetry.keys(), ...curRetry.keys()]);
    for (const k of keys) {
      const a = prevRetry.get(k);
      const b = curRetry.get(k);
      const from = a ? a.status : null;
      const to = b ? b.status : null;
      if (from === to) continue;
      transitions.push({ key: k, prevStatus: from, curStatus: to, prevPresent: !!a, curPresent: !!b, curClosedReason: b ? b.closedReason : null });
    }
    retry = {
      prevItems: prevRetry.size,
      curItems: curRetry.size,
      prevStatusCounts: tally([...prevRetry.values()].map((x) => x.status)),
      curStatusCounts: tally([...curRetry.values()].map((x) => x.status)),
      unchangedStatus: [...keys].length - transitions.length,
      transitionCounts: tally(transitions.map((t) => `${t.prevStatus}->${t.curStatus}`)),
      transitions,
    };
  }
  return {
    schema: "HOLD_RETRY_LKG_INDIVIDUAL_DIFF",
    at: new Date().toISOString(),
    snapshots: meta,
    note: "Best-effort from available snapshots; null/unknownPrevFlag means the previous snapshot lacked the flag. Offers snapshots and retry-queue snapshots are not from the same run.",
    hold,
    lkgCarried: lkg,
    retryQueue: retry,
    missing: {
      holdAndLkg: hold ? null : "PREV_OR_CUR_OFFERS_SNAPSHOT_NOT_PROVIDED",
      retryQueue: retry ? null : "PREV_OR_CUR_RETRY_QUEUE_NOT_PROVIDED",
    },
  };
}

const exists = (f) => !!f && fs.existsSync(f);

export async function runFullExport(opts) {
  const startedAt = new Date().toISOString();
  const out = opts.outDir;
  if (!out) throw new Error("outDir required");
  fs.mkdirSync(out, { recursive: true });
  const partitionRows = Math.max(1, Number(opts.partitionRows) || DEFAULT_PARTITION_ROWS);
  const maxRows = opts.maxRows != null && Number(opts.maxRows) > 0 ? Number(opts.maxRows) : null;
  const warnings = [];

  const U = new Map();
  const touch = (k) => {
    let u = U.get(k);
    if (!u) {
      u = { f: 0 };
      U.set(k, u);
    }
    return u;
  };

  // ---- Pass A: indexes (ledger streamed) ----
  let ledgerInfo = null;
  let ledgerDupes = 0;
  if (exists(opts.ledger)) {
    const r = await streamLedger(opts.ledger, (k) => {
      if (!k) return;
      const u = touch(k);
      if (u.f & F.LEDGER) ledgerDupes += 1;
      u.f |= F.LEDGER;
    });
    ledgerInfo = { rowsParsed: r.rows, duplicateRows: ledgerDupes, ...r.meta, uniqueKeys: r.rows - ledgerDupes };
  } else warnings.push("LEDGER_NOT_FOUND");

  const offersJson = exists(opts.offers) ? readJson(opts.offers) : null;
  if (!offersJson) warnings.push("OFFERS_NOT_FOUND");
  const offers = offersJson ? extractOffersProducts(offersJson) : new Map();
  const extras = offersExtras(offersJson);
  for (const k of offers.keys()) touch(k).f |= F.OFFERS;
  let sampleNew = 0;
  for (const s of extras.growth.sample) {
    if (s.ADVERTISER_ID == null || s.PRODUCT_ID == null) continue;
    const k = `${s.ADVERTISER_ID}|${s.PRODUCT_ID}`;
    const had = U.has(k);
    touch(k).f |= F.DEF_SAMPLE;
    if (!had) sampleNew += 1;
  }

  const retry = exists(opts.retryQueue) ? extractRetryQueue(readJson(opts.retryQueue)) : new Map();
  for (const k of retry.keys()) touch(k).f |= F.RETRY;

  const prevOffersJson = exists(opts.prevOffers) ? readJson(opts.prevOffers) : null;
  const prevOffers = prevOffersJson ? extractOffersProducts(prevOffersJson) : null;
  if (prevOffers) for (const k of prevOffers.keys()) touch(k).f |= F.PREV_OFFERS;

  const lkgJson = exists(opts.lkgSnapshot) ? readJson(opts.lkgSnapshot) : null;
  const lkgMap = lkgJson ? extractOffersProducts(lkgJson) : null;
  if (lkgMap) for (const k of lkgMap.keys()) touch(k).f |= F.LKG_SNAP;

  let histInfo = null;
  if (exists(opts.historicalCatalog)) {
    const h = readJson(opts.historicalCatalog);
    const keys = Object.keys(h.products || {});
    for (const k of keys) touch(k).f |= F.HIST;
    histInfo = {
      label: "HISTORICAL_SNAPSHOT_STALE",
      updatedAt: nn(h.updatedAt),
      uniqueCompositeIds: keys.length,
      stats: h.stats || null,
    };
  }

  const preferredCurrency = ledgerInfo?.preferredCurrency || null;
  const ctx = { offers, retry, preferredCurrency };

  // ---- Pass B/C: emit rows part by part ----
  const counters = {};
  for (const s of PRIMARY_STATE_PRIORITY) counters[s] = 0;
  const flagCounts = {};
  const parts = [];
  let buf = [];
  let rowsWritten = 0;
  let truncated = false;
  const shardInfo = [];
  const dupAcrossShards = { n: 0 };

  const flush = () => {
    if (!buf.length) return;
    const n = String(parts.length + 1).padStart(2, "0");
    const file = `${OUTPUT_FILES.partPrefix}${n}.jsonl.gz`;
    const tmp = path.join(out, `${file}.tmp`);
    const data = zlib.gzipSync(Buffer.from(buf.join("\n") + "\n", "utf8"), { level: 6 });
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, path.join(out, file));
    parts.push({ file, lines: buf.length, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") });
    buf = [];
  };
  const emit = (key, u, rec, shardId) => {
    if (maxRows != null && rowsWritten >= maxRows) {
      truncated = true;
      return false;
    }
    const row = buildRow(key, u, rec, shardId, ctx);
    counters[row.primaryState] += 1;
    for (const fl of row.secondaryFlags) flagCounts[fl] = (flagCounts[fl] || 0) + 1;
    buf.push(JSON.stringify(row));
    u.f |= F.EMITTED;
    rowsWritten += 1;
    if (buf.length >= partitionRows) flush();
    return true;
  };

  let manifestInfo = null;
  if (exists(opts.catalogManifest)) {
    const man = readJson(opts.catalogManifest);
    const dir = path.dirname(opts.catalogManifest);
    const shards = man?.generation?.shards || [];
    manifestInfo = {
      updatedAt: nn(man.updatedAt),
      generation: nn(man.generation?.generation),
      identityCount: nn(man.generation?.identityCount),
      shardCount: shards.length,
      stats: man.stats || null,
    };
    outer: for (const sh of shards) {
      const fp = path.join(dir, sh.file);
      if (!fs.existsSync(fp)) {
        warnings.push(`SHARD_MISSING:${sh.file}`);
        shardInfo.push({ id: sh.id, file: sh.file, present: false, declaredProductCount: nn(sh.productCount), actualProductCount: null });
        continue;
      }
      const j = readJson(fp);
      const entries = Object.entries(j.products || {});
      shardInfo.push({ id: sh.id, file: sh.file, present: true, declaredProductCount: nn(sh.productCount), actualProductCount: entries.length, countMatches: entries.length === sh.productCount });
      for (const [key, rec] of entries) {
        const u = touch(key);
        if (u.f & F.EMITTED) {
          dupAcrossShards.n += 1;
          continue;
        }
        u.f |= F.SHARD;
        if (!emit(key, u, rec, sh.id)) break outer;
      }
    }
  } else warnings.push("CATALOG_MANIFEST_NOT_FOUND");

  if (!truncated) {
    for (const [key, u] of U) {
      if (u.f & F.EMITTED) continue;
      if (!emit(key, u, null, null)) break;
    }
  }
  flush();

  const universeSize = U.size;
  const emittedAll = !truncated && rowsWritten === universeSize;

  // ---- Verification pass: re-read gz parts and recount ----
  const seen = new Set();
  const reCounts = {};
  let reLines = 0;
  let reDupKeys = 0;
  for (const p of parts) {
    const text = zlib.gunzipSync(fs.readFileSync(path.join(out, p.file))).toString("utf8");
    let start = 0;
    while (start < text.length) {
      let end = text.indexOf("\n", start);
      if (end < 0) end = text.length;
      if (end > start) {
        const row = JSON.parse(text.slice(start, end));
        reLines += 1;
        if (seen.has(row.key)) reDupKeys += 1;
        else seen.add(row.key);
        reCounts[row.primaryState] = (reCounts[row.primaryState] || 0) + 1;
      }
      start = end + 1;
    }
  }
  const perStateOk = PRIMARY_STATE_PRIORITY.every((s) => (reCounts[s] || 0) === counters[s]);

  // ---- Balance ----
  const countsByPrimaryState = {};
  const stateEvaluation = {};
  let sumNonNull = 0;
  for (const s of PRIMARY_STATE_PRIORITY) {
    const ev = STATE_EVALUATION[s];
    if (ev.evaluated) {
      countsByPrimaryState[s] = counters[s];
      sumNonNull += counters[s];
      stateEvaluation[s] = { evaluated: true, basis: ev.basis };
    } else {
      countsByPrimaryState[s] = counters[s] === 0 ? null : counters[s];
      if (counters[s] !== 0) sumNonNull += counters[s];
      stateEvaluation[s] = { evaluated: false, count: null, missingReason: ev.missingReason };
    }
  }
  const balance = {
    schema: "PRODUCT_INVENTORY_IDENTITY_BALANCE",
    at: new Date().toISOString(),
    exportSchema: SCHEMA,
    primaryStatePriority: PRIMARY_STATE_PRIORITY,
    contract: "Each identity has exactly ONE primaryState (first match in priority); secondary flags are multi-ok and never additive.",
    totalUniqueIdentities: rowsWritten,
    universeSizeBeforeEmit: universeSize,
    universeComplete: emittedAll,
    countsByPrimaryState,
    stateEvaluation,
    sumOfPrimaryStates: sumNonNull,
    balanceOk: sumNonNull === rowsWritten && reLines === rowsWritten && reDupKeys === 0 && perStateOk && (emittedAll || truncated),
    proof: {
      rowsWritten,
      rowsReReadFromGz: reLines,
      uniqueKeysReReadFromGz: seen.size,
      duplicateKeyRowsReReadFromGz: reDupKeys,
      perStateCountsReReadMatchWriteCounters: perStateOk,
      sumOfStatesEqualsRows: sumNonNull === rowsWritten,
    },
    secondaryFlagCounts: flagCounts,
    secondaryFlagNote: "Flag counts overlap by design — never sum them as unique products.",
    duplicates: {
      ledgerDuplicateRows: ledgerDupes,
      duplicateKeyOccurrencesAcrossShards: dupAcrossShards.n,
    },
  };

  // ---- Manifest ----
  const manifest = {
    schema: "PRODUCT_INVENTORY_INDIVIDUAL_MANIFEST",
    at: new Date().toISOString(),
    partitionRows,
    parts,
    totalLines: parts.reduce((a, p) => a + p.lines, 0),
    totalBytes: parts.reduce((a, p) => a + p.bytes, 0),
    rowFields: ["key", "advertiserId", "productId", "primaryState", "stateReason", "secondaryFlags", "shard", ...CORE_FIELDS, "missingFields", "missingReason"],
  };
  fs.writeFileSync(path.join(out, OUTPUT_FILES.manifest), JSON.stringify(manifest, null, 2));

  // ---- Deferred-ledger delta ----
  const histLedger = ledgerInfo?.uniqueKeys ?? null;
  const curDeferred = extras.growth.deferredNew != null ? Number(extras.growth.deferredNew) : null;
  const declaredDelta = histLedger != null && curDeferred != null ? histLedger - curDeferred : null;
  const nowInOffers = { total: 0, published: 0, hold: 0, otherNotReady: 0, keys: [] };
  let ledgerNotInCatalog = 0;
  const ledgerNotInCatalogKeys = [];
  for (const [k, u] of U) {
    if (!(u.f & F.LEDGER)) continue;
    const o = offers.get(k);
    if (o) {
      nowInOffers.total += 1;
      const vis = !o.hold && o.ready && o.publishable !== false;
      const st = vis ? "published" : o.hold ? "hold" : "other_not_ready";
      if (vis) nowInOffers.published += 1;
      else if (o.hold) nowInOffers.hold += 1;
      else nowInOffers.otherNotReady += 1;
      nowInOffers.keys.push({ key: k, currentState: st });
    }
    if (manifestInfo && !(u.f & F.SHARD) && truncated === false) {
      ledgerNotInCatalog += 1;
      ledgerNotInCatalogKeys.push(k);
    }
  }
  const sample = extras.growth.sample;
  let sampleInLedger = 0;
  let sampleInCatalog = 0;
  for (const s of sample) {
    const u = U.get(`${s.ADVERTISER_ID}|${s.PRODUCT_ID}`);
    if (u && u.f & F.LEDGER) sampleInLedger += 1;
    if (u && u.f & F.SHARD) sampleInCatalog += 1;
  }
  const expectedCurrent = histLedger != null ? histLedger - nowInOffers.total : null;
  const residual = expectedCurrent != null && curDeferred != null ? expectedCurrent - curDeferred : null;
  const deltaName = declaredDelta != null ? `DEFERRED_LEDGER_${declaredDelta}_DELTA.json` : "DEFERRED_LEDGER_DELTA.json";
  const delta = {
    schema: "DEFERRED_LEDGER_DELTA",
    at: new Date().toISOString(),
    historicalLedger: { label: "HISTORICAL_SNAPSHOT", updatedAt: nn(ledgerInfo?.updatedAt), runId: nn(ledgerInfo?.runId), declaredDeferredNewCount: nn(ledgerInfo?.deferredNewCount), uniqueKeys: histLedger },
    currentOffers: { updatedAt: extras.updatedAt, snapshotId: extras.snapshotId, deferredNew: curDeferred, newCandidates: nn(extras.growth.newCandidates), keptNew: nn(extras.growth.keptNew), deferredNewKeysPersistedInOffers: extras.growth.deferredNewKeysPersistedInOffers },
    declaredDelta,
    identityLevel: {
      historicalLedgerUniqueKeys: histLedger,
      ledgerKeysNowInCurrentOffers: { total: nowInOffers.total, published: nowInOffers.published, hold: nowInOffers.hold, otherNotReady: nowInOffers.otherNotReady },
      ledgerKeysAbsentFromDurableCatalogShards: manifestInfo ? ledgerNotInCatalog : null,
      expectedCurrentDeferredIfOnlyOffersExits: expectedCurrent,
      unexplainedResidual: residual,
      currentDeferredSample: { size: sample.length, inHistoricalLedger: sampleInLedger, notInHistoricalLedger: sample.length - sampleInLedger, inDurableCatalog: sampleInCatalog },
    },
    reconcilable: false,
    missingReason: extras.growth.deferredNewKeysPersistedInOffers === true ? null : "CURRENT_RUN_DEFERRED_KEY_LIST_NOT_AVAILABLE (offers carry only deferredDecisionLedgerSample)",
    interpretation: [
      "declaredDelta is a NET number: identities leaving the deferred set minus identities entering it.",
      "Only ledger identities now present in current offers are attributable per identity; the rest of the delta is unattributed (unexplainedResidual).",
      sample.length && sampleInLedger < sample.length
        ? "Part of the current deferred sample is absent from the historical ledger => the deferred set churned between runs; identity-level reconciliation needs the current run's persisted deferred keys."
        : "Current deferred sample matches the historical ledger.",
    ],
    ledgerKeysNowInCurrentOffers: nowInOffers.keys,
    ledgerKeysAbsentFromDurableCatalogShardsList: ledgerNotInCatalogKeys,
  };
  fs.writeFileSync(path.join(out, deltaName), JSON.stringify(delta, null, 2));

  // ---- Hold/retry/LKG diff ----
  const prevRetry = exists(opts.prevRetryQueue) ? extractRetryQueue(readJson(opts.prevRetryQueue)) : null;
  const diff = buildHoldRetryLkgDiff({
    prevOffers,
    curOffers: offersJson ? offers : null,
    prevRetry,
    curRetry: exists(opts.retryQueue) ? retry : null,
    meta: {
      prevOffersUpdatedAt: nn(prevOffersJson?.updatedAt),
      curOffersUpdatedAt: extras.updatedAt,
      prevRetryQueuePath: opts.prevRetryQueue ? path.basename(path.dirname(opts.prevRetryQueue)) : null,
      curRetryQueuePath: opts.retryQueue ? path.basename(path.dirname(opts.retryQueue)) : null,
    },
  });
  fs.writeFileSync(path.join(out, OUTPUT_FILES.diff), JSON.stringify(diff, null, 2));

  // ---- Completeness + summary ----
  const classification = truncated ? "SAMPLE_NOT_FULL" : parts.length > 1 ? "SHARDED_FULL" : "FULL";
  const completeness = {
    schema: "PRODUCT_INVENTORY_EXPORT_COMPLETENESS",
    at: new Date().toISOString(),
    classification,
    scope: truncated ? "TRUNCATED_BY_IU_CJ_INV_MAX_ROWS_TEST_ONLY" : "ALL_IDENTITIES_IN_AVAILABLE_SOURCES",
    parts: parts.length,
    partitionRows,
    lines: rowsWritten,
    perPartLines: parts.map((p) => ({ file: p.file, lines: p.lines })),
    uniqueIdentities: seen.size,
    universeSizeBeforeEmit: universeSize,
    hardRowCap: null,
    maxRowsTestOverrideUsed: maxRows,
    knownGaps: [
      ...(extras.growth.deferredNewKeysPersistedInOffers === true
        ? []
        : [`CURRENT_RUN_DEFERRED_KEYS_NOT_PERSISTED: current deferredNew=${curDeferred}; only ${sample.length} sample identities known (${sampleNew} not in any other source)`]),
      "PRIMARY_STATES_WITHOUT_PER_IDENTITY_EVIDENCE_REPORTED_AS_NULL: " + PRIMARY_STATE_PRIORITY.filter((s) => !STATE_EVALUATION[s].evaluated).join(","),
    ],
    warnings,
    historicalCatalogSnapshot: histInfo,
  };
  fs.writeFileSync(path.join(out, OUTPUT_FILES.completeness), JSON.stringify(completeness, null, 2));
  fs.writeFileSync(path.join(out, OUTPUT_FILES.balance), JSON.stringify(balance, null, 2));

  const summary = {
    schema: "PRODUCT_INVENTORY_FULL_SUMMARY",
    exportSchema: SCHEMA,
    startedAt,
    at: new Date().toISOString(),
    classification,
    totalUniqueIdentities: rowsWritten,
    parts: parts.length,
    mathematicalBalance: {
      ledgerUnique: histLedger,
      currentOffersDeferredNew: curDeferred,
      declaredDelta,
      durableCatalogUnique: manifestInfo?.identityCount ?? null,
      durableCatalogShardsActual: shardInfo.reduce((a, s) => a + (s.actualProductCount || 0), 0),
      currentOffersUniqueIdentities: offers.size,
      currentOffersPublishedVisible: counters.published,
      currentOffersHold: counters.hold,
      universeUnique: universeSize,
      sourceOverlap: {
        ledgerAndShard: [...U.values()].filter((u) => u.f & F.LEDGER && u.f & F.SHARD).length,
        ledgerAndOffers: [...U.values()].filter((u) => u.f & F.LEDGER && u.f & F.OFFERS).length,
        shardAndOffers: [...U.values()].filter((u) => u.f & F.SHARD && u.f & F.OFFERS).length,
        shardNotLedgerNotOffers: [...U.values()].filter((u) => u.f & F.SHARD && !(u.f & F.LEDGER) && !(u.f & F.OFFERS)).length,
        offersNotShardNotLedger: [...U.values()].filter((u) => u.f & F.OFFERS && !(u.f & F.SHARD) && !(u.f & F.LEDGER)).length,
      },
      statsClaims: { uniqueProducts: extras.statsUniqueProducts, uniquePublicEligible: extras.statsUniquePublicEligible, lkgCarriedProducts: extras.statsLkgCarriedProducts, lkgPublicHoldProducts: extras.statsLkgPublicHoldProducts },
    },
    countsByPrimaryState,
    sumOfPrimaryStates: sumNonNull,
    balanceOk: balance.balanceOk,
    sources: {
      ledger: ledgerInfo && { ...ledgerInfo, label: "HISTORICAL_SNAPSHOT" },
      durableCatalogManifest: manifestInfo && { ...manifestInfo, shards: shardInfo },
      currentOffers: { updatedAt: extras.updatedAt, snapshotId: extras.snapshotId, uniqueIdentities: offers.size },
      prevOffers: prevOffers ? { updatedAt: nn(prevOffersJson?.updatedAt), uniqueIdentities: prevOffers.size } : null,
      lkgSnapshot: lkgMap ? { updatedAt: nn(lkgJson?.updatedAt), uniqueIdentities: lkgMap.size } : null,
      retryQueue: { items: retry.size },
      historicalCatalogSnapshot: histInfo,
    },
    individualFiles: { manifest: OUTPUT_FILES.manifest, parts: parts.map((p) => p.file) },
    balanceFile: OUTPUT_FILES.balance,
    deltaFile: deltaName,
    diffFile: OUTPUT_FILES.diff,
    completenessFile: OUTPUT_FILES.completeness,
    warnings,
  };
  fs.writeFileSync(path.join(out, OUTPUT_FILES.summary), JSON.stringify(summary, null, 2));

  return { classification, rowsWritten, universeSize, parts, counters, countsByPrimaryState, balance, delta, diff, completeness, summary, deltaName, warnings, truncated };
}

export function optsFromEnv(env = process.env) {
  return {
    outDir: env.IU_CJ_INV_OUT_DIR,
    ledger: env.IU_CJ_INV_LEDGER,
    catalogManifest: env.IU_CJ_INV_CATALOG_MANIFEST,
    offers: env.IU_CJ_INV_OFFERS,
    prevOffers: env.IU_CJ_INV_PREV_OFFERS,
    retryQueue: env.IU_CJ_INV_RETRY_QUEUE,
    prevRetryQueue: env.IU_CJ_INV_PREV_RETRY_QUEUE,
    lkgSnapshot: env.IU_CJ_INV_LKG_SNAPSHOT,
    historicalCatalog: env.IU_CJ_INV_HISTORICAL_CATALOG,
    partitionRows: env.IU_CJ_INV_PARTITION_ROWS,
    maxRows: env.IU_CJ_INV_MAX_ROWS,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runFullExport(optsFromEnv())
    .then((r) => {
      console.log(
        JSON.stringify(
          { classification: r.classification, rows: r.rowsWritten, universe: r.universeSize, parts: r.parts.length, balanceOk: r.balance.balanceOk, countsByPrimaryState: r.countsByPrimaryState, warnings: r.warnings },
          null,
          2,
        ),
      );
      process.exit(r.balance.balanceOk ? 0 : 1);
    })
    .catch((e) => {
      console.error(e);
      process.exit(2);
    });
}
