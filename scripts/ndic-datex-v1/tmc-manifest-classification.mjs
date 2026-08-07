/**
 * Fail-closed TMC ZIP entry classification for basic import.
 *
 * Documentation-backed only:
 *   - SP08001 Table 4-2 standard DAT codes + README.DAT (tmc-sp08001-contract.mjs)
 *     → authoritative resolver input (TMC / TISA exchange format).
 *   - COMPANION_NON_AUTHORITATIVE roles (tmc-sp08001-format-promotion.mjs):
 *       encoding_cpg, dbf_layer, shp_layer, sqlite_candidate
 *     Companions never authorize DAT / never resolve locations.
 *   - LT CZE v11.0 Tab.8 exact TXT working-format basenames
 *       (ltcze11_0_technicka_dokumentace.pdf §5.2 / Tab.8):
 *       alternative denormalized working export of the same LT; not the
 *       RDS-TMC exchange format; may be ignored when SP08001 DAT is present.
 *
 * Unmapped .dat/.txt/.csv are UNKNOWN_NON_CLASSIFIED → fail-closed (never broad-ignored).
 * Fail paths retain bounded redacted digests for unknown/rejected entries (no raw names).
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

export const TMC_ENTRY_REASON = Object.freeze({
  PATH_REJECT: "PATH_REJECT",
  SP08001_README_METADATA: "SP08001_README_METADATA",
  SP08001_STANDARD_OPTIONAL_ROWS: "SP08001_STANDARD_OPTIONAL_ROWS",
  SP08001_STANDARD_REQUIRED: "SP08001_STANDARD_REQUIRED",
  COMPANION_NON_AUTHORITATIVE: "COMPANION_NON_AUTHORITATIVE",
  DOCUMENTED_LT_CZE_TXT_WORKING_FORMAT: "DOCUMENTED_LT_CZE_TXT_WORKING_FORMAT",
  UNMAPPED_TEXT_TABLE_EXTENSION: "UNMAPPED_TEXT_TABLE_EXTENSION",
  UNSAFE_OR_UNSUPPORTED_ENTRY: "UNSAFE_OR_UNSUPPORTED_ENTRY",
  MISSING_TABLE_CODE_AFTER_CLASS: "MISSING_TABLE_CODE_AFTER_CLASS",
});

/**
 * Exact LT CZE v11.0 txt working-format basenames from Tab. 8
 * (ltcze11_0_technicka_dokumentace.pdf §5.2). Never a .txt wildcard.
 */
export const DOCUMENTED_LT_CZE_V11_TXT_WORKING_FORMAT = Object.freeze([
  "LTCZE11_0_POINTS.TXT",
  "LTCZE11_0_SEGMENTS.TXT",
  "LTCZE11_0_ROADS.TXT",
  "LTCZE11_0_ADMINS.TXT",
]);

export const DOCUMENTED_LT_CZE_V11_TXT_DOC_REFERENCE =
  "ltcze11_0_technicka_dokumentace.pdf:5.2/Tab.8";

export const MAX_RETAINED_IGNORED_ENTRY_METADATA = 100;
export const MAX_RETAINED_UNKNOWN_ENTRY_METADATA = 100;

