#!/usr/bin/env node
/**
 * Phase 2C PR B — Job 2: publish-gate → write ONLY managed registry (+ audit).
 * Never pushes to main; never rewrites catalog JS / policy / guards.
 * Requires IU_CJ_SYNC_PUBLISH_ARMED=1 after infra approval.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertAllowedDataWrite,
  buildPublishPlan,
  materializeManagedPublic,
  WEBSITE_PID,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
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
  const sectionMap = readJson(path.join(dataDir, "iu-affiliate-cj-section-map-v1.json"), {});

  // Build candidates from staging links (caller may inject opts.candidates for tests)
  const candidates =
    opts.candidates ||
    (Array.isArray(staging.links) ? staging.links : []).map((l) => ({
      advertiserId: String(l.advertiserId || l["advertiser-id"] || ""),
      title: l.title || l.advertiserName || "",
      url: l.linkCode || l.url || l.clickUrl || "",
      sectionId: sectionMap[String(l.advertiserId || l["advertiser-id"] || "")] || null,
      needsReview: false,
    }));

  const linkMetaByAdvertiser = opts.linkMetaByAdvertiser || {};
  if (staging.apiOutage) {
    for (const c of candidates) {
      if (!linkMetaByAdvertiser[c.advertiserId]) {
        linkMetaByAdvertiser[c.advertiserId] = { apiError: "staging_api_outage" };
      }
    }
  }

  const plan = buildPublishPlan({
    candidates,
    policyPartners: policy.partners || [],
    linkMetaByAdvertiser,
    sectionMap,
    lastKnownGood: lkg.partners || [],
    blockedAdvertiserIds: opts.blockedAdvertiserIds || [],
  });

  const registryPath = path.join(dataDir, "iu-affiliate-cj-managed-registry-v1.json");
  const publicPath = path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json");
  const auditPath = path.join(dataDir, "iu-affiliate-cj-sync-audit-v1.json");
  assertAllowedDataWrite(registryPath);
  assertAllowedDataWrite(publicPath);
  assertAllowedDataWrite(auditPath);

  const auditPrev = readJson(auditPath, {});
  const audit = {
    ...auditPrev,
    publishAt: new Date().toISOString(),
    publishArmed: armed,
    websitePid: WEBSITE_PID,
    plan: {
      ok: plan.ok,
      apiOutage: plan.apiOutage,
      massEndedStop: plan.massEndedStop,
      publishBlockedReason: plan.publishBlockedReason,
      counts: plan.counts,
      endedRatio: plan.endedRatio,
    },
    noMergeNoProd: true,
    forbiddenWritePaths: plan.forbiddenWritePaths,
    allowedWritePaths: plan.allowedWritePaths,
  };

  if (!armed) {
    audit.note = "publish_not_armed — dry plan only; registry/public unchanged";
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");
    return { ok: true, armed: false, wroteRegistry: false, wrotePublic: false, plan, auditPath };
  }

  if (!plan.ok) {
    // Keep LKG registry + public overlay; still write audit
    audit.note = "publish_blocked_keep_lkg:" + plan.publishBlockedReason;
    fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + "\n", "utf8");
    return {
      ok: false,
      armed: true,
      wroteRegistry: false,
      wrotePublic: false,
      plan,
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
    plan,
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
