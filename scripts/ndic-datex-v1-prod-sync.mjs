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
import { DEFAULT_ZIP_LIMITS } from "./ndic-datex-v1/tmc-zip.mjs";
import { loadTmcTableFromDownload } from "./ndic-datex-v1/tmc-download-load.mjs";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const DIR = path.join(REPO, "projects", "data", "info_events");
const STATE_DIR = path.join(DIR, "ndic_datex_v1");
const STATE_FILE = path.join(STATE_DIR, "sync_state.json");
const DIAG_FILE = path.join(STATE_DIR, "diagnostics.json");
const TMC_META_FILE = path.join(STATE_DIR, "tmc_meta.json");
// Full TMC points must NEVER be committed / published on Pages (licence).
const TMC_STORE_FILE = path.join(
  process.env.IU_NDIC_TMC_STORE_PATH || path.join(REPO, ".cache", "ndic-datex-v1", "tmc_store.json")
);

function isShadowIsolated() {
  return String(process.env.IU_NDIC_SHADOW_ISOLATED || "") === "1";
}

function statePaths() {
  if (!isShadowIsolated()) {
    return { stateFile: STATE_FILE, diagFile: DIAG_FILE, tmcMetaFile: TMC_META_FILE };
  }
  const base = process.env.IU_NDIC_SHADOW_WORK_DIR || process.env.RUNNER_TEMP || path.join(REPO, ".cache", "ndic-shadow");
  return {
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
 * Isolated shadow only: write redacted forensic artifacts + safe stdout metrics.
 * Never retains raw DATEX/TMC/auth. Never commits to repo.
 */
function attachShadowForensicRetention(ret, ctx = {}) {
  if (!ret || ret.mode !== "shadow" || !isShadowIsolated()) return ret;
  const finishedAt = new Date().toISOString();
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
  return readJson(stateFile || STATE_FILE, {
    sync: createSyncState("ndic://datex-pull"),
    lock: createLockState(),
    lastRun: null,
  });
}

/**
 * Optional TMC refresh when credentials present. Failure keeps last-good table.
 */
async function maybeRefreshTmc(config, tmcStore, diagnostics) {
  if (!config.hasTmcCredentials) {
    diagnostics.tmc = { skipped: true, reason: "no_tmc_credentials", meta: tmcPublicMeta(tmcStore) };
    return tmcStore;
  }
  try {
    assertAllowedPullUrl(config.tmcPullUrl);
    const token = Buffer.from(`${config.tmcPullUser}:${config.tmcPullPass}`, "utf8").toString("base64");
    const res = await fetch(config.tmcPullUrl, {
      method: "GET",
      headers: {
        "User-Agent": config.userAgent,
        Authorization: `Basic ${token}`,
        Accept: "application/zip, application/json, text/plain, */*",
      },
      redirect: "error",
    });
    diagnostics.tmcHttp = { status: res.status };
    if (res.status === 304) {
      diagnostics.tmc = { skipped: true, reason: "not_modified", meta: tmcPublicMeta(tmcStore) };
      return tmcStore;
    }
    if (res.status < 200 || res.status >= 300) {
      diagnostics.tmc = { ok: false, reason: "http_" + res.status, meta: tmcPublicMeta(tmcStore) };
      return tmcStore;
    }
    const ab = await res.arrayBuffer();
    const bodyBuf = Buffer.from(ab);
    // TMC compressed ceiling is independent of DATEX maxResponseBytes (≤96 MiB).
    if (bodyBuf.length > DEFAULT_ZIP_LIMITS.maxCompressedTotal) {
      diagnostics.tmc = { ok: false, reason: "tmc_body_too_large", meta: tmcPublicMeta(tmcStore) };
      return tmcStore;
    }
    const contentEncoding = String(res.headers.get("content-encoding") || "");
    const workDir = path.join(
      path.dirname(TMC_STORE_FILE),
      "tmc-dl-" + String(diagnostics.runId || "run").slice(0, 16)
    );
    const loaded = await loadTmcTableFromDownload(bodyBuf, {
      contentEncoding,
      workDir,
      countryCode: config.tmcCountryCode,
      tableNumber: config.tmcLocationTableNumber,
    });
    if (!loaded.ok) {
      diagnostics.tmc = {
        ok: false,
        reason: String(loaded.rejectCode || loaded.reason || "tmc_load_failed"),
        ignoredNonStandardCount: Number(loaded.ignoredNonStandardCount) || 0,
        ignoredEntries: Array.isArray(loaded.ignoredEntries) ? loaded.ignoredEntries.slice(0, 100) : [],
        unknownEntries: Array.isArray(loaded.unknownEntries) ? loaded.unknownEntries.slice(0, 100) : [],
        unknownNonclassifiedCount: Number(loaded.unknownNonclassifiedCount) || 0,
        unknownRequiredCount: Number(loaded.unknownRequiredCount) || 0,
        rejectedUnsafeCount: Number(loaded.rejectedUnsafeCount) || 0,
        requiredTableCountExpected: Number(loaded.requiredTableCountExpected) || 0,
        requiredTableCountFound: Number(loaded.requiredTableCountFound) || 0,
        requiredTableSetComplete: false,
        requiredTableSetValid: false,
        resolverTableActivated: false,
        meta: tmcPublicMeta(tmcStore),
      };
      return tmcStore;
    }
    const act = activateTmcTable(tmcStore, loaded.table, {
      countryCode: config.tmcCountryCode,
      tableNumber: config.tmcLocationTableNumber,
    });
    diagnostics.tmc = {
      ok: act.ok,
      reason: act.ok ? act.reason || "activated" : act.reason || "activate_failed",
      source: loaded.source,
      ignoredNonStandardCount: Number(loaded.ignoredNonStandardCount) || 0,
      ignoredEntries: Array.isArray(loaded.ignoredEntries) ? loaded.ignoredEntries.slice(0, 100) : [],
      unknownNonclassifiedCount: Number(loaded.unknownNonclassifiedCount) || 0,
      unknownRequiredCount: Number(loaded.unknownRequiredCount) || 0,
      rejectedUnsafeCount: Number(loaded.rejectedUnsafeCount) || 0,
      requiredTableCountExpected: Number(loaded.requiredTableCountExpected) || 0,
      requiredTableCountFound: Number(loaded.requiredTableCountFound) || 0,
      requiredTableSetComplete: loaded.requiredTableSetComplete === true,
      requiredTableSetValid: loaded.requiredTableSetValid === true,
      resolverTableActivated: act.ok === true,
      cid: loaded.cid,
      tabcd: loaded.tabcd,
      tableVersion: loaded.tableVersion,
      authSource: config.tmcAuthSource,
      meta: tmcPublicMeta(tmcStore),
    };
    return tmcStore;
  } catch (e) {
    diagnostics.tmc = {
      ok: false,
      reason: String(e && e.code) || String(e && e.message),
      meta: tmcPublicMeta(tmcStore),
    };
    return tmcStore;
  }
}

export async function runNdicDatexV1Sync(opts = {}) {
  const config = opts.config || getNdicDatexV1Config(process.env);
  const started = new Date().toISOString();
  const paths = statePaths();

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

    let tmcStore = opts.tmcStore || readJson(TMC_STORE_FILE, emptyTmcStore());
    if (opts.fixtureTmc) {
      const table = parseTmcTablePayload(opts.fixtureTmc);
      activateTmcTable(tmcStore, table, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      diagnostics.tmc = { ok: true, reason: "fixture", meta: tmcPublicMeta(tmcStore) };
    } else {
      tmcStore = await maybeRefreshTmc(config, tmcStore, diagnostics);
    }
    writeJson(TMC_STORE_FILE, tmcStore);
    writeJson(paths.tmcMetaFile, tmcPublicMeta(tmcStore));

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
    const resp = await discovery.fetchBody(target.url, {
      etag: state.sync.etag,
      lastModified: state.sync.lastModified,
    });
    diagnostics.http.push({ status: resp.status, name: target.name });
    const cond = applyConditionalResult(resp, state.sync, { nowIso: started });

    const prevFeed = readJson(path.join(DIR, "feed.json"), { items: [] });
    const prevNdic = (prevFeed.items || []).filter(isNdicItem);

    if (cond.action === "not_modified" || cond.action === "hash_unchanged") {
      diagnostics.status = "healthy";
      diagnostics.publish = { publish: false, reason: cond.action };
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
        { startedAt: started, datexHttpStatus: resp.status }
      );
    }

    const body = cond.body;
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
      { startedAt: started }
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
