/**
 * Normalize CAP v2 hazards → info-events compatible feed items.
 */
import path from "path";
import { fileURLToPath } from "url";
import { CHMI_ATTRIBUTION, CHMI_OPENDATA_CAP_INDEX, CHMI_PUBLIC_ALERTS_URL } from "./config.mjs";
import { isChmiOutlookProductEvent } from "./identity.mjs";
import { canonicalizeUrl, foldCs, isConcreteItemUrl, makeGroupKey, normalizeItemUrl } from "../iu-info-events-lib.mjs";
import {
  attachLegalProvenance,
  canPublishFromSource,
  loadLegalRegistry,
  loadSourceRegistry,
} from "../iu-info-events-legal-registry-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = path.resolve(__dirname, "../..");

/** Official CAP index listing — never a per-alert primary URL. */
const CHMI_CAP_INDEX_RE = /\/meteorology\/weather\/alerts\/cap\/?$/i;
const CHMI_OFFICIAL_HOST_RE = /(?:^|\.)chmi\.cz$/i;
const CHMI_PUBLIC_WEB_HOST_RE = /^vystrahy-cr\.chmi\.cz$/i;

function importanceFromSeverity(sev) {
  const s = String(sev || "");
  if (/^Extreme$/i.test(s)) return 5;
  if (/^Severe$/i.test(s)) return 4;
  if (/^Moderate$/i.test(s)) return 3;
  if (/^Minor$/i.test(s)) return 2;
  return 1;
}

/**
 * Build a concrete official CAP document URL for one hazard.
 * Base = discovered opendata .xml bulletin; query disambiguates hazards in the same file.
 * Never invents hosts/paths; never uses portal homepage/listing as primary URL.
 *
 * @param {object} revision
 * @param {object} hazard
 * @param {object} [opts]
 * @returns {{ url: string, urlKind: "cap_document", listingUrl: string, urlFallbackUsed: false } | { url: "", urlKind: "missing_concrete", listingUrl: string, urlFallbackUsed: true, urlFallbackReason: string }}
 */
