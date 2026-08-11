/**
 * TMC maintenance — download/staging/validate/regression/atomic cutover/rollback.
 * NEVER invoked from the live DATEX 15m/1m hot path.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { assertAllowedPullUrl, TMC_COUNTRY_CODE, TMC_LOCATION_TABLE_NUMBER, TMC_CID, TMC_TABCD } from "./config.mjs";
import { DEFAULT_ZIP_LIMITS } from "./tmc-zip.mjs";
import { loadTmcTableFromDownload } from "./tmc-download-load.mjs";
import { activateTmcTable, validateTmcTable, emptyTmcStore, tmcPublicMeta } from "./tmc-table.mjs";
import {
  defaultTmcLkgRoot,
  ensureLkgLayout,
  loadPersistentTmcStore,
  persistTmcStoreAtomic,
  createStagingDir,
  cleanupStagingDir,
  cleanupTmcLkg,
  loadManifest,
  saveManifest,
  currentStorePath,
  previousStorePath,
} from "./tmc-persistent-store.mjs";

/**
 * Compare resolver hit rates between current and candidate tables on LCD samples.
 * @param {object} currentTable
 * @param {object} candidateTable
 * @param {Array<number|string>} lcdSample
 */
export function compareResolverCoverage(currentTable, candidateTable, lcdSample) {
  const sample = Array.isArray(lcdSample) && lcdSample.length ? lcdSample : Object.keys((currentTable && currentTable.points) || {}).slice(0, 500);
  let curRes = 0;
  let curUn = 0;
  let newRes = 0;
  let newUn = 0;
  for (const lcd of sample) {
    const key = String(lcd);
    const a = currentTable && currentTable.points && currentTable.points[key];
    const b = candidateTable && candidateTable.points && candidateTable.points[key];
    if (a) curRes += 1;
    else curUn += 1;
    if (b) newRes += 1;
    else newUn += 1;
  }
  const resolutionGain = newRes - curRes;
  const resolutionLoss = curRes - newRes;
  // Fail-closed: unresolved spike (≥10 absolute and ≥2x, or loss of ≥25% of previously resolved)
  const unresolvedSpike = newUn > curUn && newUn >= Math.max(10, curUn * 2);
  const resolvedCollapse = resolutionLoss >= Math.max(10, Math.ceil((curRes || 1) * 0.25));
  const regression = unresolvedSpike || resolvedCollapse;
  return {
    CURRENT_TMC_RESOLVED: curRes,
    CURRENT_TMC_UNRESOLVED: curUn,
    NEW_TMC_RESOLVED: newRes,
    NEW_TMC_UNRESOLVED: newUn,
    RESOLUTION_GAIN: resolutionGain,
    RESOLUTION_LOSS: Math.max(0, resolutionLoss),
    regression,
    sampleSize: sample.length,
  };
}

export function assertNoResolverRegression(cmp) {
  if (cmp && cmp.regression) {
    return { ok: false, code: "TMC_CUTOVER_BLOCKED_RESOLVER_REGRESSION", comparison: cmp };
  }
  return { ok: true, comparison: cmp };
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   root?: string,
 *   bodyBuf?: Buffer,
 *   contentEncoding?: string,
 *   lcdSample?: Array<number|string>,
 *   forceActivate?: boolean,
 *   skipDownload?: boolean,
 *   fetchImpl?: typeof fetch,
 *   mode?: 'check'|'bootstrap'|'import-buffer'|'rollback'
 * }} opts
 */
