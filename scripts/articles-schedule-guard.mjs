/**
 * Articles schedule guard — verifies safe autorun model for update-articles.yml.
 *
 * Expected model: NO GitHub schedule; Cloudflare Worker cron dispatches workflow_dispatch.
 * Concurrency must queue (not cancel) long-running pipeline runs.
 *
 * Run: node scripts/articles-schedule-guard.mjs
 *
 * Env:
 *   UPDATE_ARTICLES_WORKFLOW — path relative to repo root (default .github/workflows/update-articles.yml)
 *   WRANGLER_TOML — watchdog config (default cloudflare/articles-watchdog/wrangler.toml)
 *   EXPECTED_CHECK_CRON — Cloudflare cron (default every 15 min: star-slash-15)
 *   MIN_AGGREGATE_TIMEOUT_MIN — minimum aggregate job timeout (default 60)
 *   MIN_RELEASE_TIMEOUT_MIN — minimum release job timeout (default 12)
 *   OBSERVED_RUN_DURATION_MIN — p95-ish run length for timeout sanity (default 55)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const WORKFLOW_PATH = path.join(
  root,
  process.env.UPDATE_ARTICLES_WORKFLOW || ".github/workflows/update-articles.yml",
);
const WRANGLER_PATH = path.join(
  root,
  process.env.WRANGLER_TOML || "cloudflare/articles-watchdog/wrangler.toml",
);
const EXPECTED_CHECK_CRON = (process.env.EXPECTED_CHECK_CRON || "*/15 * * * *").trim();
const MIN_AGG_TIMEOUT = Number(process.env.MIN_AGGREGATE_TIMEOUT_MIN || "60");
const MIN_REL_TIMEOUT = Number(process.env.MIN_RELEASE_TIMEOUT_MIN || "12");
const OBSERVED_RUN_MIN = Number(process.env.OBSERVED_RUN_DURATION_MIN || "55");

function log(msg) {
  console.log(`[articles-schedule-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[articles-schedule-guard] FAIL: ${msg}`);
}

function parseJobTimeout(workflowText, jobName) {
  const idx = workflowText.indexOf(`${jobName}:`);
  if (idx < 0) return null;
  const slice = workflowText.slice(idx, idx + 600);
  const m = slice.match(/timeout-minutes:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

function parseConcurrency(workflowText) {
  const block = workflowText.match(/concurrency:\s*\n([\s\S]*?)(?:\n\n|\npermissions:)/);
  if (!block) return { group: null, cancelInProgress: null };
  const group = block[1].match(/group:\s*(.+)/)?.[1]?.trim() || null;
  const cancel = block[1].match(/cancel-in-progress:\s*(true|false)/)?.[1];
  return {
    group,
    cancelInProgress: cancel === "true" ? true : cancel === "false" ? false : null,
  };
}

function parseWranglerCron(tomlText) {
  const m = tomlText.match(/crons\s*=\s*\[\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function parseStaleAfterMinutes(tomlText) {
  const m = tomlText.match(/STALE_AFTER_MINUTES\s*=\s*"(\d+)"/);
  return m ? Number(m[1]) : null;
}

function main() {
  let failed = false;

  if (!fs.existsSync(WORKFLOW_PATH)) {
    fail(`workflow missing: ${WORKFLOW_PATH}`);
    process.exit(1);
  }
  const wf = fs.readFileSync(WORKFLOW_PATH, "utf8");

  const hasGhSchedule = /\bon:\s*\n[\s\S]*?\n\s*schedule:/m.test(wf) || /\n\s*schedule:\s*\n/m.test(wf);
  const hasDispatch = /\n\s*workflow_dispatch:\s*\{\}/m.test(wf) || /\n\s*workflow_dispatch:\s*\n/m.test(wf);

  if (hasGhSchedule) {
    fail("GitHub on.schedule present — expected Cloudflare Worker autorun only (remove GH schedule)");
    failed = true;
  } else {
    log("github_schedule absent PASS (Cloudflare Worker model)");
  }

  if (!hasDispatch) {
    fail("workflow_dispatch missing");
    failed = true;
  } else {
    log("workflow_dispatch present PASS");
  }

  const conc = parseConcurrency(wf);
  log(`concurrency group=${conc.group ?? "n/a"} cancel-in-progress=${conc.cancelInProgress}`);
  if (conc.cancelInProgress === true) {
    fail("cancel-in-progress:true unsafe for release — must queue instead");
    failed = true;
  } else if (conc.cancelInProgress === false) {
    log("concurrency cancel-in-progress=false PASS");
  } else {
    fail("concurrency cancel-in-progress not parseable");
    failed = true;
  }

  const ingestTimeout = parseJobTimeout(wf, "article_pipeline_ingest");
  const aggTimeout = parseJobTimeout(wf, "article_pipeline_aggregate");
  const relTimeout = parseJobTimeout(wf, "article_data_release");
  log(`timeouts ingest=${ingestTimeout}m aggregate=${aggTimeout}m release=${relTimeout}m`);

  if (!Number.isFinite(aggTimeout) || aggTimeout < MIN_AGG_TIMEOUT) {
    fail(`aggregate timeout ${aggTimeout}m < required ${MIN_AGG_TIMEOUT}m`);
    failed = true;
  } else {
    log("aggregate timeout PASS");
  }

  if (!Number.isFinite(relTimeout) || relTimeout < MIN_REL_TIMEOUT) {
    fail(`release timeout ${relTimeout}m < required ${MIN_REL_TIMEOUT}m`);
    failed = true;
  } else {
    log("release timeout PASS");
  }

  // Release job is shorter than full ingest+aggregate; compare aggregate only to observed run.
  if (Number.isFinite(aggTimeout) && aggTimeout > 0 && aggTimeout < OBSERVED_RUN_MIN) {
    fail(`aggregate timeout ${aggTimeout}m < observed run duration ~${OBSERVED_RUN_MIN}m`);
    failed = true;
  } else {
    log(`timeout vs observed run (~${OBSERVED_RUN_MIN}m) PASS`);
  }

  if (!fs.existsSync(WRANGLER_PATH)) {
    fail(`watchdog wrangler.toml missing: ${WRANGLER_PATH}`);
    failed = true;
  } else {
    const toml = fs.readFileSync(WRANGLER_PATH, "utf8");
    const cron = parseWranglerCron(toml);
    const staleAfter = parseStaleAfterMinutes(toml);
    log(`watchdog cron=${cron ?? "n/a"} STALE_AFTER_MINUTES=${staleAfter ?? "n/a"}`);
    if (cron !== EXPECTED_CHECK_CRON) {
      fail(`watchdog cron ${cron} != expected ${EXPECTED_CHECK_CRON}`);
      failed = true;
    } else {
      log("watchdog check interval PASS");
    }
    if (!Number.isFinite(staleAfter) || staleAfter < 10) {
      fail("STALE_AFTER_MINUTES missing or too low");
      failed = true;
    } else {
      log("STALE_AFTER_MINUTES PASS");
    }
  }

  if (failed) {
    console.error("[articles-schedule-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
