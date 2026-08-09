/**
 * SP08001 v2.6 header/schema verification helpers (offline, no importer).
 * Structural rules only — never emits raw TMC rows, basenames of live archives, or coordinates.
 */
import {
  SP08001_PHYSICAL,
  SP08001_TABLES,
  SP08001_EXCHANGE_FORMAT_VERSION,
  SP08001_SPEC_ID,
  getSp08001Table,
  resolveSp08001TableCodeFromBasename,
} from "./tmc-sp08001-contract.mjs";
import {
  TABLE_STATE,
  FILE_PRESENCE_CLASS,
  README_PARSE_STATE,
  DAT_ENCODING_SOURCE,
  classifyHeaderMismatchState,
  deriveTableState,
  isAllowedEmptyTable,
} from "./tmc-sp08001-format-promotion.mjs";

export const SP08001_DELIMITER = "semicolon";
export const SP08001_HEADER_STATE = Object.freeze({
  PRESENT_MATCH: "PRESENT_MATCH",
  PRESENT_MISMATCH: "PRESENT_MISMATCH",
  ABSENT: "ABSENT",
  UNVERIFIED: "UNVERIFIED",
});

export const ENCODING_LAYER = Object.freeze({
  DAT_DECLARED: "dat_declared",
  DAT_DETECTED: "dat_detected",
  README_DECLARED: "readme_declared",
  CPG_SHP_DBF: "cpg_shp_dbf",
  OTHER: "other",
});

const MAX_HEADER_BYTES = 1024;
const MAX_FIELDS = 64;

/**
 * Split a SP08001 record line with optional double-quote embedding.
 * Spec: strings may be optionally embedded in double quotes; empty field = ;;
 */
export function splitSp08001Fields(line) {
  const s = String(line ?? "");
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (inQuotes && s[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ";" && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function normalizeSp08001EncodingToken(raw) {
  const original = String(raw || "").trim();
  if (!original) return "UNKNOWN";
  if (original === "ASCII_OR_UTF8" || original === "NON_UTF8" || original === "UNVERIFIED") return original;
  const t = original.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!t) return "UNKNOWN";
  if (t === "UTF8" || t === "UTF-8") return "UTF-8";
  if (t.includes("8859-15") || t.includes("885915") || t.includes("LATIN9") || t === "ISO885915") return "ISO-8859-15";
  if (t.includes("8859-1") || t.includes("88591") || t === "LATIN1") return "ISO-8859-1";
  if (t.includes("1250") || t.includes("CP1250") || t.includes("WINDOWS1250") || t.includes("WINDOWS-1250"))
    return "WINDOWS-1250";
  if (t.includes("ASCII") || t === "USASCII") return "ASCII";
  return "UNKNOWN";
}

/**
 * Detect encoding from bytes for DAT layer — never auto-label decoded text as UTF-8.
 * @returns {{ encoding: string, bom: boolean, confidence: string }}
 */
export function detectDatEncodingFromBytes(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    // BOM is UNDEFINED_BY_SP08001; tolerate only as UTF-8 stream marker.
    return { encoding: "UTF-8", bom: true, confidence: "utf8_bom" };
  }
  // Valid UTF-8 structural check on peek
  try {
    const sample = b.subarray(0, Math.min(b.length, 4096));
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(sample);
    // If any non-ASCII present and decoded ok → UTF-8 candidate
    if (/[^\x00-\x7F]/.test(decoded)) return { encoding: "UTF-8", bom: false, confidence: "utf8_fatal_ok" };
    return { encoding: "ASCII_OR_UTF8", bom: false, confidence: "ascii_subset" };
  } catch {
    return { encoding: "NON_UTF8", bom: false, confidence: "utf8_fatal_fail" };
  }
}

export function parseSp08001HeaderLine(rawLine) {
  const line = String(rawLine || "").replace(/^\uFEFF/, "").replace(/\r$/, "");
  if (!line) return { ok: false, reason: "empty_header" };
  if (Buffer.byteLength(line, "utf8") > MAX_HEADER_BYTES) return { ok: false, reason: "header_too_long" };
  const fields = splitSp08001Fields(line);
  if (fields.length > MAX_FIELDS) return { ok: false, reason: "too_many_fields" };
  if (fields.length === 0) return { ok: false, reason: "no_fields" };
  // Header tokens must look like column codes (A-Z0-9_)
  const codes = fields.map((f) => String(f || "").trim().toUpperCase());
  for (const c of codes) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(c)) return { ok: false, reason: "non_code_token", codes };
  }
  const dup = new Set();
  for (const c of codes) {
    if (dup.has(c)) return { ok: false, reason: "duplicate_column", codes };
    dup.add(c);
  }
  return { ok: true, codes, fieldCount: codes.length };
}