export async function runTmcMaintenance(opts = {}) {
  const env = opts.env || process.env;
  const root = opts.root || defaultTmcLkgRoot(env);
  ensureLkgLayout(root);
  const startedAt = new Date().toISOString();
  const mode = String(opts.mode || "check");
  const result = {
    ok: false,
    mode,
    startedAt,
    root,
    stages: [],
  };

  function stage(name, data) {
    result.stages.push({ name, at: new Date().toISOString(), ...(data || {}) });
  }

  if (mode === "rollback") {
    const loaded = loadPersistentTmcStore({ root, env });
    if (!loaded.store || !loaded.store.previous) {
      result.reason = "no_previous";
      stage("rollback", { ok: false, reason: "no_previous" });
      return result;
    }
    const store = loaded.store;
    const cur = store.active;
    store.active = store.previous;
    store.previous = cur;
    const persisted = persistTmcStoreAtomic(root, store, { rollback: true });
    result.ok = true;
    result.reason = "rollback_ok";
    result.meta = persisted.meta;
    stage("rollback", { ok: true, version: persisted.meta.version });
    cleanupTmcLkg(root);
    return result;
  }

  const current = loadPersistentTmcStore({ root, env });
  const man = loadManifest(root);
  man.lastVersionCheckAt = startedAt;
  saveManifest(root, man);
  stage("version_check", { hasCurrent: current.ok === true, version: current.meta && current.meta.version });

  // check-only: no download when current exists unless forced buffer provided
  if (mode === "check" && current.ok && !opts.bodyBuf && opts.skipDownload !== false && opts.forceDownload !== true) {
    result.ok = true;
    result.reason = "current_valid_no_download";
    result.meta = current.meta;
    result.TMC_NEW_VERSION_AVAILABLE = "NO";
    man.lastMaintenanceResult = "check_ok_no_download";
    man.newVersionAvailable = false;
    saveManifest(root, man);
    stage("check", { ok: true, skippedDownload: true });
    return result;
  }

  let bodyBuf = opts.bodyBuf || null;
  let contentEncoding = opts.contentEncoding || "";
  const staging = createStagingDir(root, mode);
  result.stagingId = staging.id;
  result.stagingDir = staging.dir;

  try {
    if (!bodyBuf) {
      const url = String(env.IU_NDIC_TMC_PULL_URL || "").trim();
      const user = String(env.IU_NDIC_TMC_PULL_USER || env.IU_NDIC_PULL_USER || "").trim();
      const pass = String(env.IU_NDIC_TMC_PULL_PASS || env.IU_NDIC_PULL_PASS || "").trim();
      if (!url || !user || !pass) {
        result.reason = "tmc_credentials_missing";
        stage("download", { ok: false, reason: result.reason });
        cleanupStagingDir(staging.dir);
        return result;
      }
      assertAllowedPullUrl(url);
      const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
      const fetchImpl = opts.fetchImpl || globalThis.fetch;
      stage("download_start", {});
      const res = await fetchImpl(url, {
        method: "GET",
        headers: {
          "User-Agent": "InfoUzel-NDIC-TMC-Maintenance/1.0",
          Authorization: `Basic ${token}`,
          Accept: "application/zip, application/json, text/plain, */*",
        },
        redirect: "error",
      });
      result.tmcHttpStatus = res.status;
      if (res.status === 304) {
        result.ok = true;
        result.reason = "not_modified";
        man.lastMaintenanceResult = "check_not_modified";
        saveManifest(root, man);
        cleanupStagingDir(staging.dir);
        return result;
      }
      if (res.status < 200 || res.status >= 300) {
        result.reason = "http_" + res.status;
        stage("download", { ok: false, status: res.status });
        cleanupStagingDir(staging.dir);
        return result;
      }
      const ab = await res.arrayBuffer();
      bodyBuf = Buffer.from(ab);
      contentEncoding = String(res.headers.get("content-encoding") || "");
      fs.writeFileSync(path.join(staging.dir, "archive.bin"), bodyBuf);
      stage("download", { ok: true, bytes: bodyBuf.length });
    } else {
      fs.writeFileSync(path.join(staging.dir, "archive.bin"), bodyBuf);
      stage("download", { ok: true, bytes: bodyBuf.length, source: "buffer" });
    }

    if (bodyBuf.length > DEFAULT_ZIP_LIMITS.maxCompressedTotal) {
      result.reason = "tmc_body_too_large";
      stage("security", { ok: false, reason: result.reason });
      cleanupStagingDir(staging.dir);
      return result;
    }

    stage("import_start", {});
    const loaded = await loadTmcTableFromDownload(bodyBuf, {
      contentEncoding,
      workDir: path.join(staging.dir, "unpack"),
      countryCode: TMC_COUNTRY_CODE,
      tableNumber: TMC_LOCATION_TABLE_NUMBER,
    });
    if (!loaded.ok) {
      result.reason = String(loaded.rejectCode || loaded.reason || "tmc_load_failed");
      stage("import", { ok: false, reason: result.reason });
      cleanupStagingDir(staging.dir);
      return result;
    }
    stage("import", {
      ok: true,
      cid: loaded.cid,
      tabcd: loaded.tabcd,
      tableVersion: loaded.tableVersion,
      source: loaded.source,
    });

    const v = validateTmcTable(loaded.table, {
      countryCode: TMC_COUNTRY_CODE,
      tableNumber: TMC_LOCATION_TABLE_NUMBER,
    });
    if (!v.ok) {
      result.reason = v.reason;
      stage("validate", { ok: false, reason: v.reason });
      cleanupStagingDir(staging.dir);
      return result;
    }
    if (loaded.cid != null && Number(loaded.cid) !== TMC_CID) {
      result.reason = "TMC_CID_MISMATCH";
      stage("validate", { ok: false, reason: result.reason, got: loaded.cid });
      cleanupStagingDir(staging.dir);
      return result;
    }
    if (loaded.tabcd != null && Number(loaded.tabcd) !== TMC_TABCD) {
      result.reason = "TMC_TABCD_MISMATCH";
      stage("validate", { ok: false, reason: result.reason, got: loaded.tabcd });
      cleanupStagingDir(staging.dir);
      return result;
    }
    stage("validate", { ok: true, pointCount: v.pointCount, version: v.version });

    // Same version as current → no activation
    if (
      current.ok &&
      current.meta &&
      current.meta.version &&
      String(current.meta.version) === String(v.version) &&
      current.meta.contentHash &&
      loaded.table.contentHash &&
      String(current.meta.contentHash) === String(loaded.table.contentHash).slice(0, 12)
    ) {
      result.ok = true;
      result.reason = "same_version_no_activation";
      result.meta = current.meta;
      man.lastMaintenanceResult = "same_version";
      man.newVersionAvailable = false;
      saveManifest(root, man);
      cleanupStagingDir(staging.dir);
      return result;
    }

    const cmp = compareResolverCoverage(
      (current.store && current.store.active) || { points: {} },
      loaded.table,
      opts.lcdSample
    );
    result.comparison = cmp;
    const reg = assertNoResolverRegression(cmp);
    stage("resolver_regression", { ok: reg.ok, ...cmp });
    if (!reg.ok && mode !== "bootstrap") {
      result.reason = reg.code;
      result.ok = false;
      man.lastMaintenanceResult = reg.code;
      man.newVersionAvailable = true;
      saveManifest(root, man);
      // Keep staging for audit briefly; bounded cleanup later
      if (opts.keepFailedStaging !== true) cleanupStagingDir(staging.dir);
      return result;
    }

    // Bootstrap / approved cutover
    const store = current.store && current.store.active ? current.store : emptyTmcStore();
    const act = activateTmcTable(store, loaded.table, {
      countryCode: TMC_COUNTRY_CODE,
      tableNumber: TMC_LOCATION_TABLE_NUMBER,
    });
    if (!act.ok) {
      result.reason = act.reason || "activate_failed";
      stage("activate", { ok: false, reason: result.reason });
      cleanupStagingDir(staging.dir);
      return result;
    }

    const persisted = persistTmcStoreAtomic(root, store, {
      cutover: true,
      maintenanceResult: mode === "bootstrap" ? "bootstrap_ok" : "cutover_ok",
    });
    fs.writeFileSync(
      path.join(staging.dir, "activated-meta.json"),
      JSON.stringify(persisted.meta, null, 2) + "\n",
      "utf8"
    );
    result.ok = true;
    result.reason = act.activated === false ? "same_version" : mode === "bootstrap" ? "bootstrap_ok" : "cutover_ok";
    result.meta = persisted.meta;
    result.manifest = persisted.manifest;
    stage("cutover", { ok: true, version: persisted.meta.version, activated: act.activated !== false });
    cleanupStagingDir(staging.dir);
    cleanupTmcLkg(root);
    return result;
  } catch (e) {
    result.reason = String((e && e.code) || (e && e.message) || e);
    stage("exception", { ok: false, reason: result.reason });
    cleanupStagingDir(staging.dir);
    return result;
  }
}

