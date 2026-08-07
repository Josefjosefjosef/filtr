/**
 * Fail-closed TMC ZIP entry classification for basic import.
 *
 * Documentation-backed only:
 *   - SP08001 Table 4-2 standard DAT codes + README.DAT (tmc-sp08001-contract.mjs)
 *   - COMPANION_NON_AUTHORITATIVE roles (tmc-sp08001-format-promotion.mjs):
 *       encoding_cpg, dbf_layer, shp_layer, sqlite_candidate
 *     Companions never authorize DAT / never resolve locations.
 *
 * Unmapped .dat/.txt/.csv are UNKNOWN_NON_CLASSIFIED → fail-closed (never broad-ignored).
 */
import crypto from "node:crypto";
import {
  SP08001_TABLE_CODES,
  SP08001_STANDARD_TABLE_COUNT,
  SP08001_METADATA_FILE,
  resolveSp08001TableCodeFromBasename,
} from "./tmc-sp08001-contract.mjs";
import {
  COMPANION_NON_AUTHORITATIVE,
  ALLOWED_EMPTY_TABLES,
  REQUIRED_FOR_DATASET_IMPORT,
} from "./tmc-sp08001-format-promotion.mjs";
import { TMC_IMPORTER_ERROR } from "./tmc-importer-errors.mjs";

export const TMC_ENTRY_CLASS = Object.freeze({
  AUTHORITATIVE_SP08001_REQUIRED: "AUTHORITATIVE_SP08001_REQUIRED",
  AUTHORITATIVE_SP08001_OPTIONAL: "AUTHORITATIVE_SP08001_OPTIONAL",
  DOCUMENTED_NON_RESOLUTION_SIDECAR: "DOCUMENTED_NON_RESOLUTION_SIDECAR",
  UNKNOWN_RESOLUTION_RELEVANT: "UNKNOWN_RESOLUTION_RELEVANT",
  UNKNOWN_NON_CLASSIFIED: "UNKNOWN_NON_CLASSIFIED",
  REJECTED_UNSAFE: "REJECTED_UNSAFE",
});

export const MAX_RETAINED_IGNORED_ENTRY_METADATA = 100;

