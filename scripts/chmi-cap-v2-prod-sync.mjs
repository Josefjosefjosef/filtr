/**
 * CHMI CAP v2 production / shadow sync runner.
 *
 * Modes (IU_CHMI_CAP_V2_MODE):
 *   off     — no-op (legacy info-events path remains production)
 *   shadow  — fetch+parse+audit; do NOT replace production CHMI items
 *   active  — replace sourceId=chmi items in info_events feed atomically
 *
 * Interval: separate GHA workflow every 15 minutes (not 5).
 * Discovery: opendata_active_streams — newest bulletin per CAP product stream
 *   (alert_cap_50_*, alert_cap_70_*, …). NO fixed maxFiles / first-N / last-N.
 * Completeness: per-URL bulletin cache on 304; publish union of aktivni hazards;
 *   refuse publish when completeness cannot be proven.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getChmiCapV2Config, shouldPublishV2, shouldRunShadow } from "./chmi-cap-v2/config.mjs";
import { capProductKeyFromUrl, resolveDiscoveryAdapter } from "./chmi-cap-v2/discovery-adapter.mjs";
import {
  applyConditionalResult,
  atomicPublishDecision,
  createLockState,
  createSyncState,
  processCapDocuments,
  releaseLock,
  suspiciousDrop,
  tryAcquireLock,
} from "./chmi-cap-v2/sync-core.mjs";
import { mergeFeedItemsById, revisionsToFeed } from "./chmi-cap-v2/normalize-feed.mjs";
import { createGeoRegistry } from "./chmi-cap-v2/geo-registry.mjs";
import { latestRevisionForThread } from "./chmi-cap-v2/revisions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DIR = path.join(REPO, "projects", "data", "info_events");
const STATE_DIR = path.join(DIR, "chmi_cap_v2");
const STATE_FILE = path.join(STATE_DIR, "sync_state.json");
const DIAG_FILE = path.join(STATE_DIR, "diagnostics.json");
const REVISIONS_FILE = path.join(STATE_DIR, "revisions_index.json");
/** Bump when normalize/parser semantics change so bulletinCache cannot keep stale aktivni items. */
const BULLETIN_CACHE_EPOCH = 2;

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

function loadState() {
  return readJson(STATE_FILE, {
    sync: createSyncState("opendata://cap"),
    lock: createLockState(),
    knownUrls: [],
    endpointMeta: {},
    /** @type {Record<string, { items: object[], sent: string|null, updatedAt: string, sourceUrl: string }>} */
    bulletinCache: {},
    lastRun: null,
  });
}

function completenessMetrics(items, processResult) {
  const active = (items || []).filter((i) => i && i.status === "aktivni");
  let totalAreas = 0;
  let mappedAreas = 0;
  let unmappedAreas = 0;
  const events = new Set();
  for (const i of active) {
    const g = i.capV2 && i.capV2.geo ? i.capV2.geo : null;
    totalAreas += (g && g.totalAreas) || (i.region && i.region.orpIds && i.region.orpIds.length) || 0;
    mappedAreas += (g && g.mappedAreas) || (i.region && i.region.orpIds && i.region.orpIds.length) || 0;
    unmappedAreas += (g && g.unmappedAreas) || 0;
    if (i.capV2 && i.capV2.event) events.add(i.capV2.event);
    else if (i.title) events.add(String(i.title).split(" — ")[0]);
  }
  const infoBlocks = processResult
    ? processResult.report.revisions.reduce((n, r) => n + ((r.hazards && r.hazards.length) || 0), 0)
    : null;
  return {
    capMessages: processResult ? processResult.report.loaded : null,
    infoBlocks,
    logicalAlerts: active.length,
    uniqueEvents: [...events],
    totalAreas,
    mappedAreas,
    unmappedAreas,
    mappingCoveragePercent: mappedAreas + unmappedAreas === 0 ? 100 : Math.round((100 * mappedAreas) / (mappedAreas + unmappedAreas)),
    publishedActive: active.length,
  };
}