/**
 * Exact header contract match against SP08001 table definition.
 * Emits closed TABLE_STATE mismatch enums — never raw header strings.
 */
export function matchSp08001Header(tableCode, headerCodes, parseReason) {
  const table = getSp08001Table(tableCode);
  if (!table) {
    return {
      matched: false,
      headerState: SP08001_HEADER_STATE.PRESENT_MISMATCH,
      reason: "unknown_table",
      tableState: TABLE_STATE.missing_complete_header,
      expectedCount: 0,
      actualCount: (headerCodes || []).length,
    };
  }
  const expected = table.headerCodes;
  const actual = (headerCodes || []).map((c) => String(c).toUpperCase());
  const mismatchState = classifyHeaderMismatchState(expected, actual, parseReason);
  if (mismatchState) {
    const reason =
      mismatchState === TABLE_STATE.field_count_mismatch
        ? "field_count"
        : mismatchState === TABLE_STATE.field_order_mismatch
          ? "column_order_or_code"
          : mismatchState === TABLE_STATE.missing_required_field
            ? "missing_required_field"
            : mismatchState === TABLE_STATE.unexpected_field
              ? "unexpected_field"
              : mismatchState === TABLE_STATE.duplicate_field
                ? "duplicate_column"
                : "column_order_or_code";
    return {
      matched: false,
      headerState: SP08001_HEADER_STATE.PRESENT_MISMATCH,
      reason,
      tableState: mismatchState,
      expectedCount: expected.length,
      actualCount: actual.length,
    };
  }
  return {
    matched: true,
    headerState: SP08001_HEADER_STATE.PRESENT_MATCH,
    reason: null,
    tableState: TABLE_STATE.exact_header_match,
    expectedCount: expected.length,
    actualCount: actual.length,
  };
}

/**
 * Classify DAT buffer presence without leaking content.
 * @param {Buffer|null|undefined} buf
 * @param {{ hasHeader?: boolean, firstDataFieldCount?: number, dataRowCount?: number }} peek
 */
export function classifyDatFilePresence(buf, peek = {}) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.alloc(0);
  if (b.length === 0) return FILE_PRESENCE_CLASS.ZERO_BYTE_FILE;
  if (peek.hasHeader === true) {
    if ((peek.firstDataFieldCount || 0) > 0 || (peek.dataRowCount || 0) > 0) {
      return FILE_PRESENCE_CLASS.HEADER_AND_ROWS;
    }
    return FILE_PRESENCE_CLASS.HEADER_ONLY;
  }
  // Non-empty but no parseable header
  return FILE_PRESENCE_CLASS.HEADER_ONLY;
}

/**
 * Parse README.DAT metadata structurally (ASCII). Never returns publisher/raw values.
 * Tolerates UTF-8 BOM before an otherwise ASCII body (SP08001 bomRule = UNDEFINED).
 * Meta fields are taken from non-empty lines in Table 4-3 order; blank lines ignored.
 * Never replaces undecodable bytes — non-ASCII body ⇒ decode_error (fail-closed).
 * @param {Buffer} buf
 */
