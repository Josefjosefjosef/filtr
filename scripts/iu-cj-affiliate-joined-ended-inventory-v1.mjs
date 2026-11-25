#!/usr/bin/env node
/**
 * B-JOINED-ENDED-INVENTORY — authoritative CJ JOINED / ENDED inventory, DISTINCT from offers stats.partners.
 *
 * READ-ONLY / OFFLINE: reads committed artifacts only (partner registry + offers-public).
 * No network, no D1/R2, no growth/email activation, no repo writes (optional --out writes outside repo only).
 *
 * Denominators (never interchangeable):
 *   JOINED  = registry partners with relationshipStatus joined (CJ staging advertisers; authority = CJ API)
 *   ENDED   = previously JOINED ids now absent/ended in a COMPLETE CJ fetch (never from CJ_API_DOWN alone)
 *   stats.partners = advertisersWithOffers = unique advertisers with >=1 published offer — NOT CJ JOINED count
 *
 * Run:   node scripts/iu-cj-affiliate-joined-ended-inventory-v1.mjs [--out <path>]
 * Env:   IU_CJ_REGISTRY_PATH, IU_CJ_OFFERS_PUBLIC_PATH, IU_CJ_PREVIOUS_REGISTRY_PATH (optional ENDED diff)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isEndedApiDownFalsePositive } from "./iu-cj-affiliate-phase3z-partner-lifecycle-audit-v51-8.mjs";

export const JOINED_ENDED_INVENTORY_SCHEMA = "iu-cj-affiliate-joined-ended-inventory-v1";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_REGISTRY_PATH = path.join(
  ROOT,
  "projects",
  "data",
  "iu-affiliate-cj-partner-registry-v1.json",
);
export const DEFAULT_OFFERS_PUBLIC_PATH = path.join(
  ROOT,
  "projects",
  "data",
  "iu-affiliate-cj-offers-public-v1.json",
);

export const STATS_PARTNERS_SEMANTICS =
  "stats.partners (= advertisersWithOffers) = unique advertisers with >=1 coupon/action/product in published offers — NOT CJ JOINED count.";

/** Local copy of the lifecycle normalization (kept dependency-light; matches partner-lifecycle-v51-8). */
export function normalizeRelationshipStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s === "joined" || s === "new_joined" || s === "rejoined") return "joined";
  if (s === "ended" || s === "left" || s === "declined" || s === "removed") return "ended";
  return s;
}

function idOf(p) {
  const v = p?.advertiserId ?? p?.cid ?? p?.partnerId;
  if (v == null || v === "") return null;
  return String(v).replace(/^cj-/, "");
}

