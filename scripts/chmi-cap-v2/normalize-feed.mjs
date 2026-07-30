/**
 * Normalize CAP v2 hazards → info-events compatible feed items.
 */
import path from "path";
import { fileURLToPath } from "url";
import { CHMI_ATTRIBUTION, CHMI_PUBLIC_ALERTS_URL } from "./config.mjs";
import { foldCs, makeGroupKey } from "../iu-info-events-lib.mjs";
import {
  attachLegalProvenance,
  canPublishFromSource,
  loadLegalRegistry,
  loadSourceRegistry,
} from "../iu-info-events-legal-registry-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(__dirname, "../..");

function importanceFromSeverity(sev) {
  const s = String(sev || "");
  if (/^Extreme$/i.test(s)) return 5;
  if (/^Severe$/i.test(s)) return 4;
  if (/^Moderate$/i.test(s)) return 3;
  if (/^Minor$/i.test(s)) return 2;
  return 1;
}

/**
 * User-facing locality summary — never pretend a multi-ORP alert is a single town.
 * @param {{ orpName?: string, krajName?: string }[]} links
 * @param {string[]} displayNames
 */
export function summarizeAlertLocality(links, displayNames = []) {
  const list = Array.isArray(links) ? links.filter(Boolean) : [];
  if (!list.length) {
    const d0 = String((displayNames && displayNames[0]) || "").split("(")[0].trim();
    return {
      name: d0 || "Česká republika",
      level: d0 ? "display_only" : "cr",
      summary: d0 || "Česká republika",
      extraAreaCount: 0,
    };
  }
  if (list.length === 1) {
    const only = list[0];
    return {
      name: only.orpName || "ORP",
      level: "orp",
      summary: only.orpName || "ORP",
      extraAreaCount: 0,
    };
  }
  const kraje = [...new Set(list.map((l) => l.krajName).filter(Boolean))];
  if (kraje.length === 1) {
    return {
      name: kraje[0],
      level: "kraj",
      summary: `${kraje[0]} (${list.length} ORP)`,
      extraAreaCount: list.length - 1,
    };
  }
  const primary = list[0].orpName || "oblast";
  return {
    name: primary,
    level: "multi",
    summary: `${primary} a dalších ${list.length - 1} oblastí`,
    extraAreaCount: list.length - 1,
  };
}

function activeFromRevision(revision, nowMs = Date.now()) {
  if (/^Cancel$/i.test(revision.msgType)) return false;
  if (!/^Actual$/i.test(String(revision.status || "Actual"))) return false;
  for (const h of revision.hazards || []) {
    const exp = Date.parse(h.valid_to || "") || 0;
    if (!exp || exp > nowMs) return true;
  }
  return false;
}

function attachChmiLegal(item, opts = {}) {
  const repo = opts.repoRoot || DEFAULT_REPO;
  const legalRegistry = opts.legalRegistry || loadLegalRegistry(repo);
  const sourceRegistry = opts.sourceRegistry || loadSourceRegistry(repo);
  const src = (sourceRegistry.entries || []).find((e) => e && e.id === "chmi") || null;
  const gate = canPublishFromSource(src, legalRegistry);
  if (!gate.ok || !gate.legal) {
    return {
      ...item,
      legal: {
        attributionText: opts.attribution || CHMI_ATTRIBUTION,
        license: "CC BY 4.0",
        sourceName: "Český hydrometeorologický ústav",
      },
    };
  }
  return attachLegalProvenance(item, src, gate.legal, legalRegistry);
}

/**
 * Stable user-facing item id bound to hazard_instance_id (survives CAP updates).
 */
export function makeStableItemId(hazardInstanceId) {
  return `ie-chmi-v2-${String(hazardInstanceId || "").replace(/^haz:/, "")}`;
}

/**
 * @param {object} revision
 * @param {object} [opts]
 */
