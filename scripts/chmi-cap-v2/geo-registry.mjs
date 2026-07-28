/**
 * Central territorial registry loader (ORP → okres → kraj).
 * Primary data: scripts/chmi-cap-v2/data/geo-registry.json (ČSÚ CISORP + ČÚZK hierarchy).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, "data", "geo-registry.json");

let _cached = null;

export function loadGeoRegistryData() {
  if (_cached) return _cached;
  const raw = fs.readFileSync(DATA_PATH, "utf8");
  _cached = JSON.parse(raw);
  return _cached;
}

export function createGeoRegistry(extraUnits = []) {
  const data = loadGeoRegistryData();
  const units = (data.units || []).concat(extraUnits);
  const aliases = { ...(data.aliases || {}) };
  const byId = new Map(units.map((u) => [u.id, u]));
  const byTypeCode = new Map(units.map((u) => [`${u.type}:${u.code}`, u]));

  function resolveCode(type, code) {
    const c = String(code || "").trim();
    if (type === "orp" && aliases[c]) return aliases[c];
    return c;
  }

  return {
    version: data.version,
    source: data.source,
    aliases,
    units,
    byId,
    byTypeCode,
    counts: data.counts,
    get(type, code) {
      const resolved = resolveCode(type, code);
      return byTypeCode.get(`${type}:${resolved}`) || null;
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
          krajName: kraj ? kraj.name : orp.krajNameHint || null,
          assignmentSource: "cisorp",
          precise: true,
        });
      }
    }
  }

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

export const GEO_REGISTRY_VERSION = (() => {
  try {
    return loadGeoRegistryData().version;
  } catch {
    return "unbuilt";
  }
})();
