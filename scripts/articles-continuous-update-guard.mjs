/**
 * Articles continuous update guard — production freshness + pipeline liveness.
 *
 * Run: node scripts/articles-continuous-update-guard.mjs
 *
 * Env:
 *   FRESHNESS_URL — public index with generatedAt (default prod articles/index.json)
 *   ARTICLES_JSON_URL — full bundle for newest article (default prod articles.json)
 *   GITHUB_REPOSITORY — owner/repo
 *   GITHUB_TOKEN / GH_TOKEN — GitHub API (required for run checks)
 *   MAX_GENERATED_AGE_MINUTES — prod bundle staleness (default 90; ~53m run + 15m stale + margin)
 *   MAX_LAST_SUCCESS_AGE_MINUTES — last ingest+aggregate OK run (default 120)
 *   MAX_FAILURE_STREAK — consecutive RED pipeline runs (default 6)
 *   MAX_RELEASE_BLOCKED_STREAK — consecutive release-blocked runs (default 3)
 *   STRICT_YELLOW — "true" to fail on YELLOW pipeline state
 *   QUEUED_STALE_MINUTES — zombie queued threshold (default 120)
 *   IN_PROGRESS_STALE_MINUTES — stuck in_progress (default 90)
 *   WATCHDOG_HEALTH_URL — optional; if reachable, automatic trigger considered present
 *   REQUIRE_AUTOMATIC_TRIGGER — "true" to fail when neither GH schedule nor watchdog health
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ALERT_YELLOW,
  INGEST_SUCCESS_RELEASE_BLOCKED,
  PIPELINE_SUCCESS,
  alertLevelForOverallStatus,
  classifyRunFromGitHub,
  isIngestAggregateOkStatus,
  isPipelineFailureStatus,
} from "./iu_pipeline_run_classifier.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const FRESHNESS_URL =
  (process.env.FRESHNESS_URL || "").trim() ||
  "https://infouzel.cz/projects/data/articles/index.json";
const ARTICLES_JSON_URL =
  (process.env.ARTICLES_JSON_URL || "").trim() ||
  "https://infouzel.cz/projects/data/articles.json";
const GITHUB_REPOSITORY = (process.env.GITHUB_REPOSITORY || "Josefjosefjosef/filtr").trim();
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "").trim();
const MAX_GEN_AGE_MIN = Number(process.env.MAX_GENERATED_AGE_MINUTES || "90");
const MAX_SUCCESS_AGE_MIN = Number(process.env.MAX_LAST_SUCCESS_AGE_MINUTES || "120");
const MAX_FAIL_STREAK = Number(process.env.MAX_FAILURE_STREAK || "6");
const MAX_RELEASE_BLOCKED_STREAK = Number(process.env.MAX_RELEASE_BLOCKED_STREAK || "3");
const STRICT_YELLOW = String(process.env.STRICT_YELLOW || "").toLowerCase() === "true";
const CLASSIFIER_RUN_LIMIT = Number(process.env.CLASSIFIER_RUN_LIMIT || "20");
const QUEUED_STALE_MIN = Number(process.env.QUEUED_STALE_MINUTES || "120");
const IN_PROGRESS_STALE_MIN = Number(process.env.IN_PROGRESS_STALE_MINUTES || "90");
const WATCHDOG_HEALTH_URL =
  (process.env.WATCHDOG_HEALTH_URL || "").trim() ||
  "https://infouzel-articles-watchdog.josef-zmrhal.workers.dev/health";
const REQUIRE_AUTO = String(process.env.REQUIRE_AUTOMATIC_TRIGGER || "").toLowerCase() === "true";
const GITHUB_EVENT = (process.env.GITHUB_EVENT_NAME || "").trim();
const SKIP_PROD_FRESHNESS_ON_PR =
  String(process.env.SKIP_PROD_FRESHNESS_ON_PULL_REQUEST || "1").toLowerCase() !== "0";

const UPDATE_WORKFLOW = "update-articles.yml";
const WORKFLOW_PATH = path.join(root, ".github", "workflows", "update-articles.yml");

function log(msg) {
  console.log(`[articles-continuous-update-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[articles-continuous-update-guard] FAIL: ${msg}`);
}

function warn(msg) {
  console.warn(`[articles-continuous-update-guard] WARN: ${msg}`);
}

function parseTs(v) {
  if (!v || typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function minutesAgo(tsMs, nowMs) {
  return (nowMs - tsMs) / 60_000;
}

async function ghApi(pathname) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "articles-continuous-update-guard",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${pathname} ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function checkProductionFreshness(nowMs) {
  log(`prod_freshness index=${FRESHNESS_URL} limit_min=${MAX_GEN_AGE_MIN}`);
  const res = await fetch(FRESHNESS_URL, {
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  if (!res.ok) {
    fail(`prod_freshness HTTP ${res.status}`);
    return { ok: false, generatedAt: null, ageMinutes: null, todayCount: null, count: null };
  }
  const index = await res.json();
  const genTs = parseTs(index.generatedAt);
  if (!genTs) {
    fail("prod_freshness missing generatedAt");
    return { ok: false, generatedAt: null, ageMinutes: null, todayCount: null, count: null };
  }
  const ageMin = minutesAgo(genTs, nowMs);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const todayEntry = Array.isArray(index.days)
    ? index.days.find((d) => d?.date === today)
    : null;
  const todayCount = todayEntry?.count ?? null;
  log(`prod_freshness generatedAt=${index.generatedAt} age_min=${ageMin.toFixed(1)} todayCount=${todayCount}`);

  let newestArticle = null;
  let articleCount = null;
  try {
    const full = await fetch(ARTICLES_JSON_URL, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (full.ok) {
      const doc = await full.json();
      const list = Array.isArray(doc.articles) ? doc.articles : Array.isArray(doc.items) ? doc.items : [];
      articleCount = list.length;
      for (const a of list) {
        const ts = parseTs(a.publishedAt || a.pubDate || a.date);
        if (!ts) continue;
        if (!newestArticle || ts > parseTs(newestArticle.publishedAt || newestArticle.pubDate || newestArticle.date)) {
          newestArticle = a;
        }
      }
      if (newestArticle) {
        log(
          `prod_newest title=${String(newestArticle.title || "").slice(0, 60)} publishedAt=${newestArticle.publishedAt || newestArticle.pubDate || newestArticle.date}`,
        );
      }
    } else {
      log(`prod_articles.json HTTP ${full.status} (index-only check)`);
    }
  } catch (e) {
    log(`prod_articles.json fetch skipped: ${e instanceof Error ? e.message : e}`);
  }

  if (ageMin > MAX_GEN_AGE_MIN) {
    fail(`prod generatedAt older than ${MAX_GEN_AGE_MIN}m (${ageMin.toFixed(1)}m)`);
    return {
      ok: false,
      generatedAt: index.generatedAt,
      ageMinutes: ageMin,
      todayCount,
      count: articleCount,
      newestArticle,
    };
  }
  log("prod_freshness PASS");
  return {
    ok: true,
    generatedAt: index.generatedAt,
    ageMinutes: ageMin,
    todayCount,
    count: articleCount,
    newestArticle,
  };
}

async function loadClassifiedRuns(limit = CLASSIFIER_RUN_LIMIT) {
  const [owner, repo] = GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(UPDATE_WORKFLOW);
  const data = await ghApi(
    `/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=${limit}&branch=main`,
  );
  const runs = (data.workflow_runs || []).filter((r) => r.status === "completed");
  const classified = [];
  for (const run of runs) {
    try {
      classified.push(await classifyRunFromGitHub(owner, repo, run, GITHUB_TOKEN, { fetchArtifact: true }));
    } catch (e) {
      log(`WARN classify run_id=${run.id} ${e instanceof Error ? e.message : e}`);
    }
  }
  return classified;
}

async function checkLastIngestAggregateOk(nowMs) {
  log(`last_ingest_aggregate_ok limit_min=${MAX_SUCCESS_AGE_MIN}`);
  const classified = await loadClassifiedRuns();
  const hit = classified.find((r) => isIngestAggregateOkStatus(r.overall));
  if (!hit) {
    fail("no recent run with ingest+aggregate OK (phase status)");
    return { ok: false, runId: null, ageMinutes: null, overall: null };
  }
  const updated = parseTs(hit.updatedAt);
  const ageMin = updated ? minutesAgo(updated, nowMs) : null;
  log(
    `last_ingest_aggregate_ok run_id=${hit.runId} overall=${hit.overall} updated_at=${hit.updatedAt} age_min=${ageMin?.toFixed(1)}`,
  );
  if (ageMin !== null && ageMin > MAX_SUCCESS_AGE_MIN) {
    fail(`last ingest+aggregate OK older than ${MAX_SUCCESS_AGE_MIN}m`);
    return { ok: false, runId: hit.runId, ageMinutes: ageMin, overall: hit.overall };
  }
  log("last_ingest_aggregate_ok PASS");
  return { ok: true, runId: hit.runId, ageMinutes: ageMin, overall: hit.overall };
}

async function checkPipelineFailureStreak() {
  log(`pipeline_failure_streak max=${MAX_FAIL_STREAK}`);
  const classified = await loadClassifiedRuns();
  let streak = 0;
  for (const row of classified) {
    if (!isPipelineFailureStatus(row.overall)) break;
    streak += 1;
  }
  log(`pipeline_failure_streak count=${streak}`);
  if (streak >= MAX_FAIL_STREAK) {
    fail(`${streak} consecutive RED pipeline runs without intervening GREEN/YELLOW`);
    return { ok: false, streak };
  }
  log("pipeline_failure_streak PASS");
  return { ok: true, streak };
}

async function checkReleaseBlockedStreak() {
  log(`release_blocked_streak max=${MAX_RELEASE_BLOCKED_STREAK}`);
  const classified = await loadClassifiedRuns();
  let streak = 0;
  for (const row of classified) {
    if (row.overall === PIPELINE_SUCCESS) break;
    if (row.overall === INGEST_SUCCESS_RELEASE_BLOCKED) streak += 1;
    else break;
  }
  log(`release_blocked_streak count=${streak}`);
  if (streak >= MAX_RELEASE_BLOCKED_STREAK) {
    fail(`${streak} consecutive release-blocked runs without pipeline success`);
    return { ok: false, streak };
  }
  if (streak > 0) {
    warn(`${streak} consecutive release-blocked run(s) (YELLOW)`);
  }
  log("release_blocked_streak PASS");
  return { ok: true, streak };
}

async function checkZombies(nowMs) {
  log(`zombie_guard queued_stale=${QUEUED_STALE_MIN}m in_progress_stale=${IN_PROGRESS_STALE_MIN}m`);
  const [owner, repo] = GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(UPDATE_WORKFLOW);
  const data = await ghApi(`/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=25&branch=main`);
  const runs = data.workflow_runs || [];
  let failed = false;

  for (const r of runs) {
    if (r.status !== "queued") continue;
    const created = parseTs(r.created_at);
    if (!created) continue;
    const age = minutesAgo(created, nowMs);
    if (age >= QUEUED_STALE_MIN) {
      log(
        `WARN queued zombie run_id=${r.id} age_min=${age.toFixed(0)} created_at=${r.created_at} (non-blocking; cancel on next pipeline start)`,
      );
    } else if (age >= 30) {
      fail(`queued blocking run_id=${r.id} age_min=${age.toFixed(0)} created_at=${r.created_at}`);
      failed = true;
    }
  }

  for (const r of runs) {
    if (r.status !== "in_progress") continue;
    const created = parseTs(r.created_at);
    if (!created) continue;
    const age = minutesAgo(created, nowMs);
    if (age >= IN_PROGRESS_STALE_MIN) {
      fail(`in_progress stale run_id=${r.id} age_min=${age.toFixed(0)} created_at=${r.created_at}`);
      failed = true;
    }
  }

  if (!failed) log("zombie_guard PASS");
  return { ok: !failed };
}

function hasGithubSchedule() {
  if (!fs.existsSync(WORKFLOW_PATH)) return false;
  const wf = fs.readFileSync(WORKFLOW_PATH, "utf8");
  return /\n\s*schedule:\s*\n/m.test(wf);
}

async function checkAutomaticTrigger() {
  const ghSchedule = hasGithubSchedule();
  let watchdogOk = false;
  try {
    const res = await fetch(WATCHDOG_HEALTH_URL, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (res.ok) {
      const body = await res.json();
      watchdogOk = body?.ok === true;
    }
  } catch {
    watchdogOk = false;
  }
  log(`automatic_trigger github_schedule=${ghSchedule} watchdog_health=${watchdogOk}`);
  if (!ghSchedule && !watchdogOk) {
    if (REQUIRE_AUTO) {
      fail("no automatic trigger: GitHub schedule absent and watchdog unreachable");
      return { ok: false };
    }
    log("WARN automatic trigger not verified (manual workflow_dispatch only)");
    return { ok: true, warn: true };
  }
  log("automatic_trigger PASS");
  return { ok: true };
}

async function main() {
  const nowMs = Date.now();
  let failed = false;
  let yellowWarn = false;

  if (GITHUB_EVENT === "pull_request" && SKIP_PROD_FRESHNESS_ON_PR) {
    log("prod_freshness SKIP on pull_request (post-merge proof required)");
  } else {
    const prod = await checkProductionFreshness(nowMs);
    if (!prod.ok) failed = true;
  }

  const auto = await checkAutomaticTrigger();
  if (!auto.ok) failed = true;

  if (GITHUB_TOKEN) {
    if (GITHUB_EVENT === "pull_request") {
      log("last_ingest_aggregate_ok SKIP on pull_request (post-merge proof required)");
    } else {
      try {
        const last = await checkLastIngestAggregateOk(nowMs);
        if (!last.ok) failed = true;
        else if (last.overall && alertLevelForOverallStatus(last.overall) === ALERT_YELLOW) {
          yellowWarn = true;
        }
      } catch (e) {
        fail(`last_ingest_aggregate_ok ${e instanceof Error ? e.message : e}`);
        failed = true;
      }
    }
    try {
      const z = await checkZombies(nowMs);
      if (!z.ok) failed = true;
    } catch (e) {
      fail(`zombie_guard ${e instanceof Error ? e.message : e}`);
      failed = true;
    }
    try {
      const pfs = await checkPipelineFailureStreak();
      if (!pfs.ok) failed = true;
    } catch (e) {
      fail(`pipeline_failure_streak ${e instanceof Error ? e.message : e}`);
      failed = true;
    }
    try {
      const rbs = await checkReleaseBlockedStreak();
      if (!rbs.ok) failed = true;
      else if (rbs.streak > 0) yellowWarn = true;
    } catch (e) {
      fail(`release_blocked_streak ${e instanceof Error ? e.message : e}`);
      failed = true;
    }
  } else {
    log("github run checks SKIP (GITHUB_TOKEN unset)");
  }

  if (yellowWarn && STRICT_YELLOW) {
    fail("STRICT_YELLOW: YELLOW pipeline state treated as failure");
    failed = true;
  } else if (yellowWarn) {
    warn("YELLOW pipeline state present (release blocked or streak warning)");
  }

  if (failed) {
    console.error("[articles-continuous-update-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main().catch((e) => {
  fail(e.message || String(e));
  process.exit(1);
});
