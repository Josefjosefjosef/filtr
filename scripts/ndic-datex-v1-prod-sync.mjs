/**
 * NDIC DATEX II v1 production / shadow sync runner.
 *
 * Modes (IU_NDIC_DATEX_V1_MODE):
 *   off     — no-op
 *   shadow  — fetch+parse+audit; do NOT replace production NDIC items
 *   active  — replace sourceId=ndic / adapterOwner=ndic-datex-v1 items atomically
 *
 * Credentials (GitHub Actions secrets / Worker secrets — never commit):
 *   IU_NDIC_PULL_URL, IU_NDIC_PULL_USER, IU_NDIC_PULL_PASS
 *   IU_NDIC_TMC_PULL_URL (+ optional TMC user/pass)
 *
 * Default mode=off keeps CHMI and other sources untouched.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getNdicDatexV1Config,
  shouldPublishNdic,
  shouldRunShadow,
  NDIC_SOURCE_ID,
  NDIC_ADAPTER_OWNER,
} from "./ndic-datex-v1/config.mjs";
import { resolveDiscoveryAdapter } from "./ndic-datex-v1/discovery-adapter.mjs";
import {
  applyConditionalResult,
  atomicPublishDecision,
  createLockState,
  createSyncState,
  processAndGate,
  releaseLock,
  tryAcquireLock,
  sanityCheckSnapshot,
} from "./ndic-datex-v1/sync-core.mjs";
import {
  parseTmcTablePayload,
  activateTmcTable,
  emptyTmcStore,
  tmcPublicMeta,
} from "./ndic-datex-v1/tmc-table.mjs";
import {
  requireValidPersistentTmcForLive,
  persistTmcStoreAtomic,
  defaultTmcLkgRoot,
  datexTmcVersionMismatchGuard,
  assessDualVersionNeed,
} from "./ndic-datex-v1/tmc-persistent-store.mjs";
import {
  createPhaseTimer,
  buildDatexConditionalMetrics,
  attachObservability,
} from "./ndic-datex-v1/phase-observability.mjs";
import { isPublishableNdicItem } from "./ndic-datex-v1/normalize-feed.mjs";
import { assertAllowedPullUrl } from "./ndic-datex-v1/config.mjs";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";
import { assertNoTestDiskProviderEnv } from "./ndic-datex-v1/disk-preflight.mjs";
import {
  buildShadowForensicBundle,
  resolveForensicDir,
  writeShadowForensicBundle,
  printShadowForensicStdout,
} from "./ndic-datex-v1/shadow-forensic-report.mjs";
import {
  buildPlsDigestIndexFromXml,
  matchPredefinedRefsToPls,
  DOCUMENTED_PLS_DATASETS,
  COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF,
} from "./ndic-datex-v1/predefined-location-ref-forensics.mjs";
import { parseSafeXml, attrOf, descendantsNamed } from "./ndic-datex-v1/safe-xml.mjs";
import {
  persistTrafficUiOfflineSnapshot,
  resolveTrafficUiSnapshotDestPath,
} from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";
import { PUBLICATION_LAYER_FLAGS } from "./ndic-datex-v1/traffic-publication-constants.mjs";
import { countActivePublicationSafetyCounters } from "./ndic-datex-v1/active-publication-safety-counters.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
// Full TMC points must NEVER be committed / published on Pages (licence).
// Persistent LKG root (NOT runner.temp). Live DATEX is read-only against this store.
const TMC_LKG_ROOT = defaultTmcLkgRoot(process.env);

function isShadowIsolated(env = process.env) {
  return String(env.IU_NDIC_SHADOW_ISOLATED || "") === "1";
}

/**
 * Resolve info-events + conditional state paths at CALL TIME (not module load).
 * Critical for live-60s: IU_INFO_EVENTS_DATA_DIR is set in main() after imports.
 * Live cron must persist conditional state under IU_NDIC_LIVE_ROOT/work (not git clone).
 */
export function resolveInfoEventsDir(env = process.env) {
  if (env.IU_INFO_EVENTS_DATA_DIR) return path.resolve(String(env.IU_INFO_EVENTS_DATA_DIR));
  return path.join(REPO, "projects", "data", "info_events");
}

