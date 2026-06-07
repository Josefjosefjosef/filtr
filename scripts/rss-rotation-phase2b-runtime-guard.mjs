/**
 * RSS Rotation Phase 2B runtime guard — workflow/env/watchdog + diff scope.
 * Run: node scripts/rss-rotation-phase2b-runtime-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { activeRegistryEntries, loadRegistry, root } from "./source-rotation-guard-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BATCH_IDS = ["A", "B", "C", "D"];
const FORBIDDEN_DIFF_PATHS = [
  /^projects\/data\/articles\.json$/,
  /^projects\/data\/articles\/bootstrap\.json$/,
  /^projects\/data\/articles\/index\.json$/,
  /^assets\/app\.js$/,
  /^projects\/index\.html$/,
];

function log(msg) {
  console.log(`[rss-rotation-phase2b-runtime-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[rss-rotation-phase2b-runtime-guard] FAIL: ${msg}`);
}

function parseWranglerCron(tomlText) {
  const m = tomlText.match(/crons\s*=\s*\[\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function parseWorkflowJobEnv(workflowText, jobName) {
  const idx = workflowText.indexOf(`${jobName}:`);
  if (idx < 0) return null;
  const slice = workflowText.slice(idx, idx + 4000);
  const envBlock = slice.match(/\n\s*env:\s*\n([\s\S]*?)(?:\n\s{4}\w|\n\s{2}\w)/);
  if (!envBlock) return {};
  const out = {};
  for (const line of envBlock[1].split("\n")) {
    const m = line.match(/^\s{6}([A-Z0-9_]+):\s*"?([^"\n]+)"?\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function stepEnvHasFlag(workflowText, stepNeedle, flagName) {
  const idx = workflowText.indexOf(stepNeedle);
  if (idx < 0) return false;
  const slice = workflowText.slice(idx, idx + 800);
  return new RegExp(`\\n\\s+${flagName}:\\s*"1"`).test(slice);
}

function loadBatchRegistry() {
  const p =
    process.env.ROTATION_BATCH_REGISTRY_PATH ||
    path.join(root, "projects", "data", "rotation_batch_registry.json");
  if (!fs.existsSync(p)) {
    throw new Error(`missing batch registry ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function gitDiffNames(baseRef) {
  const names = new Set();
  for (const cmd of [`git diff --name-only ${baseRef}`, `git diff --name-only ${baseRef}...HEAD`]) {
    try {
      const out = execSync(cmd, {
        cwd: root,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      for (const line of out.split(/\r?\n/)) {
        const s = line.trim();
        if (s) names.add(s.replace(/\\/g, "/"));
      }
    } catch {
      /* ignore */
    }
  }
  return [...names];
}

function main() {
  let failed = false;
  const wranglerPath = path.join(root, "cloudflare", "articles-watchdog", "wrangler.toml");
  const workflowPath = path.join(root, ".github", "workflows", "update-articles.yml");
  const pagesPublishPath = path.join(root, ".github", "workflows", "pages-publish-from-main-data.yml");

  if (!fs.existsSync(wranglerPath)) {
    fail("watchdog wrangler.toml missing");
    failed = true;
  } else {
    const cron = parseWranglerCron(fs.readFileSync(wranglerPath, "utf8"));
    log(`watchdog cron=${cron ?? "n/a"}`);
    if (cron !== "*/5 * * * *") {
      fail(`watchdog cron must be */5 for Phase 2B, got ${cron}`);
      failed = true;
    } else {
      log("watchdog */5 PASS");
    }
  }

  if (!fs.existsSync(workflowPath)) {
    fail("update-articles.yml missing");
    failed = true;
  } else {
    const wf = fs.readFileSync(workflowPath, "utf8");
    const ingestJobEnv = parseWorkflowJobEnv(wf, "article_pipeline_ingest");
    const aggregateJobEnv = parseWorkflowJobEnv(wf, "article_pipeline_aggregate");
    const releaseJobEnv = parseWorkflowJobEnv(wf, "article_data_release");

    if (ingestJobEnv?.RSS_ROTATION_BATCH_RUNTIME === "1") {
      log("ingest job RSS_ROTATION_BATCH_RUNTIME=1 PASS");
    } else if (stepEnvHasFlag(wf, "Article pipeline — ingest (RSS → staging)", "RSS_ROTATION_BATCH_RUNTIME")) {
      log("ingest step RSS_ROTATION_BATCH_RUNTIME=1 PASS");
    } else {
      fail("RSS_ROTATION_BATCH_RUNTIME must be set for ingest job/step");
      failed = true;
    }

    if (aggregateJobEnv?.RSS_ROTATION_BATCH_RUNTIME === "1") {
      fail("RSS_ROTATION_BATCH_RUNTIME must NOT be on aggregate job");
      failed = true;
    }
    if (releaseJobEnv?.RSS_ROTATION_BATCH_RUNTIME === "1") {
      fail("RSS_ROTATION_BATCH_RUNTIME must NOT be on publish/release job");
      failed = true;
    } else {
      log("publish/aggregate jobs without batch flag PASS");
    }

    if (/\n\s*schedule:\s*\n/m.test(wf)) {
      fail("update-articles.yml must not have GitHub schedule (Cloudflare dispatch only)");
      failed = true;
    } else {
      log("update-articles no GH schedule PASS");
    }
  }

  if (fs.existsSync(pagesPublishPath)) {
    const pages = fs.readFileSync(pagesPublishPath, "utf8");
    const m = pages.match(/cron:\s*"([^"]+)"/);
    const pagesCron = m ? m[1] : null;
    log(`pages-publish cron=${pagesCron ?? "n/a"} (informational)`);
  }

  try {
    const reg = loadRegistry();
    const active = activeRegistryEntries(reg);
    const activeIds = new Set(active.map((e) => String(e.id || "")));
    const batchReg = loadBatchRegistry();
    const mapping = batchReg.rotation_batch_by_source_id || {};
    const unassigned = [...activeIds].filter((id) => !mapping[id]);
    if (unassigned.length) {
      fail(`batch registry unassigned sources: ${unassigned.slice(0, 5).join(", ")}`);
      failed = true;
    } else {
      log("batch registry covers all active sources PASS");
    }
    for (const bid of BATCH_IDS) {
      const count = (batchReg.batches?.[bid]?.source_ids || []).length;
      log(`batch_${bid}=${count}`);
      if (count < 14 || count > 16) {
        fail(`batch ${bid} count ${count} outside 14–16`);
        failed = true;
      }
    }
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    failed = true;
  }

  const diffBase = process.env.PHASE2B_DIFF_BASE || "main";
  const changed = gitDiffNames(diffBase);
  if (changed.length) {
    log(`git diff vs ${diffBase}: ${changed.length} file(s)`);
    for (const f of changed) {
      for (const re of FORBIDDEN_DIFF_PATHS) {
        if (re.test(f.replace(/\\/g, "/"))) {
          fail(`forbidden path in PR diff: ${f}`);
          failed = true;
        }
      }
    }
    if (!failed) log("diff scope (no forbidden article data paths) PASS");
  } else {
    log("git diff empty or unavailable — skip forbidden-path check");
  }

  if (failed) {
    console.error("[rss-rotation-phase2b-runtime-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
