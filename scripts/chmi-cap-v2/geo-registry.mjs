/**
 * Central territorial registry (ORP → okres → kraj).
 * Seed covers fixture CISORP codes; full CISORP import is versioned separately.
 *
 * Geocode shape verified against CHMI CAP docs + fixtures:
 *   <geocode><valueName>CISORP</valueName><value>####</value></geocode>
 */
export const GEO_REGISTRY_VERSION = "2026.07.29-seed-v1";
export const GEO_REGISTRY_SOURCE = "seed:CISORP-subset+CZ-NUTS3-okres-hierarchy";

function fold(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** @typedef {{ id: string, code: string, name: string, nameNorm: string, type: 'orp'|'okres'|'kraj', parentId: string|null, validFrom: string, validTo: string|null, registryVersion: string, source: string, updatedAt: string }} GeoUnit */

const UPDATED = "2026-07-29T00:00:00Z";

/** @type {GeoUnit[]} */
const UNITS = [
  // kraje (use NUTS-like stable codes K01..)
  { id: "kraj:CZ010", code: "CZ010", name: "Hlavní město Praha", nameNorm: fold("Hlavní město Praha"), type: "kraj", parentId: null, validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "kraj:CZ020", code: "CZ020", name: "Středočeský kraj", nameNorm: fold("Středočeský kraj"), type: "kraj", parentId: null, validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "kraj:CZ064", code: "CZ064", name: "Jihomoravský kraj", nameNorm: fold("Jihomoravský kraj"), type: "kraj", parentId: null, validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "kraj:CZ080", code: "CZ080", name: "Moravskoslezský kraj", nameNorm: fold("Moravskoslezský kraj"), type: "kraj", parentId: null, validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "kraj:CZ032", code: "CZ032", name: "Plzeňský kraj", nameNorm: fold("Plzeňský kraj"), type: "kraj", parentId: null, validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },

  // okresy
  { id: "okres:CZ0100", code: "CZ0100", name: "Praha", nameNorm: fold("Praha"), type: "okres", parentId: "kraj:CZ010", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "okres:CZ0201", code: "CZ0201", name: "Benešov", nameNorm: fold("Benešov"), type: "okres", parentId: "kraj:CZ020", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "okres:CZ0642", code: "CZ0642", name: "Brno-město", nameNorm: fold("Brno-město"), type: "okres", parentId: "kraj:CZ064", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "okres:CZ0643", code: "CZ0643", name: "Brno-venkov", nameNorm: fold("Brno-venkov"), type: "okres", parentId: "kraj:CZ064", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "okres:CZ0806", code: "CZ0806", name: "Ostrava-město", nameNorm: fold("Ostrava-město"), type: "okres", parentId: "kraj:CZ080", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "okres:CZ0323", code: "CZ0323", name: "Plzeň-město", nameNorm: fold("Plzeň-město"), type: "okres", parentId: "kraj:CZ032", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },

  // ORP — CISORP-style 4-digit codes used in fixtures (subset for tests)
  { id: "orp:1100", code: "1100", name: "Praha", nameNorm: fold("Praha"), type: "orp", parentId: "okres:CZ0100", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "orp:2101", code: "2101", name: "Benešov", nameNorm: fold("Benešov"), type: "orp", parentId: "okres:CZ0201", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "orp:6201", code: "6201", name: "Brno", nameNorm: fold("Brno"), type: "orp", parentId: "okres:CZ0642", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "orp:6211", code: "6211", name: "Šlapanice", nameNorm: fold("Šlapanice"), type: "orp", parentId: "okres:CZ0643", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "orp:6213", code: "6213", name: "Židlochovice", nameNorm: fold("Židlochovice"), type: "orp", parentId: "okres:CZ0643", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "orp:8101", code: "8101", name: "Ostrava", nameNorm: fold("Ostrava"), type: "orp", parentId: "okres:CZ0806", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
  { id: "orp:3201", code: "3201", name: "Plzeň", nameNorm: fold("Plzeň"), type: "orp", parentId: "okres:CZ0323", validFrom: "2000-01-01", validTo: null, registryVersion: GEO_REGISTRY_VERSION, source: GEO_REGISTRY_SOURCE, updatedAt: UPDATED },
];

export function createGeoRegistry(extraUnits = []) {
  const units = UNITS.concat(extraUnits);
  const byId = new Map(units.map((u) => [u.id, u]));
  const byTypeCode = new Map(units.map((u) => [`${u.type}:${u.code}`, u]));
  return {
    version: GEO_REGISTRY_VERSION,
    source: GEO_REGISTRY_SOURCE,
    units,
    byId,
    byTypeCode,
    get(type, code) {
      return byTypeCode.get(`${type}:${code}`) || null;
    },
    getById(id) {
      return byId.get(id) || null;
    },
    ancestors(id) {
      const chain = [];
      let cur = byId.get(id);
      while (cur) {
        chain.push(cur);
        cur = cur.parentId ? byId.get(cur.parentId) : null;
      }
      return chain;
    },
  };
}

/**
 * Map hazard areas → geo links + quarantine unknown CISORP.
 */
export function mapHazardGeography(hazard, registry) {
  const links = [];
  const quarantine = [];
  const displayNames = [];
  let hasOfficialGeocode = false;

  for (const area of hazard.areas || []) {
    if (area.areaDesc) displayNames.push(area.areaDesc);
    for (const g of area.geocodes || []) {
      const vn = String(g.valueName || "");
      const code = String(g.value || "").trim();
      if (!code) continue;
      if (/^CISORP$/i.test(vn) || /^ORP$/i.test(vn)) {
        hasOfficialGeocode = true;
        const orp = registry.get("orp", code);
        if (!orp) {
          quarantine.push({
            code,
            valueName: vn,
            hazard_instance_id: hazard.hazard_instance_id,
            reason: "unknown_cisorp",
            areaDesc: area.areaDesc || "",
          });
          continue;
        }
        const chain = registry.ancestors(orp.id);
        const okres = chain.find((x) => x.type === "okres") || null;
        const kraj = chain.find((x) => x.type === "kraj") || null;
        links.push({
          hazard_instance_id: hazard.hazard_instance_id,
          orpId: orp.id,
          orpCode: orp.code,
          orpName: orp.name,
          okresId: okres ? okres.id : null,
          okresName: okres ? okres.name : null,
          krajId: kraj ? kraj.id : null,
          krajName: kraj ? kraj.name : null,
          assignmentSource: "cisorp",
          precise: true,
        });
      }
    }
  }

  // Never invent kraj-wide coverage from areaDesc alone
  const uniqueKraje = [...new Set(links.map((l) => l.krajId).filter(Boolean))];
  const wholeKrajClaim = !hasOfficialGeocode && displayNames.some((d) => /kraj/i.test(d));

  return {
    links,
    quarantine,
    displayNames,
    hasOfficialGeocode,
    uniqueKraje,
    wholeKrajFromDescOnly: wholeKrajClaim,
    localizationLevel: links.length ? "orp" : displayNames.length ? "display_only" : "unknown",
  };
}