export function tmcMaintenancePublicSummary(result) {
  if (!result) return { ok: false };
  return {
    ok: result.ok === true,
    mode: result.mode,
    reason: result.reason || null,
    tmcHttpStatus: result.tmcHttpStatus != null ? result.tmcHttpStatus : null,
    meta: result.meta || null,
    comparison: result.comparison
      ? {
          CURRENT_TMC_RESOLVED: result.comparison.CURRENT_TMC_RESOLVED,
          CURRENT_TMC_UNRESOLVED: result.comparison.CURRENT_TMC_UNRESOLVED,
          NEW_TMC_RESOLVED: result.comparison.NEW_TMC_RESOLVED,
          NEW_TMC_UNRESOLVED: result.comparison.NEW_TMC_UNRESOLVED,
          RESOLUTION_GAIN: result.comparison.RESOLUTION_GAIN,
          RESOLUTION_LOSS: result.comparison.RESOLUTION_LOSS,
          regression: result.comparison.regression === true,
        }
      : null,
    stages: (result.stages || []).map((s) => s.name),
  };
}

export function measureStoreSizes(root) {
  const r = root || defaultTmcLkgRoot();
  const sizeOf = (p) => {
    try {
      return fs.statSync(p).size;
    } catch {
      return 0;
    }
  };
  let staging = 0;
  const sd = path.join(r, "staging");
  try {
    for (const n of fs.readdirSync(sd)) {
      staging += sizeOf(path.join(sd, n));
      try {
        const walk = (d) => {
          let t = 0;
          for (const x of fs.readdirSync(d)) {
            const p = path.join(d, x);
            const st = fs.statSync(p);
            t += st.isDirectory() ? walk(p) : st.size;
          }
          return t;
        };
        staging = walk(sd);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return {
    TMC_CURRENT_SIZE: sizeOf(currentStorePath(r)),
    TMC_PREVIOUS_SIZE: sizeOf(previousStorePath(r)),
    TMC_STAGING_SIZE: staging,
    TMC_MANIFEST_SIZE: sizeOf(path.join(r, "manifest.json")),
  };
}
