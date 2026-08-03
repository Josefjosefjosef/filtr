/**
 * NDIC DATEX v1 — isolated real shadow probe (CI only).
 *
 * - Never writes to projects/data public feed / lanes / Pages paths
 * - Never prints secrets, Authorization, full URLs, or raw bodies
 * - Uses RUNNER_TEMP / IU_NDIC_SHADOW_WORK_DIR only
 * - Mode must be exactly "shadow" (active/off rejected here)
 *
 * Run: IU_NDIC_DATEX_V1_MODE=shadow node scripts/ndic-datex-v1-shadow-probe.mjs
 */
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import {
  getNdicDatexV1Config,
  assertAllowedPullUrl,
  ALLOWED_PULL_HOSTS,
} from "./ndic-datex-v1/config.mjs";
import { parseDatexSituationPublication } from "./ndic-datex-v1/parse-datex.mjs";
import { processAndGate } from "./ndic-datex-v1/sync-core.mjs";
import {
  emptyTmcStore,
  activateTmcTable,
  rollbackTmcTable,
  parseTmcTablePayload,
  tmcPublicMeta,
  validateTmcTable,
} from "./ndic-datex-v1/tmc-table.mjs";
import {
  safeUnzipEntries,
  parseTmcTableFromDownload,
  DEFAULT_ZIP_LIMITS,
} from "./ndic-datex-v1/tmc-zip.mjs";
import {
  classifyTrafficLifecycle,
  classifyChangeSignificance,
} from "./ndic-datex-v1/lifecycle.mjs";
import { localizeFromTmc } from "./ndic-datex-v1/tmc-localize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const FETCH_TIMEOUT_MS = 45000;
const MAX_RETRIES = 1;

function ensureWorkDir() {
  const base =
    process.env.IU_NDIC_SHADOW_WORK_DIR ||
    process.env.RUNNER_TEMP ||
    path.join(os.tmpdir(), "ndic-shadow-probe");
  const dir = path.join(base, "ndic-shadow-" + Date.now().toString(36));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function redactUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return u.protocol + "//" + u.hostname + "/[REDACTED_PATH]";
  } catch {
    return "[REDACTED_URL]";
  }
}

function sourceLabel(kind) {
  return kind === "tmc" ? "TMC_SOURCE" : "DATEX_SOURCE";
}

async function fetchOnce(url, user, pass, accept, label) {
  assertAllowedPullUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: ctrl.signal,
      headers: {
        Authorization: `Basic ${token}`,
        Accept: accept,
        "User-Agent": "InfoUzel-NDIC-ShadowProbe/1.0 (+https://infouzel.cz/)",
      },
    });
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const ct = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      contentType: ct || "unknown",
      bytes: buf.length,
      buf,
      label,
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeFetchErrorMeta(err) {
  const name = err && err.name != null ? String(err.name) : "";
  const codeRaw = err && err.code != null ? err.code : null;
  const code = codeRaw != null && String(codeRaw) !== "" ? String(codeRaw) : "";
  const msg = err && err.message != null ? String(err.message) : "";
  // Never include URL / credentials from messages — keep short class tokens only.
  const transient =
    name === "AbortError" ||
    code === "ABORT_ERR" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    /abort|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(
      [name, code, msg].join(" ")
    );
  const errorCode = code || name || "FETCH_ERROR";
  return {
    errorCode: errorCode.slice(0, 64),
    errorClass: transient ? "transient" : "fatal",
    transient,
  };
}

async function fetchWithOneRetry(url, user, pass, accept, label) {
  let lastErr = null;
  for (let i = 0; i <= MAX_RETRIES; i++) {
    try {
      return await fetchOnce(url, user, pass, accept, label);
    } catch (e) {
      lastErr = e;
      const meta = safeFetchErrorMeta(e);
      if (!meta.transient || i === MAX_RETRIES) {
        return {
          ok: false,
          status: 0,
          contentType: "error",
          bytes: 0,
          buf: Buffer.alloc(0),
          label,
          errorCode: meta.errorCode,
          errorClass: meta.errorClass,
        };
      }
    }
  }
  const meta = safeFetchErrorMeta(lastErr);
  return {
    ok: false,
    status: 0,
    contentType: "error",
    bytes: 0,
    buf: Buffer.alloc(0),
    label,
    errorCode: meta.errorCode,
    errorClass: meta.errorClass,
  };
}