export function parseReadmeDatStructural(buf) {
  const raw = Buffer.isBuffer(buf) ? buf : Buffer.alloc(0);
  if (!raw.length) {
    return {
      readmeParseState: README_PARSE_STATE.missing_fail_closed,
      datEncodingSource: DAT_ENCODING_SOURCE.unresolved,
      declaredEncodingNormalized: null,
      readmeMapped: false,
      readmeBomPresent: false,
      readmeNonEmptyLineCount: 0,
      readmeMetaFieldObservedCount: 0,
    };
  }
  let bomPresent = false;
  let b = raw;
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    bomPresent = true;
    b = b.subarray(3);
  }
  // README must be ASCII per SP08001; reject non-ASCII bytes for decode_error.
  // Do not use replacement decoding — any byte > 0x7f is fail-closed.
  for (let i = 0; i < Math.min(b.length, 8192); i++) {
    if (b[i] > 0x7f) {
      return {
        readmeParseState: README_PARSE_STATE.decode_error,
        datEncodingSource: DAT_ENCODING_SOURCE.unresolved,
        declaredEncodingNormalized: null,
        readmeMapped: true,
        readmeBomPresent: bomPresent,
        readmeNonEmptyLineCount: 0,
        readmeMetaFieldObservedCount: 0,
      };
    }
  }
  const text = b.toString("ascii");
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\r$/, ""));
  const nonEmptyCount = lines.filter((l) => String(l || "").trim().length > 0).length;
  // Skip leading blank lines, then read Table 4-3 meta as 7 consecutive slots
  // (empty characterEncoding slot at index 4 remains distinguishable → SP08001 default).
  let start = 0;
  while (start < lines.length && String(lines[start] || "").trim().length === 0) start += 1;
  const meta = [];
  for (let i = 0; i < 7; i++) {
    meta.push(start + i < lines.length ? String(lines[start + i] || "") : "");
  }
  // Need alert..encoding window present; fewer than 5 non-empty lines overall ⇒ structural_mismatch.
  if (nonEmptyCount < 5 || start >= lines.length) {
    return {
      readmeParseState: README_PARSE_STATE.structural_mismatch,
      datEncodingSource: DAT_ENCODING_SOURCE.sp08001_default,
      declaredEncodingNormalized: null,
      readmeMapped: true,
      readmeBomPresent: bomPresent,
      readmeNonEmptyLineCount: nonEmptyCount,
      readmeMetaFieldObservedCount: meta.filter((l) => String(l || "").trim().length > 0).length,
    };
  }
  const encRaw = String(meta[4] || "").trim();
  const metaObserved = meta.filter((l) => String(l || "").trim().length > 0).length;
  if (!encRaw) {
    return {
      readmeParseState: README_PARSE_STATE.mapped_default_encoding,
      datEncodingSource: DAT_ENCODING_SOURCE.sp08001_default,
      declaredEncodingNormalized: SP08001_PHYSICAL.defaultEncoding,
      readmeMapped: true,
      readmeBomPresent: bomPresent,
      readmeNonEmptyLineCount: nonEmptyCount,
      readmeMetaFieldObservedCount: metaObserved,
    };
  }
  const enc = normalizeSp08001EncodingToken(encRaw);
  if (enc === "UNKNOWN") {
    return {
      readmeParseState: README_PARSE_STATE.mapped_invalid_encoding,
      datEncodingSource: DAT_ENCODING_SOURCE.unresolved,
      declaredEncodingNormalized: null,
      readmeMapped: true,
      readmeBomPresent: bomPresent,
      readmeNonEmptyLineCount: nonEmptyCount,
      readmeMetaFieldObservedCount: metaObserved,
    };
  }
  return {
    readmeParseState: README_PARSE_STATE.mapped_and_parsed,
    datEncodingSource: DAT_ENCODING_SOURCE.readme_declared,
    declaredEncodingNormalized: enc,
    readmeMapped: true,
    readmeBomPresent: bomPresent,
    readmeNonEmptyLineCount: nonEmptyCount,
    readmeMetaFieldObservedCount: metaObserved,
  };
}

/**
 * Content-verify a synthetic/live text peek against SP08001 for a resolved table code.
 * CID/TABCD validated only when those columns exist in the table contract.
 * Emits closed TABLE_STATE — never raw headers or cell values.
 */
