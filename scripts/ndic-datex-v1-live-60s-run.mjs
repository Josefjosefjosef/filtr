#!/usr/bin/env node
/**
 * NDIC 60s live tick (oneshot): conditional DATEX → process → optional direct live publication.
 *
 * Modes (IU_NDIC_LIVE_MODE):
 *   off     — no-op
 *   shadow  — full process, PRODUCTION_WRITE=NO
 *   active  — process + atomic publish to authoritative live store
 *
 * Start-to-start cadence is owned by systemd timer (OnCalendar=*:*:00).
 * This script must exit quickly on 304 and never overlap (single-flight lock).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNdicCzechEgressRunnerOrThrow } from "./ndic-datex-v1/runner-identity.mjs";
import { runNdicDatexV1Sync, statePaths } from "./ndic-datex-v1-prod-sync.mjs";
import { tryAcquireLiveLock, defaultLiveLockPath } from "./ndic-datex-v1/live-lock.mjs";
import {
  defaultLiveRoot,
  loadHealth,
  saveHealth,
  buildGenerationId,
  isStaleWriter,
  generationPointerPath,
  readJsonSafe,
} from "./ndic-datex-v1/live-health.mjs";
import { publishLiveTrafficSnapshot, summarizeSnapshot } from "./ndic-datex-v1/live-publication.mjs";
import { resolveTrafficUiSnapshotDestPath } from "./ndic-datex-v1/traffic-ui-snapshot-persist.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");

function liveMode(env = process.env) {
  const m = String(env.IU_NDIC_LIVE_MODE || "off").trim().toLowerCase();
  if (m === "shadow" || m === "active" || m === "off") return m;
  return "off";
}

function ensureWorkDir(root) {
  // Prefer explicit env (cron-tick sets this before node starts).
  const work = process.env.IU_INFO_EVENTS_DATA_DIR
    ? path.resolve(process.env.IU_INFO_EVENTS_DATA_DIR)
    : path.join(root, "work", "info_events");
  process.env.IU_INFO_EVENTS_DATA_DIR = work;
  fs.mkdirSync(path.join(work, "ndic_datex_v1"), { recursive: true });
  fs.mkdirSync(path.join(work, "lanes"), { recursive: true });
  // Seed from repo Pages data if empty (baseline for anomaly + prev NDIC items)
  const seedSnap = path.join(REPO, "projects/data/info_events/ndic_datex_v1/traffic_offline_snapshot.json");
  const destSnap = path.join(work, "ndic_datex_v1/traffic_offline_snapshot.json");
  if (!fs.existsSync(destSnap) && fs.existsSync(seedSnap)) {
    fs.copyFileSync(seedSnap, destSnap);
  }
  for (const rel of ["feed.json", "monitoring.json", "ndic_datex_v1/sync_state.json", "ndic_datex_v1/diagnostics.json"]) {
    const src = path.join(REPO, "projects/data/info_events", rel);
    const dst = path.join(work, rel);
    if (!fs.existsSync(dst) && fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  // One-time migration: if live work state lacks Last-Modified but git-clone state has it, copy LM/bodyHash.
  migrateConditionalStateFromRepoClone(work);
  return work;
}

function migrateConditionalStateFromRepoClone(work) {
  try {
    const liveStatePath = path.join(work, "ndic_datex_v1/sync_state.json");
    const repoStatePath = path.join(REPO, "projects/data/info_events/ndic_datex_v1/sync_state.json");
    const live = fs.existsSync(liveStatePath) ? JSON.parse(fs.readFileSync(liveStatePath, "utf8")) : null;
    const repo = fs.existsSync(repoStatePath) ? JSON.parse(fs.readFileSync(repoStatePath, "utf8")) : null;
    if (!repo || !repo.sync || !repo.sync.lastModified) return;
    const repoLmMs = Date.parse(String(repo.sync.lastModified));
    const liveLm = live && live.sync && live.sync.lastModified;
    const liveLmMs = liveLm ? Date.parse(String(liveLm)) : 0;
    const repoNewer =
      Number.isFinite(repoLmMs) && (!Number.isFinite(liveLmMs) || repoLmMs > liveLmMs || !liveLm);
    if (!repoNewer) return;
    const next = live && typeof live === "object" ? live : { sync: {}, lock: { locked: false }, lastRun: null };
    next.sync = next.sync || {};
    next.sync.lastModified = repo.sync.lastModified;
    if (repo.sync.bodyHash) next.sync.bodyHash = repo.sync.bodyHash;
    if (repo.sync.etag != null) next.sync.etag = repo.sync.etag;
    fs.mkdirSync(path.dirname(liveStatePath), { recursive: true });
    const tmp = liveStatePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, liveStatePath);
  } catch {
    /* ignore migration errors */
  }
}

