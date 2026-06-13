/**
 * priority_source_freshness_guard — Zprávy (aktualne) + Sport fresher than secondary sections.
 *
 * Phase 9B: priority sections use the fresher of articles.json (slow release bundle)
 * and publishable_pool.json (fast publish path) — homepage reads the pool.
 *
 * Run: node scripts/priority-source-freshness-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { root } from "./source-rotation-guard-lib.mjs";

const articlesPath =
  process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const poolPath =
  process.env.PUBLISHABLE_POOL_PATH || path.join(root, "projects", "data", "publishable_pool.json");
const maxPriorityAgeH = Number(process.env.MAX_PRIORITY_SECTION_AGE_HOURS || "12");
const maxSecondaryAgeH = Number(process.env.MAX_SECONDARY_SECTION_AGE_HOURS || "48");

export const PRIORITY_SECTIONS = new Set(["aktualne", "sport"]);
export const SECONDARY_SECTIONS = new Set([
  "finance",
  "zdravi",
  "cestovani",
  "hry",
  "kultura",
  "veda",
  "vzdelavani",
]);

function log(msg) {
  console.log(`[priority-source-freshness-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[priority-source-freshness-guard] FAIL: ${msg}`);
}

export function effectiveTs(article) {
  const rel = article.iuReleaseAt || article.releaseAt;
  const pub = article.publishedAt;
  const t = Date.parse(rel || pub || "");
  return Number.isFinite(t) ? t : null;
}

export function newestInSection(articles, section) {
  let best = null;
  for (const a of articles) {
    if (!a || typeof a !== "object") continue;
    const sec = String(a.section || a.topic || "").trim();
    if (sec !== section) continue;
    const t = effectiveTs(a);
    if (t === null) continue;
    if (best === null || t > best) best = t;
  }
  return best;
}

export function mergePriorityNewestTs(articlesTs, poolTs) {
  if (articlesTs === null && poolTs === null) return { ts: null, source: "none" };
  if (articlesTs === null) return { ts: poolTs, source: "publishable_pool.json" };
  if (poolTs === null) return { ts: articlesTs, source: "articles.json" };
  if (poolTs > articlesTs) return { ts: poolTs, source: "publishable_pool.json" };
  if (articlesTs > poolTs) return { ts: articlesTs, source: "articles.json" };
  return { ts: articlesTs, source: "both" };
}

export function loadArticlesFromPath(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(doc.articles) ? doc.articles : [];
}

export function evaluatePriorityFreshness(options = {}) {
  const now = options.nowMs ?? Date.now();
  const articles = options.articles ?? [];
  const poolArticles = options.poolArticles ?? [];
  const maxPriorityAge = options.maxPriorityAgeH ?? maxPriorityAgeH;
  const maxSecondaryAge = options.maxSecondaryAgeH ?? maxSecondaryAgeH;
  const slackH = options.slackH ?? Number(process.env.PRIORITY_FRESHNESS_SLACK_HOURS || "6");

  const failures = [];
  const sectionLog = [];
  let priorityNewest = null;

  for (const sec of PRIORITY_SECTIONS) {
    const articlesTs = newestInSection(articles, sec);
    const poolTs = newestInSection(poolArticles, sec);
    const merged = mergePriorityNewestTs(articlesTs, poolTs);
    const t = merged.ts;
    if (t !== null && (priorityNewest === null || t > priorityNewest)) {
      priorityNewest = t;
    }
    const ageH = t ? (now - t) / 3_600_000 : Infinity;
    sectionLog.push({
      section: sec,
      ageH: Number.isFinite(ageH) ? ageH : null,
      source: merged.source,
      articlesAgeH: articlesTs ? (now - articlesTs) / 3_600_000 : null,
      poolAgeH: poolTs ? (now - poolTs) / 3_600_000 : null,
    });
    if (!t || ageH > maxPriorityAge) {
      failures.push(`${sec} newest article older than ${maxPriorityAge}h`);
    }
  }

  const priorityAges = sectionLog
    .map((row) => row.ageH)
    .filter((age) => age !== null && Number.isFinite(age));
  const secondaryAges = [];
  for (const sec of SECONDARY_SECTIONS) {
    const t = newestInSection(articles, sec);
    if (t) secondaryAges.push((now - t) / 3_600_000);
  }

  let slackPass = true;
  if (priorityAges.length && secondaryAges.length) {
    const priBest = Math.min(...priorityAges);
    const secBest = Math.min(...secondaryAges);
    if (priBest > secBest + slackH && priBest > maxPriorityAge) {
      failures.push(
        `priority sections lag secondary by ${(priBest - secBest).toFixed(1)}h (slack ${slackH}h)`,
      );
      slackPass = false;
    }
  }

  const secondaryWarns = [];
  for (const sec of SECONDARY_SECTIONS) {
    const t = newestInSection(articles, sec);
    if (!t) continue;
    const ageH = (now - t) / 3_600_000;
    if (ageH > maxSecondaryAge) {
      secondaryWarns.push({ section: sec, ageH });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    sectionLog,
    priorityAges,
    secondaryAges,
    slackPass,
    secondaryWarns,
    maxPriorityAgeH: maxPriorityAge,
  };
}

function main() {
  if (!fs.existsSync(articlesPath)) {
    fail(`missing ${articlesPath}`);
    process.exit(1);
  }

  const articles = loadArticlesFromPath(articlesPath);
  const poolArticles = loadArticlesFromPath(poolPath);
  if (poolArticles.length) {
    log(`pool_articles_loaded=${poolArticles.length}`);
  } else if (!fs.existsSync(poolPath)) {
    log(`WARN: missing ${poolPath} — priority sections use articles.json only`);
  }

  const result = evaluatePriorityFreshness({ articles, poolArticles });
  for (const row of result.sectionLog) {
    const age = row.ageH === null ? "n/a" : row.ageH.toFixed(2);
    const articlesAge =
      row.articlesAgeH === null ? "n/a" : row.articlesAgeH.toFixed(2);
    const poolAge = row.poolAgeH === null ? "n/a" : row.poolAgeH.toFixed(2);
    log(
      `section=${row.section} newest_age_h=${age} source=${row.source} articles_age_h=${articlesAge} pool_age_h=${poolAge}`,
    );
  }

  if (result.priorityAges.length && result.secondaryAges.length) {
    const priBest = Math.min(...result.priorityAges);
    const secBest = Math.min(...result.secondaryAges);
    log(`priority_best_age_h=${priBest.toFixed(2)} secondary_best_age_h=${secBest.toFixed(2)}`);
    if (result.slackPass) {
      log("priority sections at least as fresh as secondary (within slack) PASS");
    }
  }

  for (const warn of result.secondaryWarns) {
    log(`WARN: secondary ${warn.section} age_h=${warn.ageH.toFixed(2)} > ${maxSecondaryAgeH}h`);
  }

  if (!result.ok) {
    for (const msg of result.failures) {
      fail(msg);
    }
    console.error("[priority-source-freshness-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
