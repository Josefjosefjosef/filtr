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
 *   MAX_LAST_SUCCESS_AGE_MINUTES — last successful workflow (default 120)
 *   MAX_FAILURE_STREAK — consecutive fails without intervening success (default 6)
 *   QUEUED_STALE_MINUTES — zombie queued threshold (default 120)
 *   IN_PROGRESS_STALE_MINUTES — stuck in_progress (default 90)
 *   WATCHDOG_HEALTH_URL — optional; if reachable, automatic trigger considered present
 *   REQUIRE_AUTOMATIC_TRIGGER — "true" to fail when neither GH schedule nor watchdog health
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
const QUEUED_STALE_MIN = Number(process.env.QUEUED_STALE_MINUTES || "120");
const IN_PROGRESS_STALE_MIN = Number(process.env.IN_PROGRESS_STALE_MINUTES || "90");
const WATCHDOG_HEALTH_URL =
  (process.env.WATCHDOG_HEALTH_URL || "").trim() ||
  "https://infouzel-articles-watchdog.josef-zmrhal.workers.dev/health";
const REQUIRE_AUTO = String(process.env.REQUIRE_AUTOMATIC_TRIGGER || "").toLowerCase() === "true";

const UPDATE_WORKFLOW = "update-articles.yml";
const WORKFLOW_PATH = path.join(root, ".github", "workflows", "update-articles.yml");

function log(msg) {
  console.log(`[articles-continuous-update-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[articles-continuous-update-guard] FAIL: ${msg}`);
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

async function checkLastSuccessfulRun(nowMs) {
  log(`last_success workflow=${UPDATE_WORKFLOW} limit_min=${MAX_SUCCESS_AGE_MIN}`);
  const [owner, repo] = GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(UPDATE_WORKFLOW);
  const data = await ghApi(
    `/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=30&branch=main&status=completed`,
  );
  const success = (data.workflow_runs || []).find((r) => r.conclusion === "success");
  if (!success) {
    fail("no successful update-articles run found");
    return { ok: false, runId: null, ageMinutes: null };
  }
  const updated = parseTs(success.updated_at);
  const ageMin = updated ? minutesAgo(updated, nowMs) : null;
  log(`last_success run_id=${success.id} updated_at=${success.updated_at} age_min=${ageMin?.toFixed(1)} event=${success.event}`);
  if (ageMin !== null && ageMin > MAX_SUCCESS_AGE_MIN) {
    fail(`last successful run older than ${MAX_SUCCESS_AGE_MIN}m`);
    return { ok: false, runId: success.id, ageMinutes: ageMin };
  }
  log("last_success PASS");
  return { ok: true, runId: success.id, ageMinutes: ageMin };
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

async function checkFailureStreak() {
  log(`failure_streak max=${MAX_FAIL_STREAK}`);
  const [owner, repo] = GITHUB_REPOSITORY.split("/");
  const wf = encodeURIComponent(UPDATE_WORKFLOW);
  const data = await ghApi(`/repos/${owner}/${repo}/actions/workflows/${wf}/runs?per_page=20&branch=main`);
  const runs = (data.workflow_runs || []).filter((r) => r.status === "completed");
  let streak = 0;
  for (const r of runs) {
    if (r.conclusion === "success") break;
    if (r.conclusion === "failure" || r.conclusion === "cancelled") streak += 1;
  }
  log(`failure_streak count=${streak}`);
  if (streak >= MAX_FAIL_STREAK) {
    fail(`${streak} consecutive non-success runs without intervening success`);
    return { ok: false, streak };
  }
  log("failure_streak PASS");
  return { ok: true, streak };
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

  const prod = await checkProductionFreshness(nowMs);
  if (!prod.ok) failed = true;

  const auto = await checkAutomaticTrigger();
  if (!auto.ok) failed = true;

  if (GITHUB_TOKEN) {
    try {
      const last = await checkLastSuccessfulRun(nowMs);
      if (!last.ok) failed = true;
    } catch (e) {
      fail(`last_success ${e instanceof Error ? e.message : e}`);
      failed = true;
    }
    try {
      const z = await checkZombies(nowMs);
      if (!z.ok) failed = true;
    } catch (e) {
      fail(`zombie_guard ${e instanceof Error ? e.message : e}`);
      failed = true;
    }
    try {
      const fs_ = await checkFailureStreak();
      if (!fs_.ok) failed = true;
    } catch (e) {
      fail(`failure_streak ${e instanceof Error ? e.message : e}`);
      failed = true;
    }
  } else {
    log("github run checks SKIP (GITHUB_TOKEN unset)");
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
