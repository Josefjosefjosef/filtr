/**
 * Private in-memory TMC resolution snapshot for DATEX→TMC resolver.
 * Synthetic fixtures only — never persists licensed raw DAT rows to public index.
 */
import crypto from "node:crypto";
import { NDIC_DATEX_ALERTC_CONTRACT } from "./datex-tmc-resolver-constants.mjs";

export const SNAPSHOT_SCHEMA = "tmc-resolution-snapshot-v1";

/**
 * @param {{
 *   importRunId?: string,
 *   points?: object[],
 *   roads?: object[],
 *   activatedAt?: string,
 *   languagesExtensionFieldPresent?: boolean,
 * }} opts
 */
export function buildSyntheticResolutionSnapshot(opts = {}) {
  const importRunId = opts.importRunId || crypto.randomBytes(8).toString("hex");
  const pointsByLcd = new Map();
  const lcdHitCounts = new Map();
  const roadsByLcd = new Map();

  for (const p of opts.points || []) {
    const lcd = String(p.lcd);
    lcdHitCounts.set(lcd, (lcdHitCounts.get(lcd) || 0) + 1);
    pointsByLcd.set(lcd, Object.freeze({
      lcd,
      locationType: p.locationType || "P",
      locationSubtype: p.locationSubtype || "0",
      roadCode: p.roadCode != null ? String(p.roadCode) : null,
      roadNumber: p.roadNumber != null ? String(p.roadNumber) : null,
      roadName: p.roadName != null ? String(p.roadName) : null,
      administrativeArea: p.administrativeArea != null ? String(p.administrativeArea) : null,
      lat: p.lat != null ? p.lat : null,
      lon: p.lon != null ? p.lon : null,
      segLcd: p.segLcd != null ? String(p.segLcd) : null,
      roaLcd: p.roaLcd != null ? String(p.roaLcd) : null,
      polLcd: p.polLcd != null ? String(p.polLcd) : null,
      parentLcd: p.parentLcd != null ? String(p.parentLcd) : null,
      nextLcd: p.nextLcd != null ? String(p.nextLcd) : null,
      prevLcd: p.prevLcd != null ? String(p.prevLcd) : null,
      relationshipValid: p.relationshipValid !== false,
    }));
  }

  for (const r of opts.roads || []) {
    roadsByLcd.set(String(r.lcd), Object.freeze({
      lcd: String(r.lcd),
      roadNumber: r.roadNumber != null ? String(r.roadNumber) : null,
      roadName: r.roadName != null ? String(r.roadName) : null,
      roadClass: r.roadClass != null ? String(r.roadClass) : null,
      pesLev: r.pesLev == null || r.pesLev === "" ? null : String(r.pesLev),
    }));
  }

  const ambiguousLcds = new Set();
  for (const [lcd, n] of lcdHitCounts) {
    if (n > 1) ambiguousLcds.add(lcd);
  }

  return Object.freeze({
    schema: SNAPSHOT_SCHEMA,
    importRunId,
    cid: NDIC_DATEX_ALERTC_CONTRACT.tisaCid,
    tabcd: NDIC_DATEX_ALERTC_CONTRACT.tabcd,
    tableVersion: NDIC_DATEX_ALERTC_CONTRACT.tableVersion,
    activatedAt: opts.activatedAt || new Date().toISOString(),
    languagesExtensionFieldPresent: opts.languagesExtensionFieldPresent === true,
    languagesExtensionFieldSupported: false,
    featureFlags: Object.freeze({
      RNLT_ADVANCED_RELATIONSHIPS_ENABLED: false,
      PES_LEV_RELATIONSHIP_RESOLUTION_ENABLED: false,
      LANGUAGES_FIFTH_FIELD_USED: false,
    }),
    pointsByLcd,
    roadsByLcd,
    ambiguousLcds,
    pointCount: pointsByLcd.size,
    roadCount: roadsByLcd.size,
  });
}

/** Default synthetic Czech-like table using fictional LCDs only (NUMERIC(5)). */
export function defaultSyntheticSnapshot(overrides = {}) {
  const points = overrides.points || [
    {
      lcd: "10001",
      locationType: "P",
      locationSubtype: "1",
      roadCode: "80001",
      roadNumber: "D0",
      roadName: "SYN_ROAD_A",
      administrativeArea: "SYN_AREA_1",
      lat: 50.1,
      lon: 14.4,
      nextLcd: "10002",
      prevLcd: null,
    },
    {
      lcd: "10002",
      locationType: "P",
      locationSubtype: "1",
      roadCode: "80001",
      roadNumber: "D0",
      roadName: "SYN_ROAD_A",
      administrativeArea: "SYN_AREA_1",
      lat: 50.11,
      lon: 14.41,
      nextLcd: null,
      prevLcd: "10001",
    },
    {
      lcd: "10003",
      locationType: "P",
      locationSubtype: "1",
      roadCode: "80002",
      roadNumber: "I/1",
      roadName: "SYN_ROAD_B",
      administrativeArea: "SYN_AREA_2",
      lat: 49.2,
      lon: 16.6,
    },
  ];
  const roads = overrides.roads || [
    { lcd: "80001", roadNumber: "D0", roadName: "SYN_ROAD_A", roadClass: "L", pesLev: null },
    { lcd: "80002", roadNumber: "I/1", roadName: "SYN_ROAD_B", roadClass: "L", pesLev: null },
  ];
  return buildSyntheticResolutionSnapshot({
    importRunId: overrides.importRunId,
    activatedAt: overrides.activatedAt,
    points,
    roads,
    languagesExtensionFieldPresent: overrides.languagesExtensionFieldPresent,
  });
}

export function snapshotLookupPoint(snapshot, lcdStr) {
  if (!snapshot || !snapshot.pointsByLcd) return null;
  return snapshot.pointsByLcd.get(String(lcdStr)) || null;
}

export function snapshotIsAmbiguous(snapshot, lcdStr) {
  return snapshot && snapshot.ambiguousLcds && snapshot.ambiguousLcds.has(String(lcdStr));
}