/** Opaque digest of basename (uppercased) — never retain raw licensed names in forensics. */
export function opaqueBasenameDigest(basename) {
  const s = String(basename || "").toUpperCase();
  if (!s) return null;
  return crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

const DOCUMENTED_LT_CZE_V11_TXT_DIGESTS = new Set(
  DOCUMENTED_LT_CZE_V11_TXT_WORKING_FORMAT.map((b) => opaqueBasenameDigest(b))
);

/**
 * Classify a single peek target (tableCode/role/ext already derived; optional basenameDigest).
 * @param {{ tableCode?: string|null, role?: string|null, ext?: string|null, basenameDigest?: string|null, pathReject?: boolean }} t
 */
export function classifyManifestEntry(t) {
  if (!t || t.pathReject === true) {
    return {
      classification: TMC_ENTRY_CLASS.REJECTED_UNSAFE,
      reasonCode: TMC_ENTRY_REASON.PATH_REJECT,
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
      reasonCode: TMC_ENTRY_REASON.SP08001_README_METADATA,
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
      reasonCode: optionalRows
        ? TMC_ENTRY_REASON.SP08001_STANDARD_OPTIONAL_ROWS
        : TMC_ENTRY_REASON.SP08001_STANDARD_REQUIRED,
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
        reasonCode: TMC_ENTRY_REASON.COMPANION_NON_AUTHORITATIVE,
        resolutionRequired: false,
        authoritative: false,
        mayIgnore: true,
        docReference: "tmc-sp08001-format-promotion.mjs:COMPANION_NON_AUTHORITATIVE",
      };
    }
  }

  // LT CZE v11.0 Tab.8 exact TXT working-format basenames (digest-matched; no .txt wildcard).
  // Alternative working export of the same LT; SP08001 DAT remains the resolver input.
  if (
    ext === "txt" &&
    t.basenameDigest &&
    DOCUMENTED_LT_CZE_V11_TXT_DIGESTS.has(String(t.basenameDigest))
  ) {
    return {
      classification: TMC_ENTRY_CLASS.DOCUMENTED_NON_RESOLUTION_SIDECAR,
      reasonCode: TMC_ENTRY_REASON.DOCUMENTED_LT_CZE_TXT_WORKING_FORMAT,
      resolutionRequired: false,
      authoritative: false,
      mayIgnore: true,
      docReference: DOCUMENTED_LT_CZE_V11_TXT_DOC_REFERENCE,
      documentedRole: "lt_cze_txt_working_format",
    };
  }

  // Documented companions are role-based (shp/dbf/cpg/sqlite) or exact Tab.8 TXT.
  // Any other dat/txt/csv without SP08001 tableCode is non-classified — fail-closed.
  if (ext === "dat" || ext === "txt" || ext === "csv") {
    return {
      classification: TMC_ENTRY_CLASS.UNKNOWN_NON_CLASSIFIED,
      reasonCode: TMC_ENTRY_REASON.UNMAPPED_TEXT_TABLE_EXTENSION,
      resolutionRequired: false,
      authoritative: false,
      mayIgnore: false,
      docReference: null,
    };
  }

  return {
    classification: TMC_ENTRY_CLASS.REJECTED_UNSAFE,
    reasonCode: TMC_ENTRY_REASON.UNSAFE_OR_UNSUPPORTED_ENTRY,
    resolutionRequired: false,
    authoritative: false,
    mayIgnore: false,
    docReference: null,
  };
}

function pushBoundedMeta(arr, entry, max) {
  if (arr.length < max) arr.push(entry);
}

function buildEntryMeta(t, cls, entryOrdinal) {
  const digest =
    t.basenameDigest && /^[a-f0-9]{16}$/.test(String(t.basenameDigest))
      ? String(t.basenameDigest)
      : null;
  const meta = {
    basenameDigest: digest,
    extension: String(t.ext || "").slice(0, 16),
    classification: cls.classification,
    reasonCode: cls.reasonCode,
    resolutionRequired: cls.resolutionRequired === true,
    authoritative: cls.authoritative === true,
    entryOrdinal: Number.isInteger(entryOrdinal) && entryOrdinal >= 0 ? entryOrdinal : 0,
  };
  // Opaque allowlisted tableCode only (never raw licensed basenames).
  if (t.tableCode === "README" || (t.tableCode && SP08001_TABLE_CODES.includes(t.tableCode))) {
    meta.tableCode = String(t.tableCode);
  }
  return meta;
}

function requiredCountsFromByCode(byCode) {
  let found = 0;
  for (const code of REQUIRED_FOR_DATASET_IMPORT) {
    if (byCode[code]) found += 1;
  }
  return {
    requiredTableCountExpected: REQUIRED_FOR_DATASET_IMPORT.length,
    requiredTableCountFound: found,
    requiredTableSetComplete: found === REQUIRED_FOR_DATASET_IMPORT.length,
    requiredTableSetValid: false,
  };
}

/**
 * @param {object[]} targets
 * @returns {{ ok: boolean, rejectCode?: string, ... }}
 */
