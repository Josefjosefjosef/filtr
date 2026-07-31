#!/usr/bin/env node
/**
 * Guard: CHMI CAP redundant Cloudflare trigger is present and fail-closed.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const wrangler = fs.readFileSync(path.join(REPO, "cloudflare/chmi-cap-watchdog/wrangler.toml"), "utf8");
const index = fs.readFileSync(path.join(REPO, "cloudflare/chmi-cap-watchdog/src/index.ts"), "utf8");
const decision = fs.readFileSync(path.join(REPO, "cloudflare/chmi-cap-watchdog/src/decision.ts"), "utf8");
const deploy = fs.readFileSync(path.join(REPO, ".github/workflows/deploy-chmi-cap-watchdog.yml"), "utf8");
const fallback = fs.readFileSync(path.join(REPO, ".github/workflows/chmi-cap-watchdog-cron-fallback.yml"), "utf8");
const capWf = fs.readFileSync(path.join(REPO, ".github/workflows/update-chmi-cap-v2.yml"), "utf8");

ok("wrangler_cron_5", /\*\/5 \* \* \* \*/.test(wrangler));
ok("wrangler_workflow_file", /update-chmi-cap-v2\.yml/.test(wrangler));
ok("wrangler_stale_8", /STALE_AFTER_MINUTES\s*=\s*"8"/.test(wrangler));
ok("index_no_token_log", !/GITHUB_TOKEN\}/.test(index) && !/console\.log\([^\)]*TOKEN/.test(index));
ok("index_dispatch_204", /status === 204/.test(index));
ok("index_concurrency_busy", /busy/.test(decision));
ok("index_health_probe", /\/health/.test(index) && /\/probe/.test(index));
ok("deploy_secret_put", /wrangler secret put GITHUB_TOKEN/.test(deploy));
ok("fallback_probe", /chmi-cap-watchdog.*probe|WATCHDOG_PROBE_URL/.test(fallback));
ok("cap_workflow_dispatch", /workflow_dispatch/.test(capWf));

if (fails.length) {
  console.error("IU_CHMI_REDUNDANT_TRIGGER_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_CHMI_REDUNDANT_TRIGGER_GUARD=PASS");
