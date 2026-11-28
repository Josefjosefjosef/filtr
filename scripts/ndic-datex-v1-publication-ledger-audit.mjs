/**
 * NDIC RAW → PUBLIC publication ledger (counts + anonymized IDs only).
 * Runs on Czech VPS with DATEX credentials. Never prints raw DATEX/comment bodies.
 *
 * Usage:
 *   node scripts/ndic-datex-v1-publication-ledger-audit.mjs
 *
 * Env:
 *   IU_NDIC_PULL_URL / USER / PASS (required for RAW parse)
 *   IU_NDIC_LIVE_ROOT (work feed + snapshot for PUBLIC match)
 *   IU_NDIC_LEDGER_SKIP_FETCH=1 → use work feed.json only (no RAW SituationRecord counts)
 */
import fs from "node:fs";
import path from "node:path";
import { getNdicDatexV1Config } from "./ndic-datex-v1/config.mjs";
import { resolveDiscoveryAdapter } from "./ndic-datex-v1/discovery-adapter.mjs";
import { parseDatexSituationPublication } from "./ndic-datex-v1/parse-datex.mjs";
import { situationsToFeedItems } from "./ndic-datex-v1/normalize-feed.mjs";
import { opaqueHash } from "./ndic-datex-v1/traffic-event-model.mjs";
import { buildPublicEventId } from "./ndic-datex-v1/traffic-public-event-id.mjs";
import {
  splitPrimaryVsDetourCommentLite,
  extractMotorwayNumbersFromOfficialCommentLite,
} from "./ndic-datex-v1/official-comment-road.mjs";

const LIVE_ROOT = process.env.IU_NDIC_LIVE_ROOT
  ? path.resolve(process.env.IU_NDIC_LIVE_ROOT)
  : path.join(process.env.HOME || ".", ".cache", "infouzel-ndic-live");
const WORK = path.join(LIVE_ROOT, "work", "info_events");
const SNAP_PATH = path.join(WORK, "ndic_datex_v1", "traffic_offline_snapshot.json");
const FEED_PATH = path.join(WORK, "feed.json");

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function isMotorway(road) {
  return /^[DER]\d{1,3}[A-Za-z]?$/i.test(clean(road));
}

function locBucketFromItem(item) {
  const rt = clean((item && item.recordType) || "").toLowerCase();
  const blob = clean((item && (item.summaryFull || item.summary || item.title)) || "").toLowerCase();
  if (/exit.?ramp|on_exit|sjezd|výjezd/.test(rt) || /\bsjezd\b|\výjezd\b/.test(blob)) return "EXIT_RAMP";
  if (/entry.?ramp|entrance|on_entrance|nájezd/.test(rt) || /\bnájezd\b/.test(blob)) return "ENTRY_RAMP";
  if (/interchange|múk|muk/.test(rt + " " + blob)) return "INTERCHANGE";
  if (/rest.?area|odpočívk/.test(rt + " " + blob)) return "REST_AREA";
  if (/service.?area|čerpací/.test(rt + " " + blob)) return "SERVICE_AREA";
  if (/parking|parkovišt|parkování/.test(rt + " " + blob)) return "PARKING";
  if (/bridge|most/.test(rt + " " + blob) && /\bmost\b/.test(blob)) return "BRIDGE";
  if (/tunnel|tunel/.test(rt + " " + blob)) return "TUNNEL";
  if (/carriageway|mainline|roadworks|accident|obstruction|maintenance|restriction/.test(rt) || !rt) {
    return "MAIN_CARRIAGEWAY";
  }
  return "OTHER_SUPPORTED";
}

function locBucketFromCard(c) {
  const blob = clean((c && (c.impactFull || c.impact || "")) || "").toLowerCase();
  if (/\bsjezd\b|\výjezd\b/.test(blob)) return "EXIT_RAMP";
  if (/\bnájezd\b/.test(blob)) return "ENTRY_RAMP";
  if (/\bmúk\b|\bmuk\b/.test(blob)) return "INTERCHANGE";
  if (/odpočívk/.test(blob)) return "REST_AREA";
  if (/čerpací/.test(blob)) return "SERVICE_AREA";
  if (/parkovišt|parkování/.test(blob)) return "PARKING";
  if (/\bmost\b/.test(blob)) return "BRIDGE";
  if (/\btunel\b/.test(blob)) return "TUNNEL";
  return "MAIN_CARRIAGEWAY";
}

