/**
 * Bridge SP08001 basic-import accepted rows → internal tmc-table for localizeFromTmc.
 * Coordinates: TISA SP08001 XCOORD/YCOORD as signed integers in 10^-5 degrees (X=lon, Y=lat).
 * No fuzzy matching, geocoding, or heuristics.
 */
import { TMC_COUNTRY_CODE, TMC_LOCATION_TABLE_NUMBER } from "./config.mjs";
import { parseTmcTablePayload } from "./tmc-table.mjs";

/**
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseSp08001Coordinate(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  if (!/^[+-]?\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n / 100000;
}

/**
 * @param {{
 *   points?: object[],
 *   roads?: object[],
 *   names?: object[],
 *   tableVersion?: string|number,
 *   countryCode?: number,
 *   tableNumber?: number,
 * }} input
 */
export function buildTmcResolverTableFromSp08001Accepted(input = {}) {
  const namesById = Object.create(null);
  for (const row of input.names || []) {
    if (!row || row.NID == null) continue;
    const name = String(row.NAME || "").trim();
    if (!name) continue;
    namesById[String(row.NID)] = name.slice(0, 200);
  }

  const roadsByLcd = Object.create(null);
  for (const row of input.roads || []) {
    if (!row || row.LCD == null) continue;
    const rnid = row.RNID != null && String(row.RNID).trim() !== "" ? String(row.RNID) : null;
    roadsByLcd[String(row.LCD)] = {
      roadNumber: row.ROADNUMBER ? String(row.ROADNUMBER).slice(0, 40) : null,
      roadName: rnid && namesById[rnid] ? namesById[rnid] : null,
    };
  }

  const points = Object.create(null);
  for (const row of input.points || []) {
    if (!row || row.LCD == null) continue;
    const lcd = Number(row.LCD);
    if (!Number.isFinite(lcd)) continue;
    const lon = parseSp08001Coordinate(row.XCOORD);
    const lat = parseSp08001Coordinate(row.YCOORD);
    const road = row.ROA_LCD != null ? roadsByLcd[String(row.ROA_LCD)] : null;
    const n1 = row.N1ID != null && String(row.N1ID).trim() !== "" ? namesById[String(row.N1ID)] : null;
    const n2 = row.N2ID != null && String(row.N2ID).trim() !== "" ? namesById[String(row.N2ID)] : null;
    const rn = row.RNID != null && String(row.RNID).trim() !== "" ? namesById[String(row.RNID)] : null;
    const name = n1 || n2 || rn || "";
    /** @type {Record<string, unknown>} */
    const pt = { lcd };
    if (name) pt.name = name;
    if (road && road.roadNumber) pt.roadNumber = road.roadNumber;
    if (road && road.roadName) pt.roadName = road.roadName;
    if (lat != null) pt.lat = lat;
    if (lon != null) pt.lon = lon;
    points[String(lcd)] = pt;
  }

  if (!Object.keys(points).length) {
    throw Object.assign(new Error("tmc_resolver_table_empty"), { code: "TMC_RESOLVER_TABLE_EMPTY" });
  }

  /** Forensic-only LCD class side-index (P/L/A). Never used by lookupTmcPoint. */
  const forensicLcdClass = Object.create(null);
  for (const row of input.segments || []) {
    if (!row || row.LCD == null) continue;
    forensicLcdClass[String(row.LCD)] = "L";
  }
  for (const row of input.areas || []) {
    if (!row || row.LCD == null) continue;
    forensicLcdClass[String(row.LCD)] = "A";
  }
  for (const row of input.adminAreas || []) {
    if (!row || row.LCD == null) continue;
    forensicLcdClass[String(row.LCD)] = "A";
  }
  for (const row of input.points || []) {
    if (!row || row.LCD == null) continue;
    forensicLcdClass[String(row.LCD)] = "P";
  }

  const table = parseTmcTablePayload({
    version: String(input.tableVersion != null ? input.tableVersion : "unknown"),
    countryCode: input.countryCode != null ? Number(input.countryCode) : TMC_COUNTRY_CODE,
    tableNumber: input.tableNumber != null ? Number(input.tableNumber) : TMC_LOCATION_TABLE_NUMBER,
    points,
  });
  table.forensicLcdClass = forensicLcdClass;
  return table;
}