export async function runChmiCapV2Sync(opts = {}) {
  const config = opts.config || getChmiCapV2Config(process.env);
  const started = new Date().toISOString();
  const t0 = Date.now();

  if (config.mode === "off") {
    return { ok: true, skipped: true, reason: "mode_off", mode: "off" };
  }

  const state = opts.state || loadState();
  const lockTry = tryAcquireLock(state.lock, { ttlMs: opts.ttlMs || 8 * 60 * 1000 });
  if (!lockTry.ok) {
    state.sync.status = "locked";
    writeJson(STATE_FILE, state);
    return { ok: false, reason: "locked", mode: config.mode };
  }

  const diagnostics = {
    runId: lockTry.runId,
    started,
    mode: config.mode,
    discovery: null,
    http: [],
    parser: null,
    publish: null,
    status: "healthy",
    error: null,
  };

  try {
    if (state.sync.backoff_until && Date.parse(state.sync.backoff_until) > Date.now()) {
      diagnostics.status = "degraded";
      diagnostics.error = "backoff_active";
      return { ok: true, skipped: true, reason: "backoff", diagnostics, mode: config.mode };
    }

    const discoveryKind =
      process.env.IU_CHMI_CAP_V2_DISCOVERY ||
      (config.mode === "shadow" && opts.fixtureFiles ? "fixture" : "opendata_active_streams");
    const discovery = resolveDiscoveryAdapter(config, {
      kind: discoveryKind,
      files: opts.fixtureFiles,
      urls: state.knownUrls,
      userAgent: config.userAgent,
    });
    diagnostics.discovery = {
      type: discovery.type,
      role: discovery.role || null,
      selection: discovery.selection || null,
      maxFiles: null,
      fixedLimit: false,
    };

    const latest = await discovery.listLatest();
    if (!latest.length) throw Object.assign(new Error("discovery_empty"), { code: "DISCOVERY_EMPTY" });

    if (!state.bulletinCache || typeof state.bulletinCache !== "object") state.bulletinCache = {};
    if (state.bulletinCacheEpoch !== BULLETIN_CACHE_EPOCH) {
      state.bulletinCache = {};
      state.bulletinCacheEpoch = BULLETIN_CACHE_EPOCH;
      diagnostics.discovery = diagnostics.discovery || {};
      diagnostics.cacheEpochInvalidated = BULLETIN_CACHE_EPOCH;
    }

    const docs = [];
    const latestUrls = new Set();
    const latestByProduct = new Map();
    for (const item of latest) {
      const url = item.url;
      latestUrls.add(url);
      const productKey = item.productKey || capProductKeyFromUrl(item.name || url);
      latestByProduct.set(productKey, url);
      const meta = state.endpointMeta[url] || {};
      const haveCache = !!(state.bulletinCache[url] && Array.isArray(state.bulletinCache[url].items));
      // Cold cache miss: force full GET so concurrent streams are not lost after deploy.
      const conditional = haveCache ? { etag: meta.etag, lastModified: meta.lastModified } : {};
      const resp = await discovery.fetchBody(url, conditional);
      const applied = applyConditionalResult(resp, state.sync, { nowIso: new Date().toISOString() });
      diagnostics.http.push({
        url,
        productKey,
        status: resp.status,
        action: applied.action,
        cacheHit: haveCache && applied.action !== "process",
      });
      if (applied.action === "process" && applied.body) {
        state.endpointMeta[url] = {
          etag: state.sync.etag,
          lastModified: state.sync.lastModified,
          bodyHash: state.sync.bodyHash,
          updatedAt: new Date().toISOString(),
        };
        docs.push({ xml: applied.body, sourceUrl: url, name: item.name || url, productKey });
      }
    }

    diagnostics.discovery.productStreams = [...latestByProduct.keys()];
    diagnostics.discovery.streamCount = latestByProduct.size;

    // Evict superseded stream heads (same productKey, older URL) — never a fixed N window.
    for (const cachedUrl of Object.keys(state.bulletinCache)) {
      const pk = capProductKeyFromUrl(cachedUrl);
      const currentHead = latestByProduct.get(pk);
      if (currentHead && currentHead !== cachedUrl) {
        delete state.bulletinCache[cachedUrl];
        continue;
      }
      if (!latestUrls.has(cachedUrl) && !currentHead) {
        delete state.bulletinCache[cachedUrl];
      }
    }

    let feedItems = [];
    let processResult = null;
    if (docs.length) {
      for (const doc of docs) {
        const one = processCapDocuments([doc], {
          config,
          registry: createGeoRegistry(),
          receivedAt: started,
        });
        const tids = [...new Set(one.report.revisions.map((r) => r.alert_thread_id))];
        const revs = tids.map((tid) => latestRevisionForThread(one.store, tid)).filter(Boolean);
        const items = revisionsToFeed(revs, { nowIso: started });
        state.bulletinCache[doc.sourceUrl] = {
          items,
          sent: revs[0] ? revs[0].sent : null,
          updatedAt: started,
          sourceUrl: doc.sourceUrl,
          msgType: revs[0] ? revs[0].msgType : null,
          hazardCount: revs.reduce((n, r) => n + ((r.hazards && r.hazards.length) || 0), 0),
        };
      }

      processResult = processCapDocuments(docs, {
        config,
        registry: createGeoRegistry(),
        receivedAt: started,
      });
      diagnostics.parser = {
        loaded: processResult.report.loaded,
        valid: processResult.report.valid,
        rejected: processResult.report.rejected,
        duplicates: processResult.report.duplicates,
        quarantine: processResult.report.quarantine.length,
        cancels: processResult.report.cancels,
        updates: processResult.report.updates,
        newThreads: processResult.report.newThreads,
        status: processResult.status,
        alert: processResult.report.revisions.filter((r) => /^Alert$/i.test(r.msgType)).length,
        update: processResult.report.revisions.filter((r) => /^Update$/i.test(r.msgType)).length,
        cancel: processResult.report.revisions.filter((r) => /^Cancel$/i.test(r.msgType)).length,
      };
      writeJson(REVISIONS_FILE, {
        updatedAt: started,
        revisions: processResult.report.revisions.map((r) => ({
          cap_message_id: r.cap_message_id,
          alert_thread_id: r.alert_thread_id,
          msgType: r.msgType,
          change_type: r.change_type,
          sent: r.sent,
          hazardCount: (r.hazards || []).length,
        })),
      });
      state.knownUrls = latest.map((x) => x.url);
    } else {
      diagnostics.status = state.sync.status || "not_modified";
    }

    // Union active items across all current product-stream heads (304 keeps prior cache).
    const union = [];
    const missingCache = [];
    for (const item of latest) {
      const cached = state.bulletinCache[item.url];
      if (!cached || !Array.isArray(cached.items)) {
        missingCache.push(item.url);
        continue;
      }
      union.push(...cached.items);
    }
    feedItems = mergeFeedItemsById(union).filter((i) => i && i.status === "aktivni");

    const prevFeed = readJson(path.join(DIR, "feed.json"), { items: [] });
    const prevChmi = (prevFeed.items || []).filter((i) => String(i.sourceId) === "chmi");
    const completeness = completenessMetrics(feedItems, processResult);
    completeness.productStreams = diagnostics.discovery.productStreams || [];
    completeness.streamCount = diagnostics.discovery.streamCount || 0;
    completeness.missingStreamCache = missingCache.length;
    diagnostics.completeness = completeness;

    const alarms = [];
    if (missingCache.length) {
      alarms.push({ code: "INCOMPLETE_STREAM_CACHE", detail: missingCache.slice(0, 8) });
    }
    if (completeness.unmappedAreas > 0) {
      alarms.push({ code: "UNMAPPED_AREAS", count: completeness.unmappedAreas });
    }
    if (processResult && processResult.report.rejected > 0) {
      alarms.push({ code: "PARSER_REJECTED", count: processResult.report.rejected });
    }
    if (processResult && processResult.report.valid > 0 && feedItems.length === 0) {
      // All hazards filtered (žádná/None) is possible; only alarm when hazards had real events.
      const hazardEvents = processResult.report.revisions.flatMap((r) =>
        (r.hazards || []).map((h) => h.event || "")
      );
      const real = hazardEvents.filter((e) => e && !/^žádn|^no warning/i.test(e));
      if (real.length) alarms.push({ code: "ZERO_PUBLISH_WITH_REAL_HAZARDS", events: real.slice(0, 12) });
    }
    if (
      processResult &&
      suspiciousDrop(
        prevChmi.filter((i) => i.status === "aktivni").length,
        feedItems.length
      )
    ) {
      alarms.push({ code: "SUSPICIOUS_ACTIVE_DROP", prev: prevChmi.length, next: feedItems.length });
    }
    diagnostics.alarms = alarms;

    // Snapshot contract (CHMI product-supersession): one head per stream is authoritative.
    const headAreas = feedItems.reduce((n, i) => {
      const g = i.capV2 && i.capV2.geo ? i.capV2.geo : null;
      return n + ((g && g.mappedAreas) || (i.region && i.region.orpIds && i.region.orpIds.length) || 0);
    }, 0);
    diagnostics.snapshot = {
      model: "chmi_product_supersession",
      streamCount: diagnostics.discovery.streamCount || 0,
      headDocuments: latest.length,
      headAreas,
      historyReplayWarnings: 0,
      headWarnings: processResult ? processResult.report.rejected : 0,
      historyReplayAreas: null,
      crossDocumentReferences: null,
      unresolvedReferences: null,
      snapshotContractValid:
        missingCache.length === 0 &&
        (!processResult || processResult.report.rejected === 0) &&
        !alarms.some((a) =>
          ["INCOMPLETE_STREAM_CACHE", "ZERO_PUBLISH_WITH_REAL_HAZARDS", "PARSER_REJECTED"].includes(a.code)
        ),
    };
    if (!diagnostics.snapshot.snapshotContractValid) {
      alarms.push({ code: "SNAPSHOT_CONTRACT_INVALID", detail: diagnostics.snapshot });
      diagnostics.alarms = alarms;
    }

    const completenessOk =
      missingCache.length === 0 &&
      (!processResult || processResult.report.rejected === 0) &&
      !alarms.some((a) => a.code === "ZERO_PUBLISH_WITH_REAL_HAZARDS") &&
      diagnostics.snapshot.snapshotContractValid !== false;

    if (!completenessOk) {
      diagnostics.status = "failed";
      diagnostics.error = alarms[0] ? alarms[0].code : "completeness_failed";
    } else if (completeness.unmappedAreas > 0) {
      diagnostics.status = "degraded";
      diagnostics.error = diagnostics.error || "unmapped_areas";
    }

    const validationOk =
      completenessOk &&
      (!processResult || processResult.report.valid > 0 || feedItems.length > 0 || !docs.length);

    // Never publish an incomplete set. Keep last known good when FAIL.
    const shouldReplaceChmi = completenessOk && (feedItems.length > 0 || (docs.length > 0 && feedItems.length === 0));
    const candidateItems = shouldReplaceChmi
      ? (prevFeed.items || []).filter((i) => String(i.sourceId) !== "chmi").concat(feedItems)
      : null;

    const decision = atomicPublishDecision({
      mode: shouldPublishV2(config) ? "active" : "shadow",
      validationOk: validationOk && completenessOk,
      suspicious: alarms.some((a) => a.code === "SUSPICIOUS_ACTIVE_DROP"),
      candidateSnapshot: candidateItems ? { items: candidateItems, chmiItems: feedItems } : null,
      lastKnownGood: { items: prevFeed.items || [], chmiItems: prevChmi },
    });
    diagnostics.publish = {
      publish: decision.publish,
      reason: decision.reason,
      completeness,
      alarms,
      productionVerified: false,
    };

    if (decision.publish && candidateItems) {
      const nextFeed = {
        ...prevFeed,
        generatedAt: started,
        itemCount: candidateItems.length,
        items: candidateItems,
        chmiCapV2Active: true,
      };
      writeJson(path.join(DIR, "feed.json"), nextFeed);
      // refresh pocasi lane if present
      const lanePath = path.join(DIR, "lanes", "pocasi.json");
      const lane = readJson(lanePath, null);
      if (lane) {
        const others = (lane.items || []).filter((i) => String(i.sourceId) !== "chmi");
        const merged = others.concat(feedItems);
        writeJson(lanePath, { ...lane, generatedAt: started, itemCount: merged.length, items: merged });
      }
    } else if (shouldRunShadow(config) || config.mode === "shadow") {
      writeJson(path.join(STATE_DIR, "shadow_feed.json"), {
        generatedAt: started,
        mode: "shadow",
        items: feedItems,
      });
    }

    // Merge diagnostics into monitoring.json (ops / admin)
    const monitoring = readJson(path.join(DIR, "monitoring.json"), {});
    const prevDiag = monitoring.chmiCapV2 || {};
    const history = Array.isArray(prevDiag.runHistory) ? prevDiag.runHistory.slice() : [];
    const expiredCount = feedItems.filter((i) => i.status === "ukonceno").length;
    const cancelledCount =
      feedItems.filter((i) => i.status === "zruseno").length || diagnostics.parser?.cancel || 0;
    const snapshot = {
      mode: config.mode,
      lastRunAt: started,
      lastSuccessAt: state.sync.last_success_at || (diagnostics.status !== "failed" ? started : prevDiag.lastSuccessAt || null),
      lastChangedAt: state.sync.last_changed_at || prevDiag.lastChangedAt || null,
      lastError: diagnostics.error || state.sync.last_error || null,
      status:
        diagnostics.status === "healthy"
          ? state.sync.status || processResult?.status || "healthy"
          : diagnostics.status,
      etag: state.sync.etag,
      lastModified: state.sync.lastModified,
      consecutiveErrors: state.sync.consecutive_errors || 0,
      backoffUntil: state.sync.backoff_until || null,
      activeCount:
        feedItems.filter((i) => i.status === "aktivni").length ||
        prevChmi.filter((i) => i.status === "aktivni").length,
      cancelledCount,
      expiredCount,
      updateCount: diagnostics.parser?.update || 0,
      alertCount: diagnostics.parser?.alert || 0,
      cancelMsgCount: diagnostics.parser?.cancel || 0,
      quarantineCount: diagnostics.parser?.quarantine || 0,
      validCount: diagnostics.parser?.valid || 0,
      rejectedCount: diagnostics.parser?.rejected || 0,
      discoveryType: diagnostics.discovery?.type || null,
      discoveryRole: diagnostics.discovery?.role || null,
      discoverySelection: diagnostics.discovery?.selection || null,
      discoveryMaxFiles: null,
      discoveryFixedLimit: false,
      productStreams: diagnostics.discovery?.productStreams || [],
      streamCount: diagnostics.discovery?.streamCount || 0,
      completeness: diagnostics.completeness || null,
      alarms: diagnostics.alarms || [],
      lastCapSent: (() => {
        let best = null;
        for (const url of Object.keys(state.bulletinCache || {})) {
          const s = state.bulletinCache[url] && state.bulletinCache[url].sent;
          if (s && (!best || String(s) > String(best))) best = s;
        }
        return best;
      })(),
      bulletinCacheSize: Object.keys(state.bulletinCache || {}).length,
      publish: decision.publish,
      publishReason: decision.reason,
      productionVerified: false,
      runMs: Date.now() - t0,
      registryVersion: createGeoRegistry().version,
      lastSnapshotAt: decision.publish ? started : prevDiag.lastSnapshotAt || null,
      audit: {
        http: diagnostics.http || [],
        publish: diagnostics.publish,
        parser: diagnostics.parser,
      },
    };
    history.unshift({
      at: started,
      status: snapshot.status,
      mode: snapshot.mode,
      publish: snapshot.publish,
      runMs: snapshot.runMs,
      error: snapshot.lastError,
      activeCount: snapshot.activeCount,
    });
    snapshot.runHistory = history.slice(0, 48);
    monitoring.chmiCapV2 = snapshot;
    writeJson(path.join(DIR, "monitoring.json"), monitoring);

    state.lastRun = {
      at: started,
      ok: diagnostics.status !== "failed",
      mode: config.mode,
      publish: decision.publish,
    };
    diagnostics.finished = new Date().toISOString();
    diagnostics.runMs = Date.now() - t0;
    writeJson(DIAG_FILE, diagnostics);
    writeJson(STATE_FILE, state);
    return {
      ok: diagnostics.status !== "failed",
      mode: config.mode,
      publish: decision.publish,
      diagnostics,
      itemCount: feedItems.length,
    };
  } catch (e) {
    state.sync.consecutive_errors = (state.sync.consecutive_errors || 0) + 1;
    state.sync.status = "failed";
    state.sync.last_error = String(e && e.message ? e.message : e);
    diagnostics.status = "failed";
    diagnostics.error = state.sync.last_error;
    writeJson(DIAG_FILE, diagnostics);
    writeJson(STATE_FILE, state);
    return { ok: false, mode: config.mode, error: state.sync.last_error, diagnostics };
  } finally {
    releaseLock(state.lock, lockTry.runId);
    writeJson(STATE_FILE, state);
  }
}

async function main() {
  const result = await runChmiCapV2Sync();
  console.log("CHMI_CAP_V2_PROD_SYNC=" + (result.ok ? "OK" : "FAIL"));
  console.log("mode=" + result.mode);
  if (result.skipped) console.log("skipped=" + result.reason);
  if (result.publish != null) console.log("publish=" + result.publish);
  if (result.itemCount != null) console.log("items=" + result.itemCount);
  if (result.diagnostics && result.diagnostics.completeness) {
    console.log("streams=" + (result.diagnostics.completeness.streamCount || 0));
    console.log("active=" + (result.diagnostics.completeness.publishedActive || 0));
  }
  if (result.diagnostics && Array.isArray(result.diagnostics.alarms) && result.diagnostics.alarms.length) {
    console.log("alarms=" + result.diagnostics.alarms.map((a) => a.code).join(","));
  }
  if (result.error) console.log("error=" + result.error);
  if (!result.ok && !result.skipped) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
