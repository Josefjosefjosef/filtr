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
  const active = activeFromRevision(revision, nowMs);
  const items = [];

  for (const h of revision.hazards || []) {
    if (/^None$/i.test(h.severity)) continue;
    if (/^žádn|^no warning/i.test(h.event || "")) continue;

    const geo = h.geo || {};
    const links = geo.links || [];
    const primary = links[0] || null;
    const region =
      primary && primary.precise
        ? {
            level: "orp",
            name: primary.orpName,
            orpId: primary.orpId,
            orpCode: primary.orpCode,
            okresId: primary.okresId,
            okresName: primary.okresName,
            krajId: primary.krajId,
            krajName: primary.krajName,
            orpIds: links.map((l) => l.orpId).filter(Boolean),
            okresIds: [...new Set(links.map((l) => l.okresId).filter(Boolean))],
            krajIds: [...new Set(links.map((l) => l.krajId).filter(Boolean))],
            assignmentSource: "cisorp",
            precise: true,
          }
        : geo.displayNames && geo.displayNames[0]
          ? {
              level: "display_only",
              name: String(geo.displayNames[0]).split("(")[0].trim(),
              precise: false,
              assignmentSource: "areaDesc_display",
            }
          : { level: "cr", name: "Česká republika", precise: false };

    const titleBase = h.headline || h.event || "Výstraha ČHMÚ";
    const areaBit = primary ? primary.orpName : region.name && region.name !== "Česká republika" ? region.name : "";
    const title = areaBit && !titleBase.includes(areaBit) ? `${titleBase} — ${areaBit}` : titleBase;

    const ended = !active;
    const cancelled = /^Cancel$/i.test(revision.msgType);
    const itemId = makeStableItemId(h.hazard_instance_id);

    items.push({
      id: itemId,
      title: `Výstraha ČHMÚ: ${title}`,
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
      groupKey: makeGroupKey(title, revision.sent || "unknown"),
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
        severity: h.severity,
        urgency: h.urgency,
        certainty: h.certainty,
        badgeActive: active && !cancelled,
        searchText: foldCs(
          [title, h.event, h.description, h.instruction, region.name, primary && primary.krajName, "ČHMÚ", "Český hydrometeorologický ústav", h.severity, h.urgency, h.certainty]
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

export function revisionsToFeed(revisions, opts = {}) {
  const out = [];
  for (const r of revisions || []) out.push(...revisionToFeedItems(r, opts));
  return out;
}
