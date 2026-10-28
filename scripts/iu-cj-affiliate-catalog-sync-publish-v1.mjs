#!/usr/bin/env node
/**
 * Phase 2C PR B — Job 2: publish-gate → write ONLY managed registry (+ audit).
 * Never pushes to main; never rewrites catalog JS / policy / guards.
 * Requires IU_CJ_SYNC_PUBLISH_ARMED=1 after infra approval.
 *
 * Phase 3U: never materialize an empty public overlay over a non-empty LKG;
 * build one candidate per JOINED advertiser with link ownership meta.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertAllowedDataWrite,
  buildPublishPlan,
  extractLinkIdFromUrl,
  isCjTrackingUrl,
  materializeManagedPublic,
  WEBSITE_PID,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function normalizeSectionMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw)) {
    if (!k || k.startsWith("_")) continue;
    if (v == null || typeof v === "object") continue;
    out[String(k)] = String(v);
  }
  return out;
}

function linkRank(link) {
  const t = String(link?.linkType || "");
  if (/evergreen/i.test(t)) return 0;
  if (/text/i.test(t)) return 1;
  if (/banner/i.test(t)) return 3;
  return 2;
}

export function pickBestPartnerLink(links, websitePid = WEBSITE_PID) {
  const list = Array.isArray(links) ? links.slice() : [];
  list.sort((a, b) => linkRank(a) - linkRank(b));
  for (const l of list) {
    const url = String(l?.clickUrl || l?.linkCode || l?.url || "");
    if (!isCjTrackingUrl(url)) continue;
    const ids = extractLinkIdFromUrl(url);
    if (!ids || String(ids.pid) !== String(websitePid)) continue;
    return { link: l, url };
  }
  return null;
}

/**
 * One candidate per JOINED advertiser + ownership meta derived from staging XML.
 */
export function buildCandidatesFromStaging(staging, sectionMap, policyPartners = [], websitePid = WEBSITE_PID) {
  const map = normalizeSectionMap(sectionMap);
  const policyById = new Map();
  for (const p of policyPartners || []) {
    if (p?.advertiserId != null) policyById.set(String(p.advertiserId), p);
  }
  const linksByAdv = new Map();
  for (const l of staging?.links || []) {
    const id = String(l?.advertiserId || l?.["advertiser-id"] || "");
    if (!id) continue;
    if (!linksByAdv.has(id)) linksByAdv.set(id, []);
    linksByAdv.get(id).push(l);
  }

  const candidates = [];
  const linkMetaByAdvertiser = {};
  const advertisers = Array.isArray(staging?.advertisers) ? staging.advertisers : [];

  for (const a of advertisers) {
    const id = String(a?.advertiserId || "");
    if (!id) continue;
    const rel = String(a?.relationshipStatus || "").toLowerCase();
    if (rel && rel !== "joined") continue;

    const picked = pickBestPartnerLink(linksByAdv.get(id) || [], websitePid);
    const policy = policyById.get(id);
    const sectionId = map[id] || policy?.sectionId || null;
    const account = String(a?.accountStatus || "");
    const programAvailable = !account || /^active$/i.test(account);

    candidates.push({
      advertiserId: id,
      title: a?.advertiserName || picked?.link?.advertiserName || "",
      url: picked?.url || "",
      sectionId,
      needsReview: false,
    });

    if (picked) {
      linkMetaByAdvertiser[id] = {
        websitePid: String(websitePid),
        advertiserId: id,
        linkId: String(picked.link?.linkId || ""),
        linkBelongsToAdvertiser: String(picked.link?.advertiserId || id) === id,
        programAvailable,
        programStatus: account || (programAvailable ? "Active" : "UNKNOWN"),
      };
    }
  }

  return { candidates, linkMetaByAdvertiser };
}

function seedLkgPartners(registryPartners, publicPartners) {
  const fromReg = Array.isArray(registryPartners) ? registryPartners : [];
  if (fromReg.length > 0) return fromReg;
  const fromPub = Array.isArray(publicPartners) ? publicPartners : [];
  return fromPub
    .filter((p) => p && p.advertiserId != null)
    .map((p) => ({
      advertiserId: String(p.advertiserId),
      title: p.title || "",
      url: p.url || "",
      sectionId: p.sectionId || null,
      management: "CJ_MANAGED",
      active: p.active !== false,
    }));
}

function activeCount(partners) {
  return (partners || []).filter((p) => p && p.active !== false).length;
}