export function statePaths(env = process.env) {
  const dir = resolveInfoEventsDir(env);
  const stateDir = path.join(dir, "ndic_datex_v1");
  if (!isShadowIsolated(env)) {
    return {
      dir,
      stateDir,
      stateFile: path.join(stateDir, "sync_state.json"),
      diagFile: path.join(stateDir, "diagnostics.json"),
      tmcMetaFile: path.join(stateDir, "tmc_meta.json"),
    };
  }
  const base = env.IU_NDIC_SHADOW_WORK_DIR || env.RUNNER_TEMP || path.join(REPO, ".cache", "ndic-shadow");
  return {
    dir,
    stateDir: base,
    stateFile: path.join(base, "sync_state.json"),
    diagFile: path.join(base, "diagnostics.json"),
    tmcMetaFile: path.join(base, "tmc_meta.json"),
  };
}

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

function isNdicItem(item) {
  if (!item) return false;
  if (String(item.adapterOwner || "") === NDIC_ADAPTER_OWNER) return true;
  if (String(item.sourceId || "") === NDIC_SOURCE_ID) return true;
  return false;
}

/**
 * Optional forensic-only PLS catalog digest index (shadow). Never persists raw XML.
 * URLs: IU_NDIC_PLS_FORENSIC_URLS=comma-separated HTTPS mobilitydata.rsd.cz pull URLs.
 */
async function maybeBuildPlsForensicIndexes(config, diagnostics) {
  const raw = String(process.env.IU_NDIC_PLS_FORENSIC_URLS || "").trim();
  const paths = String(process.env.IU_NDIC_PLS_FORENSIC_XML_PATHS || "").trim();
  const indexes = [];
  const checked = [];
  diagnostics.plsForensic = {
    documentedDatasets: DOCUMENTED_PLS_DATASETS.map((d) => d.name),
    commonTrafficProfileAllowsPlsRef: COMMON_TRAFFIC_PROFILE_ALLOWS_PLS_REF,
    fetched: false,
  };
  if (paths) {
    for (const p of paths.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8)) {
      try {
        const xml = fs.readFileSync(p, "utf8");
        const name = path.basename(p).slice(0, 64) || "pls_file";
        const idx = buildPlsDigestIndexFromXml(xml, name, { parseSafeXml, attrOf, descendantsNamed });
        indexes.push(idx);
        checked.push({ name, locationCount: idx.locationCount, source: "file" });
      } catch (e) {
        checked.push({ name: path.basename(p), error: "pls_file_read_failed" });
      }
    }
    diagnostics.plsForensic.fetched = indexes.length > 0;
    diagnostics.plsForensic.checked = checked;
    return indexes;
  }
  if (!raw) {
    diagnostics.plsForensic.checked = DOCUMENTED_PLS_DATASETS.map((d) => ({
      name: d.name,
      source: "registry_docs_only",
      locationCount: null,
    }));
    return indexes;
  }
  if (!config.hasCredentials) {
    diagnostics.plsForensic.skipped = true;
    diagnostics.plsForensic.reason = "no_datex_credentials";
    return indexes;
  }
  const urls = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  const token = Buffer.from(`${config.pullUser}:${config.pullPass}`, "utf8").toString("base64");
  for (let i = 0; i < urls.length; i += 1) {
    const url = urls[i];
    try {
      assertAllowedPullUrl(url);
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": config.userAgent,
          Authorization: `Basic ${token}`,
          Accept: "application/xml, text/xml, */*",
        },
        redirect: "error",
      });
      if (res.status < 200 || res.status >= 300) {
        checked.push({ name: "pls_url_" + i, error: "http_" + res.status });
        continue;
      }
      const xml = await res.text();
      const name = "pls_url_" + i;
      const idx = buildPlsDigestIndexFromXml(xml, name, { parseSafeXml, attrOf, descendantsNamed });
      indexes.push(idx);
      checked.push({ name, locationCount: idx.locationCount, source: "url", httpStatus: res.status });
    } catch (e) {
      checked.push({ name: "pls_url_" + i, error: "pls_fetch_failed" });
    }
  }
  diagnostics.plsForensic.fetched = indexes.length > 0;
  diagnostics.plsForensic.checked = checked;
  return indexes;
}

/**
 * Isolated shadow only: write redacted forensic artifacts + safe stdout metrics.
 * Never retains raw DATEX/TMC/auth. Never commits to repo.
 */