/** Opaque digest of basename (uppercased) — never retain raw licensed names in forensics. */
export function opaqueBasenameDigest(basename) {
  const s = String(basename || "").toUpperCase();
  if (!s) return null;
  return crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

/**
 * Classify a single peek target (tableCode/role/ext already derived; optional basenameDigest).
 * @param {{ tableCode?: string|null, role?: string|null, ext?: string|null, basenameDigest?: string|null, pathReject?: boolean }} t
 */
export function classifyManifestEntry(t) {
  if (!t || t.pathReject === true) {
    return {
      classification: TMC_ENTRY_CLASS.REJECTED_UNSAFE,
      reasonCode: "PATH_REJECT",
      resolutionRequired: false,
      authoritative: false,
      mayIgnore: false,
    };
  }
  const code = t.tableCode || null;
  const role = String(t.role || "");
  const ext = String(t.ext || "").toLowerCase();

  if (code === "README") {
    return {
      classification: TMC_ENTRY_CLASS.AUTHORITATIVE_SP08001_REQUIRED,
      reasonCode: "SP08001_README_METADATA",
      resolutionRequired: false,
      authoritative: true,
      mayIgnore: false,
      docReference: "SP08001_METADATA_FILE=" + SP08001_METADATA_FILE,
    };
  }

  if (code && SP08001_TABLE_CODES.includes(code)) {
    const optionalRows = ALLOWED_EMPTY_TABLES.includes(code);
    return {
      classification: optionalRows
        ? TMC_ENTRY_CLASS.AUTHORITATIVE_SP08001_OPTIONAL
        : TMC_ENTRY_CLASS.AUTHORITATIVE_SP08001_REQUIRED,
      reasonCode: optionalRows ? "SP08001_STANDARD_OPTIONAL_ROWS" : "SP08001_STANDARD_REQUIRED",
      resolutionRequired: true,
      authoritative: true,
      mayIgnore: false,
      docReference: "SP08001_TABLE_CODES/" + code,
    };
  }

  if (COMPANION_NON_AUTHORITATIVE.includes(role)) {
    const companionExtOk =
      (role === "encoding_cpg" && ext === "cpg") ||
      (role === "dbf_layer" && ext === "dbf") ||
      (role === "shp_layer" && (ext === "shp" || ext === "shx")) ||
      (role === "sqlite_candidate" && (ext === "db" || ext === "sqlite" || ext === "sqlite3"));
    if (companionExtOk) {
      return {
        classification: TMC_ENTRY_CLASS.DOCUMENTED_NON_RESOLUTION_SIDECAR,
        reasonCode: "COMPANION_NON_AUTHORITATIVE",
        resolutionRequired: false,
        authoritative: false,
        mayIgnore: true,
        docReference: "tmc-sp08001-format-promotion.mjs:COMPANION_NON_AUTHORITATIVE",
      };
    }
  }

  // Documented companions are role-based (shp/dbf/cpg/sqlite). Any other dat/txt/csv
  // without SP08001 tableCode is non-classified — fail-closed (no extension wildcards).
  if (ext === "dat" || ext === "txt" || ext === "csv") {
    return {
      classification: TMC_ENTRY_CLASS.UNKNOWN_NON_CLASSIFIED,
      reasonCode: "UNMAPPED_TEXT_TABLE_EXTENSION",
      resolutionRequired: false,
      authoritative: false,
      mayIgnore: false,
      docReference: null,
    };
  }

  // Non-peek / non-text companions already filtered; treat residual as unsafe if present.
  return {
    classification: TMC_ENTRY_CLASS.REJECTED_UNSAFE,
    reasonCode: "UNSAFE_OR_UNSUPPORTED_ENTRY",
    resolutionRequired: false,
    authoritative: false,
    mayIgnore: false,
    docReference: null,
  };
}

/**
 * @param {object[]} targets
 * @returns {{ ok: boolean, rejectCode?: string, ... }}
 */
function pushBoundedMeta(arr, entry) {
  if (arr.length < MAX_RETAINED_IGNORED_ENTRY_METADATA) arr.push(entry);
}

export function classifyManifest(targets) {
  const byCode = Object.create(null);
  const ignoredEntries = [];
  const unknownEntries = [];
  const ignoredNonStandardExtCounts = Object.create(null);
  let readme = null;
  let unknownNonclassifiedCount = 0;
  let unknownRequiredCount = 0;
  let rejectedUnsafeCount = 0;
  let documentedSidecarCount = 0;

  for (const t of targets || []) {
    const cls = classifyManifestEntry(t);
    const digest =
      t.basenameDigest && /^[a-f0-9]{16}$/.test(String(t.basenameDigest))
        ? String(t.basenameDigest)
        : null;
    const metaBase = {
      basenameDigest: digest,
      extension: String(t.ext || "").slice(0, 16),
      classification: cls.classification,
      reasonCode: cls.reasonCode,
      resolutionRequired: cls.resolutionRequired === true,
      authoritative: cls.authoritative === true,
    };

    if (cls.classification === TMC_ENTRY_CLASS.REJECTED_UNSAFE) {
      rejectedUnsafeCount += 1;
      pushBoundedMeta(unknownEntries, metaBase);
      return {
        ok: false,
        rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_INVALID,
        rejectedUnsafeCount,
        unknownNonclassifiedCount,
        unknownRequiredCount,
        unknownEntries,
      };
    }

    if (cls.classification === TMC_ENTRY_CLASS.UNKNOWN_NON_CLASSIFIED) {
      unknownNonclassifiedCount += 1;
      pushBoundedMeta(unknownEntries, metaBase);
      continue;
    }

    if (cls.classification === TMC_ENTRY_CLASS.UNKNOWN_RESOLUTION_RELEVANT) {
      unknownRequiredCount += 1;
      pushBoundedMeta(unknownEntries, { ...metaBase, resolutionRequired: true });
      continue;
    }

    if (cls.classification === TMC_ENTRY_CLASS.DOCUMENTED_NON_RESOLUTION_SIDECAR) {
      documentedSidecarCount += 1;
      if (t.ext) ignoredNonStandardExtCounts[t.ext] = (ignoredNonStandardExtCounts[t.ext] || 0) + 1;
      pushBoundedMeta(ignoredEntries, {
        basenameDigest: digest,
        extension: String(t.ext || "").slice(0, 16),
        classification: cls.classification,
        reasonCode: cls.reasonCode,
        resolutionRequired: false,
        authoritative: false,
      });
      continue;
    }

    // Authoritative SP08001 / README
    if (!t.tableCode) {
      unknownNonclassifiedCount += 1;
      continue;
    }
    if (t.tableCode === "README") {
      if (readme) return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_DUPLICATE_ENTRY };
      readme = t;
      continue;
    }
    if (byCode[t.tableCode]) {
      return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_DUPLICATE_ENTRY };
    }
    byCode[t.tableCode] = t;
  }

  if (unknownRequiredCount > 0) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT,
      unknownRequiredCount,
      unknownNonclassifiedCount,
      unknownEntries,
      ignoredEntries,
      ignoredNonStandardCount: documentedSidecarCount,
    };
  }
  if (unknownNonclassifiedCount > 0) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT,
      unknownNonclassifiedCount,
      unknownRequiredCount: 0,
      unknownEntries,
      ignoredEntries,
      ignoredNonStandardCount: documentedSidecarCount,
    };
  }

  const missing = [];
  for (const code of REQUIRED_FOR_DATASET_IMPORT) {
    if (!byCode[code]) missing.push(code);
  }
  if (missing.length) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_REQUIRED_TABLE_MISSING,
      missingCount: missing.length,
      requiredTableCountExpected: REQUIRED_FOR_DATASET_IMPORT.length,
      requiredTableCountFound: REQUIRED_FOR_DATASET_IMPORT.length - missing.length,
    };
  }

  return {
    ok: true,
    byCode,
    readme,
    ignoredNonStandardCount: documentedSidecarCount,
    ignoredNonStandardExtCounts,
    ignoredEntries,
    ignoredEntriesTruncated: documentedSidecarCount > ignoredEntries.length,
    unknownNonclassifiedCount: 0,
    unknownRequiredCount: 0,
    rejectedUnsafeCount: 0,
    documentedSidecarCount,
    requiredTableCountExpected: REQUIRED_FOR_DATASET_IMPORT.length,
    requiredTableCountFound: REQUIRED_FOR_DATASET_IMPORT.length,
    requiredTableSetComplete: true,
    requiredTableSetValid: true,
    standardTableCount: SP08001_STANDARD_TABLE_COUNT,
    role: {
      README: "METADATA_ONLY",
      ROAD_NETWORK_LEVEL_TYPES: "UNSUPPORTED_ADVANCED_RELATIONSHIP",
      ROADS: "REQUIRED_FOR_BASIC_RESOLUTION",
      POINTS: "REQUIRED_FOR_BASIC_RESOLUTION",
      LOCATIONCODES: "REQUIRED_FOR_BASIC_RESOLUTION",
      LOCATIONDATASETS: "REQUIRED_FOR_ARCHIVE_VALIDITY",
      LANGUAGES: "REQUIRED_FOR_ARCHIVE_VALIDITY",
    },
  };
}

/** Mutation-guard: ensure classifier is not a broad extension ignore. */
export function assertNoBroadExtensionIgnore(sourceText) {
  const src = String(sourceText || "");
  // Forbidden patterns: ignore-all by extension without SP08001/companion gate
  if (/if\s*\(\s*t\.ext\s*===\s*["']dat["'][\s\S]{0,80}ignoredNonStandard\.push/.test(src)) {
    return { ok: false, reason: "broad_dat_ignore" };
  }
  return { ok: true };
}

export function resolveDigestFromBasename(basename) {
  return opaqueBasenameDigest(basename);
}

export { resolveSp08001TableCodeFromBasename, REQUIRED_FOR_DATASET_IMPORT, COMPANION_NON_AUTHORITATIVE };