export function buildConcreteCapItemUrl(revision, hazard, opts = {}) {
  const listingUrl = opts.publicAlertsUrl || CHMI_PUBLIC_ALERTS_URL;
  let rawBase =
    (revision && revision.sourceUrl) ||
    opts.sourceUrl ||
    (opts.sourceUrlByMessageId && revision && opts.sourceUrlByMessageId.get(revision.cap_message_id)) ||
    "";
  // Fixture / relative tokens resolve against the official CAP index (prod always passes absolute URLs).
  if (rawBase && !/^https?:\/\//i.test(String(rawBase))) {
    const name = String(rawBase).replace(/^\/+/, "");
    rawBase = `${CHMI_OPENDATA_CAP_INDEX}${/\.xml$/i.test(name) ? name : `${name}.xml`}`;
  }
  const base = normalizeItemUrl(rawBase);
  if (!base) {
    return {
      url: "",
      urlKind: "missing_concrete",
      listingUrl,
      urlFallbackUsed: true,
      urlFallbackReason: "no_source_document_url",
    };
  }
  let u;
  try {
    u = new URL(base);
  } catch {
    return {
      url: "",
      urlKind: "missing_concrete",
      listingUrl,
      urlFallbackUsed: true,
      urlFallbackReason: "invalid_source_document_url",
    };
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (!CHMI_OFFICIAL_HOST_RE.test(host)) {
    return {
      url: "",
      urlKind: "missing_concrete",
      listingUrl,
      urlFallbackUsed: true,
      urlFallbackReason: "non_official_host",
    };
  }
  const pathNoSlash = (u.pathname || "/").replace(/\/+$/, "") || "/";
  if (pathNoSlash === "/" || CHMI_CAP_INDEX_RE.test(pathNoSlash) || /vystrahy-cr\.chmi\.cz$/i.test(host)) {
    return {
      url: "",
      urlKind: "missing_concrete",
      listingUrl,
      urlFallbackUsed: true,
      urlFallbackReason: "homepage_or_listing_rejected",
    };
  }
  if (!/\.xml$/i.test(pathNoSlash)) {
    return {
      url: "",
      urlKind: "missing_concrete",
      listingUrl,
      urlFallbackUsed: true,
      urlFallbackReason: "not_cap_xml_document",
    };
  }
  // Drop prior disambiguators; set stable hid from hazard identity.
  u.search = "";
  u.hash = "";
  const hid = String((hazard && hazard.hazard_instance_id) || "").replace(/^haz:/, "");
  if (hid) u.searchParams.set("hid", hid);
  else if (revision && revision.identifier) {
    u.searchParams.set("id", String(revision.identifier).slice(-24));
    const ek = foldCs((hazard && (hazard.eventKey || hazard.event)) || "").slice(0, 40);
    if (ek) u.searchParams.set("e", ek);
  }
  const concrete = u.toString();
  if (!isConcreteItemUrl(concrete, listingUrl) || !isConcreteItemUrl(concrete, null)) {
    return {
      url: "",
      urlKind: "missing_concrete",
      listingUrl,
      urlFallbackUsed: true,
      urlFallbackReason: "failed_concrete_url_gate",
    };
  }
  return {
    url: concrete,
    urlKind: "cap_document",
    listingUrl,
    urlFallbackUsed: false,
  };
}

/**
 * Preserve official CAP <web> as informational publisherWebUrl (audit only).
 * Does NOT drive public card click — that is always CHMI_PUBLIC_ALERTS_URL.
 *
 * @param {string} rawWeb
 * @returns {{ publisherWebUrl: string, ok: boolean, reason?: string }}
 */
export function resolveCapPublisherWebUrl(rawWeb) {
  const raw = String(rawWeb || "").trim();
  if (!raw) return { publisherWebUrl: "", ok: false, reason: "missing_cap_web" };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { publisherWebUrl: "", ok: false, reason: "invalid_cap_web" };
  }
  if (u.protocol !== "https:") {
    return { publisherWebUrl: "", ok: false, reason: "cap_web_not_https" };
  }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  if (!CHMI_OFFICIAL_HOST_RE.test(host)) {
    return { publisherWebUrl: "", ok: false, reason: "cap_web_non_official_host" };
  }
  if (CHMI_PUBLIC_WEB_HOST_RE.test(host)) {
    return { publisherWebUrl: u.toString().replace(/\/+$/, "") + "/", ok: true };
  }
  const pathNoSlash = (u.pathname || "/").replace(/\/+$/, "") || "/";
  if (pathNoSlash === "/") {
    return { publisherWebUrl: "", ok: false, reason: "cap_web_homepage_without_portal_host" };
  }
  return { publisherWebUrl: u.toString(), ok: true };
}

/** @deprecated Use resolveCapPublisherWebUrl — kept for call-site compatibility during rename. */
export function resolveCapPublicWebUrl(rawWeb) {
  const r = resolveCapPublisherWebUrl(rawWeb);
  return { publicUrl: r.publisherWebUrl, ok: r.ok, reason: r.reason };
}

/**
 * Unified InfoUzel public click target for every CHMI card.
 * Independent of CAP <web> / ovzduší / missing web / XML source document.
 */
export function chmiUnifiedPublicClickUrl(opts = {}) {
  const raw = String(opts.publicAlertsUrl || CHMI_PUBLIC_ALERTS_URL || "").trim() || "https://vystrahy-cr.chmi.cz/";
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return "https://vystrahy-cr.chmi.cz/";
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (!/^vystrahy-cr\.chmi\.cz$/i.test(host)) return "https://vystrahy-cr.chmi.cz/";
    return u.toString().replace(/\/+$/, "") + "/";
  } catch {
    return "https://vystrahy-cr.chmi.cz/";
  }
}

