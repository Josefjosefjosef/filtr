#!/usr/bin/env node
/**
 * Phase 3F — unlimited dynamic CJ affiliate buttons (add/remove).
 *
 * Business rule:
 * - New approved (joined) partner with trusted section + CJ URL → ADD button (no slot limit).
 * - Confirmed cooperation end → REMOVE dynamic (CJ_MANAGED) button only.
 * - Incomplete fetch / API outage / auth error → FAIL-CLOSED keep last-known-good (no mass delete).
 * - MANUAL_PROTECTED / PAID_RESERVED never auto-removed.
 *
 * Does not mutate assets/iu-affiliate-catalog.js.
 * Does not arm liveEnabled / R2 publish.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { materializeManagedPublic } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { normalizePartnerBrand } from "./iu-cj-affiliate-phase3e-partner-recon-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEBSITE_PID = "101883843";

export const DYNAMIC_DECISION = Object.freeze({
  ADD: "ADD",
  KEEP: "KEEP",
  REMOVE_ENDED: "REMOVE_ENDED",
  KEEP_DRIFT: "KEEP_DRIFT_NOT_CONFIRMED_ENDED",
  KEEP_LKG_FETCH_INCOMPLETE: "KEEP_LKG_FETCH_INCOMPLETE",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  PROTECTED_SKIP: "PROTECTED_SKIP",
  SKIP_NO_URL: "SKIP_NO_URL",
  SKIP_DUPLICATE: "SKIP_DUPLICATE",
});

const ENDED_STATUSES = new Set([
  "ended",
  "rejected",
  "notjoined",
  "not_joined",
  "removed",
  "closed",
]);

export function isConfirmedEndedStatus(status) {
  const s = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "");
  return ENDED_STATUSES.has(s);
}

export function classifyPolicyManagement(entry) {
  return String(entry?.management || "").trim().toUpperCase();
}

/**
 * Build unlimited dynamic catalog diff + next managed-public materialization (preview/staging).
 */