export function classifyManifest(targets) {
  const byCode = Object.create(null);
  const ignoredEntries = [];
  const unknownNonclassifiedEntries = [];
  const unknownRequiredEntries = [];
  const rejectedUnsafeEntries = [];
  const ignoredNonStandardExtCounts = Object.create(null);
  let readme = null;
  let unknownNonclassifiedCount = 0;
  let unknownRequiredCount = 0;
  let rejectedUnsafeCount = 0;
  let documentedSidecarCount = 0;
  let entryOrdinal = 0;

  for (const t of targets || []) {
    const ordinal = entryOrdinal++;
    const cls = classifyManifestEntry(t);
    const meta = buildEntryMeta(t, cls, ordinal);

    if (cls.classification === TMC_ENTRY_CLASS.REJECTED_UNSAFE) {
      rejectedUnsafeCount += 1;
      pushBoundedMeta(rejectedUnsafeEntries, meta, MAX_RETAINED_UNKNOWN_ENTRY_METADATA);
      const req = requiredCountsFromByCode(byCode);
      return {
        ok: false,
        rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_INVALID,
        rejectedUnsafeCount,
        unknownNonclassifiedCount,
        unknownRequiredCount,
        unknownNonclassifiedEntries,
        unknownRequiredEntries,
        rejectedUnsafeEntries,
        ignoredEntries,
        ignoredNonStandardCount: documentedSidecarCount,
        ...req,
        requiredTableSetComplete: false,
        requiredTableSetValid: false,
      };
    }

    if (cls.classification === TMC_ENTRY_CLASS.UNKNOWN_NON_CLASSIFIED) {
      unknownNonclassifiedCount += 1;
      pushBoundedMeta(unknownNonclassifiedEntries, meta, MAX_RETAINED_UNKNOWN_ENTRY_METADATA);
      continue;
    }

    if (cls.classification === TMC_ENTRY_CLASS.UNKNOWN_RESOLUTION_RELEVANT) {
      unknownRequiredCount += 1;
      pushBoundedMeta(
        unknownRequiredEntries,
        { ...meta, resolutionRequired: true },
        MAX_RETAINED_UNKNOWN_ENTRY_METADATA
      );
      continue;
    }

    if (cls.classification === TMC_ENTRY_CLASS.DOCUMENTED_NON_RESOLUTION_SIDECAR) {
      documentedSidecarCount += 1;
      if (t.ext) ignoredNonStandardExtCounts[t.ext] = (ignoredNonStandardExtCounts[t.ext] || 0) + 1;
      pushBoundedMeta(
        ignoredEntries,
        {
          basenameDigest: meta.basenameDigest,
          extension: meta.extension,
          classification: meta.classification,
          reasonCode: meta.reasonCode,
          resolutionRequired: false,
          authoritative: false,
          entryOrdinal: meta.entryOrdinal,
        },
        MAX_RETAINED_IGNORED_ENTRY_METADATA
      );
      continue;
    }

    // Authoritative SP08001 / README
    if (!t.tableCode) {
      unknownNonclassifiedCount += 1;
      pushBoundedMeta(
        unknownNonclassifiedEntries,
        {
          ...meta,
          classification: TMC_ENTRY_CLASS.UNKNOWN_NON_CLASSIFIED,
          reasonCode: TMC_ENTRY_REASON.MISSING_TABLE_CODE_AFTER_CLASS,
          resolutionRequired: false,
          authoritative: false,
        },
        MAX_RETAINED_UNKNOWN_ENTRY_METADATA
      );
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

  const req = requiredCountsFromByCode(byCode);

  if (unknownRequiredCount > 0) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT,
      unknownRequiredCount,
      unknownNonclassifiedCount,
      rejectedUnsafeCount,
      unknownNonclassifiedEntries,
      unknownRequiredEntries,
      rejectedUnsafeEntries,
      ignoredEntries,
      ignoredNonStandardCount: documentedSidecarCount,
      ...req,
      requiredTableSetComplete: false,
      requiredTableSetValid: false,
    };
  }
  if (unknownNonclassifiedCount > 0) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_UNKNOWN_TABLE_PRESENT,
      unknownNonclassifiedCount,
      unknownRequiredCount: 0,
      rejectedUnsafeCount,
      unknownNonclassifiedEntries,
      unknownRequiredEntries,
      rejectedUnsafeEntries,
      ignoredEntries,
      ignoredNonStandardCount: documentedSidecarCount,
      ...req,
      requiredTableSetComplete: false,
      requiredTableSetValid: false,
    };
  }

  if (!req.requiredTableSetComplete) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_REQUIRED_TABLE_MISSING,
      missingCount: req.requiredTableCountExpected - req.requiredTableCountFound,
      ...req,
      requiredTableSetValid: false,
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
    unknownNonclassifiedEntries: [],
    unknownRequiredEntries: [],
    rejectedUnsafeEntries: [],
    documentedSidecarCount,
    requiredTableCountExpected: req.requiredTableCountExpected,
    requiredTableCountFound: req.requiredTableCountFound,
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
  if (/if\s*\(\s*t\.ext\s*===\s*["']dat["'][\s\S]{0,80}ignoredNonStandard\.push/.test(src)) {
    return { ok: false, reason: "broad_dat_ignore" };
  }
  if (/ext\s*===\s*["']txt["'][\s\S]{0,120}mayIgnore\s*:\s*true/.test(src) && !/DOCUMENTED_LT_CZE_V11_TXT_DIGESTS/.test(src)) {
    return { ok: false, reason: "broad_txt_ignore" };
  }
  if (/DOCUMENTED_LT_CZE_V11_TXT/.test(src) && !/DOCUMENTED_LT_CZE_V11_TXT_DOC_REFERENCE/.test(src)) {
    return { ok: false, reason: "missing_doc_reference_gate" };
  }
  return { ok: true };
}

export function resolveDigestFromBasename(basename) {
  return opaqueBasenameDigest(basename);
}

export { resolveSp08001TableCodeFromBasename, REQUIRED_FOR_DATASET_IMPORT, COMPANION_NON_AUTHORITATIVE };