function sortedIds(set) {
  return [...set].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function collectOfferAdvertiserIds(offersPublic) {
  const ids = new Set();
  const sections = Array.isArray(offersPublic?.sections) ? offersPublic.sections : [];
  for (const sec of sections) {
    // Section-level advertiserId is a header (may have zero offers) — count only advertisers of actual offer items.
    for (const key of ["coupons", "actions", "products"]) {
      const arr = Array.isArray(sec?.[key]) ? sec[key] : [];
      for (const o of arr) {
        if (o?.advertiserId != null && o.advertiserId !== "") ids.add(String(o.advertiserId));
      }
    }
  }
  return ids;
}

/**
 * Authority = CJ API staging snapshot (not email/AI, not fixture).
 */
export function isCjAuthoritativeRegistry(registry) {
  const kind = String(registry?.stagingMeta?.sourceKind || "");
  return /^cj_api/i.test(kind) && registry?.fixtureOnly !== true;
}

/**
 * @param {object} input
 * @param {object} input.registry — partner registry JSON (v1) or { partners }
 * @param {object} [input.offersPublic] — offers-public JSON ({ sections, stats })
 * @param {object} [input.previousRegistry] — optional prior registry for ENDED diff
 * @param {object|array} [input.endedSample] — optional explicit ENDED rows (checked for CJ_API_DOWN false-positive)
 * @param {boolean} [input.currentFetchComplete] — ENDED diff allowed only when true (default: registry authoritative)
 */
export function buildJoinedEndedInventory({
  registry = {},
  offersPublic = {},
  previousRegistry = null,
  endedSample = [],
  currentFetchComplete,
} = {}) {
  const partners = Array.isArray(registry?.partners) ? registry.partners : [];
  const joinedIds = new Set();
  const endedIdsExplicit = new Set();
  const otherStatus = {};
  for (const p of partners) {
    const id = idOf(p);
    if (!id) continue;
    const rel = normalizeRelationshipStatus(p.relationshipStatus);
    if (rel === "joined") joinedIds.add(id);
    else if (rel === "ended") endedIdsExplicit.add(id);
    else otherStatus[rel] = (otherStatus[rel] || 0) + 1;
  }

  const authoritative = isCjAuthoritativeRegistry(registry);
  const fetchComplete = currentFetchComplete === undefined ? authoritative : currentFetchComplete === true;

  // ENDED via diff: previously JOINED, absent from the current JOINED set, only on a complete fetch.
  const endedIdsFromDiff = new Set();
  let endedDiffSkippedReason = null;
  if (previousRegistry && Array.isArray(previousRegistry.partners)) {
    if (!fetchComplete) {
      endedDiffSkippedReason = "current_fetch_incomplete_or_not_cj_authoritative";
    } else if (isEndedApiDownFalsePositive(endedSample)) {
      endedDiffSkippedReason = "cj_api_down_false_positive";
    } else {
      for (const p of previousRegistry.partners) {
        const id = idOf(p);
        if (id && normalizeRelationshipStatus(p.relationshipStatus) === "joined" && !joinedIds.has(id)) {
          endedIdsFromDiff.add(id);
        }
      }
    }
  } else {
    endedDiffSkippedReason = "no_previous_registry";
  }
  const endedIds = new Set([...endedIdsExplicit, ...endedIdsFromDiff]);
  for (const id of endedIds) joinedIds.delete(id);

  const offerIds = collectOfferAdvertiserIds(offersPublic);
  const stats = offersPublic?.stats && typeof offersPublic.stats === "object" ? offersPublic.stats : {};
  const statsPartners = Number.isFinite(Number(stats.partners)) ? Number(stats.partners) : null;
  const advertisersWithOffers = Number.isFinite(Number(stats.advertisersWithOffers))
    ? Number(stats.advertisersWithOffers)
    : statsPartners;

  const joinedWithOffers = new Set([...joinedIds].filter((id) => offerIds.has(id)));
  const joinedWithoutOffers = new Set([...joinedIds].filter((id) => !offerIds.has(id)));
  const offersNotInJoined = new Set([...offerIds].filter((id) => !joinedIds.has(id)));
  const offersEnded = new Set([...offerIds].filter((id) => endedIds.has(id)));

  const joinedCount = joinedIds.size;
  const statsSemanticsDeclared = /NOT CJ JOINED/i.test(String(stats.statsSemantics || ""));
  const apiDownFp = isEndedApiDownFalsePositive(endedSample);

  const guards = {
    joinedCountNotEqualStatsPartners:
      statsPartners == null ? null : joinedCount !== statsPartners,
    statsPartnersEqualsAdvertisersWithOffers:
      statsPartners != null && advertisersWithOffers != null ? statsPartners === advertisersWithOffers : null,
    offerAdvertiserSetSizeMatchesStats:
      advertisersWithOffers == null || offerIds.size === 0 ? null : offerIds.size === advertisersWithOffers,
    offerSetPartitionsIntoJoinedAndNotJoined:
      joinedWithOffers.size + offersNotInJoined.size === offerIds.size,
    statsSemanticsDeclaredNotJoined: statsSemanticsDeclared,
    joinedPartnersNotImpliedFlag: stats.joinedPartnersNotImplied === true,
    endedNotInferredFromApiDown: !apiDownFp,
    joinedEndedDisjoint: [...endedIds].every((id) => !joinedIds.has(id)),
    cjAuthoritative: authoritative,
  };

  return {
    schema: JOINED_ENDED_INVENTORY_SCHEMA,
    readOnly: true,
    registryGeneratedAt: registry?.generatedAt ?? null,
    offersUpdatedAt: offersPublic?.updatedAt ?? null,
    authority: {
      cjAuthoritative: authoritative,
      sourceKind: registry?.stagingMeta?.sourceKind ?? null,
      emailOrAiAuthority: false,
      note: "JOINED/ENDED authority = CJ API staging advertisers only; email/AI are never authority.",
    },
    denominators: {
      joined: joinedCount,
      ended: endedIds.size,
      statsPartners,
      advertisersWithOffers,
      offerAdvertiserIds: offerIds.size,
      joinedWithOffers: joinedWithOffers.size,
      joinedWithoutOffers: joinedWithoutOffers.size,
      offersAdvertisersNotInJoined: offersNotInJoined.size,
      offersAdvertisersEnded: offersEnded.size,
      registryOtherStatus: otherStatus,
    },
    ended: {
      explicitInRegistry: endedIdsExplicit.size,
      fromPreviousRegistryDiff: endedIdsFromDiff.size,
      diffSkippedReason: endedDiffSkippedReason,
      cjApiDownFalsePositive: apiDownFp,
      note: "ENDED requires CJ confirmed ended/absent on a complete fetch; never CJ_API_DOWN alone. Joined-only staging yields ended=0 without a previous registry.",
    },
    lists: {
      joinedIds: sortedIds(joinedIds),
      endedIds: sortedIds(endedIds),
      joinedWithoutOffersIds: sortedIds(joinedWithoutOffers),
      offersAdvertisersNotInJoinedIds: sortedIds(offersNotInJoined),
    },
    guards,
    statsPartnersSemantics: STATS_PARTNERS_SEMANTICS,
    notes: [
      STATS_PARTNERS_SEMANTICS,
      "JOINED is a CJ relationship count; stats.partners counts advertisers that have published offers. Expected to differ.",
      "Never use stats.partners as JOINED, nor JOINED as stats.partners.",
    ],
  };
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Read-only load of committed artifacts (offline). */
export function loadInventoryFromArtifacts(env = process.env) {
  const registryPath = env.IU_CJ_REGISTRY_PATH || DEFAULT_REGISTRY_PATH;
  const offersPath = env.IU_CJ_OFFERS_PUBLIC_PATH || DEFAULT_OFFERS_PUBLIC_PATH;
  const prevPath = env.IU_CJ_PREVIOUS_REGISTRY_PATH || null;
  return buildJoinedEndedInventory({
    registry: readJson(registryPath),
    offersPublic: readJson(offersPath),
    previousRegistry: prevPath ? readJson(prevPath) : null,
  });
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  return path.resolve(arg) === path.resolve(fileURLToPath(import.meta.url));
}

if (isDirectRun()) {
  const inv = loadInventoryFromArtifacts();
  const outIdx = process.argv.indexOf("--out");
  if (outIdx > 0 && process.argv[outIdx + 1]) {
    const out = path.resolve(process.argv[outIdx + 1]);
    if (out.startsWith(ROOT + path.sep)) {
      console.error("REFUSED: --out must be outside the repo (use %TEMP%).");
      process.exit(2);
    }
    fs.writeFileSync(out, JSON.stringify(inv, null, 2) + "\n", "utf8");
  }
  const compact = { ...inv, lists: { ...inv.lists } };
  for (const k of Object.keys(compact.lists)) compact.lists[k] = compact.lists[k].length + " ids";
  console.log(JSON.stringify(compact, null, 2));
}