/**
 * Temporal classification for a CHMI CAP hazard/item.
 * Never invents validFrom/validTo. One function drives status, badge, publishability.
 *
 * temporalState: active | scheduled | expired | cancelled | invalid | excluded
 * Public Czech `status`: aktivni | naplanovano | ukonceno | zruseno | nezaraditelne
 *
 * Open-ended ("do odvolání"): validTo empty + untilRevoked=true → active/scheduled
 * until cancelled or superseded. Missing expires alone is NOT invalid.
 *
 * @param {{ cancelled?: boolean, inactiveStatus?: boolean, productExcluded?: boolean, validFrom?: string|null, validTo?: string|null, untilRevoked?: boolean, nowMs: number }} input
 */
export function classifyChmiTemporalState(input = {}) {
  const nowMs = Number(input.nowMs) > 0 ? Number(input.nowMs) : Date.now();
  if (input.cancelled) {
    return {
      temporalState: "cancelled",
      status: "zruseno",
      lifecycle: "zruseno",
      publishable: false,
      badgeActive: false,
      reason: "cap_cancel",
      untilRevoked: false,
    };
  }
  if (input.productExcluded) {
    return {
      temporalState: "excluded",
      status: "nezaraditelne",
      lifecycle: "nezaraditelne",
      publishable: false,
      badgeActive: false,
      reason: "excluded_product_type",
      untilRevoked: !!input.untilRevoked,
    };
  }
  if (input.inactiveStatus) {
    return {
      temporalState: "invalid",
      status: "nezaraditelne",
      lifecycle: "nezaraditelne",
      publishable: false,
      badgeActive: false,
      reason: "cap_status_not_actual",
      untilRevoked: false,
    };
  }
  const fromRaw = String(input.validFrom || "").trim();
  const toRaw = String(input.validTo || "").trim();
  const fromMs = fromRaw ? Date.parse(fromRaw) : NaN;
  const toMs = toRaw ? Date.parse(toRaw) : NaN;
  const untilRevoked = !toRaw && input.untilRevoked === true;
  if (!fromRaw || !Number.isFinite(fromMs)) {
    return {
      temporalState: "invalid",
      status: "nezaraditelne",
      lifecycle: "nezaraditelne",
      publishable: false,
      badgeActive: false,
      reason: "missing_validFrom",
      untilRevoked: false,
    };
  }
  if (!toRaw || !Number.isFinite(toMs)) {
    // Open-ended official validity ("do odvolání") — not a data defect.
    if (untilRevoked) {
      if (nowMs < fromMs) {
        return {
          temporalState: "scheduled",
          status: "naplanovano",
          lifecycle: "naplanovano",
          publishable: true,
          badgeActive: false,
          reason: "before_validFrom_until_revoked",
          untilRevoked: true,
        };
      }
      return {
        temporalState: "active",
        status: "aktivni",
        lifecycle: "prave-probihajici",
        publishable: true,
        badgeActive: true,
        reason: "in_force_until_revoked",
        untilRevoked: true,
      };
    }
    return {
      temporalState: "invalid",
      status: "nezaraditelne",
      lifecycle: "nezaraditelne",
      publishable: false,
      badgeActive: false,
      reason: "missing_validTo",
      untilRevoked: false,
    };
  }
  if (toMs <= fromMs) {
    return {
      temporalState: "invalid",
      status: "nezaraditelne",
      lifecycle: "nezaraditelne",
      publishable: false,
      badgeActive: false,
      reason: "invalid_interval",
      untilRevoked: false,
    };
  }
  if (nowMs >= toMs) {
    return {
      temporalState: "expired",
      status: "ukonceno",
      lifecycle: "ukonceno",
      publishable: false,
      badgeActive: false,
      reason: "past_validTo",
      untilRevoked: false,
    };
  }
  if (nowMs < fromMs) {
    return {
      temporalState: "scheduled",
      status: "naplanovano",
      lifecycle: "naplanovano",
      publishable: true,
      badgeActive: false,
      reason: "before_validFrom",
      untilRevoked: false,
    };
  }
  return {
    temporalState: "active",
    status: "aktivni",
    lifecycle: "prave-probihajici",
    publishable: true,
    badgeActive: true,
    reason: "in_force",
    untilRevoked: false,
  };
}

