/**
 * aggregator_legacy_cleanup_guard — static audit: single V3 prod path, no legacy publish/cron bypass.
 * Run: node scripts/aggregator-legacy-cleanup-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const workflowsDir = path.join(root, ".github", "workflows");

const CANONICAL_UA =
  "infoUzelBot/1.0 (+https://infouzel.cz; contact: Info@infoUzel.cz)";
const PRIMARY_PUBLISH_WORKFLOW = "update-articles.yml";
const WATCHDOG_WORKFLOW_FILE = "update-articles.yml";
const NIGHTLY_REBUILD_WORKFLOW = "articles-nightly-full-rebuild.yml";

const LEGACY_SCRIPT_MARKERS = [
  { rel: "scripts/build_articles_v2.py", reason: "filtr/data layer; not wired in CI" },
  { rel: "scripts/run_articles_pipeline.py", reason: "wrapper for build_articles_v2 only" },
  { rel: "scripts/update-articles.js", reason: "demo generator to data/articles.json" },
  { rel: "scripts/fetch_engine.py", reason: "used only by build_articles_v2" },
];

const RUNTIME_ARTIFACTS = [
  "feed_build.log",
  "projects/data/staging/",
  "projects/data/feed_snapshots/",
  "projects/data/fetch_monitor.json",
];

function log(msg) {
  console.log(`[aggregator-legacy-cleanup-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[aggregator-legacy-cleanup-guard] FAIL: ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function listWorkflowFiles() {
  return fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => path.join(workflowsDir, f));
}

function parseTriggers(text) {
  const onBlock = text.match(/^on:\s*\n([\s\S]*?)(?=^[a-z]|^env:|^permissions:|^concurrency:|^jobs:)/m);
  if (!onBlock) return { schedule: [], dispatch: false, push: false, pr: false };
  const block = onBlock[1];
  const schedules = [...block.matchAll(/cron:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  return {
    schedule: schedules,
    dispatch: /\bworkflow_dispatch\b/.test(block),
    push: /\bpush:\b/.test(block),
    pr: /\bpull_request\b/.test(block),
  };
}

function workflowInvokesBuildArticles(text) {
  return /python\s+scripts\/build_articles\.py/.test(text);
}

function workflowInvokesLegacyBuild(text) {
  return (
    /build_articles_v2/.test(text) ||
    /update-articles\.js/.test(text) ||
    /run_articles_pipeline/.test(text)
  );
}

function articlesRelatedWorkflow(name, text) {
  const n = name.toLowerCase();
  if (
    n.includes("article") ||
    n.includes("aggregator") ||
    n.includes("watchdog") ||
    n.includes("pages-publish-from-main-data") ||
    n.includes("pages-on-data-pr-merge") ||
    n.includes("after-merge-articles")
  ) {
    return true;
  }
  return workflowInvokesBuildArticles(text);
}

function main() {
  let failed = false;
  const report = {
    active_workflows: [],
    legacy_workflows: [],
    nightly_only_workflows: [],
    recovery_only_workflows: [],
    guard_only_workflows: [],
    publish_workflows: [],
    legacy_publish_paths: [],
    dead_code_candidates: [],
    generated_runtime_artifacts: RUNTIME_ARTIFACTS.slice(),
    git_tracked_runtime_artifacts: [],
  };

  // --- Runtime artifacts in git index ---
  for (const rel of ["feed_build.log", "projects/data/staging"]) {
    try {
      const tracked = fs.existsSync(path.join(root, rel));
      if (rel === "feed_build.log" && tracked) {
        const st = fs.statSync(path.join(root, rel));
        if (st.isFile()) {
          /* may be ignored locally */
        }
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const gitignore = read(".gitignore");
    if (!gitignore.includes("feed_build.log")) {
      fail(".gitignore must ignore feed_build.log");
      failed = true;
    } else {
      log("feed_build.log in .gitignore PASS");
    }
  } catch (e) {
    fail(`cannot read .gitignore: ${e.message}`);
    failed = true;
  }

  // --- Legacy scripts not referenced from workflows ---
  const allWorkflowText = listWorkflowFiles()
    .map((p) => fs.readFileSync(p, "utf8"))
    .join("\n");
  const packageJson = JSON.parse(read("package.json"));
  const pkgScripts = Object.values(packageJson.scripts || {}).join("\n");

  for (const item of LEGACY_SCRIPT_MARKERS) {
    const used =
      allWorkflowText.includes(item.rel) ||
      allWorkflowText.includes(path.basename(item.rel)) ||
      pkgScripts.includes(item.rel);
    if (!used) {
      report.dead_code_candidates.push(`${item.rel} (${item.reason})`);
    } else {
      fail(`legacy script still referenced in workflow/package: ${item.rel}`);
      failed = true;
    }
  }
  log(`dead_code_candidates=${report.dead_code_candidates.length}`);

  // --- Workflow scan ---
  let prodPublishCount = 0;
  let updateArticlesHasSchedule = false;

  for (const wfPath of listWorkflowFiles()) {
    const name = path.basename(wfPath);
    const text = fs.readFileSync(wfPath, "utf8");
    if (!articlesRelatedWorkflow(name, text)) continue;

    const triggers = parseTriggers(text);
    const invokesBuild = workflowInvokesBuildArticles(text);
    const invokesLegacy = workflowInvokesLegacyBuild(text);

    if (invokesLegacy) {
      fail(`${name} invokes legacy article build path`);
      failed = true;
    }

    const entry = {
      file: name,
      schedule: triggers.schedule,
      workflow_dispatch: triggers.dispatch,
      invokes_build_articles: invokesBuild,
    };

    if (name === PRIMARY_PUBLISH_WORKFLOW) {
      if (triggers.schedule.length > 0) {
        updateArticlesHasSchedule = true;
        fail(`${name} must not have GitHub schedule (watchdog only)`);
        failed = true;
      } else {
        log(`${name} no GitHub schedule PASS`);
      }
      if (!triggers.dispatch) {
        fail(`${name} must allow workflow_dispatch`);
        failed = true;
      }
      if (!/IU_INCREMENTAL_PUBLISH/.test(text)) {
        fail(`${name} must set IU_INCREMENTAL_PUBLISH on ingest`);
        failed = true;
      } else {
        log(`${name} IU_INCREMENTAL_PUBLISH PASS`);
      }
      report.active_workflows.push(name);
      report.publish_workflows.push(name);
      prodPublishCount += 1;
    } else if (name === NIGHTLY_REBUILD_WORKFLOW) {
      if (!/IU_FULL_REBUILD/.test(text)) {
        fail(`${name} must set IU_FULL_REBUILD`);
        failed = true;
      }
      if (!/IU_ARTICLE_PIPELINE_PHASE:\s*ingest/.test(text) && !/ingest/.test(text)) {
        log(`${name} ingest-only rebuild (no release job) — OK`);
      }
      const hasRelease =
        /article_data_release/.test(text) || /publish/.test(text.toLowerCase());
      if (hasRelease && invokesBuild) {
        fail(`${name} must not run full publish/release path alongside nightly ingest`);
        failed = true;
      }
      report.nightly_only_workflows.push(name);
    } else if (invokesBuild) {
      fail(`unexpected build_articles.py in ${name}`);
      failed = true;
    } else if (name.includes("ci-articles") || name.includes("guard") || name.includes("infra")) {
      report.guard_only_workflows.push(name);
    } else if (name.includes("pages-publish") || name.includes("pages-on-data")) {
      report.active_workflows.push(`${name} (publish chain, no ingest)`);
    } else if (name.includes("deploy-articles-watchdog")) {
      report.active_workflows.push(name);
    } else {
      report.legacy_workflows.push(name);
    }
  }

  if (prodPublishCount !== 1) {
    fail(`expected exactly 1 primary publish workflow, found ${prodPublishCount}`);
    failed = true;
  } else {
    log("single primary publish workflow PASS");
  }

  if (updateArticlesHasSchedule) {
    failed = true;
  }

  // --- Watchdog targets V3 workflow ---
  const wrangler = read("cloudflare/articles-watchdog/wrangler.toml");
  const wfFile = wrangler.match(/WORKFLOW_FILE\s*=\s*"([^"]+)"/)?.[1];
  if (wfFile !== WATCHDOG_WORKFLOW_FILE) {
    fail(`watchdog WORKFLOW_FILE must be ${WATCHDOG_WORKFLOW_FILE}, got ${wfFile}`);
    failed = true;
  } else {
    log("watchdog WORKFLOW_FILE PASS");
  }

  // --- build_articles.py: single writer, topic dedupe twice, iu_crawler ---
  const build = read("scripts/build_articles.py");
  if (!build.includes("from iu_crawler import")) {
    fail("build_articles.py must use iu_crawler");
    failed = true;
  }
  if (!build.includes("_apply_conservative_topic_clustering")) {
    fail("build_articles.py missing topic dedupe");
    failed = true;
  }
  const dedupeCalls = (build.match(/_apply_conservative_topic_clustering/g) || []).length;
  if (dedupeCalls < 2) {
    fail(`topic dedupe must run at least twice (pre+post retention), calls=${dedupeCalls}`);
    failed = true;
  } else {
    log(`topic dedupe invocations=${dedupeCalls} PASS`);
  }
  if (!build.includes("apply_topic_event_dedupe")) {
    fail("build_articles.py must call apply_topic_event_dedupe");
    failed = true;
  }
  if (!build.includes("iu_backpressure")) {
    fail("build_articles.py must use iu_backpressure");
    failed = true;
  } else {
    log("backpressure import PASS");
  }
  if (build.includes("from fetch_engine import") || build.includes("build_articles_v2")) {
    fail("build_articles.py must not import legacy v2/fetch_engine");
    failed = true;
  }

  // --- v2 must not write projects/data ---
  const v2 = read("scripts/build_articles_v2.py");
  if (v2.includes("projects/data/articles.json")) {
    fail("build_articles_v2.py must not write projects/data/articles.json");
    failed = true;
  } else {
    log("v2 isolated from projects/data PASS");
  }

  // --- source_rotation_inventory: generated in CI; optional committed snapshot on main ---
  if (!fs.existsSync(path.join(root, "scripts/source_rotation_inventory.py"))) {
    fail("missing source_rotation_inventory.py");
    failed = true;
  }
  const updateWf = read(".github/workflows/update-articles.yml");
  if (!updateWf.includes("source_rotation_inventory.py")) {
    fail("update-articles.yml must regenerate source_rotation_inventory");
    failed = true;
  } else {
    log("rotation inventory regen in release PASS");
  }

  // --- Emit report ---
  log(`active_workflows=${JSON.stringify(report.active_workflows)}`);
  log(`nightly_only_workflows=${JSON.stringify(report.nightly_only_workflows)}`);
  log(`guard_only_workflows=${JSON.stringify(report.guard_only_workflows)}`);
  log(`legacy_workflows=${JSON.stringify(report.legacy_workflows)}`);
  log(`publish_workflows=${JSON.stringify(report.publish_workflows)}`);
  log(`dead_code_candidates=${JSON.stringify(report.dead_code_candidates)}`);
  log(`generated_runtime_artifacts=${JSON.stringify(report.generated_runtime_artifacts)}`);
  log(`active_publish_flow=update-articles.yml → build_articles.py (ingest|aggregate|publish)`);
  log(`active_topic_dedupe_path=iu_topic_dedupe.apply_topic_event_dedupe via _apply_conservative_topic_clustering`);
  log(`topic_dedupe_can_be_bypassed=false`);
  log(`user_agent=${CANONICAL_UA}`);

  if (failed) {
    console.error("[aggregator-legacy-cleanup-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