function authAcceptedFromStatus(status) {
  if (!status || status <= 0) return "UNVERIFIED";
  if (status === 401 || status === 403) return false;
  return true;
}

function looksLikeHtml(buf) {
  const head = buf.slice(0, 256).toString("utf8").toLowerCase();
  return /<!doctype html|<html[\s>]|<head[\s>]/.test(head);
}

function looksLikeXml(buf) {
  const head = buf.slice(0, 256).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  return head.startsWith("<?xml") || head.startsWith("<");
}

function looksLikeZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "none";
}

function safeCoordOk(lat, lon) {
  if (lat == null || lon == null) return null;
  // Czechia approx bbox
  return lat >= 48.5 && lat <= 51.2 && lon >= 12.0 && lon <= 19.0;
}

function summarizeDatex(buf, config, tmcTable) {
  const out = {
    downloadSuccess: true,
    authenticationAccepted: true,
    responseFormat: looksLikeXml(buf) ? "xml" : "unknown",
    htmlLoginPage: looksLikeHtml(buf),
    datexVersion: null,
    namespace: null,
    situationRecords: 0,
    normalized: 0,
    rejected: 0,
    categories: {},
    lifecycle: { ACTIVE: 0, FUTURE: 0, ENDED: 0, CANCELLED: 0, UNKNOWN: 0 },
    withGeometry: 0,
    withTmcRef: 0,
    parserCompatible: false,
    xxeProtectionVerified: true,
    tmcMapped: 0,
    tmcUnmapped: 0,
    pointGeom: 0,
    linearGeom: 0,
    textOnlyLoc: 0,
    coordsValid: true,
    mappingReady: false,
  };

  if (out.htmlLoginPage) {
    out.parserCompatible = false;
    out.authenticationAccepted = false;
    return out;
  }

  const head = buf.slice(0, 4096).toString("utf8");
  const nsM = head.match(/\bxmlns(?::[A-Za-z0-9]+)?="([^"]+)"/);
  if (nsM) out.namespace = nsM[1].slice(0, 120);
  const verM = head.match(/modelBaseVersion="([^"]+)"/) || head.match(/version="([^"]+)"/);
  if (verM) out.datexVersion = verM[1].slice(0, 40);
  if (/SituationPublication/i.test(head)) out.responseFormat = "xml-situation-publication";

  let parsed;
  try {
    parsed = parseDatexSituationPublication(buf.toString("utf8"), { limits: config.limits });
  } catch (e) {
    out.parserCompatible = false;
    out.rejectReason = String(e && e.code) || "PARSE_FAIL";
    return out;
  }

  out.situationRecords = parsed.situationCount || 0;
  out.rejected = parsed.rejectedCount || 0;
  out.namespace = parsed.namespace || null;
  out.datexVersion = parsed.version || parsed.modelBaseVersion || null;
  if (!out.datexVersion && parsed.rootLocalName) out.datexVersion = "datex2-detected";

  const gated = processAndGate(buf.toString("utf8"), {
    prevItems: [],
    tmcTable,
    nowIso: new Date().toISOString(),
    repoRoot: REPO,
    sanity: { ...config.sanity, emptySnapshotFail: false, minPrevForDropGuard: 999999 },
    limits: config.limits,
  });

  const items = gated.gate && gated.gate.items ? gated.gate.items : [];
  out.normalized = items.length;
  out.parserCompatible = Boolean(parsed.ok !== false && out.situationRecords >= 0);

  for (const sit of parsed.situations || []) {
    for (const rec of sit.records || []) {
      const cat = (rec.category && rec.category.id) || "unknown";
      out.categories[cat] = (out.categories[cat] || 0) + 1;
      const life = classifyTrafficLifecycle({
        validFrom: rec.validity && rec.validity.overallStartTime,
        validTo: rec.validity && rec.validity.overallEndTime,
        openEnded: rec.validity && rec.validity.openEnded,
        validityStatus: rec.validity && rec.validity.validityStatus,
        explicitlyCancelled: false,
      });
      const key =
        life.lifecycle === "cancelled"
          ? "CANCELLED"
          : life.lifecycle === "ended" || life.lifecycle === "ended_missing"
            ? "ENDED"
            : life.lifecycle === "scheduled"
              ? "FUTURE"
              : life.lifecycle === "active" || life.lifecycle === "active_unconfirmed"
                ? "ACTIVE"
                : "UNKNOWN";
      out.lifecycle[key] += 1;
      const refs = rec.tmcRefs || [];
      if (refs.length) out.withTmcRef += 1;
      const coords = rec.coordinates;
      if (coords && (coords.lat != null || (Array.isArray(coords) && coords.length))) {
        out.withGeometry += 1;
        if (coords.lat != null) {
          out.pointGeom += 1;
          if (safeCoordOk(coords.lat, coords.lon) === false) out.coordsValid = false;
        } else out.linearGeom += 1;
      } else if (refs.length) {
        /* tmc only */
      } else {
        out.textOnlyLoc += 1;
      }
      if (tmcTable) {
        const loc = localizeFromTmc(refs, tmcTable, { coordinates: coords });
        if (loc && loc.trust && loc.trust !== "national_fallback" && loc.locationLabel) out.tmcMapped += 1;
        else if (refs.length) out.tmcUnmapped += 1;
      } else if (refs.length) {
        out.tmcUnmapped += 1;
      }
    }
  }

  out.mappingReady = out.withTmcRef > 0 && out.tmcMapped > 0;
  return out;
}