function attachShadowForensicRetention(ret, ctx = {}) {
  if (!ret || ret.mode !== "shadow" || !isShadowIsolated()) return ret;
  const finishedAt = new Date().toISOString();
  const gateItems = Array.isArray(ctx.gateItems) ? ctx.gateItems : [];
  const refs = [];
  for (const it of gateItems) {
    const forensic = (it && it.ndicV1 && it.ndicV1.forensic) || {};
    if (forensic.noSignalSubtype !== "unrecognized_standard_profile") continue;
    const ri = forensic.rootInventory || {};
    const pref = forensic.predefinedRef || null;
    const name = String(ri.primaryStandardLocalName || "");
    if (name !== "predefinedlocationreference" && !(pref && pref.hasId)) continue;
    refs.push({
      idDigest: pref && pref.idDigest ? pref.idDigest : "",
      versionDigest: pref && pref.versionDigest ? pref.versionDigest : "",
    });
  }
  const indexes = Array.isArray(ctx.plsIndexes) ? ctx.plsIndexes : [];
  const checkPerformed = indexes.length > 0;
  const match = checkPerformed
    ? matchPredefinedRefsToPls(refs, indexes)
    : {
        matched: 0,
        unmatched: refs.length,
        multiple: 0,
        catalogBindingProven: 0,
        locationRecordExists: 0,
        verifiedLocationPossible: 0,
      };
  const bundle = buildShadowForensicBundle({
    ok: Boolean(ret.ok),
    reason: ret.reason || (ret.ok ? "ok" : "failed"),
    mode: ret.mode,
    published: Boolean(ret.published),
    diagnostics: ret.diagnostics || ctx.diagnostics,
    stats: ret.stats || ctx.stats,
    result: ctx.result,
    gateItems: ctx.gateItems,
    startedAt: (ret.diagnostics && ret.diagnostics.started) || ctx.startedAt,
    finishedAt,
    headSha: ctx.headSha,
    runId: ctx.runId || (ret.diagnostics && ret.diagnostics.runId),
    shadowIsolated: true,
    datexBytesRead: ctx.datexBytesRead,
    datexHttpStatus: ctx.datexHttpStatus,
    datexContentTypeValid: ctx.datexContentTypeValid,
    geocodingUsed: false,
    plsCatalogCheckPerformed: checkPerformed,
    plsDatasetsCheckedCount: checkPerformed
      ? indexes.length
      : DOCUMENTED_PLS_DATASETS.length,
    plsMatched: match.matched,
    plsUnmatched: match.unmatched,
    plsMultiple: match.multiple,
    plsCatalogBindingProven: match.catalogBindingProven,
    plsLocationRecordExists: match.locationRecordExists,
    plsVerifiedLocationPossible: match.verifiedLocationPossible,
  });
  const dir = resolveForensicDir(ctx.forensicDir);
  writeShadowForensicBundle(dir, bundle);
  printShadowForensicStdout(bundle.summary, bundle.validationReport);
  return {
    ...ret,
    forensic: {
      ok: bundle.ok,
      dirName: path.basename(dir),
      retentionPass: bundle.validationReport.FORENSIC_RETENTION_PASS === true,
    },
  };
}

function assertMonitoringMergeSafe(monitoring) {
  const m = monitoring && typeof monitoring === "object" ? monitoring : null;
  if (!m) throw new Error("NDIC sync: monitoring.json missing or invalid");
  if (!m.datasetAges || typeof m.datasetAges.feedAgeHours !== "number") {
    throw new Error("NDIC sync: refusing to write monitoring.json without datasetAges.feedAgeHours");
  }
  if (!Array.isArray(m.alerts)) throw new Error("NDIC sync: refusing to write monitoring.json without alerts[]");
  if (!Array.isArray(m.outageHistory)) {
    throw new Error("NDIC sync: refusing to write monitoring.json without outageHistory[]");
  }
}

function loadState(stateFile) {
  return readJson(stateFile || statePaths().stateFile, {
    sync: createSyncState("ndic://datex-pull"),
    lock: createLockState(),
    lastRun: null,
  });
}

/**
 * Live DATEX path MUST NOT download/import TMC.
 * Use scripts/ndic-tmc-maintenance-run.mjs (bootstrap/check/cutover/rollback).
 */
function assertLivePathDoesNotRefreshTmc() {
  return { liveDownload: false, liveImport: false };
}