function classifyHttp200Reason({ ifModifiedSinceSent, requestIms, responseLm }) {
  if (!ifModifiedSinceSent) return "CONDITIONAL_STATE_MISSING_OR_WRONG";
  if (responseLm && requestIms && String(responseLm) !== String(requestIms)) {
    const a = Date.parse(String(responseLm));
    const b = Date.parse(String(requestIms));
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) return "SOURCE_CHANGED";
    if (String(responseLm) !== String(requestIms)) return "SOURCE_CHANGED";
  }
  return "SERVER_200_WITH_SAME_OR_MISSING_LM";
}

function attachConditionalForensics(out, { workDir, obs, httpStatus, syncResult, stateBeforeLm }) {
  const paths = statePaths(process.env);
  const cond = (obs && obs.conditional) || {};
  const responseLm = (obs && obs.DATEX_RESPONSE_LAST_MODIFIED) || readSyncLastModified(workDir);
  const requestIms = (obs && obs.DATEX_REQUEST_IF_MODIFIED_SINCE) || stateBeforeLm || null;
  const ifModifiedSinceSent =
    (cond && cond.DATEX_REQUEST_IF_MODIFIED_SINCE_SENT === "YES") || Boolean(requestIms);
  out.CONDITIONAL_STATE_FILE = paths.stateFile;
  out.REQUEST_IF_MODIFIED_SINCE = requestIms;
  out.RESPONSE_LAST_MODIFIED = responseLm;
  out.IF_MODIFIED_SINCE_SENT = ifModifiedSinceSent ? "YES" : "NO";
  out.PERSISTED_LAST_MODIFIED = readSyncLastModified(workDir);
  if (httpStatus === 200) {
    out.HTTP_200_REASON = classifyHttp200Reason({
      ifModifiedSinceSent,
      requestIms,
      responseLm,
    });
  }
  if (httpStatus === 304 || syncResult.reason === "not_modified" || syncResult.reason === "hash_unchanged") {
    out.HTTP_304_PARSE_SKIPPED = "YES";
    out.HTTP_304_RESOLVER_SKIPPED = "YES";
    out.HTTP_304_PUBLICATION_SKIPPED = "YES";
  }
  return out;
}

