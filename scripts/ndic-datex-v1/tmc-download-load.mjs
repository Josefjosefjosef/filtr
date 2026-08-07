/**
 * Load internal TMC location table from download bytes.
 * Routes TISA SP08001 DAT archives through importBasicTmcArchive + resolver bridge.
 * Routes JSON/simple tables through parseTmcTableFromDownload.
 * Never clamps TMC unzip limits to DATEX maxResponseBytes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  DEFAULT_ZIP_LIMITS,
  isZipMagic,
  parseTmcTableFromDownload,
  unwrapTmcTransportLayers,
} from "./tmc-zip.mjs";
import { inspectZipFileCentral, selectAuthoritativeFormat, TMC_FORMAT } from "./tmc-archive-stream.mjs";
import { importBasicTmcArchive } from "./tmc-basic-importer.mjs";
import { wipeTaskOwnedPath } from "./disk-preflight.mjs";

/**
 * Resolve TMC unzip/parse limits. Explicit zip keys may override; DATEX maxResponseBytes must not.
 * @param {{ limits?: object }} [opts]
 */
export function resolveTmcDownloadLimits(opts = {}) {
  const base = { ...DEFAULT_ZIP_LIMITS };
  const lim = opts.limits || {};
  for (const key of Object.keys(DEFAULT_ZIP_LIMITS)) {
    if (lim[key] != null && Number.isFinite(Number(lim[key])) && Number(lim[key]) > 0) {
      base[key] = Number(lim[key]);
    }
  }
  return base;
}

/**
 * @param {Buffer|string} input
 * @param {{
 *   contentEncoding?: string,
 *   limits?: object,
 *   workDir?: string,
 *   countryCode?: number,
 *   tableNumber?: number,
 *   version?: string,
 * }} [opts]
 * @returns {Promise<{ ok: true, table: object, source: string, importerStatus?: string } | { ok: false, rejectCode: string, reason: string }>}
 */
export async function loadTmcTableFromDownload(input, opts = {}) {
  const limits = resolveTmcDownloadLimits(opts);
  let body;
  try {
    if (Buffer.isBuffer(input)) {
      const unwrapped = unwrapTmcTransportLayers(input, {
        contentEncoding: opts.contentEncoding,
        limits,
      });
      body = unwrapped.body;
    } else {
      body = Buffer.from(String(input || ""), "utf8");
    }
  } catch (e) {
    const code = String((e && e.code) || "TMC_UNWRAP_FAILED");
    return { ok: false, rejectCode: code, reason: code };
  }

  if (!isZipMagic(body)) {
    try {
      const table = parseTmcTableFromDownload(body, {
        version: opts.version,
        limits,
        contentEncoding: "",
      });
      return { ok: true, table, source: "plain_or_json" };
    } catch (e) {
      const code = String((e && e.code) || "TMC_PARSE_FAILED");
      return { ok: false, rejectCode: code, reason: code };
    }
  }

  if (body.length > limits.maxCompressedTotal) {
    return { ok: false, rejectCode: "TMC_ZIP_TOO_LARGE", reason: "TMC_ZIP_TOO_LARGE" };
  }

  const runId = crypto.randomBytes(8).toString("hex");
  const workDir = opts.workDir || path.join(os.tmpdir(), "iu-tmc-dl-" + runId);
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const zipPath = path.join(workDir, "archive.zip");

  try {
    fs.writeFileSync(zipPath, body, { mode: 0o600 });
    const meta = inspectZipFileCentral(zipPath, limits);
    const decision = selectAuthoritativeFormat(meta);
    const isTisa =
      decision.format === TMC_FORMAT.TISA_DAT_CSV || decision.candidateFormat === TMC_FORMAT.TISA_DAT_CSV;

    if (isTisa) {
      const imported = await importBasicTmcArchive(zipPath, {
        workDir: path.join(workDir, "import"),
        limits,
        maxPeekBytes: limits.maxSingleUncompressed,
        returnResolverTable: true,
        skipArchiveHash: opts.skipArchiveHash === true,
        measureDeps: opts.measureDeps,
      });
      if (!imported.ok || !imported.resolverTable) {
        const code = String(imported.rejectCode || imported.importerStatus || "TMC_BASIC_IMPORT_FAILED");
        return {
          ok: false,
          rejectCode: code,
          reason: code,
          ignoredNonStandardCount: imported.ignoredNonStandardCount || 0,
          ignoredEntries: imported.ignoredEntries || [],
          unknownEntries: imported.unknownEntries || [],
          unknownNonclassifiedCount: imported.unknownNonclassifiedCount || 0,
          unknownRequiredCount: imported.unknownRequiredCount || 0,
          rejectedUnsafeCount: imported.rejectedUnsafeCount || 0,
          requiredTableCountExpected: imported.requiredTableCountExpected || 0,
          requiredTableCountFound: imported.requiredTableCountFound || 0,
          requiredTableSetComplete: imported.requiredTableSetComplete === true,
          requiredTableSetValid: imported.requiredTableSetValid === true,
        };
      }
      return {
        ok: true,
        table: imported.resolverTable,
        source: "sp08001_basic",
        importerStatus: imported.importerStatus,
        ignoredNonStandardCount: imported.ignoredNonStandardCount || 0,
        ignoredEntries: imported.ignoredEntries || [],
        unknownNonclassifiedCount: 0,
        unknownRequiredCount: 0,
        rejectedUnsafeCount: 0,
        requiredTableCountExpected: imported.requiredTableCountExpected || 0,
        requiredTableCountFound: imported.requiredTableCountFound || 0,
        requiredTableSetComplete: imported.requiredTableSetComplete === true,
        requiredTableSetValid: imported.requiredTableSetValid === true,
        cid: imported.cid,
        tabcd: imported.tabcd,
        tableVersion: imported.tableVersion,
      };
    }

    try {
      const table = parseTmcTableFromDownload(body, {
        version: opts.version,
        limits,
        contentEncoding: "",
      });
      return { ok: true, table, source: "zip_json_or_simple" };
    } catch (e) {
      const code = String((e && e.code) || "TMC_ZIP_NO_PAYLOAD");
      return { ok: false, rejectCode: code, reason: code };
    }
  } finally {
    try {
      wipeTaskOwnedPath(workDir, workDir);
    } catch (_) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }
}