/** Public feed / publish set: currently active + scheduled (future) only. */
export function isPublishableChmiItem(item) {
  if (!item) return false;
  if (item.publishable === true) return true;
  if (item.publishable === false) return false;
  const st = String(item.status || "");
  return st === "aktivni" || st === "naplanovano";
}

/**
 * Recompute temporal fields from validFrom/validTo (e.g. bulletin cache on 304).
 * Does not invent times; preserves cancelled via msgType/status; preserves untilRevoked.
 */
export function refreshItemTemporalFields(item, nowMs) {
  if (!item) return item;
  const msgType = String((item.capV2 && item.capV2.msgType) || "");
  const cancelled =
    /^Cancel$/i.test(msgType) || String(item.status || "").toLowerCase() === "zruseno";
  const untilRevoked =
    item.untilRevoked === true ||
    (item.capV2 && item.capV2.untilRevoked === true) ||
    (!String(item.validTo || "").trim() && item.untilRevoked !== false && !(item.capV2 && item.capV2.untilRevoked === false));
  const productExcluded =
    !!(item.capV2 && item.capV2.productExcluded) ||
    isChmiOutlookProductEvent((item.capV2 && item.capV2.event) || item.title || "");
  const cls = classifyChmiTemporalState({
    cancelled,
    inactiveStatus: false,
    productExcluded,
    validFrom: item.validFrom,
    validTo: item.validTo,
    untilRevoked,
    nowMs: Number(nowMs) > 0 ? Number(nowMs) : Date.now(),
  });
  const ended =
    cls.temporalState === "expired" ||
    cls.temporalState === "cancelled" ||
    cls.temporalState === "invalid" ||
    cls.temporalState === "excluded";
  return {
    ...item,
    status: cls.status,
    lifecycle: cls.lifecycle,
    publishable: cls.publishable,
    untilRevoked: !!cls.untilRevoked,
    validTo: cls.untilRevoked ? null : item.validTo,
    resolvedAt: ended ? item.resolvedAt || new Date(Number(nowMs) || Date.now()).toISOString() : null,
    capV2: {
      ...(item.capV2 || {}),
      badgeActive: cls.badgeActive,
      temporalState: cls.temporalState,
      temporalReason: cls.reason,
      publishable: cls.publishable,
      untilRevoked: !!cls.untilRevoked,
      openEnded: !!cls.untilRevoked,
      productExcluded,
    },
  };
}

/**
 * Chronology for CAP feed items — never invent validity times.
 * sortAt prefers CAP sent/published; firstSeen preserved across refreshes by stable item id.
 */
