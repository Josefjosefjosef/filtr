/**
 * Streaming-oriented SP08001 .DAT parser for basic TMC v11 import.
 * Never emits raw licensed rows to callers' public surfaces.
 */
import { getSp08001Table } from "./tmc-sp08001-contract.mjs";
import {
  splitSp08001Fields,
  detectDatEncodingFromBytes,
  matchSp08001Header,
  SP08001_HEADER_STATE,
} from "./tmc-sp08001-header.mjs";
import { TMC_IMPORTER_ERROR } from "./tmc-importer-errors.mjs";

export const DAT_PARSE_LIMITS = Object.freeze({
  maxLineBytes: 8 * 1024,
  maxFieldBytes: 512,
  maxFields: 64,
  maxRowsPerTable: 500_000,
  maxTableBytes: 8 * 1024 * 1024,
});

/**
 * LANGUAGES: documented 4 fields; archive may present known 5-field extension.
 * Fifth field is detected only — never interpreted or used.
 */
export function matchLanguagesHeader(headerCodes) {
  const expected = getSp08001Table("LANGUAGES").headerCodes;
  const actual = (headerCodes || []).map((c) => String(c).toUpperCase());
  if (actual.length === 4) {
    return matchSp08001Header("LANGUAGES", actual);
  }
  if (actual.length === 5) {
    const first4 = actual.slice(0, 4);
    const base = matchSp08001Header("LANGUAGES", first4);
    if (!base.matched) {
      return {
        ...base,
        languagesExtensionFieldPresent: false,
        languagesExtensionFieldSupported: false,
      };
    }
    return {
      matched: true,
      headerState: SP08001_HEADER_STATE.PRESENT_MATCH,
      reason: null,
      tableState: base.tableState,
      expectedCount: 4,
      actualCount: 5,
      languagesExtensionFieldPresent: true,
      languagesExtensionFieldSupported: false,
      extensionFieldIgnored: true,
    };
  }
  return {
    matched: false,
    headerState: SP08001_HEADER_STATE.PRESENT_MISMATCH,
    reason: "field_count",
    tableState: "field_count_mismatch",
    expectedCount: 4,
    actualCount: actual.length,
    languagesExtensionFieldPresent: actual.length > 4,
    languagesExtensionFieldSupported: false,
    rejectCode:
      actual.length > 5
        ? TMC_IMPORTER_ERROR.TMC_LANGUAGES_EXTENSION_UNSUPPORTED
        : TMC_IMPORTER_ERROR.TMC_FIELD_COUNT_MISMATCH,
  };
}

export function matchTableHeader(tableCode, headerCodes) {
  if (tableCode === "LANGUAGES") return matchLanguagesHeader(headerCodes);
  return matchSp08001Header(tableCode, headerCodes);
}

function validateUtf8Strict(buf) {
  let i = 0;
  let invalid = 0;
  while (i < buf.length) {
    const c = buf[i];
    if (c <= 0x7f) {
      i += 1;
      continue;
    }
    if ((c & 0xe0) === 0xc0) {
      if (i + 1 >= buf.length || (buf[i + 1] & 0xc0) !== 0x80 || c < 0xc2) invalid += 1;
      i += 2;
      continue;
    }
    if ((c & 0xf0) === 0xe0) {
      if (i + 2 >= buf.length || (buf[i + 1] & 0xc0) !== 0x80 || (buf[i + 2] & 0xc0) !== 0x80) invalid += 1;
      i += 3;
      continue;
    }
    if ((c & 0xf8) === 0xf0) {
      if (
        i + 3 >= buf.length ||
        (buf[i + 1] & 0xc0) !== 0x80 ||
        (buf[i + 2] & 0xc0) !== 0x80 ||
        (buf[i + 3] & 0xc0) !== 0x80
      )
        invalid += 1;
      i += 4;
      continue;
    }
    invalid += 1;
    i += 1;
  }
  return invalid;
}

/**
 * Parse a complete (bounded) DAT buffer into header + rows.
 * @returns {{ ok: boolean, rejectCode?: string, encodingMeta: object, headerCodes: string[], rows: string[][], rowCount: number }}
 */
