/**
 * Versioned DATEX II situationRecord type → InfoUzel traffic category mapping.
 * Unknown types get a safe generic fallback (never invented facts).
 */

export const CATEGORY_MAP_VERSION = "ndic-cat-v1";

/** @type {Record<string, { category: string, labelCs: string, importance: number }>} */
const KNOWN = Object.freeze({
  Accident: { category: "nehoda", labelCs: "Dopravní nehoda", importance: 4 },
  VehicleObstruction: { category: "prekazka", labelCs: "Překážka provozu", importance: 3 },
  Obstruction: { category: "prekazka", labelCs: "Překážka provozu", importance: 3 },
  RoadOrCarriagewayOrLaneManagement: {
    category: "omezeni",
    labelCs: "Dopravní omezení",
    importance: 3,
  },
  GeneralNetworkManagement: { category: "omezeni", labelCs: "Dopravní omezení", importance: 3 },
  ReroutingManagement: { category: "objizdka", labelCs: "Objížďka", importance: 3 },
  SpeedManagement: { category: "omezeni", labelCs: "Omezení rychlosti", importance: 2 },
  Roadworks: { category: "prace", labelCs: "Práce na silnici", importance: 3 },
  MaintenanceWorks: { category: "prace", labelCs: "Údržba komunikace", importance: 3 },
  ConstructionWorks: { category: "prace", labelCs: "Stavební práce", importance: 3 },
  AbnormalTraffic: { category: "kolona", labelCs: "Kolona", importance: 3 },
  TrafficConcentration: { category: "kolona", labelCs: "Hustý provoz", importance: 2 },
  PoorEnvironmentConditions: {
    category: "sjizdnost",
    labelCs: "Nepříznivé podmínky",
    importance: 3,
  },
  WeatherRelatedRoadConditions: {
    category: "sjizdnost",
    labelCs: "Stav vozovky",
    importance: 3,
  },
  NonWeatherRelatedRoadConditions: {
    category: "sjizdnost",
    labelCs: "Stav vozovky",
    importance: 3,
  },
  Conditions: { category: "sjizdnost", labelCs: "Podmínky provozu", importance: 2 },
  AnimalPresenceObstruction: { category: "prekazka", labelCs: "Zvíře na silnici", importance: 3 },
  InfrastructureDamageObstruction: {
    category: "prekazka",
    labelCs: "Poškození infrastruktury",
    importance: 4,
  },
  GeneralObstruction: { category: "prekazka", labelCs: "Překážka provozu", importance: 3 },
  Activity: { category: "omezeni", labelCs: "Dopravní omezení", importance: 2 },
  AuthorityOperation: { category: "omezeni", labelCs: "Zásah složek", importance: 3 },
  PublicEvent: { category: "omezeni", labelCs: "Veřejná akce", importance: 2 },
  DisturbanceActivity: { category: "omezeni", labelCs: "Mimořádná událost", importance: 3 },
  SituationRecord: { category: "doprava", labelCs: "Dopravní informace", importance: 2 },
  GenericSituationRecord: { category: "doprava", labelCs: "Dopravní informace", importance: 2 },
});

/**
 * @param {string} recordType
 * @returns {{ category: string, labelCs: string, importance: number, known: boolean, mapVersion: string }}
 */
export function mapSituationRecordType(recordType) {
  const t = String(recordType || "").trim();
  const hit = KNOWN[t];
  if (hit) {
    return { ...hit, known: true, mapVersion: CATEGORY_MAP_VERSION, sourceType: t };
  }
  // Soft match without namespace / case noise
  const key = Object.keys(KNOWN).find((k) => k.toLowerCase() === t.toLowerCase());
  if (key) {
    return { ...KNOWN[key], known: true, mapVersion: CATEGORY_MAP_VERSION, sourceType: t || key };
  }
  return {
    category: "doprava",
    labelCs: "Dopravní informace",
    importance: 2,
    known: false,
    mapVersion: CATEGORY_MAP_VERSION,
    sourceType: t || "unknown",
  };
}

export function knownCategoryTypes() {
  return Object.keys(KNOWN);
}
