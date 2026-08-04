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
 */
export function matchSp08001Header(tableCode, headerCodes) {
  const table = getSp08001Table(tableCode);
  if (!table) {
    return {
      matched: false,
      headerState: SP08001_HEADER_STATE.PRESENT_MISMATCH,
      reason: "unknown_table",
      expectedCount: 0,
      actualCount: (headerCodes || []).length,
    };
  }
  const expected = table.headerCodes;
  const actual = (headerCodes || []).map((c) => String(c).toUpperCase());
  if (actual.length !== expected.length) {
    return {
      matched: false,
      headerState: SP08001_HEADER_STATE.PRESENT_MISMATCH,
      reason: "field_count",
      expectedCount: expected.length,
      actualCount: actual.length,
    };
  }
  for (let i = 0; i < expected.length; i++) {
    if (actual[i] !== expected[i]) {
      return {
        matched: false,
        headerState: SP08001_HEADER_STATE.PRESENT_MISMATCH,
        reason: "column_order_or_code",
        expectedCount: expected.length,
        actualCount: actual.length,
        mismatchIndex: i,
      };
    }
  }
  return {
    matched: true,
    headerState: SP08001_HEADER_STATE.PRESENT_MATCH,
    reason: null,
    expectedCount: expected.length,
    actualCount: actual.length,
  };
}

/**
 * Content-verify a synthetic/live text peek against SP08001 for a resolved table code.
 * CID/TABCD validated only when those columns exist in the table contract.
 */
export function assessSp08001ContentContract(tableCode, peek, opts = {}) {
  const expectedCid = opts.expectedCid != null ? Number(opts.expectedCid) : 11;
  const expectedTabcd = opts.expectedTabcd != null ? Number(opts.expectedTabcd) : 25;
  const table = getSp08001Table(tableCode);
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
    };
  }
  const p = peek || {};
  if (!p.hasHeader || !Array.isArray(p.headerCodes) || p.headerCodes.length === 0) {
    return {
      tableCode,
      headerContractMatch: false,
      contentVerified: false,
      evidenceLevel: p.positional ? "metadata_only" : "filename_hint",
      headerState: SP08001_HEADER_STATE.ABSENT,
      cidMatch: false,
      tabcdMatch: false,
      delimiter: p.delimiter === "semicolon" ? SP08001_DELIMITER : p.delimiter || "unknown",
    };
  }
  const match = matchSp08001Header(tableCode, p.headerCodes);
  const hasCidCol = table.headerCodes.includes("CID");
  const hasTabcdCol = table.headerCodes.includes("TABCD");
  let cidMatch = false;
  let tabcdMatch = false;
  if (hasCidCol) {
    cidMatch = p.cidValueSeen === expectedCid || p.cid11Seen === true;
  }
  if (hasTabcdCol) {
    tabcdMatch = p.tabcdValueSeen === expectedTabcd || p.tabcd25Seen === true;
  }
  let contentVerified = false;
  if (match.matched) {
    if (hasCidCol || hasTabcdCol) {
      contentVerified = (!hasCidCol || cidMatch) && (!hasTabcdCol || tabcdMatch);
    } else {
      contentVerified = true;
    }
  }
  let evidenceLevel = "metadata_only";
  if (contentVerified) evidenceLevel = "content_verified";
  else if (match.matched) evidenceLevel = "header_contract";
  return {
    tableCode,
    headerContractMatch: match.matched,
    contentVerified,
    evidenceLevel,
    headerState: match.headerState,
    cidMatch,
    tabcdMatch,
    delimiter: p.delimiter === "semicolon" || match.matched ? SP08001_DELIMITER : p.delimiter || "unknown",
    fieldCount: match.actualCount,
    expectedFieldCount: match.expectedCount,
    mismatchReason: match.reason,
    exchangeFormatContractVersion: SP08001_EXCHANGE_FORMAT_VERSION,
    specId: SP08001_SPEC_ID,
  };
}

/**
 * Merge encoding candidates by layer — CONFLICT only within same authoritative layer.
 */
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
    const enc = normalizeSp08001EncodingToken(item.encoding);
    if (!byLayer[layer]) byLayer[layer] = new Set();
    if (enc && enc !== "UNKNOWN") byLayer[layer].add(enc);
  }
  const layerStatus = {};
  for (const [layer, set] of Object.entries(byLayer)) {
    const vals = [...set];
    if (vals.length === 0) layerStatus[layer] = "ABSENT";
    else if (vals.length === 1) layerStatus[layer] = vals[0];
    else layerStatus[layer] = "CONFLICT";
  }
  // Authoritative DAT encoding preference: README declared > DAT declared > DAT detected
  let datEncoding = "UNKNOWN";
  for (const key of [
    ENCODING_LAYER.README_DECLARED,
    ENCODING_LAYER.DAT_DECLARED,
    ENCODING_LAYER.DAT_DETECTED,
  ]) {
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
  // ASCII_OR_UTF8 soft detection promotes to UTF-8 only when README/default says UTF-8
  if (datEncoding === "ASCII_OR_UTF8") {
    if (layerStatus[ENCODING_LAYER.README_DECLARED] === "UTF-8" || SP08001_PHYSICAL.defaultEncoding === "UTF-8") {
      datEncoding = "UTF-8";
    } else {
      datEncoding = "UNVERIFIED";
    }
  }
  return {
    datEncoding,
    cpgEncoding: layerStatus[ENCODING_LAYER.CPG_SHP_DBF],
    layerStatus,
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
    LCD: "900001",
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
