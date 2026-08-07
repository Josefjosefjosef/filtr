/**
 * Normalized basic TMC v11 internal model (never public / no licensed raw rows).
 */
export const RESOLUTION_STATUS = Object.freeze({
  RESOLVED_BASIC: "RESOLVED_BASIC",
  UNRESOLVED_MISSING_REFERENCE: "UNRESOLVED_MISSING_REFERENCE",
  UNRESOLVED_INVALID_REFERENCE: "UNRESOLVED_INVALID_REFERENCE",
  UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP: "UNRESOLVED_UNSUPPORTED_ADVANCED_RELATIONSHIP",
  UNRESOLVED_AMBIGUOUS: "UNRESOLVED_AMBIGUOUS",
  REJECTED_INVALID_ROW: "REJECTED_INVALID_ROW",
});

export const RNLT_STATUS = Object.freeze({
  PRESENT_EMPTY: "PRESENT_EMPTY",
  PRESENT_UNSUPPORTED_HEADER: "PRESENT_UNSUPPORTED_HEADER",
  PRESENT_VALID_BASIC: "PRESENT_VALID_BASIC",
  MISSING: "MISSING",
  INVALID: "INVALID",
});

export const PES_LEV_RELATIONSHIP_STATUS = Object.freeze({
  DISABLED_UNPROVEN: "DISABLED_UNPROVEN",
  VALIDATED: "VALIDATED",
  INVALID: "INVALID",
});

export const FEATURE_FLAGS = Object.freeze({
  ADVANCED_RNLT_RELATIONSHIPS_ENABLED: false,
  PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED: false,
  LANGUAGES_FIFTH_FIELD_USED: false,
  UNPROVEN_FIELDS_INFERRED: false,
});

export function emptyMetrics() {
  return {
    archiveCompressedBytes: 0,
    archiveDeclaredUncompressedBytes: 0,
    archiveActualReadBytes: 0,
    archiveEntryCount: 0,
    datEntryCount: 0,
    standardTableCount: 0,
    ignoredNonStandardCount: 0,
    ignoredNonStandardExtCounts: Object.create(null),
    parsedRowCount: 0,
    acceptedRowCount: 0,
    rejectedRowCount: 0,
    duplicateKeyCount: 0,
    missingReferenceCount: 0,
    unsupportedAdvancedRelationshipCount: 0,
    emptyPesLevCount: 0,
    nonEmptyPesLevCount: 0,
    invalidPesLevCount: 0,
    peakHeapBytes: 0,
    peakRssBytes: 0,
    temporaryDiskBytes: 0,
    durationMs: 0,
    cleanupSucceeded: false,
    activationSucceeded: false,
  };
}

/**
 * Build opaque row objects keyed by header codes (in-memory staging only).
 */
export function rowsToObjects(headerCodes, rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const obj = Object.create(null);
    for (let c = 0; c < headerCodes.length; c++) {
      obj[headerCodes[c]] = rows[i][c] ?? "";
    }
    obj.__sourceRowNumber = i + 2; // 1-based file line after header
    out.push(obj);
  }
  return out;
}

export function normalizeRoad(row, meta) {
  const pesRaw = row.PES_LEV == null ? "" : String(row.PES_LEV).trim();
  const pesLev = pesRaw === "" ? null : pesRaw;
  return {
    cid: Number(row.CID),
    tabcd: Number(row.TABCD),
    tableVersion: meta.tableVersion,
    lcd: row.LCD,
    classCode: row.CLASS,
    tcd: row.TCD,
    stcd: row.STCD,
    roadNumber: row.ROADNUMBER || null,
    rnid: row.RNID || null,
    n1id: row.N1ID || null,
    n2id: row.N2ID || null,
    polLcd: row.POL_LCD || null,
    pesLev,
    rdid: row.RDID || null,
    rawSourceTable: "ROADS",
    sourceRowNumber: row.__sourceRowNumber,
    sourceFieldPresence: Object.freeze({
      PES_LEV: pesLev != null,
    }),
    validationStatus: "accepted",
  };
}

export function normalizePoint(row, meta) {
  return {
    cid: Number(row.CID),
    tabcd: Number(row.TABCD),
    tableVersion: meta.tableVersion,
    lcd: row.LCD,
    classCode: row.CLASS,
    tcd: row.TCD,
    stcd: row.STCD,
    segLcd: row.SEG_LCD || null,
    roaLcd: row.ROA_LCD || null,
    polLcd: row.POL_LCD || null,
    nextPos: row.OUTPOS || null,
    nextNeg: row.OUTNEG || null,
    prevPos: row.INPOS || null,
    prevNeg: row.INNEG || null,
    xcoord: row.XCOORD || null,
    ycoord: row.YCOORD || null,
    rawSourceTable: "POINTS",
    sourceRowNumber: row.__sourceRowNumber,
    sourceFieldPresence: Object.freeze({}),
    validationStatus: "accepted",
  };
}