export function syncUnlimitedDynamicCatalog(input = {}) {
  const joined = Array.isArray(input.joined) ? input.joined : [];
  const previous = Array.isArray(input.previousManaged)
    ? input.previousManaged
    : Array.isArray(input.previousManagedPublic?.partners)
      ? input.previousManagedPublic.partners
      : [];
  const sectionMap = { ...(input.sectionMap || {}) };
  for (const k of Object.keys(sectionMap)) {
    if (k.startsWith("_")) delete sectionMap[k];
  }
  const policyById = new Map();
  for (const p of input.slotPolicyPartners || []) {
    if (p?.advertiserId != null) policyById.set(String(p.advertiserId), p);
  }
  const urlByAdvertiser = { ...(input.urlByAdvertiser || {}) };
  const titleByAdvertiser = { ...(input.titleByAdvertiser || {}) };
  const fetchComplete = input.fetchComplete !== false;
  const apiOutage = input.apiOutage === true;
  const confirmedEndedIds = new Set(
    (input.confirmedEndedAdvertiserIds || []).map(String)
  );

  const decisions = [];
  const nextById = new Map();

  // Seed LKG
  for (const p of previous) {
    if (!p || p.advertiserId == null) continue;
    nextById.set(String(p.advertiserId), {
      advertiserId: String(p.advertiserId),
      sectionId: p.sectionId || null,
      title: p.title || "",
      url: p.url || null,
      active: p.active !== false,
      management: "CJ_MANAGED",
    });
  }

  if (!fetchComplete || apiOutage) {
    for (const [id, p] of nextById) {
      decisions.push({
        advertiserId: id,
        decision: DYNAMIC_DECISION.KEEP_LKG_FETCH_INCOMPLETE,
        sectionId: p.sectionId,
        reason: apiOutage ? "api_outage" : "fetch_incomplete",
      });
    }
    const materialization = materializeManagedPublic([...nextById.values()], {
      websitePid: input.websitePid || WEBSITE_PID,
      updatedAt: input.updatedAt,
    });
    return {
      ok: false,
      reason: apiOutage ? "api_outage_keep_lkg" : "fetch_incomplete_keep_lkg",
      liveEnabled: false,
      publishArmed: false,
      unlimited: true,
      freeEmptyGateRemoved: true,
      decisions,
      added: [],
      removed: [],
      kept: [...nextById.keys()],
      manualReview: [],
      nextManagedPublic: materialization,
      counts: {
        joined: joined.length,
        nextActive: materialization.partners.filter((p) => p.active !== false).length,
        added: 0,
        removed: 0,
      },
    };
  }

  const joinedById = new Map();
  for (const a of joined) {
    const id = String(a.advertiserId || "");
    if (!id) continue;
    joinedById.set(id, a);
  }

  // Process joined → add/keep
  const seenJoined = new Set();
  for (const [id, adv] of joinedById) {
    seenJoined.add(id);
    const policy = policyById.get(id);
    const mgmt = classifyPolicyManagement(policy);
    if (mgmt === "MANUAL_PROTECTED" || mgmt === "PAID_RESERVED") {
      decisions.push({
        advertiserId: id,
        decision: DYNAMIC_DECISION.PROTECTED_SKIP,
        sectionId: policy?.sectionId || sectionMap[id] || null,
        reason: "immutable_" + mgmt,
      });
      continue;
    }

    const sectionId = sectionMap[id] || policy?.sectionId || adv.sectionId || null;
    if (!sectionId) {
      decisions.push({
        advertiserId: id,
        decision: DYNAMIC_DECISION.MANUAL_REVIEW,
        sectionId: null,
        partnerName: adv.advertiserName || null,
        primaryCategory: adv.primaryCategory || null,
        reason: "unmapped_no_trusted_section",
      });
      continue;
    }

    const url =
      urlByAdvertiser[id] ||
      nextById.get(id)?.url ||
      adv.affiliateUrl ||
      adv.clickUrl ||
      null;
    if (!isCjTrackingUrl(url)) {
      decisions.push({
        advertiserId: id,
        decision: DYNAMIC_DECISION.SKIP_NO_URL,
        sectionId,
        reason: "missing_or_untrusted_cj_url",
      });
      continue;
    }

    const title =
      titleByAdvertiser[id] ||
      adv.advertiserName ||
      nextById.get(id)?.title ||
      id;
    const existed = nextById.has(id) && nextById.get(id).active !== false;
    nextById.set(id, {
      advertiserId: id,
      sectionId,
      title,
      url,
      active: true,
      management: "CJ_MANAGED",
    });
    decisions.push({
      advertiserId: id,
      decision: existed ? DYNAMIC_DECISION.KEEP : DYNAMIC_DECISION.ADD,
      sectionId,
      title,
      url,
    });
  }

  // Previous managed not in joined → remove only if confirmed ended
  for (const [id, prev] of [...nextById.entries()]) {
    if (seenJoined.has(id)) continue;
    const policy = policyById.get(id);
    const mgmt = classifyPolicyManagement(policy);
    if (mgmt === "MANUAL_PROTECTED" || mgmt === "PAID_RESERVED") {
      decisions.push({
        advertiserId: id,
        decision: DYNAMIC_DECISION.PROTECTED_SKIP,
        sectionId: prev.sectionId,
        reason: "immutable_keep_not_joined",
      });
      continue;
    }
    const ended = confirmedEndedIds.has(id) || isConfirmedEndedStatus(prev.relationshipStatus);
    if (ended) {
      nextById.set(id, { ...prev, active: false, endedReason: "confirmed_ended" });
      decisions.push({
        advertiserId: id,
        decision: DYNAMIC_DECISION.REMOVE_ENDED,
        sectionId: prev.sectionId,
        reason: "confirmed_ended",
      });
    } else {
      // Fail-closed drift — keep showing until confirmed end
      decisions.push({
        advertiserId: id,
        decision: DYNAMIC_DECISION.KEEP_DRIFT,
        sectionId: prev.sectionId,
        reason: "not_in_joined_unconfirmed",
        note: "Do not mass-remove on missing joined row without ENDED confirmation",
      });
    }
  }

  const materialization = materializeManagedPublic([...nextById.values()], {
    websitePid: input.websitePid || WEBSITE_PID,
    updatedAt: input.updatedAt,
  });

  const added = decisions.filter((d) => d.decision === DYNAMIC_DECISION.ADD);
  const removed = decisions.filter((d) => d.decision === DYNAMIC_DECISION.REMOVE_ENDED);
  const manualReview = decisions.filter((d) => d.decision === DYNAMIC_DECISION.MANUAL_REVIEW);
  const kept = decisions.filter(
    (d) =>
      d.decision === DYNAMIC_DECISION.KEEP ||
      d.decision === DYNAMIC_DECISION.KEEP_DRIFT ||
      d.decision === DYNAMIC_DECISION.PROTECTED_SKIP
  );

  return {
    ok: true,
    reason: "dynamic_sync_complete",
    liveEnabled: false,
    publishArmed: false,
    unlimited: true,
    freeEmptyGateRemoved: true,
    decisions,
    added,
    removed,
    kept,
    manualReview,
    nextManagedPublic: materialization,
    counts: {
      joined: joined.length,
      nextActive: materialization.partners.filter((p) => p.active !== false).length,
      nextTotal: materialization.partners.length,
      added: added.length,
      removed: removed.length,
      manualReview: manualReview.length,
    },
  };
}

/**
 * Resolve catalog URL/title hints for advertisers (existing buttons) — evidence only.
 */
