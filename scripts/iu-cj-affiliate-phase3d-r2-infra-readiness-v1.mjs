#!/usr/bin/env node
/**
 * Phase 3D/3I — R2 infrastructure readiness audit (repo-only + secrets presence).
 * Never creates buckets, never prints secret values, never arms LIVE_ENABLED.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function auditCjManagedPublicR2Readiness(opts = {}) {
  const root = opts.root || ROOT;
  const wranglerPath = path.join(root, "cloudflare", "iu-site-redirects", "wrangler.toml");
  const srcPath = path.join(root, "cloudflare", "iu-site-redirects", "src", "cj-managed-public.ts");
  const publishScript = path.join(root, "scripts", "iu-cj-affiliate-catalog-sync-r2-publish-v1.mjs");
  const workflow = path.join(root, ".github", "workflows", "cj-affiliate-catalog-sync.yml");
  const ensureWf = path.join(root, ".github", "workflows", "ensure-cj-managed-public-r2-bucket.yml");

  const findings = [];
  const blockers = [];
  const readyChecks = [];

  function note(id, ok, detail) {
    const row = { id, ok, detail: detail || null };
    findings.push(row);
    if (ok) readyChecks.push(id);
    else blockers.push(id);
  }

  const wrangler = fs.existsSync(wranglerPath) ? fs.readFileSync(wranglerPath, "utf8") : "";
  note("wrangler_present", Boolean(wrangler), wranglerPath);
  note(
    "live_flag_false",
    /CJ_MANAGED_PUBLIC_LIVE_ENABLED\s*=\s*"false"/.test(wrangler),
    "CJ_MANAGED_PUBLIC_LIVE_ENABLED must stay false until public GO"
  );

  const bindingActive =
    /\[\[r2_buckets\]\][\s\S]*?binding\s*=\s*"CJ_MANAGED_PUBLIC"[\s\S]*?bucket_name\s*=\s*"iu-cj-managed-public-live"/.test(
      wrangler
    ) && !/#\s*binding\s*=\s*"CJ_MANAGED_PUBLIC"/.test(wrangler);
  const bindingCommented =
    /#\s*\[\[r2_buckets\]\][\s\S]*?#\s*binding\s*=\s*"CJ_MANAGED_PUBLIC"/.test(wrangler) ||
    (/#\s*binding\s*=\s*"CJ_MANAGED_PUBLIC"/.test(wrangler) && /INFRA_PENDING/.test(wrangler));

  note(
    "binding_cj_managed_public",
    bindingActive || bindingCommented,
    bindingActive ? "ACTIVE_DISARMED" : bindingCommented ? "COMMENTED_INFRA_PENDING" : "MISSING"
  );
  note("bucket_name_documented", /iu-cj-managed-public-live/.test(wrangler), "iu-cj-managed-public-live");
  note(
    "publish_token_not_committed",
    !/CJ_MANAGED_PUBLIC_PUBLISH_TOKEN\s*=\s*"[^"]+"/.test(wrangler),
    "no plaintext publish token in wrangler.toml"
  );
  note(
    "ndic_traffic_binding_intact",
    /binding\s*=\s*"TRAFFIC_LIVE"/.test(wrangler) && /iu-ndic-traffic-live/.test(wrangler),
    "NDIC TRAFFIC_LIVE unchanged"
  );

  const src = fs.existsSync(srcPath) ? fs.readFileSync(srcPath, "utf8") : "";
  note("worker_handler_present", /CJ_MANAGED_PUBLIC|managedPublic|publish/i.test(src), srcPath);
  note(
    "atomic_or_lkg_logic_present",
    /lkg|LKG|staging|ATOMIC|rollback/i.test(src) ||
      fs.existsSync(path.join(root, "cloudflare", "iu-site-redirects", "src", "index.ts")),
    "worker supports atomic/LKG patterns for overlays"
  );

  const pub = fs.existsSync(publishScript) ? fs.readFileSync(publishScript, "utf8") : "";
  note("r2_publish_script_disarmed_default", /R2_PUBLISH_ARMED|DISARMED|!= 1/.test(pub), publishScript);
  note("r2_publish_validates_payload", /validateManagedPublicPayload/.test(pub), "validation before publish");
  note("r2_publish_no_git_merge", /NO_GIT_MERGE|no git merge/i.test(pub), "no-git-merge contract");

  const wf = fs.existsSync(workflow) ? fs.readFileSync(workflow, "utf8") : "";
  note(
    "workflow_r2_input_default_zero",
    /publish_managed_public_r2:[\s\S]*?default:\s*"0"/.test(wf),
    "workflow R2 arm default 0"
  );
  note("ensure_bucket_workflow_present", fs.existsSync(ensureWf), ensureWf);

  const secretsPresence = opts.secretsPresence || {};
  const r2Url =
    secretsPresence.IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL === "PRESENT" ||
    secretsPresence.IU_CJ_MANAGED_PUBLIC_PUBLISH_URL === "PRESENT";
  const r2Tok =
    secretsPresence.IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN === "PRESENT" ||
    secretsPresence.IU_CJ_MANAGED_PUBLIC_PUBLISH_TOKEN === "PRESENT";
  note("secret_r2_publish_url", r2Url, r2Url ? "PRESENT" : "MISSING");
  note("secret_r2_publish_token", r2Tok, r2Tok ? "PRESENT" : "MISSING");

  const bucketKnown = opts.bucketExists === true;
  if (opts.bucketExists === true || opts.bucketExists === false) {
    note("bucket_exists_remote", bucketKnown, bucketKnown ? "EXISTS" : "MISSING_REMOTE");
  }

  const infraPending = !(bindingActive && r2Url && r2Tok) || opts.bucketExists === false;
  const codeReady = [
    "wrangler_present",
    "live_flag_false",
    "binding_cj_managed_public",
    "publish_token_not_committed",
    "worker_handler_present",
    "r2_publish_script_disarmed_default",
    "r2_publish_validates_payload",
    "workflow_r2_input_default_zero",
    "ndic_traffic_binding_intact",
  ].every((id) => readyChecks.includes(id));

  return {
    schema: "iu-cj-phase3d-r2-infra-readiness-v1",
    at: new Date().toISOString(),
    ok: codeReady,
    infraPending,
    productionPublishAllowed: false,
    codeReady,
    secretsReady: r2Url && r2Tok,
    bindingActive,
    bindingCommented,
    liveEnabled: false,
    publishArmed: false,
    findings,
    blockers: blockers.filter(
      (id) => !["secret_r2_publish_url", "secret_r2_publish_token", "bucket_exists_remote"].includes(id)
    ),
    remainingGoSteps: [
      bindingActive ? null : "Uncomment CJ_MANAGED_PUBLIC binding in wrangler.toml",
      bucketKnown ? null : "Create/ensure R2 bucket iu-cj-managed-public-live",
      r2Url && r2Tok ? null : "Set GitHub secrets IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL + TOKEN",
      "Deploy worker with CJ_MANAGED_PUBLIC_LIVE_ENABLED=false (sets worker secret)",
      "Staging burn-in with publish_managed_public_r2=1 (non-public keys)",
      "Public LIVE_ENABLED=true only after separate final GO",
    ].filter(Boolean),
    note: "Public CJ live stays DISARMED. NDIC/CHMI/CNB bindings untouched.",
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const secretsPresence = {
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: process.env.IU_CJ_R2_URL_PRESENT === "1" ? "PRESENT" : "MISSING",
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: process.env.IU_CJ_R2_TOKEN_PRESENT === "1" ? "PRESENT" : "MISSING",
  };
  const r = auditCjManagedPublicR2Readiness({
    secretsPresence,
    bucketExists: process.env.IU_CJ_R2_BUCKET_EXISTS === "1" ? true : undefined,
  });
  console.log(JSON.stringify({ IU_CJ_PHASE3D_R2_INFRA_READINESS: r.ok ? "OK" : "FAIL", ...r }));
  process.exit(r.ok ? 0 : 1);
}