export function revisionToFeedItems(revision, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  const publicUrl = opts.publicAlertsUrl || CHMI_PUBLIC_ALERTS_URL;
  const items = [];

  for (const h of revision.hazards || []) {
    if (/^None$/i.test(h.severity)) continue;
    if (/^žádn|^no warning/i.test(h.event || "")) continue;

    const geo = h.geo || {};
    const links = geo.links || [];
    const primary = links[0] || null;
    const loc = summarizeAlertLocality(links, geo.displayNames || []);
    const orpNames = [...new Set(links.map((l) => l.orpName).filter(Boolean))];
    const okresNames = [...new Set(links.map((l) => l.okresName).filter(Boolean))];
    const krajNames = [...new Set(links.map((l) => l.krajName).filter(Boolean))];
    const region =
      primary && primary.precise
        ? {
            level: loc.level === "kraj" ? "kraj" : links.length > 1 ? "multi" : "orp",
            name: loc.name,
            summary: loc.summary,
            extraAreaCount: loc.extraAreaCount,
            orpId: primary.orpId,
            orpCode: primary.orpCode,
            orpName: primary.orpName,
            okresId: primary.okresId,
            okresName: primary.okresName,
            krajId: primary.krajId,
            krajName: primary.krajName || (krajNames.length === 1 ? krajNames[0] : null),
            orpIds: links.map((l) => l.orpId).filter(Boolean),
            orpCodes: links.map((l) => l.orpCode).filter(Boolean),
            orpNames,
            okresIds: [...new Set(links.map((l) => l.okresId).filter(Boolean))],
            okresNames,
            krajIds: [...new Set(links.map((l) => l.krajId).filter(Boolean))],
            krajNames,
            areaDescs: (geo.displayNames || []).slice(),
            assignmentSource: "cisorp",
            precise: true,
          }
        : geo.displayNames && geo.displayNames[0]
          ? {
              level: "display_only",
              name: loc.name,
              summary: loc.summary,
              extraAreaCount: loc.extraAreaCount,
              precise: false,
              assignmentSource: "areaDesc_display",
              areaDescs: (geo.displayNames || []).slice(),
            }
          : { level: "cr", name: "Česká republika", summary: "Česká republika", precise: false };

    const titleBase = h.headline || h.event || "Výstraha ČHMÚ";
    const areaBit = loc.summary && loc.summary !== "Česká republika" ? loc.summary : "";
    const title = areaBit && !titleBase.includes(areaBit) ? `${titleBase} — ${areaBit}` : titleBase;

    const cancelled = /^Cancel$/i.test(revision.msgType);
    const expMs = Date.parse(h.valid_to || "") || 0;
    const hazardExpired = expMs > 0 && expMs <= nowMs;
    const inactiveStatus = !/^Actual$/i.test(String(revision.status || "Actual"));
    const hazardActive = !cancelled && !inactiveStatus && !hazardExpired;
    const ended = !hazardActive;
    const itemId = makeStableItemId(h.hazard_instance_id);
    const geoStats = {
      totalAreas: (h.areas || []).length,
      mappedAreas: links.length,
      unmappedAreas: (geo.quarantine || []).length,
      mappingCoveragePercent:
        (h.areas || []).length === 0
          ? 100
          : Math.round((100 * links.length) / Math.max(links.length + (geo.quarantine || []).length, 1)),
    };

    items.push({
      id: itemId,
      title: title,
      description: h.description || "",
      instruction: h.instruction || "",
      sourceId: "chmi",
      sourceLabel: "ČHMÚ",
      sourceGroup: "pocasi",
      url: publicUrl,
      originalUrl: publicUrl,
      canonicalUrl: publicUrl,
      sectionId: "pocasi",
      subsectionId: "vystrahy",
      eventType: "mimoradne",
      status: cancelled ? "zruseno" : ended ? "ukonceno" : "aktivni",
      lifecycle: cancelled ? "zruseno" : ended ? "ukonceno" : "prave-probihajici",
      importance: importanceFromSeverity(h.severity),
      impact: importanceFromSeverity(h.severity),
      region,
      lane: "pocasi",
      connectorType: "opendata",
      orgType: "meteo",
      publishedAtSource: revision.published_at || revision.sent,
      publishedAt: revision.published_at || revision.sent,
      updatedAt: nowIso,
      validFrom: h.valid_from || revision.sent,
      validTo: h.valid_to || "",
      resolvedAt: ended ? nowIso : null,
      groupKey: makeGroupKey(titleBase + "|" + (h.eventKey || h.event || ""), revision.sent || "unknown"),
      tags: ["cap", "vystraha", "cap-v2"],
      links: [],
      legal: {
        attributionText: opts.attribution || CHMI_ATTRIBUTION,
        license: "CC BY 4.0",
        sourceName: "Český hydrometeorologický ústav",
      },
      capV2: {
        cap_message_id: revision.cap_message_id,
        alert_thread_id: revision.alert_thread_id,
        hazard_instance_id: h.hazard_instance_id,
        msgType: revision.msgType,
        change_type: revision.change_type,
        event: h.event || "",
        severity: h.severity,
        urgency: h.urgency,
        certainty: h.certainty,
        badgeActive: hazardActive && !cancelled,
        geo: {
          links,
          quarantine: geo.quarantine || [],
          ...geoStats,
        },
        searchText: foldCs(
          [
            "Výstraha ČHMÚ",
            title,
            titleBase,
            h.event,
            h.description,
            h.instruction,
            loc.summary,
            ...orpNames,
            ...okresNames,
            ...krajNames,
            ...(geo.displayNames || []),
            "ČHMÚ",
            "Český hydrometeorologický ústav",
            h.severity,
            h.urgency,
            h.certainty,
          ]
            .filter(Boolean)
            .join(" ")
        ),
        significantUnreadReset: !!(revision.change && revision.change.significantUnreadReset),
      },
    });
    items[items.length - 1] = attachChmiLegal(items[items.length - 1], opts);
  }
  return items;
}

