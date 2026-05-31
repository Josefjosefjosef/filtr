/**
 * Articles aggregator infrastructure guard — stale prod, watchdog, pipeline deadlock,
 * aggregate timeout regression, cancelled Pages deploy without replacement success.
 *
 * Run: node scripts/articles-aggregator-infra-guard.mjs
 *
 * Env:
 *   ARTICLES_JSON_URL — production articles.json (default prod URL)
 *   WATCHDOG_HEALTH_URL — optional GET /health target (e.g. workers.dev)
 *   REQUIRE_WATCHDOG — "true" to fail when watchdog health unreachable
 *   GITHUB_REPOSITORY — owner/repo (default Josefjosefjosef/filtr)
 *   GITHUB_TOKEN — GitHub API token (Actions: secrets.GITHUB_TOKEN)
 *   MAX_GENERATED_AGE_HOURS — stale bundle limit (default 48)
 *   QUEUED_STALE_MINUTES — queued zombie threshold (default 120, matches worker)
 *   AGGREGATE_TIMEOUT_MIN — minimum safe aggregate job timeout (default 60)
 *   PAGES_LOOKBACK_HOURS — cancelled deploy scan window (default 48)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const ARTICLES_JSON_URL =
  (process.env.ARTICLES_JSON_URL || "").trim() ||
  "https://infouzel.cz/projects/data/articles.json";
const WATCHDOG_HEALTH_URL = (process.env.WATCHDOG_HEALTH_URL || "").trim();
const REQUIRE_WATCHDOG = String(process.env.REQUIRE_WATCHDOG || "").toLowerCase() === "true";
const GITHUB_REPOSITORY = (process.env.GITHUB_REPOSITORY || "Josefjosefjosef/filtr").trim();
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
const MAX_GENERATED_AGE_H = Number(process.env.MAX_GENERATED_AGE_HOURS || "48");
const QUEUED_STALE_MIN = Number(process.env.QUEUED_STALE_MINUTES || "120");
const AGGREGATE_TIMEOUT_MIN = Number(process.env.AGGREGATE_TIMEOUT_MIN || "60");
const PAGES_LOOKBACK_H = Number(process.env.PAGES_LOOKBACK_HOURS || "48");

const UPDATE_WORKFLOW = "update-articles.yml";
const PAGES_WORKFLOW = "pages.yml";
const UPDATE_ARTICLES_WORKFLOW_PATH = path.join(root, ".github", "workflows", "update-articles.yml");

function log(msg) {
  console.log(`[articles-aggregator-infra-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[articles-aggregator-infra-guard] FAIL: ${msg}`);
}

function parseTs(v) {
  if (!v || typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function hoursAgo(tsMs, nowMs) {
  return (nowMs - tsMs) / 3_600_000;
}

function minutesAgo(tsMs, nowMs) {
  return (nowMs - tsMs) / 60_000;
}

async function ghApi(pathname) {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN missing (required for pipeline/deploy checks)");
  }
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "articles-aggregator-infra-guard",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${pathname} failed ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function checkStaleArticles(nowMs) {
  log(`stale_article_guard url=${ARTICLES_JSON_URL} limit_hours=${MAX_GENERATED_AGE_H}`);
  const res = await fetch(ARTICLES_JSON_URL, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    fail(`stale_article_guard HTTP ${res.status}`);
    return { ok: false, generatedAt: null, ageHours: null };
  }
  const doc = await res.json();
  const genTs = parseTs(doc.generatedAt);
  if (!genTs) {
    fail("stale_article_guard missing generatedAt");
    return { ok: false, generatedAt: doc.generatedAt || null, ageHours: null };
  }
  const ageH = hoursAgo(genTs, nowMs);
  log(`stale_article_guard generatedAt=${doc.generatedAt} age_hours=${ageH.toFixed(1)}`);
  if (ageH > MAX_GENERATED_AGE_H) {
    fail(`stale_article_guard bundle older than ${MAX_GENERATED_AGE_H}h`);
    return { ok: false, generatedAt: doc.generatedAt, ageHours: ageH };
  }
  log("stale_article_guard PASS");
  return { ok: true, generatedAt: doc.generatedAt, ageHours: ageH };
}

async function checkWatchdogHealth() {
  if (!WATCHDOG_HEALTH_URL) {
    log("watchdog_health SKIP (WATCHDOG_HEALTH_URL unset)");
    return { ok: !REQUIRE_WATCHDOG, deployed: false, reachable: false, reason: "url_unset" };
  }
  log(`watchdog_health url=${WATCHDOG_HEALTH_URL}`);
  try {
    const res = await fetch(WATCHDOG_HEALTH_URL, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!res.ok) {
      const msg = `HTTP ${res.status}`;
      if (REQUIRE_WATCHDOG) fail(`watchdog_health ${msg}`);
      else log(`watchdog_health WARN ${msg}`);
      return { ok: !REQUIRE_WATCHDOG, deployed: false, reachable: false, reason: msg };
    }
    const body = await res.json();
    if (body?.ok !== true) {
      if (REQUIRE_WATCHDOG) fail("watchdog_health body ok!=true");
      else log("watchdog_health WARN body ok!=true");
      return { ok: !REQUIRE_WATCHDOG, deployed: true, reachable: true, reason: "bad_body" };
    }
    log("watchdog_health PASS");
    return { ok: true, deployed: true, reachable: true, reason: "ok" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (REQUIRE_WATCHDOG) fail(`watchdog_health unreachable: ${msg}`);
    else log(`watchdog_health WARN unreachable: ${msg}`);
    return { ok: !REQUIRE_WATCHDOG, deployed: false, reachable: false, reason: msg };
  }
}

async function checkDeadlockGuard(nowMs) {
  log(`deadlock_guard workflow=${UPDATE_WORKFLOW} queued_stale_min=${QUEUED_STALE_MIN}`);
  const [owner, repo] = GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(UPDATE_WORKFLOW);
  const data = await ghApi(
    `/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=20&branch=main`,
  );
  const runs = data.workflow_runs || [];

  const zombies = runs.filter((r) => {
    if (r.status !== "queued") return false;
    const created = parseTs(r.created_at);
    if (!created) return true;
    return minutesAgo(created, nowMs) >= QUEUED_STALE_MIN;
  });
  if (zombies.length) {
    for (const z of zombies) {
      log(
        `deadlock_guard WARN queued zombie run_id=${z.id} created_at=${z.created_at} (ignored by watchdog policy)`,
      );
    }
  }

  const stuckInProgress = runs.filter((r) => {
    if (r.status !== "in_progress") return false;
    const created = parseTs(r.created_at);
    if (!created) return true;
    return minutesAgo(created, nowMs) >= AGGREGATE_TIMEOUT_MIN + 30;
  });
  if (stuckInProgress.length) {
    for (const r of stuckInProgress) {
      fail(
        `deadlock_guard in_progress run_id=${r.id} older than ${AGGREGATE_TIMEOUT_MIN + 30}m created_at=${r.created_at}`,
      );
    }
    return { ok: false, stuckInProgress: stuckInProgress.map((r) => r.id) };
  }

  const blockingQueued = runs.filter((r) => {
    if (r.status !== "queued") return false;
    const created = parseTs(r.created_at);
    if (!created) return true;
    const ageMin = minutesAgo(created, nowMs);
    return ageMin >= 30 && ageMin < QUEUED_STALE_MIN;
  });
  if (blockingQueued.length) {
    for (const r of blockingQueued) {
      fail(
        `deadlock_guard queued run_id=${r.id} stuck ${minutesAgo(parseTs(r.created_at), nowMs).toFixed(0)}m created_at=${r.created_at}`,
      );
    }
    return { ok: false, blockingQueued: blockingQueued.map((r) => r.id) };
  }

  log("deadlock_guard PASS");
  return { ok: true };
}

function checkAggregateTimeoutGuard() {
  log(`aggregate_timeout_guard min_required=${AGGREGATE_TIMEOUT_MIN}m`);
  if (!fs.existsSync(UPDATE_ARTICLES_WORKFLOW_PATH)) {
    fail("aggregate_timeout_guard workflow file missing");
    return { ok: false, timeoutMinutes: null };
  }
  const text = fs.readFileSync(UPDATE_ARTICLES_WORKFLOW_PATH, "utf8");
  const idx = text.indexOf("article_pipeline_aggregate:");
  if (idx < 0) {
    fail("aggregate_timeout_guard article_pipeline_aggregate job not found");
    return { ok: false, timeoutMinutes: null };
  }
  const slice = text.slice(idx, idx + 800);
  const m = slice.match(/timeout-minutes:\s*(\d+)/);
  const timeout = m ? Number(m[1]) : null;
  if (!Number.isFinite(timeout)) {
    fail("aggregate_timeout_guard timeout-minutes not parseable");
    return { ok: false, timeoutMinutes: null };
  }
  log(`aggregate_timeout_guard configured=${timeout}m`);
  if (timeout < AGGREGATE_TIMEOUT_MIN) {
    fail(`aggregate_timeout_guard ${timeout}m < required ${AGGREGATE_TIMEOUT_MIN}m`);
    return { ok: false, timeoutMinutes: timeout };
  }
  log("aggregate_timeout_guard PASS");
  return { ok: true, timeoutMinutes: timeout };
}

async function checkCancelledDeployGuard(nowMs) {
  log(`cancelled_deploy_guard workflow=${PAGES_WORKFLOW} lookback_hours=${PAGES_LOOKBACK_H}`);
  const [owner, repo] = GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(PAGES_WORKFLOW);
  const data = await ghApi(
    `/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=30&branch=main`,
  );
  const runs = (data.workflow_runs || []).filter((r) => {
    const created = parseTs(r.created_at);
    return created !== null && hoursAgo(created, nowMs) <= PAGES_LOOKBACK_H;
  });

  const bySha = new Map();
  for (const r of runs) {
    const sha = r.head_sha || r.headSha || "";
    if (!sha) continue;
    if (!bySha.has(sha)) bySha.set(sha, []);
    bySha.get(sha).push(r);
  }

  let ok = true;
  for (const [sha, shaRuns] of bySha) {
    const cancelled = shaRuns.filter((r) => r.conclusion === "cancelled");
    const success = shaRuns.filter((r) => r.conclusion === "success");
    if (!cancelled.length) continue;
    if (success.length) {
      log(
        `cancelled_deploy_guard sha=${sha.slice(0, 7)} cancelled=${cancelled.length} superseded_by_success=${success.length}`,
      );
      continue;
    }
    fail(
      `cancelled_deploy_guard sha=${sha.slice(0, 7)} has cancelled Pages run(s) without successful deploy`,
    );
    ok = false;
  }
  if (ok) log("cancelled_deploy_guard PASS");
  return { ok };
}

function runFreshnessGuard() {
  log("freshness_guard delegating to articles-aggregator-freshness-guard.mjs");
  const script = path.join(root, "scripts", "articles-aggregator-freshness-guard.mjs");
  const res = spawnSync(process.execPath, [script], {
    env: { ...process.env, ARTICLES_JSON_URL },
    stdio: "inherit",
  });
  return res.status === 0;
}

async function main() {
  const nowMs = Date.now();
  let failed = false;

  const stale = await checkStaleArticles(nowMs);
  if (!stale.ok) failed = true;

  const watchdog = await checkWatchdogHealth();
  if (!watchdog.ok) failed = true;

  if (!runFreshnessGuard()) {
    fail("freshness_guard RESULT=FAIL");
    failed = true;
  }

  try {
    const agg = checkAggregateTimeoutGuard();
    if (!agg.ok) failed = true;
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
    failed = true;
  }

  if (GITHUB_TOKEN) {
    try {
      const deadlock = await checkDeadlockGuard(nowMs);
      if (!deadlock.ok) failed = true;
    } catch (e) {
      fail(`deadlock_guard ${e instanceof Error ? e.message : String(e)}`);
      failed = true;
    }
    try {
      const pages = await checkCancelledDeployGuard(nowMs);
      if (!pages.ok) failed = true;
    } catch (e) {
      fail(`cancelled_deploy_guard ${e instanceof Error ? e.message : String(e)}`);
      failed = true;
    }
  } else {
    log("deadlock_guard SKIP (GITHUB_TOKEN unset)");
    log("cancelled_deploy_guard SKIP (GITHUB_TOKEN unset)");
  }

  if (failed) {
    console.error("[articles-aggregator-infra-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main().catch((e) => {
  fail(e.message || String(e));
  process.exit(1);
});