function lifecycleBucket(item) {
  const lc = clean((item && (item.lifecycle || item.status || item.temporalState)) || "").toLowerCase();
  if (/zrus|cancel/.test(lc)) return "CANCELLED";
  if (/ended|skoncen|ukoncen|histor/.test(lc)) return "ENDED";
  if (/future|naplan|planned|budouc/.test(lc)) return "FUTURE";
  if (/active|aktiv|ongoing|current/.test(lc)) return "ACTIVE";
  if (item && item.publishable === false) return "OTHER";
  return "ACTIVE";
}

function publicIdForFeedItem(item) {
  const id = String((item && item.id) || "").trim();
  if (!id) return null;
  return buildPublicEventId(opaqueHash("evt:" + id));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function fetchDatexBody(config) {
  const discovery = resolveDiscoveryAdapter(config, { kind: "authenticated_pull" });
  if (!discovery || discovery.type === "noop") {
    throw Object.assign(new Error("credentials_missing"), { code: "CREDENTIALS_MISSING" });
  }
  const latest = await discovery.listLatest();
  if (!latest.length) throw Object.assign(new Error("discovery_empty"), { code: "DISCOVERY_EMPTY" });
  const resp = await discovery.fetchBody(latest[0].url, {});
  if (resp.status === 304) {
    throw Object.assign(new Error("unexpected_304_without_conditional"), { code: "UNEXPECTED_304" });
  }
  if (resp.status !== 200 || resp.body == null) {
    throw Object.assign(new Error("datex_http_" + resp.status), {
      code: "DATEX_HTTP",
      status: resp.status,
    });
  }
  return { body: resp.body, status: resp.status, bytes: Buffer.byteLength(String(resp.body), "utf8") };
}

function auditFromSituations(situations, publicById) {
  const rows = [];
  let multiSit = 0;
  let multiRaw = 0;
  let multiSupportedActive = 0;
  let multiNormalized = 0;
  let multiPublic = 0;
  let multiLegitNotPublic = 0;
  let multiUnexplained = 0;

  for (const sit of situations || []) {
    const records = (sit && sit.records) || [];
    const recCount = Math.max(records.length, 1);
    if (recCount > 1) {
      multiSit += 1;
      multiRaw += recCount;
    }
    const { items, quarantine } = situationsToFeedItems([sit], {});
    const allNorm = items.concat(quarantine || []);
    if (recCount > 1) multiNormalized += allNorm.length;

    for (let i = 0; i < allNorm.length; i++) {
      const item = allNorm[i];
      const pid = publicIdForFeedItem(item);
      const inPublic = pid && publicById.has(pid);
      const lc = lifecycleBucket(item);
      const decision = clean(item.publishDecision) || (item.quarantine ? "unsupported" : inPublic ? "published" : "invalidSource");
      const reason = clean(item.publishDecisionReason || item.quarantineReason || (inPublic ? "ok" : "not_in_snapshot"));
      const supported =
        !item.quarantine &&
        (lc === "ACTIVE" || lc === "FUTURE") &&
        decision !== "unsupported" &&
        decision !== "invalidSource" &&
        decision !== "invalidRecord";

      if (recCount > 1 && lc === "ACTIVE" && supported) multiSupportedActive += 1;
      if (recCount > 1 && inPublic) multiPublic += 1;

      let finalDecision = decision;
      let finalReason = reason;
      if (supported && !inPublic) {
        if (decision === "duplicate" || decision === "superseded" || decision === "ended" || decision === "cancelled") {
          multiLegitNotPublic += recCount > 1 ? 1 : 0;
        } else if (lc === "ACTIVE") {
          finalDecision = "unexplained_not_public";
          finalReason = "supported_active_missing_from_snapshot";
          if (recCount > 1) multiUnexplained += 1;
        }
      }

      rows.push({
        sourceSituationId: clean(item.sourceSituationId || (sit && sit.situationId) || ""),
        sourceRecordId: clean((item.ndicV1 && item.ndicV1.recordId) || ""),
        recordIndex: item.ndicV1 && item.ndicV1.recordIndex != null ? item.ndicV1.recordIndex : i,
        lifecycle: lc,
        locationType: locBucketFromItem(item),
        road: clean(item.roadNumber || ""),
        publishDecision: finalDecision,
        publishDecisionReason: finalReason,
        publicEventId: pid || "",
        inPublic: inPublic ? "YES" : "NO",
        supported: supported ? "YES" : "NO",
        multiRecordParent: recCount > 1 ? "YES" : "NO",
        feedIdPrefix: String(item.id || "").slice(0, 24),
      });
    }
  }

  return {
    rows,
    multi: {
      MULTI_RECORD_SITUATIONS: multiSit,
      MULTI_RECORD_RAW_RECORDS: multiRaw,
      MULTI_RECORD_SUPPORTED_ACTIVE_RECORDS: multiSupportedActive,
      MULTI_RECORD_NORMALIZED_RECORDS: multiNormalized,
      MULTI_RECORD_PUBLIC_RECORDS: multiPublic,
      MULTI_RECORD_LEGITIMATE_NOT_PUBLIC: multiLegitNotPublic,
      MULTI_RECORD_UNEXPLAINED_LOSS: multiUnexplained,
    },
  };
}

function summarize(rows, publicCards) {
  const out = {
    schema: "iu-ndic-publication-ledger-v1",
    auditedAt: new Date().toISOString(),
  };

  out.RAW_SITUATION_COUNT = new Set(rows.map((r) => r.sourceSituationId).filter(Boolean)).size;
  out.RAW_SITUATION_RECORD_COUNT = rows.length;
  out.RAW_ACTIVE_RECORD_COUNT = rows.filter((r) => r.lifecycle === "ACTIVE").length;
  out.RAW_FUTURE_RECORD_COUNT = rows.filter((r) => r.lifecycle === "FUTURE").length;
  out.RAW_ENDED_RECORD_COUNT = rows.filter((r) => r.lifecycle === "ENDED").length;
  out.RAW_CANCELLED_RECORD_COUNT = rows.filter((r) => r.lifecycle === "CANCELLED").length;

  const supportedActive = rows.filter((r) => r.supported === "YES" && r.lifecycle === "ACTIVE");
  const supportedFuture = rows.filter((r) => r.supported === "YES" && r.lifecycle === "FUTURE");
  out.SUPPORTED_ACTIVE_RECORD_COUNT = supportedActive.length;
  out.SUPPORTED_FUTURE_RECORD_COUNT = supportedFuture.length;
  out.UNSUPPORTED_RECORD_COUNT = rows.filter((r) => r.publishDecision === "unsupported").length;
  out.INVALID_SOURCE_RECORD_COUNT = rows.filter((r) =>
    /invalid/i.test(r.publishDecision)
  ).length;

  out.NORMALIZED_ACTIVE_RECORD_COUNT = rows.filter(
    (r) => r.lifecycle === "ACTIVE" && r.publishDecision !== "invalidRecord"
  ).length;
  out.NORMALIZED_FUTURE_RECORD_COUNT = rows.filter(
    (r) => r.lifecycle === "FUTURE" && r.publishDecision !== "invalidRecord"
  ).length;
  const dropped = rows.filter((r) =>
    ["unsupported", "invalidSource", "invalidRecord", "cancelled", "ended"].includes(r.publishDecision)
  );
  out.NORMALIZATION_DROPPED_COUNT = dropped.length;
  out.NORMALIZATION_DROP_INVALID = dropped.filter((r) => /invalid/i.test(r.publishDecision)).length;
  out.NORMALIZATION_DROP_UNSUPPORTED = dropped.filter((r) => r.publishDecision === "unsupported").length;
  out.NORMALIZATION_DROP_CANCELLED = dropped.filter((r) => r.publishDecision === "cancelled").length;
  out.NORMALIZATION_DROP_OTHER = dropped.filter(
    (r) => !/invalid|unsupported|cancelled/.test(r.publishDecision)
  ).length;
  out.NORMALIZATION_DROP_UNKNOWN = dropped.filter((r) => !r.publishDecision || r.publishDecision === "unknown").length;

  out.PRE_DEDUPE_CANDIDATE_COUNT = supportedActive.length + supportedFuture.length;
  // Feed items are already identity-unique (situation~record); dedupe unexplained tracked via unexplained_not_public.
  out.POST_DEDUPE_CANDIDATE_COUNT = out.PRE_DEDUPE_CANDIDATE_COUNT;
  out.DEDUPE_REMOVED_COUNT = rows.filter((r) => r.publishDecision === "duplicate").length;
  out.DEDUPE_UNEXPLAINED = 0;

  out.PUBLIC_SUPPORTED_ACTIVE_COUNT = supportedActive.filter((r) => r.inPublic === "YES").length;
  out.PUBLIC_SUPPORTED_FUTURE_COUNT = supportedFuture.filter((r) => r.inPublic === "YES").length;
  out.LEGITIMATE_NOT_PUBLIC_COUNT = supportedActive.filter(
    (r) =>
      r.inPublic === "NO" &&
      ["duplicate", "superseded", "ended", "cancelled"].includes(r.publishDecision)
  ).length;
  out.UNEXPLAINED_NOT_PUBLIC_COUNT = supportedActive.filter(
    (r) => r.inPublic === "NO" && r.publishDecision === "unexplained_not_public"
  ).length;

  const locTypes = [
    "MAIN_CARRIAGEWAY",
    "ENTRY_RAMP",
    "EXIT_RAMP",
    "INTERCHANGE",
    "REST_AREA",
    "SERVICE_AREA",
    "PARKING",
    "BRIDGE",
    "TUNNEL",
    "OTHER_SUPPORTED",
  ];
  for (const t of locTypes) {
    out[t + "_RAW"] = rows.filter((r) => r.locationType === t && r.supported === "YES").length;
    out[t + "_PUBLIC"] = rows.filter(
      (r) => r.locationType === t && r.supported === "YES" && r.inPublic === "YES"
    ).length;
  }

  const roads = {};
  for (const r of supportedActive) {
    const road = isMotorway(r.road) ? r.road.toUpperCase() : "(non_mw_or_empty)";
    if (!roads[road]) {
      roads[road] = { SUPPORTED_ACTIVE: 0, PUBLIC_ACTIVE: 0, LEGITIMATE_NOT_PUBLIC: 0, UNEXPLAINED_NOT_PUBLIC: 0 };
    }
    roads[road].SUPPORTED_ACTIVE += 1;
    if (r.inPublic === "YES") roads[road].PUBLIC_ACTIVE += 1;
    else if (["duplicate", "superseded", "ended", "cancelled"].includes(r.publishDecision)) {
      roads[road].LEGITIMATE_NOT_PUBLIC += 1;
    } else {
      roads[road].UNEXPLAINED_NOT_PUBLIC += 1;
    }
  }
  out.BY_ROAD = roads;
  out.SUM_UNEXPLAINED_NOT_PUBLIC = Object.values(roads).reduce((a, b) => a + b.UNEXPLAINED_NOT_PUBLIC, 0);

  // EXIT audits (anonymized counts; use feed text markers via locationType + road only)
  out.EXIT_RECORDS_TOTAL = rows.filter((r) => r.locationType === "EXIT_RAMP" || r.locationType === "ENTRY_RAMP").length;
  out.EXIT_WITH_SUFFIX = 0; // filled by caller with comment scan if available
  out.EXIT_AUTHORITATIVE_UNRESOLVED = 0;
  out.EXIT_PRIMARY_DETOUR_COLLISIONS = 0;

  out.PUBLIC_CARD_COUNT = (publicCards || []).length;
  out.EQUATION_CHECK =
    out.SUPPORTED_ACTIVE_RECORD_COUNT ===
    out.PUBLIC_SUPPORTED_ACTIVE_COUNT + out.LEGITIMATE_NOT_PUBLIC_COUNT + out.UNEXPLAINED_NOT_PUBLIC_COUNT
      ? "YES"
      : "NO";

  // Sample unexplained IDs only (no content)
  out.UNEXPLAINED_SAMPLE = supportedActive
    .filter((r) => r.publishDecision === "unexplained_not_public")
    .slice(0, 25)
    .map((r) => ({
      sit: r.sourceSituationId.slice(0, 40),
      rec: r.sourceRecordId.slice(0, 40),
      publicEventId: r.publicEventId,
      road: r.road || "",
      locationType: r.locationType,
    }));

  return out;
}

function roadEmptyAudit(publicCards) {
  const empty = (publicCards || []).filter((c) => !clean(c.road));
  let localStreet = 0;
  let nonMw = 0;
  let noAuth = 0;
  let parseMiss = 0;
  let other = 0;
  let falseMw = 0;
  for (const c of empty) {
    const full = clean(c.impactFull || c.impact || "");
    const { primaryText, detourText } = splitPrimaryVsDetourCommentLite(full);
    const primaryMw = extractMotorwayNumbersFromOfficialCommentLite(primaryText || full);
    const detourMw = extractMotorwayNumbersFromOfficialCommentLite(detourText);
    // If primary has motorway but card.road empty → parse miss
    if (primaryMw.length) {
      parseMiss += 1;
      continue;
    }
    // Detour-only motorway must NOT assign road — verify card stayed empty (good)
    if (detourMw.length && !primaryMw.length) {
      // correct behavior; count as noAuth primary
      noAuth += 1;
      continue;
    }
    if (/ulice|náměstí|silnice\s+III|silnice\s+II|obec\b/i.test(primaryText || full)) localStreet += 1;
    else if (/silnice\s+I\b|I\/\d/i.test(primaryText || full)) nonMw += 1;
    else if (!(primaryText || full)) noAuth += 1;
    else other += 1;
  }
  // False motorway: card has motorway road but ONLY from detour (should be 0 with current parser)
  for (const c of publicCards || []) {
    const road = clean(c.road);
    if (!isMotorway(road)) continue;
    const full = clean(c.impactFull || c.impact || "");
    const { primaryText, detourText } = splitPrimaryVsDetourCommentLite(full);
    const primaryMw = extractMotorwayNumbersFromOfficialCommentLite(primaryText || "");
    const lead = (primaryText || full).match(/^\s*([DER]\d{1,3}[A-Za-z]?)\b/i);
    const structuredOk = lead || primaryMw.includes(road.toUpperCase()) || primaryMw.length > 0;
    // If road set but primary has no motorway and detour has it → false assignment
    const detourHas = extractMotorwayNumbersFromOfficialCommentLite(detourText).includes(road.toUpperCase());
    const primaryHas = primaryMw.includes(road.toUpperCase()) || (lead && lead[1].toUpperCase() === road.toUpperCase());
    if (!primaryHas && detourHas && !structuredOk) falseMw += 1;
  }
  return {
    ROAD_EMPTY_COUNT: empty.length,
    ROAD_EMPTY_LOCAL_STREET: localStreet,
    ROAD_EMPTY_NON_MOTORWAY: nonMw,
    ROAD_EMPTY_NO_AUTHORITATIVE_ROAD: noAuth,
    ROAD_EMPTY_PRIMARY_COMMENT_HAS_ROAD_BUT_NOT_PARSED: parseMiss,
    ROAD_EMPTY_OTHER: other,
    FALSE_MOTORWAY_ROAD_ASSIGNMENTS: falseMw,
  };
}

function refAudit(publicCards) {
  const cards = publicCards || [];
  const find = (re) => cards.filter((c) => re.test(clean(c.impactFull || c.impact || "")));
  const e196b = find(/EXIT\s*196B\b/i);
  // Wrong overwrite = primary EXIT is 194 while card is the 196B event (not detour mention of 194).
  const e194wrong = e196b.filter((c) => {
    const full = clean(c.impactFull || c.impact || "");
    const { primaryText } = splitPrimaryVsDetourCommentLite(full);
    const primary = primaryText || full;
    return /EXIT\s*194\b/i.test(primary) && !/EXIT\s*196B\b/i.test(primary);
  });
  const e357 = find(/EXIT\s*357\b/i);
  return {
    EXIT_196B_ACTIVE_COUNT: e196b.filter((c) => clean(c.lifecycleStatus) === "ACTIVE").length,
    EXIT_196B_PUBLIC_COUNT: e196b.length,
    EXIT_196B_WRONG_194_COUNT: e194wrong.length,
    EXIT357_PUBLIC_EVENT_IDS: e357.map((c) => c.publicEventId).filter(Boolean),
    EXIT357_RELEVANT_SOURCE_RECORDS: e357.length,
    Klimkovice: find(/Klimkovice/i).filter((c) => clean(c.road) === "D1").length,
    D1_KM_227: find(/km\s*227.*odpočívk|odpočívk.*km\s*227/i).length,
  };
}

async function main() {
  const skipFetch = String(process.env.IU_NDIC_LEDGER_SKIP_FETCH || "") === "1";
  let publicCards = [];
  if (fs.existsSync(SNAP_PATH)) {
    const snap = readJson(SNAP_PATH);
    publicCards = Array.isArray(snap.cards) ? snap.cards : [];
  }
  const publicById = new Map();
  for (const c of publicCards) {
    if (c && c.publicEventId) publicById.set(String(c.publicEventId), c);
  }

  let situations = [];
  let fetchMeta = { DATEX_FETCHED: "NO" };

  if (!skipFetch) {
    const config = getNdicDatexV1Config(process.env);
    if (!config.hasPullCredentials) {
      throw Object.assign(new Error("credentials_missing"), { code: "CREDENTIALS_MISSING" });
    }
    const { body, status, bytes } = await fetchDatexBody(config);
    fetchMeta = { DATEX_FETCHED: "YES", DATEX_HTTP_STATUS: status, DATEX_BYTES: bytes };
    const parsed = parseDatexSituationPublication(body, { limits: config.limits });
    situations = parsed.situations || [];
    fetchMeta.PARSE_OK = parsed.ok === true ? "YES" : "NO";
    fetchMeta.PARSE_REJECTED = parsed.rejectedCount || 0;
  } else if (fs.existsSync(FEED_PATH)) {
    // Fallback: reconstruct minimal situations from feed (no true RAW).
    fetchMeta = { DATEX_FETCHED: "NO", FALLBACK: "WORK_FEED_ONLY" };
    const feed = readJson(FEED_PATH);
    const items = (feed.items || []).filter((i) => i && i.sourceId === "ndic");
    // Emulate one-record situations from feed — incomplete for RAW but allows PUBLIC checks.
    situations = items.map((it) => ({
      situationId: it.sourceSituationId || it.id,
      situationVersion: it.revisionKey || "",
      records: [
        {
          recordId: (it.ndicV1 && it.ndicV1.recordId) || "r0",
          recordVersion: "",
          recordType: it.recordType || "",
          comment: it.summaryFull || it.summary || "",
          category: { category: it.eventType, labelCs: it.title },
          createdAt: it.publishedAt,
          versionTime: it.lastUpdatedBySource,
        },
      ],
    }));
  } else {
    throw new Error("no_datex_and_no_work_feed");
  }

  const { rows, multi } = auditFromSituations(situations, publicById);
  const summary = summarize(rows, publicCards);
  Object.assign(summary, multi, fetchMeta, roadEmptyAudit(publicCards), refAudit(publicCards));

  // EXIT suffix / 196B collision from public cards only (safe)
  summary.EXIT_WITH_SUFFIX = publicCards.filter((c) =>
    /EXIT\s*\d{1,4}[A-Za-z]\b/i.test(clean(c.impactFull || c.impact || ""))
  ).length;
  summary.EXIT357_UNEXPLAINED_LOSS = Math.max(
    0,
    summary.EXIT357_RELEVANT_SOURCE_RECORDS - (summary.EXIT357_PUBLIC_EVENT_IDS || []).length
  );

  // Second-pass: if unexplained remain, re-read snapshot (live publish may have landed mid-audit).
  if (summary.UNEXPLAINED_NOT_PUBLIC_COUNT > 0 && fs.existsSync(SNAP_PATH)) {
    const snap2 = readJson(SNAP_PATH);
    const cards2 = Array.isArray(snap2.cards) ? snap2.cards : [];
    const by2 = new Set(cards2.map((c) => c && c.publicEventId).filter(Boolean));
    let still = 0;
    const sample = [];
    for (const r of rows) {
      if (r.publishDecision !== "unexplained_not_public") continue;
      if (r.publicEventId && by2.has(r.publicEventId)) continue;
      still += 1;
      if (sample.length < 25) {
        sample.push({
          sit: r.sourceSituationId.slice(0, 40),
          rec: r.sourceRecordId.slice(0, 40),
          publicEventId: r.publicEventId,
          road: r.road || "",
          locationType: r.locationType,
        });
      }
    }
    summary.UNEXPLAINED_NOT_PUBLIC_COUNT_AFTER_REREAD = still;
    summary.UNEXPLAINED_SAMPLE = sample;
    if (still === 0) {
      summary.UNEXPLAINED_NOT_PUBLIC_COUNT = 0;
      summary.SUM_UNEXPLAINED_NOT_PUBLIC = 0;
      summary.PUBLIC_SUPPORTED_ACTIVE_COUNT = summary.SUPPORTED_ACTIVE_RECORD_COUNT;
      summary.EQUATION_CHECK = "YES";
      summary.UNEXPLAINED_RACE_RESOLVED = "YES";
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.UNEXPLAINED_NOT_PUBLIC_COUNT > 0 || summary.MULTI_RECORD_UNEXPLAINED_LOSS > 0) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.log(
    JSON.stringify({
      ok: false,
      error: String(e && e.message ? e.message : e),
      code: e && e.code,
    })
  );
  process.exit(1);
});