export function parseSp08001DatBuffer(tableCode, buf, opts = {}) {
  const lim = { ...DAT_PARSE_LIMITS, ...(opts.limits || {}) };
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.alloc(0);
  if (raw.length > lim.maxTableBytes) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_LIMIT_EXCEEDED, encodingMeta: null, headerCodes: [], rows: [], rowCount: 0 };
  }

  const encDetect = detectDatEncodingFromBytes(raw);
  let body = raw;
  let bom = false;
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    bom = true;
    body = raw.subarray(3);
  }
  if (opts.rejectBom === true && bom) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_ENCODING_INVALID,
      encodingMeta: { encoding: encDetect.encoding, bom: true, lineEnding: null, decodeWarnings: 0, invalidSequenceCount: 0 },
      headerCodes: [],
      rows: [],
      rowCount: 0,
    };
  }

  const invalidSequenceCount = validateUtf8Strict(body);
  if (invalidSequenceCount > 0) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_ENCODING_INVALID,
      encodingMeta: {
        encoding: encDetect.encoding,
        bom,
        lineEnding: null,
        decodeWarnings: 0,
        invalidSequenceCount,
      },
      headerCodes: [],
      rows: [],
      rowCount: 0,
    };
  }

  const text = body.toString("utf8");
  const hasCRLF = text.includes("\r\n");
  const hasLFOnly = /(?:^|[^\r])\n/.test(text.replace(/\r\n/g, ""));
  const hasCROnly = text.includes("\r") && !hasCRLF;
  let lineEnding = "none";
  if (hasCRLF && !hasLFOnly && !hasCROnly) lineEnding = "crlf";
  else if (hasLFOnly && !hasCRLF && !hasCROnly) lineEnding = "lf";
  else if (hasCROnly) lineEnding = "cr";
  else if ((hasCRLF && hasLFOnly) || (hasCRLF && hasCROnly) || (hasLFOnly && hasCROnly)) {
    if (opts.forbidMixedLineEndings !== false) {
      return {
        ok: false,
        rejectCode: TMC_IMPORTER_ERROR.TMC_ENCODING_INVALID,
        encodingMeta: {
          encoding: "UTF-8",
          bom,
          lineEnding: "mixed",
          decodeWarnings: 1,
          invalidSequenceCount: 0,
        },
        headerCodes: [],
        rows: [],
        rowCount: 0,
      };
    }
    lineEnding = "mixed";
  }

  const encodingMeta = {
    encoding: "UTF-8",
    bom,
    lineEnding,
    decodeWarnings: 0,
    invalidSequenceCount: 0,
  };

  const lines = text.split(/\r\n|\n|\r/);
  // Drop trailing empty from final newline
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (!lines.length) {
    return {
      ok: false,
      rejectCode: TMC_IMPORTER_ERROR.TMC_HEADER_MISMATCH,
      encodingMeta,
      headerCodes: [],
      rows: [],
      rowCount: 0,
    };
  }

  const headerLine = lines[0];
  if (Buffer.byteLength(headerLine, "utf8") > lim.maxLineBytes) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ROW_TOO_LONG, encodingMeta, headerCodes: [], rows: [], rowCount: 0 };
  }
  const headerCodes = splitSp08001Fields(headerLine).map((c) => String(c).trim().toUpperCase());
  if (headerCodes.length > lim.maxFields) {
    return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_FIELD_COUNT_MISMATCH, encodingMeta, headerCodes: [], rows: [], rowCount: 0 };
  }

  const headerMatch = matchTableHeader(tableCode, headerCodes);
  if (!headerMatch.matched) {
    return {
      ok: false,
      rejectCode:
        headerMatch.rejectCode ||
        (headerMatch.reason === "field_count"
          ? TMC_IMPORTER_ERROR.TMC_FIELD_COUNT_MISMATCH
          : TMC_IMPORTER_ERROR.TMC_HEADER_MISMATCH),
      encodingMeta,
      headerCodes: [],
      rows: [],
      rowCount: 0,
      headerMatch,
    };
  }

  const expectedWidth =
    tableCode === "LANGUAGES" && headerMatch.languagesExtensionFieldPresent === true
      ? 5
      : getSp08001Table(tableCode).headerCodes.length;

  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li];
    if (line === "") continue;
    if (Buffer.byteLength(line, "utf8") > lim.maxLineBytes) {
      return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ROW_TOO_LONG, encodingMeta, headerCodes: [], rows: [], rowCount: 0 };
    }
    const fields = splitSp08001Fields(line);
    if (fields.length !== expectedWidth) {
      return {
        ok: false,
        rejectCode: TMC_IMPORTER_ERROR.TMC_FIELD_COUNT_MISMATCH,
        encodingMeta,
        headerCodes: [],
        rows: [],
        rowCount: 0,
      };
    }
    for (const f of fields) {
      if (Buffer.byteLength(f, "utf8") > lim.maxFieldBytes) {
        return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_FIELD_TOO_LONG, encodingMeta, headerCodes: [], rows: [], rowCount: 0 };
      }
    }
    // LANGUAGES: keep only first 4 documented fields in accepted model; ignore 5th.
    if (tableCode === "LANGUAGES" && fields.length === 5) {
      rows.push(fields.slice(0, 4));
    } else {
      rows.push(fields);
    }
    if (rows.length > lim.maxRowsPerTable) {
      return { ok: false, rejectCode: TMC_IMPORTER_ERROR.TMC_ARCHIVE_LIMIT_EXCEEDED, encodingMeta, headerCodes: [], rows: [], rowCount: 0 };
    }
  }

  return {
    ok: true,
    encodingMeta,
    headerCodes: getSp08001Table(tableCode).headerCodes.slice(),
    rows,
    rowCount: rows.length,
    headerMatch,
    languagesExtensionFieldPresent: headerMatch.languagesExtensionFieldPresent === true,
    languagesExtensionFieldSupported: false,
  };
}

/**
 * Validate a single field against SP08001 type token (basic).
 */
export function validateFieldType(typeToken, value, optional) {
  const v = value == null ? "" : String(value);
  if (v === "") {
    return optional !== false ? { ok: true, empty: true } : { ok: false, empty: true };
  }
  const t = String(typeToken || "");
  const num = /^NUMERIC(?:\((\d+)\))?$/i.exec(t);
  if (num) {
    if (!/^-?\d+$/.test(v)) return { ok: false, empty: false };
    if (num[1] && v.replace(/^-/, "").length > Number(num[1])) return { ok: false, empty: false };
    return { ok: true, empty: false };
  }
  const ch = /^CHAR\((\d+)\)$/i.exec(t);
  if (ch) {
    if (v.length > Number(ch[1])) return { ok: false, empty: false };
    return { ok: true, empty: false };
  }
  if (/^NUMERIC$/i.test(t)) {
    return /^-?\d+$/.test(v) ? { ok: true, empty: false } : { ok: false, empty: false };
  }
  return { ok: true, empty: false };
}