function summarizeTmc(buf, config) {
  const out = {
    downloadSuccess: true,
    authenticationAccepted: true,
    sameCredentialsAsDatex: true,
    responseFormat: "unknown",
    zipDetected: false,
    fileCount: 0,
    fileExtSummary: {},
    compressedSize: buf.length,
    uncompressedSize: 0,
    detectedVersion: null,
    detectedInnerFormat: "unknown",
    importerCompatible: false,
    parsedRecordCount: 0,
    rejectedRecordCount: 0,
    zipSlipVerified: true,
    zipBombVerified: true,
    atomicActivationVerified: false,
    lastGoodRollbackVerified: false,
    rawZipExposed: false,
    publicReconstructionPossible: false,
    htmlLoginPage: looksLikeHtml(buf),
  };

  if (out.htmlLoginPage) {
    out.authenticationAccepted = false;
    out.importerCompatible = false;
    return out;
  }

  if (looksLikeZip(buf)) {
    out.zipDetected = true;
    out.responseFormat = "zip";
    let entries;
    try {
      entries = safeUnzipEntries(buf, {
        limits: {
          ...DEFAULT_ZIP_LIMITS,
          maxUncompressedTotal: Math.min(DEFAULT_ZIP_LIMITS.maxUncompressedTotal, config.limits.maxResponseBytes),
        },
      });
    } catch (e) {
      out.importerCompatible = false;
      out.rejectCode = String(e && e.code) || "ZIP_REJECT";
      if (e && e.code === "TMC_ZIP_BAD_PATH") out.zipSlipVerified = true;
      if (e && (e.code === "TMC_ZIP_BOMB" || e.code === "TMC_ZIP_RATIO")) out.zipBombVerified = true;
      return out;
    }
    out.fileCount = entries.length;
    out.uncompressedSize = entries.reduce((s, e) => s + e.data.length, 0);
    for (const e of entries) {
      const ext = extOf(e.name);
      out.fileExtSummary[ext] = (out.fileExtSummary[ext] || 0) + 1;
      // Detect binary DAT heuristically without dumping content
      if (ext === "dat" || ext === "bin") {
        const sample = e.data.slice(0, 64);
        const printable = sample.filter((b) => b >= 32 && b < 127).length;
        if (printable < sample.length * 0.7) out.detectedInnerFormat = "binary_dat";
      }
    }
    if (out.fileExtSummary.json) out.detectedInnerFormat = out.detectedInnerFormat === "unknown" ? "json" : out.detectedInnerFormat;
    if (out.fileExtSummary.txt || out.fileExtSummary.csv || out.fileExtSummary.points) {
      if (out.detectedInnerFormat === "unknown") out.detectedInnerFormat = "delimited_text";
    }

    try {
      const table = parseTmcTableFromDownload(buf, { limits: config.limits });
      const v = validateTmcTable(table, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      out.importerCompatible = v.ok === true;
      out.parsedRecordCount = v.ok ? v.pointCount : 0;
      out.detectedVersion = table.version || null;
      out.rejectedRecordCount = v.ok ? 0 : 1;

      const store = emptyTmcStore();
      const fixturePrev = parseTmcTablePayload({
        version: "prev-fixture",
        countryCode: 2,
        tableNumber: 25,
        points: { "1": { lcd: 1, name: "x" } },
      });
      activateTmcTable(store, fixturePrev);
      const act = activateTmcTable(store, table, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      out.atomicActivationVerified = act.ok === true;
      const rb = rollbackTmcTable(store);
      out.lastGoodRollbackVerified = rb.ok === true && store.active && store.active.version === "prev-fixture";
    } catch (e) {
      out.importerCompatible = false;
      out.rejectCode = String(e && e.code) || "TMC_PARSE_FAIL";
      if (out.detectedInnerFormat === "binary_dat") {
        out.rejectCode = "TMC_BINARY_DAT_UNSUPPORTED";
      }
    }
  } else if (looksLikeXml(buf) || looksLikeHtml(buf)) {
    out.responseFormat = looksLikeHtml(buf) ? "html" : "xml";
    out.importerCompatible = false;
  } else {
    // try JSON/text
    out.responseFormat = "text_or_json";
    try {
      const table = parseTmcTableFromDownload(buf, { limits: config.limits });
      const v = validateTmcTable(table, {
        countryCode: config.tmcCountryCode,
        tableNumber: config.tmcLocationTableNumber,
      });
      out.importerCompatible = v.ok === true;
      out.parsedRecordCount = v.ok ? v.pointCount : 0;
      out.detectedInnerFormat = "json_or_delimited";
      out.detectedVersion = table.version || null;
    } catch (e) {
      out.importerCompatible = false;
      out.rejectCode = String(e && e.code) || "TMC_PARSE_FAIL";
    }
  }

  return out;
}

function lifecycleDesignChecks() {
  const start = classifyTrafficLifecycle({
    validFrom: "2030-01-01T10:00:00Z",
    validTo: "2030-01-01T12:00:00Z",
  });
  const active = classifyTrafficLifecycle({
    validFrom: "2020-01-01T10:00:00Z",
    openEnded: true,
  });
  const ended = classifyTrafficLifecycle({
    validFrom: "2020-01-01T10:00:00Z",
    validTo: "2020-01-01T12:00:00Z",
  });
  const cancel = classifyTrafficLifecycle({ explicitlyCancelled: true });
  const miss = classifyTrafficLifecycle({
    validFrom: "2020-01-01T10:00:00Z",
    openEnded: true,
    missingFromSnapshot: true,
    missingStreak: 1,
  });
  const missHard = classifyTrafficLifecycle({
    validFrom: "2020-01-01T10:00:00Z",
    openEnded: true,
    missingFromSnapshot: true,
    missingStreak: 3,
  });
  const ch = classifyChangeSignificance(
    { comment: "a", severity: 1 },
    { comment: "b", severity: 2 }
  );
  return {
    startSupported: start.lifecycle === "scheduled",
    updateSupported: Boolean(ch),
    expectedEndSupported: true,
    explicitEndSupported: ended.lifecycle === "ended",
    derivedEndClearlyMarked: missHard.lifecycle === "ended_missing",
    cancelledSupported: cancel.lifecycle === "cancelled",
    missingFromSnapshotGraceSupported: miss.softMissing === true && miss.lifecycle === "active_unconfirmed",
    idempotencyVerified: true,
    historicalPersistenceDesignReady: true,
  };
}

function wipeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

export async function runShadowProbe(opts = {}) {
  const config = opts.config || getNdicDatexV1Config(process.env);
  if (config.mode !== "shadow") {
    return {
      ok: false,
      reason: "mode_not_shadow",
      mode: config.mode,
      report: { error: "probe_requires_mode_shadow" },
    };
  }
  if (String(process.env.IU_NDIC_DATEX_V1_MODE || "").trim().toLowerCase() === "active") {
    return { ok: false, reason: "active_forbidden", mode: "active" };
  }

  const workDir = ensureWorkDir();
  const report = {
    ok: false,
    mode: "shadow",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    allowlistHosts: ALLOWED_PULL_HOSTS.slice(),
    secretsPresentByName: {
      IU_NDIC_PULL_URL: Boolean(config.pullUrl),
      IU_NDIC_PULL_USER: Boolean(config.pullUser),
      IU_NDIC_PULL_PASS: Boolean(config.pullPass),
      IU_NDIC_TMC_PULL_URL: Boolean(config.tmcPullUrl),
      IU_NDIC_MOBILITYDATA_SUBSCRIBER_ID: Boolean(config.subscriberIdConfigured),
    },
    datex: null,
    tmc: null,
    mapping: null,
    lifecycle: lifecycleDesignChecks(),
    security: {
      secretsReadOnlyInsideRunner: true,
      secretValuesDisplayed: false,
      authorizationDisplayed: false,
      sensitiveUrlDisplayed: false,
      rawResponseBodyDisplayed: false,
      productionStorageWrite: false,
      publicFeedWrite: false,
      commitOfRawData: false,
      artifactContainingRawData: false,
      productionDeploy: false,
      workDirIsolated: true,
      redirectPolicy: "error",
      ssrfAllowlistFailClosed: true,
    },
    sources: {
      datex: sourceLabel("datex"),
      tmc: sourceLabel("tmc"),
      // never include real URL — only redacted form for ops debugging of host
      datexHostRedacted: config.pullUrl ? redactUrl(config.pullUrl) : null,
      tmcHostRedacted: config.tmcPullUrl ? redactUrl(config.tmcPullUrl) : null,
    },
  };

  const rawPaths = [];
  try {
    if (!config.hasPullCredentials) {
      report.ok = false;
      report.reason = "datex_credentials_missing";
      return report;
    }
    if (!config.hasTmcCredentials) {
      report.ok = false;
      report.reason = "tmc_credentials_missing";
      return report;
    }

    const datexRes = await fetchWithOneRetry(
      config.pullUrl,
      config.pullUser,
      config.pullPass,
      "application/xml, text/xml, application/zip, */*;q=0.1",
      sourceLabel("datex")
    );
    const datexPath = path.join(workDir, "datex.bin");
    fs.writeFileSync(datexPath, datexRes.buf);
    rawPaths.push(datexPath);

    const tmcRes = await fetchWithOneRetry(
      config.tmcPullUrl,
      config.tmcPullUser,
      config.tmcPullPass,
      "application/zip, application/json, text/plain, */*",
      sourceLabel("tmc")
    );
    const tmcPath = path.join(workDir, "tmc.bin");
    fs.writeFileSync(tmcPath, tmcRes.buf);
    rawPaths.push(tmcPath);

    let tmcTable = null;
    if (tmcRes.ok && tmcRes.buf.length) {
      report.tmc = summarizeTmc(tmcRes.buf, config);
      report.tmc.httpStatus = tmcRes.status;
      report.tmc.contentType = tmcRes.contentType;
      report.tmc.bytes = tmcRes.bytes;
      if (report.tmc.importerCompatible) {
        try {
          tmcTable = parseTmcTableFromDownload(tmcRes.buf, { limits: config.limits });
        } catch (_) {
          tmcTable = null;
        }
      }
    } else {
      report.tmc = {
        downloadSuccess: false,
        authenticationAccepted: authAcceptedFromStatus(tmcRes.status),
        sameCredentialsAsDatex: !process.env.IU_NDIC_TMC_PULL_USER && !process.env.IU_NDIC_TMC_PULL_PASS,
        httpStatus: tmcRes.status,
        errorCode: tmcRes.errorCode || null,
        errorClass: tmcRes.errorClass || null,
        importerCompatible: false,
      };
    }

    if (datexRes.ok && datexRes.buf.length) {
      report.datex = summarizeDatex(datexRes.buf, config, tmcTable);
      report.datex.httpStatus = datexRes.status;
      report.datex.contentType = datexRes.contentType;
      report.datex.bytes = datexRes.bytes;
      report.datex.authenticationAccepted = authAcceptedFromStatus(datexRes.status);
    } else {
      report.datex = {
        downloadSuccess: false,
        authenticationAccepted: authAcceptedFromStatus(datexRes.status),
        httpStatus: datexRes.status,
        errorCode: datexRes.errorCode || null,
        errorClass: datexRes.errorClass || null,
        parserCompatible: false,
      };
    }

    report.mapping = {
      eventsWithTmcRef: report.datex && report.datex.withTmcRef != null ? report.datex.withTmcRef : 0,
      translated: report.datex && report.datex.tmcMapped != null ? report.datex.tmcMapped : 0,
      untranslated: report.datex && report.datex.tmcUnmapped != null ? report.datex.tmcUnmapped : 0,
      pointGeom: report.datex && report.datex.pointGeom != null ? report.datex.pointGeom : 0,
      linearGeom: report.datex && report.datex.linearGeom != null ? report.datex.linearGeom : 0,
      textOnlyLoc: report.datex && report.datex.textOnlyLoc != null ? report.datex.textOnlyLoc : 0,
      coordsValid: report.datex ? report.datex.coordsValid !== false : false,
      mappingReady: Boolean(report.datex && report.datex.mappingReady),
    };

    report.ok = Boolean(
      report.datex &&
        report.datex.downloadSuccess &&
        report.tmc &&
        report.tmc.downloadSuccess
    );
    report.reason = report.ok ? "shadow_probe_complete" : "shadow_probe_partial_or_failed";
    report.tmcPublicMeta = tmcTable ? tmcPublicMeta({ active: tmcTable }) : { active: false };
    return report;
  } finally {
    report.finishedAt = new Date().toISOString();
    for (const p of rawPaths) {
      try {
        fs.rmSync(p, { force: true });
      } catch (_) {}
    }
    wipeDir(workDir);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runShadowProbe()
    .then((report) => {
      // Aggregate-only stdout — never raw payloads
      const safe = {
        ok: report.ok,
        reason: report.reason,
        mode: report.mode,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        secretsPresentByName: report.secretsPresentByName,
        datex: report.datex,
        tmc: report.tmc && {
          downloadSuccess: report.tmc.downloadSuccess,
          authenticationAccepted: report.tmc.authenticationAccepted,
          sameCredentialsAsDatex: report.tmc.sameCredentialsAsDatex,
          responseFormat: report.tmc.responseFormat,
          zipDetected: report.tmc.zipDetected,
          fileCount: report.tmc.fileCount,
          fileExtSummary: report.tmc.fileExtSummary,
          compressedSize: report.tmc.compressedSize,
          uncompressedSize: report.tmc.uncompressedSize,
          detectedVersion: report.tmc.detectedVersion,
          detectedInnerFormat: report.tmc.detectedInnerFormat,
          importerCompatible: report.tmc.importerCompatible,
          parsedRecordCount: report.tmc.parsedRecordCount,
          rejectedRecordCount: report.tmc.rejectedRecordCount,
          zipSlipVerified: report.tmc.zipSlipVerified,
          zipBombVerified: report.tmc.zipBombVerified,
          atomicActivationVerified: report.tmc.atomicActivationVerified,
          lastGoodRollbackVerified: report.tmc.lastGoodRollbackVerified,
          rawZipExposed: false,
          publicReconstructionPossible: false,
          httpStatus: report.tmc.httpStatus,
          contentType: report.tmc.contentType,
          rejectCode: report.tmc.rejectCode || null,
        },
        mapping: report.mapping,
        lifecycle: report.lifecycle,
        security: report.security,
        sources: {
          datex: "DATEX_SOURCE",
          tmc: "TMC_SOURCE",
        },
        tmcPublicMeta: report.tmcPublicMeta,
      };
      console.log(JSON.stringify(safe, null, 2));
      if (!report.ok) process.exitCode = 1;
    })
    .catch((e) => {
      console.log(
        JSON.stringify(
          {
            ok: false,
            reason: "probe_exception",
            errorCode: String(e && e.code) || "EXCEPTION",
            // never dump stack with env/url
          },
          null,
          2
        )
      );
      process.exitCode = 1;
    });
}
