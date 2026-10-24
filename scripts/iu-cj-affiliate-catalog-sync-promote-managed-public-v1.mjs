#!/usr/bin/env node
/**
 * Phase 2F PR B — same-origin promote of managed-public JSON (data-only).
 *
 * NEVER rewrites assets/, guards, workflows, or slot policy.
 * Default: DISARMED (IU_CJ_MANAGED_PUBLIC_PROMOTE_ARMED != 1) → validate + dry plan only.
 *
 * When armed: atomically writes projects/data/iu-affiliate-cj-managed-public-v1.json
 * into a target data dir (fixture or checkout), keeping LKG sidecar for rollback.
 *
 * Live GitHub Pages: workflow opens a data-only PR to main (required checks still apply).
 * No uncontrolled commit to main from this script.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertAllowedDataWrite,
  isCjTrackingUrl,
  materializeManagedPublic,
  WEBSITE_PID,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_REL = "projects/data/iu-affiliate-cj-managed-public-v1.json";
const LKG_REL = "projects/data/iu-affiliate-cj-managed-public-lkg-v1.json";
const FORBIDDEN_BASENAMES = [
  "iu-affiliate-catalog.js",
  "iu-affiliate-slot-policy-v1.json",
  "index.html",
];

export function validateManagedPublicPayload(doc, opts = {}) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["not_object"] };
  }
  if (doc.schema !== "iu-affiliate-cj-managed-public-v1" && doc.schema != null) {
    errors.push("schema_mismatch:" + doc.schema);
  }
  if (String(doc.websitePid || "") !== String(opts.websitePid || WEBSITE_PID)) {
    errors.push("website_pid_mismatch");
  }
  if (!Array.isArray(doc.partners)) {
    errors.push("partners_not_array");
    return { ok: false, errors };
  }
  const seen = new Set();
  let active = 0;
  let inactive = 0;
  let unverifiedActive = 0;
  for (const p of doc.partners) {
    if (!p || p.advertiserId == null) {
      errors.push("partner_missing_advertiserId");
      continue;
    }
    const id = String(p.advertiserId);
    if (seen.has(id)) errors.push("duplicate_advertiserId:" + id);
    seen.add(id);
    if (p.active === false) {
      inactive += 1;
      continue;
    }
    active += 1;
    const url = String(p.url || "");
    if (!isCjTrackingUrl(url)) {
      unverifiedActive += 1;
      errors.push("active_url_not_cj:" + id);
    }
    if (!p.sectionId) errors.push("active_missing_section:" + id);
  }
  if (unverifiedActive > 0) {
    errors.push("unverified_active_urls:" + unverifiedActive);
  }
  return {
    ok: errors.length === 0,
    errors,
    counts: { partners: doc.partners.length, active, inactive, unique: seen.size },
  };
}

export function assertPromotePathAllowed(filePath) {
  const norm = String(filePath || "").replace(/\\/g, "/");
  for (const bad of FORBIDDEN_BASENAMES) {
    if (norm.endsWith("/" + bad) || norm.endsWith(bad)) {
      throw new Error("FORBIDDEN_PROMOTE_WRITE:" + norm);
    }
  }
  assertAllowedDataWrite(filePath);
  if (!norm.endsWith(PUBLIC_REL) && !norm.includes("/" + PUBLIC_REL) && !norm.endsWith(LKG_REL)) {
    if (!norm.includes("iu-affiliate-cj-managed-public")) {
      throw new Error("FORBIDDEN_PROMOTE_WRITE:" + norm);
    }
  }
  return true;
}

/**
 * Atomic promote: write LKG of previous public (if any), then write new public.
 */
export function promoteManagedPublicAtomic(opts = {}) {
  const env = opts.env || process.env;
  const armed = env.IU_CJ_MANAGED_PUBLIC_PROMOTE_ARMED === "1";
  const dataDir = opts.dataDir || path.join(ROOT, "projects", "data");
  const publicPath = path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json");
  const lkgPath = path.join(dataDir, "iu-affiliate-cj-managed-public-lkg-v1.json");
  const sourcePath =
    opts.sourcePath ||
    path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json");

  let incoming =
    opts.payload ||
    (fs.existsSync(sourcePath)
      ? JSON.parse(fs.readFileSync(sourcePath, "utf8"))
      : null);

  if (opts.fromRegistryPath && fs.existsSync(opts.fromRegistryPath)) {
    const reg = JSON.parse(fs.readFileSync(opts.fromRegistryPath, "utf8"));
    incoming = materializeManagedPublic(reg, {
      updatedAt: new Date().toISOString(),
      websitePid: WEBSITE_PID,
    });
  }

  const validation = validateManagedPublicPayload(incoming, { websitePid: WEBSITE_PID });
  const plan = {
    armed,
    ok: validation.ok,
    validation,
    publicPath,
    lkgPath,
    sha256: incoming
      ? crypto.createHash("sha256").update(JSON.stringify(incoming)).digest("hex")
      : null,
    noMergeNoProd: true,
    mode: armed ? "WRITE_IF_VALID" : "DRY_VALIDATE_ONLY",
  };

  if (!validation.ok) {
    return { ok: false, wrote: false, reason: "VALIDATION_FAILED", plan };
  }

  if (!armed) {
    return { ok: true, wrote: false, reason: "PROMOTE_DISARMED", plan };
  }

  assertPromotePathAllowed(publicPath);
  assertPromotePathAllowed(lkgPath);

  if (fs.existsSync(publicPath)) {
    const prev = fs.readFileSync(publicPath, "utf8");
    fs.writeFileSync(lkgPath, prev, "utf8");
  }

  const tmp = publicPath + ".tmp." + process.pid;
  const body = JSON.stringify(incoming, null, 2) + "\n";
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, publicPath);

  return {
    ok: true,
    wrote: true,
    reason: "PROMOTED_ATOMIC",
    plan,
    rollback: fs.existsSync(lkgPath) ? lkgPath : null,
  };
}

export function rollbackManagedPublicFromLkg(dataDir) {
  const publicPath = path.join(dataDir, "iu-affiliate-cj-managed-public-v1.json");
  const lkgPath = path.join(dataDir, "iu-affiliate-cj-managed-public-lkg-v1.json");
  if (!fs.existsSync(lkgPath)) {
    return { ok: false, reason: "NO_LKG" };
  }
  assertPromotePathAllowed(publicPath);
  const tmp = publicPath + ".tmp.rollback." + process.pid;
  fs.copyFileSync(lkgPath, tmp);
  fs.renameSync(tmp, publicPath);
  return { ok: true, reason: "ROLLED_BACK_TO_LKG" };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const r = promoteManagedPublicAtomic();
  console.log(
    JSON.stringify(
      {
        ok: r.ok,
        wrote: r.wrote,
        reason: r.reason,
        counts: r.plan?.validation?.counts,
        sha256: r.plan?.sha256,
        armed: r.plan?.armed,
        noMergeNoProd: true,
      },
      null,
      2
    )
  );
  process.exit(r.ok ? 0 : 1);
}