/**
 * Merge feed items that share the same stable id — union geographic coverage.
 */
export function mergeFeedItemsById(items) {
  const map = new Map();
  for (const item of items || []) {
    if (!item || !item.id) continue;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      continue;
    }
    const a = prev.region || {};
    const b = item.region || {};
    const orpIds = [...new Set([...(a.orpIds || []), ...(b.orpIds || [])])];
    const orpNames = [...new Set([...(a.orpNames || []), ...(b.orpNames || [])])];
    const okresIds = [...new Set([...(a.okresIds || []), ...(b.okresIds || [])])];
    const okresNames = [...new Set([...(a.okresNames || []), ...(b.okresNames || [])])];
    const krajIds = [...new Set([...(a.krajIds || []), ...(b.krajIds || [])])];
    const krajNames = [...new Set([...(a.krajNames || []), ...(b.krajNames || [])])];
    const areaDescs = [...new Set([...(a.areaDescs || []), ...(b.areaDescs || [])])];
    const links = [...((prev.capV2 && prev.capV2.geo && prev.capV2.geo.links) || []), ...((item.capV2 && item.capV2.geo && item.capV2.geo.links) || [])];
    const uniqLinks = [];
    const seenOrp = new Set();
    for (const l of links) {
      const key = l && (l.orpId || l.orpCode);
      if (!key || seenOrp.has(key)) continue;
      seenOrp.add(key);
      uniqLinks.push(l);
    }
    const loc = summarizeAlertLocality(uniqLinks, areaDescs);
    const newer = String(item.updatedAt || "") >= String(prev.updatedAt || "") ? item : prev;
    const titleBase = (newer.capV2 && newer.capV2.event) || String(newer.title || "").split(" — ")[0];
    const title = loc.summary && !titleBase.includes(loc.summary) ? `${titleBase} — ${loc.summary}` : titleBase;
    map.set(item.id, {
      ...newer,
      title,
      region: {
        ...newer.region,
        ...loc,
        orpIds,
        orpNames,
        okresIds,
        okresNames,
        krajIds,
        krajNames,
        areaDescs,
        precise: !!(a.precise || b.precise),
      },
      capV2: {
        ...(newer.capV2 || {}),
        geo: {
          ...((newer.capV2 && newer.capV2.geo) || {}),
          links: uniqLinks,
          mappedAreas: uniqLinks.length,
          totalAreas: Math.max(
            (prev.capV2 && prev.capV2.geo && prev.capV2.geo.totalAreas) || 0,
            (item.capV2 && item.capV2.geo && item.capV2.geo.totalAreas) || 0,
            uniqLinks.length
          ),
        },
        searchText: foldCs(
          [newer.capV2 && newer.capV2.searchText, prev.capV2 && prev.capV2.searchText, ...orpNames, ...krajNames]
            .filter(Boolean)
            .join(" ")
        ),
      },
    });
  }
  return [...map.values()];
}

export function revisionsToFeed(revisions, opts = {}) {
  const out = [];
  for (const r of revisions || []) out.push(...revisionToFeedItems(r, opts));
  return mergeFeedItemsById(out);
}