export function buildUrlTitleHintsFromCatalog(catalogSrc) {
  const ordered = parseAffiliateCatalogOrdered(catalogSrc);
  const urlByAdvertiser = {};
  const titleByAdvertiser = {};
  const byNorm = new Map();
  for (const sec of ordered.sections || []) {
    for (const it of sec.items || []) {
      if (!it.url || !/^https:\/\//i.test(it.url)) continue;
      if (it.advertiserId) {
        const id = String(it.advertiserId);
        if (!urlByAdvertiser[id]) urlByAdvertiser[id] = it.url;
        if (!titleByAdvertiser[id]) titleByAdvertiser[id] = it.title;
      }
      const n = normalizePartnerBrand(it.title);
      if (n.length >= 4 && !byNorm.has(n)) {
        byNorm.set(n, { url: it.url, title: it.title, sectionId: sec.sectionId });
      }
    }
  }
  return { urlByAdvertiser, titleByAdvertiser, byNorm };
}

/**
 * Simulate chip HTML for a section after overlay (no browser).
 */
export function renderSectionChipsHtml(catalogSections, sectionId, overlay) {
  const cat = (catalogSections || []).find((s) => s.id === sectionId || s.sectionId === sectionId);
  if (!cat) return { ok: false, html: "", chips: [] };
  // shallow clone items
  const section = {
    id: cat.id || cat.sectionId,
    items: (cat.items || []).map((it) => ({ ...it })),
  };
  const overlayDoc = {
    partners: Array.isArray(overlay?.partners) ? overlay.partners : overlay || [],
  };
  applyOverlayToSections([section], overlayDoc);
  const chips = [];
  for (const it of section.items) {
    const ready = it.affiliateUrlReady === true && /^https:\/\//i.test(String(it.url || ""));
    if (!ready) continue;
    chips.push({
      title: it.title,
      url: it.url,
      advertiserId: it.advertiserId || null,
      management: it.management || null,
      target: "_blank",
      rel: "sponsored noopener",
    });
  }
  const html = chips
    .map(
      (c) =>
        `<a class="iuRadioChip iuAffiliateChip" href="${escapeHtml(c.url)}" data-aff-ready="1" target="_blank" rel="sponsored noopener"><span class="iuRadioChipTitle">${escapeHtml(c.title)}</span></a>`
    )
    .join("");
  return { ok: true, html, chips, count: chips.length, sectionId: section.id };
}

/** Same semantics as assets/iu-affiliate-catalog.js applyManagedPublicOverlay (section-scoped). */
export function applyOverlayToSections(sections, overlay) {
  const byAdv = {};
  for (const p of overlay.partners || []) {
    if (!p || p.advertiserId == null) continue;
    byAdv[String(p.advertiserId)] = p;
  }
  for (const cat of sections) {
    const kept = [];
    const seenAdv = {};
    for (const it of cat.items || []) {
      const adv = it.advertiserId != null ? String(it.advertiserId) : null;
      if (adv && byAdv[adv]) {
        const ov = byAdv[adv];
        if (ov.active === false) {
          if (it.management === "MANUAL_PROTECTED" || it.management === "PAID_RESERVED") {
            kept.push(it);
            seenAdv[adv] = true;
          }
          continue;
        }
        kept.push({
          title: ov.title || it.title,
          url: ov.url || it.url,
          affiliateUrlReady: true,
          advertiserId: adv,
          management: "CJ_MANAGED",
        });
        seenAdv[adv] = true;
      } else {
        kept.push(it);
        if (adv) seenAdv[adv] = true;
      }
    }
    for (const np of overlay.partners || []) {
      if (!np || np.active === false) continue;
      if (String(np.sectionId || "") !== String(cat.id || cat.sectionId)) continue;
      const nid = String(np.advertiserId);
      if (seenAdv[nid]) continue;
      if (!np.url || !/^https:\/\//i.test(String(np.url))) continue;
      kept.push({
        title: np.title,
        url: np.url,
        affiliateUrlReady: true,
        advertiserId: nid,
        management: "CJ_MANAGED",
      });
      seenAdv[nid] = true;
    }
    cat.items = kept;
  }
  return sections;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Stress: many partners in one section — prove no hard cap.
 */
export function stressUnlimitedSectionRender(baseCount = 80) {
  const section = { id: "aff-pojisteni", items: [] };
  const partners = [];
  for (let i = 0; i < baseCount; i++) {
    const id = String(9000000 + i);
    partners.push({
      advertiserId: id,
      sectionId: "aff-pojisteni",
      title: "DynPartner" + i,
      url: "https://www.kqzyfj.com/click-" + WEBSITE_PID + "-" + (1000 + i),
      active: true,
    });
  }
  const rendered = renderSectionChipsHtml([section], "aff-pojisteni", { partners });
  return {
    ok: rendered.count === baseCount,
    requested: baseCount,
    rendered: rendered.count,
    sampleRel: rendered.chips[0]?.rel || null,
    sampleTarget: rendered.chips[0]?.target || null,
  };
}

export function loadRepoSectionMap() {
  const p = path.join(ROOT, "projects", "data", "iu-affiliate-cj-section-map-v1.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const stress = stressUnlimitedSectionRender(100);
  console.log(
    JSON.stringify({
      IU_CJ_PHASE3F_DYNAMIC_CATALOG: stress.ok ? "OK" : "FAIL",
      unlimitedStress: stress,
      liveEnabled: false,
      publishArmed: false,
    })
  );
  process.exit(stress.ok ? 0 : 1);
}