export function applyCapChronology(item, opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const firstSeenMap = opts.firstSeenById || new Map();
  const itemId = String(item.id || "");
  const sourcePub = item.publishedAtSource || item.publishedAt || null;
  const prevFirst = itemId && firstSeenMap.has(itemId) ? firstSeenMap.get(itemId) : null;
  const firstSeen = prevFirst || item.firstSeenByInfoUzel || nowIso;
  const sortAt = sourcePub || firstSeen;
  return {
    ...item,
    publishedAtSource: sourcePub,
    publishedAt: sourcePub,
    firstSeenByInfoUzel: firstSeen,
    lastProcessedAt: nowIso,
    sortAt,
    timeSource: sourcePub ? "cap_sent" : "first_seen_fallback",
    timeConfidence: sourcePub ? "high" : "fallback",
    isNewCapture: !prevFirst,
  };
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
    if (h.productExcluded || isChmiOutlookProductEvent(h.event || "")) continue;
    const fromMs = Date.parse(h.valid_from || "") || 0;
    if (!fromMs) continue;
    const toRaw = String(h.valid_to || "").trim();
    const untilRevoked = h.untilRevoked === true || (!toRaw && h.untilRevoked !== false);
    if (untilRevoked) {
      if (nowMs >= fromMs) return true;
      continue;
    }
    const exp = Date.parse(toRaw) || 0;
    if (exp && exp > nowMs && nowMs >= fromMs) return true;
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
  const listingUrl = opts.publicAlertsUrl || CHMI_PUBLIC_ALERTS_URL;
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
    const inactiveStatus = !/^Actual$/i.test(String(revision.status || "Actual"));
    // Never invent onset/expires from sent. Empty expires + untilRevoked = "do odvolání".
    const validFrom = h.valid_from || null;
    const validToRaw = String(h.valid_to || "").trim();
    const untilRevoked =
      h.untilRevoked === true ||
      (!validToRaw && h.untilRevoked !== false && h.openEnded !== false);
    const validTo = untilRevoked ? null : validToRaw || null;
    const productExcluded =
      h.productExcluded === true || isChmiOutlookProductEvent(h.event || h.headline || "");
    const temporal = classifyChmiTemporalState({
      cancelled,
      inactiveStatus,
      productExcluded,
      validFrom,
      validTo: validToRaw,
      untilRevoked,
      nowMs,
    });
    const ended =
      temporal.temporalState === "expired" ||
      temporal.temporalState === "cancelled" ||
      temporal.temporalState === "invalid" ||
      temporal.temporalState === "excluded";
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

    const sourceDoc = buildConcreteCapItemUrl(revision, h, opts);
    // Technical CAP XML must remain resolvable for audit; never publish without it.
    if (!sourceDoc.url) {
      continue;
    }
    const publisherInfo = resolveCapPublisherWebUrl(h.web || "");
    const publisherWebUrl = publisherInfo.ok ? publisherInfo.publisherWebUrl : null;
    // Unified public click for ALL CHMI cards — never CAP XML, never ovzduší, never missing.
    const publicUrl = chmiUnifiedPublicClickUrl({ publicAlertsUrl: listingUrl });
    const clickUrl = publicUrl;
    const canonical = canonicalizeUrl(sourceDoc.url) || sourceDoc.url;
    const publishedAtSource = revision.published_at || revision.sent || null;

    let item = {
      id: itemId,
      title: title,
      description: h.description || "",
      instruction: h.instruction || "",
      sourceId: "chmi",
      sourceLabel: "ČHMÚ",
      sourceGroup: "pocasi",
      url: clickUrl,
      originalUrl: clickUrl,
      publicUrl,
      publicClickUrl: publicUrl,
      publisherWebUrl,
      canonicalUrl: canonical,
      urlKind: "cap_public_web",
      listingUrl: sourceDoc.listingUrl || listingUrl,
      sectionId: "pocasi",
      subsectionId: "vystrahy",
      eventType: "mimoradne",
      status: temporal.status,
      lifecycle: temporal.lifecycle,
      publishable: temporal.publishable,
      untilRevoked: !!temporal.untilRevoked,
      importance: importanceFromSeverity(h.severity),
      impact: importanceFromSeverity(h.severity),
      region,
      lane: "pocasi",
      connectorType: "opendata",
      orgType: "meteo",
      publishedAtSource,
      publishedAt: publishedAtSource,
      updatedAt: nowIso,
      validFrom,
      validTo,
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
        badgeActive: temporal.badgeActive,
        temporalState: temporal.temporalState,
        temporalReason: temporal.reason,
        publishable: temporal.publishable,
        untilRevoked: !!temporal.untilRevoked,
        openEnded: !!temporal.untilRevoked,
        productExcluded,
        sourceDocumentUrl: sourceDoc.url,
        publicUrl,
        publicClickUrl: publicUrl,
        publisherWebUrl,
        listingUrl: sourceDoc.listingUrl || listingUrl,
        urlKind: "cap_public_web",
        expiresSource: h.expiresSource || "",
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
    };
    item = applyCapChronology(item, opts);
    items.push(attachChmiLegal(item, opts));
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

/**
 * Build firstSeen map from previous feed items (stable id → firstSeenByInfoUzel).
 */
export function loadChmiFirstSeenById(prevItems) {
  const map = new Map();
  for (const it of prevItems || []) {
    if (!it || String(it.sourceId) !== "chmi") continue;
    if (it.id && it.firstSeenByInfoUzel) map.set(String(it.id), String(it.firstSeenByInfoUzel));
  }
  return map;
}