export async function runNdicDatexV1Sync(opts = {}) {
  const config = opts.config || getNdicDatexV1Config(process.env);
  const started = new Date().toISOString();
  const paths = statePaths(process.env);
  const DIR = paths.dir;
  const STATE_DIR = paths.stateDir;

  // Defense-in-depth: even if a GitHub-hosted workflow injects secrets + checkouts
  // feature code, refuse before Authorization / mobilitydata contact.
  if (opts.skipRunnerIdentityCheck !== true) {
    assertNdicCzechEgressRunnerOrThrow(process.env);
  }
  assertNoTestDiskProviderEnv(process.env);

  if (config.mode === "off") {
    return { ok: true, skipped: true, reason: "mode_off", mode: "off" };
  }

  const state = opts.state || loadState(paths.stateFile);
  const lockTry = tryAcquireLock(state.lock, { ttlMs: opts.ttlMs || 8 * 60 * 1000 });
  if (!lockTry.ok) {
    state.sync.status = "locked";
    writeJson(paths.stateFile, state);
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
    tmc: null,
    status: "healthy",
    error: null,
    secretsPresent: {
      pull: config.hasPullCredentials,
      tmc: config.hasTmcCredentials,
      subscriberIdConfigured: config.subscriberIdConfigured,
    },
  };

  try {
    if (state.sync.backoff_until && Date.parse(state.sync.backoff_until) > Date.now()) {
      diagnostics.status = "degraded";
      diagnostics.error = "backoff_active";
      return { ok: true, skipped: true, reason: "backoff", diagnostics, mode: config.mode };
    }

        const phaseTimer = createPhaseTimer();
    assertLivePathDoesNotRefreshTmc();
    let tmcStore = emptyTmcStore();
    let tmcLkgRoot = opts.tmcLkgRoot || TMC_LKG_ROOT;
    let tmcStoreBytes = 0;
    if (opts.tmcStore) {
      tmcStore = opts.tmcStore;
      diagnostics.tmc = {
        ok: Boolean(tmcStore.active),
        reason: "opts_tmcStore",
        liveDownload: false,
        liveImport: false,
        persistent: false,
        meta: tmcPublicMeta(tmcStore),
      };
    } else if (opts.fixtureTmc) {
      const table = parseTmcTablePayload(opts.fixtureTmc);
      activateTmcTable(tmcStore, table, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      if (opts.persistFixtureTmc === true) {
        persistTmcStoreAtomic(tmcLkgRoot, tmcStore, { cutover: true, maintenanceResult: "fixture_bootstrap" });
      }
      diagnostics.tmc = {
        ok: true,
        reason: "fixture",
        liveDownload: false,
        liveImport: false,
        persistent: opts.persistFixtureTmc === true,
        meta: tmcPublicMeta(tmcStore),
      };
    } else {
      const liveTmc = requireValidPersistentTmcForLive({
        root: tmcLkgRoot,
        env: process.env,
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      tmcStoreBytes = liveTmc.bytes || 0;
      if (!liveTmc.ok) {
        diagnostics.status = "failed";
        diagnostics.error = "REFUSING_DATEX_RESOLVER_WITHOUT_VALID_TMC";
        diagnostics.tmc = {
          ok: false,
          reason: liveTmc.refuseCode || liveTmc.reason,
          liveDownload: false,
          liveImport: false,
          persistent: true,
          meta: (liveTmc.loaded && liveTmc.loaded.meta) || { active: false },
          storeBytes: tmcStoreBytes,
        };
        writeJson(paths.diagFile, diagnostics);
        return {
          ok: false,
          reason: "REFUSING_DATEX_RESOLVER_WITHOUT_VALID_TMC",
          mode: config.mode,
          diagnostics,
          published: false,
        };
      }
      tmcStore = liveTmc.store;
      diagnostics.tmc = {
        ok: true,
        reason: "persistent_lkg",
        liveDownload: false,
        liveImport: false,
        persistent: true,
        meta: liveTmc.meta,
        storeBytes: tmcStoreBytes,
        manifest: {
          activeVersion: liveTmc.manifest && liveTmc.manifest.activeVersion,
          previousVersion: liveTmc.manifest && liveTmc.manifest.previousVersion,
          lastVersionCheckAt: liveTmc.manifest && liveTmc.manifest.lastVersionCheckAt,
          lastSuccessfulCutoverAt: liveTmc.manifest && liveTmc.manifest.lastSuccessfulCutoverAt,
          newVersionAvailable: liveTmc.manifest && liveTmc.manifest.newVersionAvailable,
        },
      };
    }
    // Live path is read-only for TMC — only refresh public meta for Pages.
    writeJson(paths.tmcMetaFile, tmcPublicMeta(tmcStore));

    let plsIndexes = [];
    if (isShadowIsolated() && config.mode === "shadow") {
      plsIndexes = await maybeBuildPlsForensicIndexes(config, diagnostics);
    }

    const discoveryKind =
      opts.fixtureFiles || process.env.IU_NDIC_DISCOVERY === "fixture"
        ? "fixture"
        : config.hasPullCredentials
          ? "authenticated_pull"
          : "noop";
    const discovery = resolveDiscoveryAdapter(config, {
      kind: discoveryKind,
      files: opts.fixtureFiles,
      fetchImpl: opts.fetchImpl,
    });
    diagnostics.discovery = { type: discovery.type };

    if (discovery.type === "noop") {
      diagnostics.status = "failed";
      diagnostics.error = "credentials_missing";
      writeJson(paths.diagFile, diagnostics);
      return {
        ok: false,
        reason: "credentials_missing",
        mode: config.mode,
        diagnostics,
        blocked: [
          "IU_NDIC_PULL_URL",
          "IU_NDIC_PULL_USER",
          "IU_NDIC_PULL_PASS",
        ],
      };
    }

    const latest = await discovery.listLatest();
    if (!latest.length) throw Object.assign(new Error("discovery_empty"), { code: "DISCOVERY_EMPTY" });

    const target = latest[0];
    phaseTimer.mark("DATEX_REQUEST");
    const resp = await discovery.fetchBody(target.url, {
      etag: state.sync.etag,
      lastModified: state.sync.lastModified,
    });
    phaseTimer.finish("DATEX_REQUEST");
    const obsNet = resp.observability || {};
    if (obsNet.downloadFinishedAt) {
      // Split request vs body download when adapter provides it.
      phaseTimer.mark("DATEX_DOWNLOAD");
      // synthetic finish using reported durations for snapshot clarity
      phaseTimer.finish("DATEX_DOWNLOAD");
    }
    diagnostics.http.push({ status: resp.status, name: target.name });
    const condMetrics = buildDatexConditionalMetrics({
      status: resp.status,
      headers: resp.headers || {},
      ifModifiedSinceSent: obsNet.ifModifiedSinceSent === true,
      ifNoneMatchSent: obsNet.ifNoneMatchSent === true,
      bytesRead: obsNet.bytesRead != null ? obsNet.bytesRead : 0,
    });
    attachObservability(diagnostics, {
      DATEX_REQUEST_STARTED_AT: obsNet.requestStartedAt || null,
      DATEX_HEADERS_RECEIVED_AT: obsNet.headersReceivedAt || null,
      DATEX_DOWNLOAD_FINISHED_AT: obsNet.downloadFinishedAt || null,
      DATEX_REQUEST_DURATION_MS: obsNet.requestDurationMs != null ? obsNet.requestDurationMs : null,
      DATEX_DOWNLOAD_DURATION_MS: obsNet.downloadDurationMs != null ? obsNet.downloadDurationMs : null,
      DATEX_HTTP_STATUS: resp.status,
      DATEX_CONTENT_LENGTH: obsNet.contentLengthHeader != null ? obsNet.contentLengthHeader : condMetrics.DATEX_RESPONSE_CONTENT_LENGTH,
      DATEX_BYTES_READ: condMetrics.DATEX_BYTES_READ,
      DATEX_REQUEST_IF_MODIFIED_SINCE: obsNet.ifModifiedSinceValue || state.sync.lastModified || null,
      DATEX_RESPONSE_LAST_MODIFIED: obsNet.responseLastModified || null,
      conditional: condMetrics,
      TMC_LIVE_DOWNLOAD: "NO",
      TMC_LIVE_IMPORT: "NO",
      TMC_STORE_BYTES: tmcStoreBytes,
      phases: phaseTimer.snapshot(),
    });
    const cond = applyConditionalResult(resp, state.sync, { nowIso: started });
    // Persist etag/lastModified whenever server provided them (already in applyConditionalResult).
    diagnostics.observability.DATEX_ETAG_PERSISTED = state.sync.etag ? "YES" : "NO";
    diagnostics.observability.DATEX_LAST_MODIFIED_PERSISTED = state.sync.lastModified ? "YES" : "NO";

    const prevFeed = readJson(path.join(DIR, "feed.json"), { items: [] });
    const prevNdic = (prevFeed.items || []).filter(isNdicItem);

    if (cond.action === "not_modified" || cond.action === "hash_unchanged") {
      diagnostics.status = "healthy";
      diagnostics.publish = { publish: false, reason: cond.action };
      diagnostics.observability.DATEX_NOT_MODIFIED = resp.status === 304 || cond.action === "not_modified" ? "YES" : "NO";
      diagnostics.observability.FAST_PATH = {
        action: cond.action,
        DATEX_PARSE_CALLED: "NO",
        TMC_CALLED: "NO",
        RESOLVER_CALLED: "NO",
        CANDIDATE_CALLED: "NO",
        PUBLICATION_CALLED: "NO",
        "304_FAST_PATH_PASS": resp.status === 304 ? "YES" : "YES_HASH_UNCHANGED",
        "304_FAST_PATH_DURATION_MS": obsNet.totalDurationMs != null ? obsNet.totalDurationMs : phaseTimer.durationMs("DATEX_REQUEST"),
        "304_NETWORK_BYTES_APPROX": resp.status === 304 ? 0 : Number(condMetrics.DATEX_BYTES_READ || 0),
      };
      if (!isShadowIsolated()) {
        const monitoring = readJson(path.join(DIR, "monitoring.json"), {});
        if (monitoring.datasetAges) {
          assertMonitoringMergeSafe(monitoring);
          monitoring.ndicDatexV1 = {
            ...(monitoring.ndicDatexV1 || {}),
            mode: config.mode,
            lastRunAt: started,
            lastSuccessAt: state.sync.last_success_at,
            status: "not_modified",
            tmc: tmcPublicMeta(tmcStore),
            activeCount: prevNdic.filter(isPublishableNdicItem).length,
          };
          writeJson(path.join(DIR, "monitoring.json"), monitoring);
        }
      }
      state.lastRun = { at: started, action: cond.action };
      writeJson(paths.stateFile, state);
      writeJson(paths.diagFile, diagnostics);
      return attachShadowForensicRetention(
        { ok: true, reason: cond.action, mode: config.mode, diagnostics, published: false },
        {
          result: { parsed: { ok: true, situationCount: 0, rejectedCount: 0 }, stats: {}, quarantine: [], gate: { items: [], gateOk: true }, all: [] },
          gateItems: [],
          startedAt: started,
          datexBytesRead: 0,
          datexHttpStatus: resp.status,
          datexContentTypeValid: true,
          plsIndexes,
        }
      );
    }

    if (cond.action !== "process") {
      diagnostics.status = state.sync.status || "failed";
      diagnostics.error = state.sync.last_error || cond.action;
      writeJson(paths.stateFile, state);
      writeJson(paths.diagFile, diagnostics);
      return attachShadowForensicRetention(
        { ok: false, reason: cond.action, mode: config.mode, diagnostics, published: false },
        { startedAt: started, datexHttpStatus: resp.status, plsIndexes }
      );
    }

    const body = cond.body;
    phaseTimer.mark("DATEX_PARSE");
    phaseTimer.mark("RESOLVER");
    phaseTimer.mark("CANDIDATE");
    const result = processAndGate(body, {
      prevItems: prevNdic,
      tmcTable: tmcStore.active,
      nowIso: started,
      repoRoot: REPO,
      sanity: config.sanity,
      limits: config.limits,
      legalRegistry: opts.legalRegistry,
      sourceRegistry: opts.sourceRegistry,
    });
    phaseTimer.finish("DATEX_PARSE");
    phaseTimer.finish("RESOLVER");
    phaseTimer.finish("CANDIDATE");
    attachObservability(diagnostics, {
      phases: phaseTimer.snapshot(),
      DATEX_PARSE_STARTED_AT: (phaseTimer.snapshot().DATEX_PARSE || {}).startedAt || null,
      DATEX_PARSE_FINISHED_AT: (phaseTimer.snapshot().DATEX_PARSE || {}).finishedAt || null,
      DATEX_PARSE_DURATION_MS: phaseTimer.durationMs("DATEX_PARSE"),
      RESOLVER_DURATION_MS: phaseTimer.durationMs("RESOLVER"),
      CANDIDATE_READY_AT: (phaseTimer.snapshot().CANDIDATE || {}).finishedAt || null,
    });
    // Compatibility guard: collect TMC refs from parsed situations when available
    try {
      const refs = [];
      for (const sit of result.parsed && result.parsed.situations ? result.parsed.situations : []) {
        for (const rec of sit.records || []) {
          for (const loc of rec.locations || []) {
            for (const r of loc.tmcRefs || []) refs.push(r);
          }
        }
      }
      const mismatch = datexTmcVersionMismatchGuard(refs, tmcStore.active, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      const dual = assessDualVersionNeed(refs);
      diagnostics.datexTmcCompatibility = { ...mismatch, ...dual };
      if (mismatch.NEW_TMC_REFERENCE_DETECTED === "YES") {
        diagnostics.status = diagnostics.status || "healthy";
        diagnostics.tmcNewVersionHint = true;
      }
    } catch {
      diagnostics.datexTmcCompatibility = { ok: true, note: "guard_skipped" };
    }
    diagnostics.parser = {
      situations: result.parsed.situationCount,
      rejected: result.parsed.rejectedCount,
      quarantine: (result.quarantine || []).length,
      stats: result.stats,
    };

    if (!result.gate.gateOk) {
      diagnostics.status = "quarantined";
      diagnostics.error = "publish_gate:" + result.gate.reason;
      // Fail-closed: do not publish
      writeJson(paths.stateFile, state);
      writeJson(paths.diagFile, diagnostics);
      return attachShadowForensicRetention(
        { ok: false, reason: "publish_gate", mode: config.mode, diagnostics },
        {
          result,
          gateItems: [],
          startedAt: started,
          datexBytesRead: typeof body === "string" ? Buffer.byteLength(body, "utf8") : 0,
          datexHttpStatus: resp.status,
          datexContentTypeValid: true,
          plsIndexes,
        }
      );
    }

    const feedItems = result.gate.items;
    const sanity = result.sanity || sanityCheckSnapshot(prevNdic.filter(isPublishableNdicItem).length, feedItems.length);
    diagnostics.sanity = sanity;

    const validationOk = result.parsed.ok && sanity.ok !== false && !sanity.alarms.some((a) => a.code === "EMPTY_SNAPSHOT");
    const suspicious = sanity.alarms.some((a) => a.code === "SUSPICIOUS_DROP");

    const candidateItems = validationOk
      ? (prevFeed.items || []).filter((i) => !isNdicItem(i)).concat(feedItems)
      : null;

    const decision = atomicPublishDecision({
      mode: shouldPublishNdic(config) ? "active" : "shadow",
      validationOk,
      suspicious,
      candidateSnapshot: candidateItems ? { items: candidateItems, ndicItems: feedItems } : null,
      lastKnownGood: { items: prevFeed.items || [], ndicItems: prevNdic },
    });
    diagnostics.publish = {
      publish: decision.publish,
      reason: decision.reason,
      stats: result.stats,
      alarms: sanity.alarms,
    };

    const datexBytesRead = typeof body === "string" ? Buffer.byteLength(body, "utf8") : Buffer.isBuffer(body) ? body.length : 0;
    diagnostics.forensicMeta = {
      datexBytesRead,
      datexHttpStatus: resp.status,
    };

    if (decision.publish && candidateItems && !isShadowIsolated()) {
      const nextFeed = {
        ...prevFeed,
        generatedAt: started,
        itemCount: candidateItems.length,
        items: candidateItems,
        ndicDatexV1Active: true,
      };
      writeJson(path.join(DIR, "feed.json"), nextFeed);
      const lanePath = path.join(DIR, "lanes", "doprava.json");
      const lane = readJson(lanePath, null);
      if (lane) {
        const others = (lane.items || []).filter((i) => !isNdicItem(i));
        const merged = others.concat(feedItems);
        writeJson(lanePath, { ...lane, generatedAt: started, itemCount: merged.length, items: merged });
      }
      // Count-only ACTIVE safety counters (same keys as shadow forensic; no payloads).
      diagnostics.publicationSafety = countActivePublicationSafetyCounters(feedItems);
      diagnostics.UNVERIFIED_LOCATION_PUBLISHED =
        diagnostics.publicationSafety.UNVERIFIED_LOCATION_PUBLISHED;
      diagnostics.UNVERIFIED_KM_PUBLISHED = diagnostics.publicationSafety.UNVERIFIED_KM_PUBLISHED;
      diagnostics.UNVERIFIED_DIRECTION_PUBLISHED =
        diagnostics.publicationSafety.UNVERIFIED_DIRECTION_PUBLISHED;
      diagnostics.FUZZY_MATCH_USED = false;
      diagnostics.GEOCODING_USED = false;
      diagnostics.HEURISTIC_LOCATION_USED = false;

      if (PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED === true) {
        // Write into DIR (IU_INFO_EVENTS_DATA_DIR candidate sandbox when set), NOT only
        // feature-checkout projects/data/... — otherwise candidate artifact lacks REQUIRED
        // traffic_offline_snapshot.json and shared-write git add can false-NO_CHANGES
        // (ACTIVE run 31257122613).
        const snapshotDest = resolveTrafficUiSnapshotDestPath({
          repoRoot: REPO,
          infoEventsDir: DIR,
        });
        const uiSnap = persistTrafficUiOfflineSnapshot(feedItems, {
          repoRoot: REPO,
          relPath: snapshotDest,
          nowIso: started,
          sourceFreshness: "FRESH",
        });
        diagnostics.trafficUiSnapshot = {
          ok: uiSnap.ok === true,
          rejectCode: uiSnap.rejectCode || null,
          cardCount: uiSnap.cardCount || 0,
          bytes: uiSnap.bytes || 0,
          uiCompact: uiSnap.uiCompact === true,
          sizeBreakdown: uiSnap.sizeBreakdown
            ? {
                metadata: uiSnap.sizeBreakdown.metadata,
                projections: uiSnap.sizeBreakdown.projections,
                feed: uiSnap.sizeBreakdown.feed,
                cards: uiSnap.sizeBreakdown.cards,
                historyItems: uiSnap.sizeBreakdown.historyItems,
                filterIndexes: uiSnap.sizeBreakdown.filterIndexes,
                cardsProvenance: uiSnap.sizeBreakdown.cardsProvenance,
                FULL_SNAPSHOT: uiSnap.sizeBreakdown.FULL_SNAPSHOT,
                LIMIT_DEFAULT: uiSnap.sizeBreakdown.LIMIT_DEFAULT,
                OVER_BY: uiSnap.sizeBreakdown.OVER_BY,
              }
            : null,
          trafficUiEnabled: uiSnap.trafficUiEnabled === true,
          publicationEnabled: false,
        };
      }
    } else if ((shouldRunShadow(config) || config.mode === "shadow") && process.env.IU_NDIC_SHADOW_ISOLATED !== "1") {
      /* Non-isolated legacy shadow dump — still not published; never commit this path in CI. */
      writeJson(path.join(STATE_DIR, "shadow_feed.json"), {
        generatedAt: started,
        mode: "shadow",
        itemCount: feedItems.length,
        stats: result.stats,
        /* omit full items when isolated; keep count-only for safety in future */
        items: feedItems,
      });
    } else if (config.mode === "shadow" && process.env.IU_NDIC_SHADOW_ISOLATED === "1") {
      diagnostics.shadowIsolated = true;
      diagnostics.shadowItemCount = feedItems.length;
    }

    const monitoring = readJson(path.join(DIR, "monitoring.json"), {});
    if (monitoring.datasetAges && process.env.IU_NDIC_SHADOW_ISOLATED !== "1") {
      assertMonitoringMergeSafe(monitoring);
      monitoring.ndicDatexV1 = {
        mode: config.mode,
        lastRunAt: started,
        lastSuccessAt: state.sync.last_success_at,
        lastChangedAt: state.sync.last_changed_at,
        status: decision.publish ? "healthy" : diagnostics.status,
        httpStatus: resp.status,
        notModified: false,
        stats: result.stats,
        quarantineCount: (result.quarantine || []).length,
        rejectedCount: result.parsed.rejectedCount,
        activeCount: feedItems.filter(isPublishableNdicItem).length,
        tmc: tmcPublicMeta(tmcStore),
        parserVersion: config.parserVersion,
        publish: diagnostics.publish,
        alarms: sanity.alarms,
      };
      writeJson(path.join(DIR, "monitoring.json"), monitoring);
    }

    state.lastRun = { at: started, action: decision.publish ? "published" : decision.reason };
    writeJson(paths.stateFile, state);
    writeJson(paths.diagFile, diagnostics);
    return attachShadowForensicRetention(
      {
        ok: true,
        mode: config.mode,
        published: Boolean(decision.publish),
        diagnostics,
        stats: result.stats,
      },
      {
        result,
        gateItems: feedItems,
        startedAt: started,
        datexBytesRead,
        datexHttpStatus: resp.status,
        datexContentTypeValid: true,
        plsIndexes,
      }
    );
  } catch (e) {
    diagnostics.status = "failed";
    diagnostics.error = String(e && e.code) || String(e && e.message) || "error";
    state.sync.consecutive_errors = (state.sync.consecutive_errors || 0) + 1;
    writeJson(paths.stateFile, state);
    writeJson(paths.diagFile, diagnostics);
    return attachShadowForensicRetention(
      { ok: false, reason: diagnostics.error, mode: config.mode, diagnostics },
      { startedAt: started, plsIndexes: [] }
    );
  } finally {
    releaseLock(state.lock, lockTry.runId);
    writeJson(paths.stateFile, state);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runNdicDatexV1Sync()
    .then((r) => {
      const out = {
        ok: r.ok,
        reason: r.reason,
        mode: r.mode,
        published: r.published,
        blocked: r.blocked || null,
        forensicRetention: r.forensic ? r.forensic.retentionPass : null,
      };
      console.log(JSON.stringify(out, null, 2));
      if (!r.ok && r.reason !== "credentials_missing" && r.reason !== "mode_off") process.exitCode = 1;
      // credentials_missing in shadow/off-default CI is non-fatal when mode=off; when mode!=off exit 1
      if (r.reason === "credentials_missing" && r.mode !== "off") process.exitCode = 1;
      // Isolated shadow must produce forensic retention (fail-closed if missing/invalid)
      if (r.mode === "shadow" && isShadowIsolated() && r.ok && (!r.forensic || r.forensic.retentionPass !== true)) {
        process.exitCode = 1;
      }
    })
    .catch((e) => {
      console.error(String(e && e.stack || e));
      process.exitCode = 1;
    });
}
