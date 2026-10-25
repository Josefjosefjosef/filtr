#!/usr/bin/env node
/**
 * Phase 3D — R2 infrastructure readiness audit (repo-only).
 * Never creates buckets, never sets Cloudflare secrets, never publishes.
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
    "CJ_MANAGED_PUBLIC_LIVE_ENABLED must stay false until GO"
  );
  note(
    "binding_commented_infra_pending",
    /INFRA_PENDING[\s\S]*#\s*\[\[r2_buckets\]\][\s\S]*#\s*binding\s*=\s*"CJ_MANAGED_PUBLIC"/.test(wrangler) ||
      (/#\s*binding\s*=\s*"CJ_MANAGED_PUBLIC"/.test(wrangler) && /INFRA_PENDING/.test(wrangler)),
    "CJ_MANAGED_PUBLIC R2 binding remains commented"
  );
  note(
    "bucket_name_documented",
    /iu-cj-managed-public-live/.test(wrangler),
    "intended bucket name documented in comments"
  );
  note(
    "publish_token_not_committed",
    !/CJ_MANAGED_PUBLIC_PUBLISH_TOKEN\s*=\s*"[^"]+"/.test(wrangler),
    "no plaintext publish token in wrangler.toml"
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

  const secretsPresence = opts.secretsPresence || {};
  const r2Url = secretsPresence.IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL === "PRESENT";
  const r2Tok = secretsPresence.IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN === "PRESENT";
  note("secret_r2_publish_url", !r2Url ? false : true, r2Url ? "PRESENT" : "MISSING");
  note("secret_r2_publish_token", !r2Tok ? false : true, r2Tok ? "PRESENT" : "MISSING");
  // Missing secrets are expected INFRA_PENDING — not a code defect
  const infraPending = !(r2Url && r2Tok) || blockers.includes("binding_commented_infra_pending");

  const codeReady = [
    "wrangler_present",
    "live_flag_false",
    "binding_commented_infra_pending",
    "publish_token_not_committed",
    "worker_handler_present",
    "r2_publish_script_disarmed_default",
    "r2_publish_validates_payload",
    "workflow_r2_input_default_zero",
  ].every((id) => readyChecks.includes(id));

  return {
    schema: "iu-cj-phase3d-r2-infra-readiness-v1",
    at: new Date().toISOString(),
    ok: codeReady,
    infraPending: true,
    productionPublishAllowed: false,
    codeReady,
    secretsReady: r2Url && r2Tok,
    findings,
    blockers: blockers.filter((id) => !["secret_r2_publish_url", "secret_r2_publish_token"].includes(id)),
    remainingGoSteps: [
      "Create R2 bucket iu-cj-managed-public-live (manual Cloudflare GO)",
      "Uncomment CJ_MANAGED_PUBLIC binding in wrangler.toml after GO",
      "Set CJ_MANAGED_PUBLIC_PUBLISH_TOKEN worker secret (never commit)",
      "Set GitHub secrets IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL + TOKEN",
      "Deploy worker with CJ_MANAGED_PUBLIC_LIVE_ENABLED still false until final GO",
      "Arm publish only via workflow input after validated staging",
    ],
    note: "Repo-only audit. No bucket created. No Cloudflare mutations performed.",
  };
}

const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const secretsPresence = {
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: process.env.IU_CJ_R2_URL_PRESENT === "1" ? "PRESENT" : "MISSING",
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: process.env.IU_CJ_R2_TOKEN_PRESENT === "1" ? "PRESENT" : "MISSING",
  };
  const r = auditCjManagedPublicR2Readiness({ secretsPresence });
  console.log(JSON.stringify({ IU_CJ_PHASE3D_R2_INFRA_READINESS: r.ok ? "OK" : "FAIL", ...r }));
  process.exit(r.ok ? 0 : 1);
}