export function assessSp08001ContentContract(tableCode, peek, opts = {}) {
  const expectedCid = opts.expectedCid != null ? Number(opts.expectedCid) : 11;
  const expectedTabcd = opts.expectedTabcd != null ? Number(opts.expectedTabcd) : 25;
  const table = getSp08001Table(tableCode);
  const byteLength = opts.byteLength != null ? opts.byteLength : peek && peek.byteLength != null ? peek.byteLength : 0;
  if (!table) {
    return {
      tableCode: tableCode || null,
      headerContractMatch: false,
      contentVerified: false,
      evidenceLevel: "filename_hint",
      headerState: SP08001_HEADER_STATE.UNVERIFIED,
      cidMatch: false,
      tabcdMatch: false,
      delimiter: SP08001_DELIMITER,
      tableState: TABLE_STATE.missing_complete_header,
      filePresenceClass: FILE_PRESENCE_CLASS.MISSING_FILE,
      hasLimitedDataRow: false,
    };
  }
  const p = peek || {};
  if (byteLength === 0 || (Buffer.isBuffer(opts.buf) && opts.buf.length === 0)) {
    const state = deriveTableState({
      present: true,
      byteLength: 0,
      tableCode,
    });
    return {
      tableCode,
      headerContractMatch: false,
      contentVerified: false,
      evidenceLevel: "metadata_only",
      headerState: SP08001_HEADER_STATE.ABSENT,
      cidMatch: false,
      tabcdMatch: false,
      delimiter: SP08001_DELIMITER,
      tableState: state,
      filePresenceClass: FILE_PRESENCE_CLASS.ZERO_BYTE_FILE,
      hasLimitedDataRow: false,
      mismatchReason: "empty_header",
    };
  }
  if (!p.hasHeader || !Array.isArray(p.headerCodes) || p.headerCodes.length === 0) {
    const state = deriveTableState({
      present: true,
      byteLength: byteLength || 1,
      hasCompleteHeader: false,
      tableCode,
    });
    return {
      tableCode,
      headerContractMatch: false,
      contentVerified: false,
      evidenceLevel: p.positional ? "metadata_only" : "filename_hint",
      headerState: SP08001_HEADER_STATE.ABSENT,
      cidMatch: false,
      tabcdMatch: false,
      delimiter: p.delimiter === "semicolon" ? SP08001_DELIMITER : p.delimiter || "unknown",
      tableState: state,
      filePresenceClass: classifyDatFilePresence(opts.buf, p),
      hasLimitedDataRow: false,
      mismatchReason: "empty_header",
    };
  }
  const match = matchSp08001Header(tableCode, p.headerCodes, p.headerParseReason);
  const hasCidCol = table.headerCodes.includes("CID");
  const hasTabcdCol = table.headerCodes.includes("TABCD");
  let cidMatch = true;
  let tabcdMatch = true;
  if (hasCidCol) {
    cidMatch = p.cidValueSeen === expectedCid || p.cid11Seen === true;
  }
  if (hasTabcdCol) {
    tabcdMatch = p.tabcdValueSeen === expectedTabcd || p.tabcd25Seen === true;
  }
  const hasLimitedDataRow =
    (p.firstDataFieldCount || 0) > 0 || (p.dataRowCount || 0) > 0 || p.hasDataRow === true;
  const delimiterOk = p.delimiter === "semicolon" || p.delimiter === SP08001_DELIMITER || match.matched;
  const newlineOk =
    p.lineEnding == null ||
    p.lineEnding === "unknown" ||
    p.lineEnding === "crlf" ||
    p.lineEnding === "CRLF";
  let encodingOk = true;
  if (p.encodingCandidate === "UNKNOWN" && opts.requireEncoding === true) encodingOk = false;

  let tableState;
  if (!match.matched) {
    tableState = match.tableState || TABLE_STATE.field_order_mismatch;
  } else {
    tableState = deriveTableState({
      present: true,
      byteLength: byteLength || 1,
      hasCompleteHeader: true,
      headerMatched: true,
      delimiterOk,
      newlineOk,
      encodingOk,
      decodeOk: p.encodingCandidate !== "NON_UTF8" || opts.allowNonUtf8 === true,
      cidOk: !hasCidCol || cidMatch || !hasLimitedDataRow,
      tabcdOk: !hasTabcdCol || tabcdMatch || !hasLimitedDataRow,
      hasLimitedDataRow,
      tableCode,
    });
    // Header-only allowed empty: CID/TABCD not required in data rows.
    if (match.matched && !hasLimitedDataRow && isAllowedEmptyTable(tableCode)) {
      tableState = TABLE_STATE.schema_verified_empty;
    }
  }

  let contentVerified = tableState === TABLE_STATE.schema_and_limited_content_verified;
  let evidenceLevel = "metadata_only";
  if (contentVerified) evidenceLevel = "content_verified";
  else if (match.matched) evidenceLevel = "header_contract";

  return {
    tableCode,
    headerContractMatch: match.matched,
    contentVerified,
    evidenceLevel,
    headerState: match.headerState,
    cidMatch: hasCidCol ? cidMatch : false,
    tabcdMatch: hasTabcdCol ? tabcdMatch : false,
    delimiter: p.delimiter === "semicolon" || match.matched ? SP08001_DELIMITER : p.delimiter || "unknown",
    fieldCount: match.actualCount,
    expectedFieldCount: match.expectedCount,
    mismatchReason: match.reason,
    tableState,
    filePresenceClass: classifyDatFilePresence(opts.buf || Buffer.alloc(byteLength || 1), {
      ...p,
      hasHeader: match.matched || p.hasHeader,
    }),
    hasLimitedDataRow,
    exchangeFormatContractVersion: SP08001_EXCHANGE_FORMAT_VERSION,
    specId: SP08001_SPEC_ID,
  };
}

