#!/usr/bin/env node
/**
 * Fail when critical article publication workflows are disabled on GitHub.
 * Prevents silent pipeline stop (watchdog dispatch → HTTP 422).
 *
 * Run: node scripts/iu-articles-pipeline-workflows-guard.mjs
 * Env: GH_TOKEN (required in CI)
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Must stay in sync with Cloudflare watchdog lanes + fallback chain. */
const REQUIRED_ACTIVE = [
  { path: ".github/workflows/update-articles-fast-pool.yml", label: "Update articles fast pool" },
  { path: ".github/workflows/update-articles.yml", label: "Update articles data" },
  { path: ".github/workflows/articles-watchdog-cron-fallback.yml", label: "Articles watchdog cron fallback" },
  { path: ".github/workflows/pages-publish-from-main-data.yml", label: "Pages publish from main data" },
];

function ghJson(args) {
  const out = execSync(`gh ${args}`, {
    cwd: REPO,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  return JSON.parse(out);
}

function main() {
  const fails = [];
  let workflows = [];
  try {
    const data = ghJson('api repos/Josefjosefjosef/filtr/actions/workflows --paginate');
    workflows = data.workflows || [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("IU_ARTICLES_PIPELINE_WORKFLOWS_GUARD_FAIL");
    console.error("gh api error:", msg);
    process.exit(1);
  }

  const byPath = new Map();
  for (const wf of workflows) {
    if (wf.path) byPath.set(wf.path, wf);
  }

  for (const req of REQUIRED_ACTIVE) {
    const wf = byPath.get(req.path);
    if (!wf) {
      fails.push(`missing workflow file on GitHub: ${req.path}`);
      continue;
    }
    if (wf.state !== "active") {
      fails.push(`${req.label} (${req.path}) state=${wf.state} id=${wf.id}`);
    }
  }

  const report = {
    measuredAt: new Date().toISOString(),
    pass: fails.length === 0,
    required: REQUIRED_ACTIVE.map((r) => r.path),
    fails,
  };

  console.log("IU_ARTICLES_PIPELINE_WORKFLOWS_GUARD_RESULT");
  console.log(JSON.stringify(report, null, 2));

  if (fails.length) {
    console.error("FAIL: critical article workflows not active — re-enable via GitHub Actions UI or:");
    for (const f of fails) {
      const m = f.match(/id=(\d+)/);
      if (m) {
        console.error(`  gh api --method PUT repos/Josefjosefjosef/filtr/actions/workflows/${m[1]}/enable`);
      }
    }
    process.exit(1);
  }
  console.log("PASS");
}

main();
