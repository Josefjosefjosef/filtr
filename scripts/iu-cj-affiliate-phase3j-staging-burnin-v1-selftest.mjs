#!/usr/bin/env node
/**
 * Phase 3J offline selftest: isolation + ops 14/14 + DISARMED + burn-in workflow present.
 * Does not call live Cloudflare with production tokens.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditCjManagedPublicR2Readiness } from "./iu-cj-affiliate-phase3d-r2-infra-readiness-v1.mjs";
import { runAutomation24x7Matrix } from "./iu-cj-affiliate-phase3d-complete-validation-v1.mjs";
import { validateManagedPublicPayload } from "./iu-cj-affiliate-catalog-sync-promote-managed-public-v1.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

const ops = runAutomation24x7Matrix({});
expect("ops_14", ops.ok === true && ops.scenarioCount === 14 && ops.failed.length === 0, {
  failed: ops.failed,
});

const wrangler = fs.readFileSync(
  path.join(ROOT, "cloudflare", "iu-site-redirects", "wrangler.toml"),
  "utf8"
);
expect("live_false", /CJ_MANAGED_PUBLIC_LIVE_ENABLED\s*=\s*"false"/.test(wrangler));
expect("cj_binding", /binding\s*=\s*"CJ_MANAGED_PUBLIC"/.test(wrangler));
expect("ndic_binding", /binding\s*=\s*"TRAFFIC_LIVE"/.test(wrangler));
expect("cj_bucket", /iu-cj-managed-public-live/.test(wrangler));
expect("ndic_bucket", /iu-ndic-traffic-live/.test(wrangler));
expect("distinct_buckets", /iu-cj-managed-public-live/.test(wrangler) && /iu-ndic-traffic-live/.test(wrangler));

const src = fs.readFileSync(
  path.join(ROOT, "cloudflare", "iu-site-redirects", "src", "cj-managed-public.ts"),
  "utf8"
);
expect("keys_current", /R2_CJ_CURRENT_KEY/.test(src));
expect("keys_lkg", /R2_CJ_LKG_KEY/.test(src));
expect("keys_staging", /R2_CJ_STAGING_KEY/.test(src));
expect("no_ndic_put_in_cj_module", !/iu-ndic-traffic-live|TRAFFIC_LIVE/.test(src));
expect("publish_while_disarmed", /Authenticated publish allowed while LIVE_ENABLED=false/.test(src));
expect("serve_gated", /cjManagedPublicLiveEnabled\(env\) \|\| !env\.CJ_MANAGED_PUBLIC/.test(src) || /if \(!cjManagedPublicLiveEnabled/.test(src));

const burninWf = path.join(ROOT, ".github", "workflows", "cj-affiliate-r2-staging-burnin.yml");
expect("burnin_wf", fs.existsSync(burninWf));
const burnin = fs.readFileSync(burninWf, "utf8");
expect("burnin_default_disarmed", /arm_r2_publish:[\s\S]*?default:\s*"0"/.test(burnin));
expect("burnin_public_probe", /PUBLIC_SERVE_SOURCE|x-iu-cj-managed-public-source/.test(burnin));
expect("burnin_noauth_probe", /POST_NOAUTH_HTTP|NOAUTH_POST/.test(burnin));

const syncWf = fs.readFileSync(
  path.join(ROOT, ".github", "workflows", "cj-affiliate-catalog-sync.yml"),
  "utf8"
);
expect("sync_cron", /cron:\s*"17 3 \* \* \*"/.test(syncWf));
expect("sync_concurrency_no_cancel", /group:\s*cj-affiliate-catalog-sync[\s\S]*?cancel-in-progress:\s*false/.test(syncWf));
expect(
  "r2_job_dual_arm",
  /publish_managed_public_r2 == '1' && inputs\.arm_publish == '1'/.test(syncWf)
);

const mp = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-managed-public-v1.json"), "utf8")
);
const v = validateManagedPublicPayload(mp, { websitePid: "101883843" });
expect("managed_public_valid", v.ok === true, v.errors);
expect("managed_public_active_gt_100", (v.counts?.active || 0) >= 100, v.counts);

const review = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-manual-review-v1.json"), "utf8")
);
expect("disarmed_flags", review.liveEnabled === false && review.publishArmed === false);
expect("mr_two", (review.remainingManualReview || []).length === 2);
expect(
  "mr_ids",
  (review.remainingManualReview || []).every((r) =>
    ["5578976", "7804601"].includes(String(r.advertiserId))
  )
);
expect(
  "gavri_keep",
  (review.managedNotJoined || []).some(
    (g) => String(g.advertiserId) === "5614135" && /KEEP_DRIFT/.test(String(g.decision || ""))
  )
);

const r2 = auditCjManagedPublicR2Readiness({
  secretsPresence: {
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_URL: "PRESENT",
    IU_CJ_MANAGED_PUBLIC_R2_PUBLISH_TOKEN: "PRESENT",
  },
  bucketExists: true,
});
expect("r2_code_ready", r2.codeReady === true);
expect("r2_no_prod_publish", r2.productionPublishAllowed === false);
expect("r2_live_false", r2.liveEnabled === false);

const goPath = path.join(ROOT, "scripts", "iu-cj-affiliate-phase3j-public-go-checklist-v1.mjs");
expect("go_checklist_script", fs.existsSync(goPath));

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_PHASE3J_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    ops: { ok: ops.ok, passed: ops.passed, scenarioCount: ops.scenarioCount },
    managedPublic: v.counts,
    r2: {
      codeReady: r2.codeReady,
      productionPublishAllowed: r2.productionPublishAllowed,
      bindingActive: r2.bindingActive,
    },
  })
);
process.exit(ok ? 0 : 1);