/**
 * Merge encoding candidates by layer — CONFLICT only within same authoritative layer.
 */
/**
 * Collapse soft DAT detections so ASCII_OR_UTF8 + UTF-8 do not become a false CONFLICT.
 * NON_UTF8 vs UTF-8 remains a real CONFLICT. CPG never enters this set.
 */
function collapseDatDetectedSet(set) {
  const vals = [...set];
  if (vals.length <= 1) return set;
  const hasUtf8 = vals.includes("UTF-8");
  const hasSoft = vals.includes("ASCII_OR_UTF8");
  const hasNon = vals.includes("NON_UTF8");
  const others = vals.filter((v) => v !== "UTF-8" && v !== "ASCII_OR_UTF8" && v !== "NON_UTF8");
  if (others.length) return set;
  if (hasNon && (hasUtf8 || hasSoft)) return new Set(["NON_UTF8", hasUtf8 ? "UTF-8" : "ASCII_OR_UTF8"]);
  if (hasUtf8 && hasSoft) return new Set(["UTF-8"]);
  return set;
}

export function resolveEncodingLayers(layers) {
  const byLayer = {
    [ENCODING_LAYER.DAT_DECLARED]: new Set(),
    [ENCODING_LAYER.DAT_DETECTED]: new Set(),
    [ENCODING_LAYER.README_DECLARED]: new Set(),
    [ENCODING_LAYER.CPG_SHP_DBF]: new Set(),
    [ENCODING_LAYER.OTHER]: new Set(),
  };
  for (const item of layers || []) {
    const layer = item.layer || ENCODING_LAYER.OTHER;
    // Companion .cpg must never enter DAT_* layers (SP08001 authoritativeLayer = TISA_DAT_CSV).
    if (layer === ENCODING_LAYER.CPG_SHP_DBF) {
      const enc = normalizeSp08001EncodingToken(item.encoding);
      if (enc && enc !== "UNKNOWN") byLayer[ENCODING_LAYER.CPG_SHP_DBF].add(enc);
      continue;
    }
    if (layer === ENCODING_LAYER.DAT_DETECTED || layer === ENCODING_LAYER.DAT_DECLARED || layer === ENCODING_LAYER.README_DECLARED) {
      const enc = normalizeSp08001EncodingToken(item.encoding);
      if (enc && enc !== "UNKNOWN") byLayer[layer].add(enc);
      continue;
    }
    const enc = normalizeSp08001EncodingToken(item.encoding);
    if (enc && enc !== "UNKNOWN") byLayer[ENCODING_LAYER.OTHER].add(enc);
  }
  byLayer[ENCODING_LAYER.DAT_DETECTED] = collapseDatDetectedSet(byLayer[ENCODING_LAYER.DAT_DETECTED]);

  const layerStatus = {};
  for (const [layer, set] of Object.entries(byLayer)) {
    const vals = [...set];
    if (vals.length === 0) layerStatus[layer] = "ABSENT";
    else if (vals.length === 1) layerStatus[layer] = vals[0];
    else layerStatus[layer] = "CONFLICT";
  }
  // Authoritative DAT encoding preference: DAT declared (from README characterEncoding)
  // then DAT detected. README_DECLARED describes README file charset (ASCII) — not DAT bytes.
  let datEncoding = "UNKNOWN";
  for (const key of [ENCODING_LAYER.DAT_DECLARED, ENCODING_LAYER.DAT_DETECTED]) {
    const v = layerStatus[key];
    if (v && v !== "ABSENT" && v !== "CONFLICT") {
      datEncoding = v;
      break;
    }
    if (v === "CONFLICT") {
      datEncoding = "CONFLICT";
      break;
    }
  }
  // ASCII_OR_UTF8 soft detection promotes to UTF-8 when declared/default says UTF-8
  if (datEncoding === "ASCII_OR_UTF8") {
    if (
      layerStatus[ENCODING_LAYER.DAT_DECLARED] === "UTF-8" ||
      SP08001_PHYSICAL.defaultEncoding === "UTF-8"
    ) {
      datEncoding = "UTF-8";
    } else {
      datEncoding = "UNVERIFIED";
    }
  }
  // If detect-layer CONFLICT but DAT_DECLARED is clear UTF-8, prefer declared (SP08001 README source).
  if (datEncoding === "CONFLICT" && layerStatus[ENCODING_LAYER.DAT_DECLARED] === "UTF-8") {
    datEncoding = "UTF-8";
  }
  // Prefer explicit source tags from layer items (readme_declared vs sp08001_default).
  // Never label a SP08001 default fallback as readme_declared.
  let declaredSourceTag = null;
  for (const item of layers || []) {
    if (item.layer !== ENCODING_LAYER.DAT_DECLARED) continue;
    if (item.source === "readme_declared" || item.source === "sp08001_default") {
      declaredSourceTag = item.source;
      break;
    }
  }
  const datEncodingSource =
    declaredSourceTag === "readme_declared"
      ? "readme_declared"
      : declaredSourceTag === "sp08001_default"
        ? "sp08001_default"
        : layerStatus[ENCODING_LAYER.DAT_DECLARED] &&
            layerStatus[ENCODING_LAYER.DAT_DECLARED] !== "ABSENT" &&
            layerStatus[ENCODING_LAYER.DAT_DECLARED] !== "CONFLICT"
          ? "readme_declared"
          : datEncoding !== "UNKNOWN" && datEncoding !== "CONFLICT" && datEncoding !== "UNVERIFIED"
            ? "sp08001_default"
            : "unresolved";
  return {
    datEncoding,
    datEncodingSource,
    cpgEncoding: layerStatus[ENCODING_LAYER.CPG_SHP_DBF],
    layerStatus,
    companionEncodingIgnoredForDatCount:
      layerStatus[ENCODING_LAYER.CPG_SHP_DBF] !== "ABSENT" ? 1 : 0,
    falseConflictAvoided:
      layerStatus[ENCODING_LAYER.CPG_SHP_DBF] !== "ABSENT" &&
      datEncoding !== "CONFLICT" &&
      layerStatus[ENCODING_LAYER.CPG_SHP_DBF] !== datEncoding,
  };
}