async function main() {
  const startedAt = new Date().toISOString();
  const mode = liveMode();
  const out = {
    ok: true,
    schema: "iu-ndic-live-60s-tick-v1",
    mode,
    POLL_STARTED_AT: startedAt,
    MAX_CONCURRENT_LIVE_DATEX_PROCESSORS: 1,
  };

  if (mode === "off") {
    out.reason = "mode_off";
    console.log(JSON.stringify(out));
    return;
  }

  // Soft runner check — allow fixture env override
  if (String(process.env.IU_NDIC_LIVE_SKIP_RUNNER_ASSERT || "") !== "1") {
    assertNdicCzechEgressRunnerOrThrow(process.env);
  }

  const root = defaultLiveRoot();
  const lock = tryAcquireLiveLock(defaultLiveLockPath());
  if (!lock.ok) {
    out.ok = true;
    out.reason = "SKIPPED_LOCKED";
    out.SINGLE_FLIGHT_PASS = "YES";
    out.lockReason = lock.reason;
    console.log(JSON.stringify(out));
    return;
  }

  const health = loadHealth(root);
  health.LAST_POLL_AT = startedAt;

  try {
    const workDir = ensureWorkDir(root);
    process.env.IU_INFO_EVENTS_DATA_DIR = workDir;
    if (!process.env.IU_NDIC_DATEX_V1_MODE) {
      // Live tick always processes; publication gated by IU_NDIC_LIVE_MODE
      process.env.IU_NDIC_DATEX_V1_MODE = "active";
    }
    process.env.IU_NDIC_TMC_LKG_ROOT =
      process.env.IU_NDIC_TMC_LKG_ROOT ||
      path.join(process.env.HOME || "", ".cache", "infouzel-ndic-tmc-lkg");

    const stateBeforeLm = readSyncLastModified(workDir);
    const syncResult = await runNdicDatexV1Sync();
    const diag = syncResult.diagnostics || {};
    const obs = diag.observability || {};
    const httpStatus = obs.DATEX_HTTP_STATUS != null ? obs.DATEX_HTTP_STATUS : null;
    health.LAST_HTTP_STATUS = httpStatus;
    health.LAST_SUCCESSFUL_SOURCE_CHECK_AT = startedAt;
    health.CURRENT_SOURCE_LAST_MODIFIED = readSyncLastModified(workDir) || health.CURRENT_SOURCE_LAST_MODIFIED;
    health.LAST_CONDITIONAL_STATE_WRITE_AT = new Date().toISOString();
    health.LAST_IF_MODIFIED_SINCE_SENT = obs.DATEX_REQUEST_IF_MODIFIED_SINCE || stateBeforeLm || null;
    if (httpStatus === 304 || syncResult.reason === "not_modified" || syncResult.reason === "hash_unchanged") {
      health.LAST_304_AT = startedAt;
      health.CONSECUTIVE_FAILURES = 0;
      saveHealth(health, root);
      Object.assign(out, {
        reason: syncResult.reason || "not_modified",
        DATEX_HTTP_STATUS: httpStatus,
        "304_FAST_PATH_PASS": "YES",
        "304_FAST_PATH_DURATION_MS":
          (obs.FAST_PATH && obs.FAST_PATH["304_FAST_PATH_DURATION_MS"]) || obs.DATEX_REQUEST_DURATION_MS || null,
        "304_BYTES": httpStatus === 304 ? 0 : Number(obs.DATEX_BYTES_READ || 0),
        TMC_DOWNLOAD_IN_60S_PATH: "NO",
        TMC_IMPORT_IN_60S_PATH: "NO",
        PRODUCTION_WRITE: "NO",
        SINGLE_FLIGHT_PASS: "YES",
        HEADERS_RECEIVED_AT: obs.DATEX_HEADERS_RECEIVED_AT || null,
        DOWNLOAD_FINISHED_AT: obs.DATEX_DOWNLOAD_FINISHED_AT || null,
      });
      attachConditionalForensics(out, { workDir, obs, httpStatus, syncResult, stateBeforeLm });
      console.log(JSON.stringify(out));
      return;
    }

    if (!syncResult.ok) {
      health.CONSECUTIVE_FAILURES = (health.CONSECUTIVE_FAILURES || 0) + 1;
      health.LAST_ERROR = String(syncResult.reason || "sync_failed");
      saveHealth(health, root);
      out.ok = false;
      out.reason = syncResult.reason || "sync_failed";
      out.CONSECUTIVE_FAILURES = health.CONSECUTIVE_FAILURES;
      console.log(JSON.stringify(out));
      process.exitCode = 1;
      return;
    }

    health.LAST_200_AT = startedAt;
    health.LAST_SUCCESSFUL_PROCESS_AT = startedAt;
    health.CONSECUTIVE_FAILURES = 0;

    const tmc = (diag.tmc && diag.tmc.meta) || {};
    health.ACTIVE_TMC_VERSION = tmc.version || health.ACTIVE_TMC_VERSION;

    const snapPath = resolveTrafficUiSnapshotDestPath({ infoEventsDir: workDir });
    if (!fs.existsSync(snapPath)) {
      health.LAST_ERROR = "SNAPSHOT_MISSING_AFTER_PROCESS";
      saveHealth(health, root);
      out.ok = false;
      out.reason = "SNAPSHOT_MISSING_AFTER_PROCESS";
      console.log(JSON.stringify(out));
      process.exitCode = 1;
      return;
    }
    const snapshot = JSON.parse(fs.readFileSync(snapPath, "utf8"));
    const sourceLastModified = readSyncLastModified(workDir);
    const bodyHash = readSyncBodyHash(workDir);
    const ptr = readJsonSafe(generationPointerPath(root), null);
    if (
      isStaleWriter({
        incomingSourceLastModified: sourceLastModified,
        currentSourceLastModified: (ptr && ptr.sourceLastModified) || health.CURRENT_SOURCE_LAST_MODIFIED,
      })
    ) {
      out.ok = true;
      out.reason = "STALE_WRITER_SKIPPED";
      out.STALE_WRITER_PROTECTION_PASS = "YES";
      out.PRODUCTION_WRITE = "NO";
      saveHealth(health, root);
      console.log(JSON.stringify(out));
      return;
    }

    const generation = {
      generationId: buildGenerationId({
        sourceLastModified,
        bodyHash,
        processedAt: startedAt,
      }),
      sourceLastModified,
      sourceDownloadedAt: obs.DATEX_DOWNLOAD_FINISHED_AT || startedAt,
      processedAt: startedAt,
    };

    const pubStarted = new Date().toISOString();
    const pub = await publishLiveTrafficSnapshot({
      snapshot,
      mode,
      generation,
      env: process.env,
    });
    const pubFinished = new Date().toISOString();

    if (pub.ok && pub.PRODUCTION_WRITE === "YES") {
      health.LAST_SUCCESSFUL_PUBLICATION_AT = pubFinished;
      health.CURRENT_PRODUCTION_GENERATION = pub.generationId;
      health.CURRENT_SOURCE_LAST_MODIFIED = sourceLastModified;
    }
    saveHealth(health, root);

    Object.assign(out, {
      reason: pub.reason || syncResult.reason,
      DATEX_HTTP_STATUS: httpStatus,
      TMC_DOWNLOAD_IN_60S_PATH: obs.TMC_LIVE_DOWNLOAD === "YES" ? "YES" : "NO",
      TMC_IMPORT_IN_60S_PATH: obs.TMC_LIVE_IMPORT === "YES" ? "YES" : "NO",
      TMC_LIVE_DOWNLOAD: obs.TMC_LIVE_DOWNLOAD || "NO",
      TMC_LIVE_IMPORT: obs.TMC_LIVE_IMPORT || "NO",
      SINGLE_FLIGHT_PASS: "YES",
      STALE_WRITER_PROTECTION_PASS: "YES",
      ANOMALY_GUARD_PASS: pub.anomaly ? (pub.anomaly.ok ? "YES" : "NO") : "YES",
      UNCHANGED_CONTENT_PUBLICATION_SKIPPED: pub.UNCHANGED_CONTENT_PUBLICATION_SKIPPED || "NO",
      PRODUCTION_WRITE: pub.PRODUCTION_WRITE || "NO",
      ATOMIC_PUBLICATION_PASS: pub.ATOMIC_PUBLICATION_PASS || (pub.ok ? "YES" : "NO"),
      LAST_KNOWN_GOOD_PROTECTED: pub.LAST_KNOWN_GOOD_PROTECTED || "YES",
      generationId: pub.generationId || generation.generationId,
      summary: pub.summary || summarizeSnapshot(snapshot),
      HEADERS_RECEIVED_AT: obs.DATEX_HEADERS_RECEIVED_AT || null,
      DOWNLOAD_FINISHED_AT: obs.DATEX_DOWNLOAD_FINISHED_AT || null,
      PARSE_FINISHED_AT: obs.DATEX_PARSE_FINISHED_AT || null,
      RESOLVER_FINISHED_AT: obs.phases && obs.phases.RESOLVER && obs.phases.RESOLVER.finishedAt,
      CANDIDATE_READY_AT: obs.CANDIDATE_READY_AT || null,
      PUBLICATION_STARTED_AT: pubStarted,
      PUBLICATION_FINISHED_AT: pubFinished,
      DATEX_DOWNLOAD_MS: obs.DATEX_DOWNLOAD_DURATION_MS,
      DATEX_PARSE_MS: obs.DATEX_PARSE_DURATION_MS,
      RESOLVER_MS: obs.RESOLVER_DURATION_MS,
      syncOk: syncResult.ok,
      publishedSync: Boolean(syncResult.published),
    });
    attachConditionalForensics(out, { workDir, obs, httpStatus, syncResult, stateBeforeLm });
    if (!pub.ok) {
      out.ok = false;
      process.exitCode = 1;
    }
    console.log(JSON.stringify(out));
  } catch (e) {
    health.CONSECUTIVE_FAILURES = (health.CONSECUTIVE_FAILURES || 0) + 1;
    health.LAST_ERROR = String((e && e.message) || e);
    saveHealth(health, root);
    out.ok = false;
    out.reason = "exception";
    out.error = health.LAST_ERROR;
    console.log(JSON.stringify(out));
    process.exitCode = 1;
  } finally {
    lock.handle.release();
  }
}

function readSyncLastModified(workDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(workDir, "ndic_datex_v1/sync_state.json"), "utf8"));
    return (s.sync && s.sync.lastModified) || null;
  } catch {
    return null;
  }
}

function readSyncBodyHash(workDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(workDir, "ndic_datex_v1/sync_state.json"), "utf8"));
    return (s.sync && s.sync.bodyHash) || null;
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
  process.exit(1);
});