export function runCatalogSyncPublish(opts = {}) {
  const env = opts.env || process.env;
  const dataDir = opts.dataDir || path.join(ROOT, "projects", "data");
  const armed = env.IU_CJ_SYNC_PUBLISH_ARMED === "1";

  const staging = readJson(path.join(dataDir, "iu-affiliate-cj-staging-v1.json"), {
    apiOutage: true,
    advertisers: [],
    links: [],
  });
  const policy = readJson(path.join(dataDir, "iu-affiliate-slot-policy-v1.json"), {
    partners: [],
  });
  const lkg = readJson(path.join(dataDir, "iu-affiliate-cj-managed-registry-v1.json"), {
    partners: [],
  });
  const publicLkg = readJson(path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json"), {
    partners: [],
  });
  const sectionMap = normalizeSectionMap(
    readJson(path.join(dataDir, "iu-affiliate-cj-section-map-v1.json"), {})
  );

  const built = buildCandidatesFromStaging(staging, sectionMap, policy.partners || [], WEBSITE_PID);
  const candidates = opts.candidates || built.candidates;
  const linkMetaByAdvertiser = {
    ...built.linkMetaByAdvertiser,
    ...(opts.linkMetaByAdvertiser || {}),
  };

  if (staging.apiOutage) {
    for (const c of candidates) {
      if (!linkMetaByAdvertiser[c.advertiserId]) {
        linkMetaByAdvertiser[c.advertiserId] = { apiError: "staging_api_outage" };
      }
    }
  }

  const lastKnownGood = seedLkgPartners(lkg.partners || [], publicLkg.partners || []);

  const plan = buildPublishPlan({
    candidates,
    policyPartners: policy.partners || [],
    linkMetaByAdvertiser,
    sectionMap,
    lastKnownGood,
    blockedAdvertiserIds: opts.blockedAdvertiserIds || [],
  });

  const registryPath = path.join(dataDir, "iu-affiliate-cj-managed-registry-v1.json");
  const publicPath = path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json");
  const auditPath = path.join(dataDir, "iu-affiliate-cj-sync-audit-v1.json");
  assertAllowedDataWrite(registryPath);
  assertAllowedDataWrite(publicPath);
  assertAllowedDataWrite(auditPath);

  const prevActive = activeCount(publicLkg.partners);
  const nextActive = activeCount(plan.publishSlice);
  let publishBlockedReason = plan.publishBlockedReason;
  let planOk = plan.ok;

  // Fail-closed: never wipe a non-empty public overlay with an empty slice.
  if (planOk && prevActive > 0 && nextActive === 0) {
    planOk = false;
    publishBlockedReason = "EMPTY_PUBLISH_REGRESSION_KEEP_LKG";
  }

  const auditPrev = readJson(auditPath, {});
  const audit = {
    ...auditPrev,
    publishAt: new Date().toISOString(),
    publishArmed: armed,
    websitePid: WEBSITE_PID,
    plan: {
      ok: planOk,
      apiOutage: plan.apiOutage,
      massEndedStop: plan.massEndedStop,
      publishBlockedReason,
      counts: {
        ...plan.counts,
        lkg_seeded_from_public: (lkg.partners || []).length === 0 && lastKnownGood.length > 0,
        prev_public_active: prevActive,
        next_slice_active: nextActive,
      },
      endedRatio: plan.endedRatio,
    },
    noMergeNoProd: true,
    forbiddenWritePaths: plan.forbiddenWritePaths,
    allowedWritePaths: plan.allowedWritePaths,
  };

  if (!armed) {
    audit.note = "publish_not_armed — dry plan only; registry/public unchanged";
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");
    return {
      ok: true,
      armed: false,
      wroteRegistry: false,
      wrotePublic: false,
      plan: { ...plan, ok: planOk, publishBlockedReason },
      auditPath,
    };
  }

  if (!planOk) {
    audit.note = "publish_blocked_keep_lkg:" + publishBlockedReason;
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");
    return {
      ok: false,
      armed: true,
      wroteRegistry: false,
      wrotePublic: false,
      plan: { ...plan, ok: false, publishBlockedReason },
      auditPath,
    };
  }

  const updatedAt = new Date().toISOString();
  const registry = {
    version: 1,
    updatedAt,
    websitePid: WEBSITE_PID,
    partners: plan.publishSlice,
    lastKnownGood: true,
  };
  const managedPublic = materializeManagedPublic(registry, {
    updatedAt,
    websitePid: WEBSITE_PID,
  });

  // Second guard after materialize (URL filter may drop rows).
  if (prevActive > 0 && activeCount(managedPublic.partners) === 0) {
    audit.note = "publish_blocked_keep_lkg:EMPTY_MATERIALIZE_REGRESSION_KEEP_LKG";
    audit.plan.publishBlockedReason = "EMPTY_MATERIALIZE_REGRESSION_KEEP_LKG";
    audit.plan.ok = false;
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");
    return {
      ok: false,
      armed: true,
      wroteRegistry: false,
      wrotePublic: false,
      plan: {
        ...plan,
        ok: false,
        publishBlockedReason: "EMPTY_MATERIALIZE_REGRESSION_KEEP_LKG",
      },
      auditPath,
    };
  }

  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
  fs.writeFileSync(publicPath, JSON.stringify(managedPublic, null, 2) + "\n", "utf8");
  audit.managedPublicPartners = managedPublic.partners.length;
  audit.note = "publish_ok_registry_and_managed_public";
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");

  return {
    ok: true,
    armed: true,
    wroteRegistry: true,
    wrotePublic: true,
    plan: { ...plan, ok: true, publishBlockedReason },
    registryPath,
    publicPath,
    auditPath,
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const r = runCatalogSyncPublish();
  console.log(
    JSON.stringify(
      {
        ok: r.ok,
        armed: r.armed,
        wroteRegistry: r.wroteRegistry,
        wrotePublic: r.wrotePublic,
        counts: r.plan.counts,
        publishBlockedReason: r.plan.publishBlockedReason,
        noMergeNoProd: true,
      },
      null,
      2
    )
  );
  process.exit(r.ok || !r.armed ? 0 : 1);
}