export function classifyBasenameToSp08001OrRole(entryPath) {
  const base = String(entryPath || "").split(/[/\\]/).pop() || "";
  const code = resolveSp08001TableCodeFromBasename(base);
  return { tableCode: code, basenameKind: code ? "sp08001_standard" : "non_standard_or_unknown" };
}

export function listRequiredSp08001Header(tableCode) {
  const t = getSp08001Table(tableCode);
  return t ? t.headerCodes.slice() : [];
}

/** Build a synthetic SP08001 .DAT buffer (CRLF, semicolon, exact header). Values must be fictional. */
export function buildSyntheticSp08001Dat(tableCode, dataRows, opts = {}) {
  const header = listRequiredSp08001Header(tableCode);
  if (!header.length) throw new Error("unknown_table");
  const nl = opts.newline === "lf" ? "\n" : "\r\n";
  const lines = [header.join(";")];
  for (const row of dataRows || []) {
    if (!Array.isArray(row) || row.length !== header.length) {
      throw new Error("row_width");
    }
    lines.push(
      row
        .map((cell) => {
          const s = cell == null ? "" : String(cell);
          if (s.includes(";") || s.includes('"') || s.includes("\n")) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(";")
    );
  }
  let body = lines.join(nl) + (opts.trailingNewline === false ? "" : nl);
  if (opts.bom === true) body = "\uFEFF" + body;
  return Buffer.from(body, "utf8");
}

/** Minimal fictional POINTS row matching SP08001 column order (no real Czech LCD/coords). */
export function syntheticPointsRow(overrides = {}) {
  const base = {
    CID: "11",
    TABCD: "25",
    LCD: "10001",
    CLASS: "P",
    TCD: "1",
    STCD: "0",
    JUNCTIONNUMBER: "",
    RNID: "1",
    N1ID: "1",
    N2ID: "",
    POL_LCD: "",
    OTH_LCD: "",
    SEG_LCD: "",
    ROA_LCD: "",
    INPOS: "0",
    INNEG: "0",
    OUTPOS: "0",
    OUTNEG: "0",
    PRESENTPOS: "0",
    PRESENTNEG: "0",
    DIVERSIONPOS: "",
    DIVERSIONNEG: "",
    XCOORD: "+09999999",
    YCOORD: "+9999999",
    INTERRUPTSROAD: "0",
    URBAN: "0",
    JNID: "",
  };
  Object.assign(base, overrides);
  return listRequiredSp08001Header("POINTS").map((c) => base[c] ?? "");
}

/**
 * Minimal fictional row for any SP08001 table (synthetic only).
 * Fills CID=11 / TABCD=25 where those columns exist; other required cells get safe placeholders.
 */
export function syntheticSp08001Row(tableCode, overrides = {}) {
  const table = getSp08001Table(tableCode);
  const header = listRequiredSp08001Header(tableCode);
  if (!header.length || !table) throw new Error("unknown_table");
  const base = Object.create(null);
  for (const col of table.columns) {
    const c = col.code;
    if (c === "CID") base[c] = "11";
    else if (c === "TABCD" || c === "INT_TABCD") base[c] = "25";
    else if (c === "CLASS") base[c] = "P";
    else if (c === "XCOORD") base[c] = "+09999999";
    else if (c === "YCOORD") base[c] = "+9999999";
    else if (
      c === "NAME" ||
      c === "CNAME" ||
      c === "DCOMMENT" ||
      c === "VERSIONDESCRIPTION" ||
      c === "NCOMMENT" ||
      c === "NTRANSLATION" ||
      c === "LANGUAGE" ||
      c === "TDESC" ||
      c === "PES_LEV_DESC"
    )
      base[c] = "X";
    else if (c === "VERSION") base[c] = "11";
    else if (c === "REPRESENTATION" || c === "OFFICIALNAME") base[c] = "";
    else if (c === "ECC") base[c] = "E";
    else if (c === "CCD") base[c] = "C";
    else if (c === "PES_LEV") base[c] = "";
    else if (/^NUMERIC/i.test(col.type)) {
      // Stay within documented digit width when present
      const m = /^NUMERIC\((\d+)\)$/i.exec(col.type);
      const width = m ? Number(m[1]) : 5;
      base[c] = "1".padStart(Math.min(width, 5), "0").slice(-Math.min(width, 5)) || "1";
      if (width === 1) base[c] = "1";
      else base[c] = "1";
    } else if (/^CHAR\((\d+)\)$/i.test(col.type)) {
      const width = Number(RegExp.$1);
      base[c] = col.optional ? "" : "X".slice(0, Math.max(1, width));
    } else {
      base[c] = col.optional ? "" : "1";
    }
  }
  Object.assign(base, overrides);
  return header.map((c) => base[c] ?? "");
}

export function sp08001PhysicalContract() {
  return {
    delimiter: SP08001_PHYSICAL.delimiter,
    quoting: SP08001_PHYSICAL.quoting,
    emptyField: SP08001_PHYSICAL.emptyField,
    headerRequired: SP08001_PHYSICAL.headerRequired,
    newline: SP08001_PHYSICAL.newline,
    defaultEncoding: SP08001_PHYSICAL.defaultEncoding,
    bomRule: SP08001_PHYSICAL.bomRule,
    authoritativeLayer: SP08001_PHYSICAL.authoritativeLayer,
    exchangeFormatContractVersion: SP08001_EXCHANGE_FORMAT_VERSION,
    tableContractCount: Object.keys(SP08001_TABLES).length,
  };
}
