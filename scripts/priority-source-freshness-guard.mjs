/**
 * priority_source_freshness_guard — Zprávy (aktualne) + Sport fresher than secondary sections.
 * Run: node scripts/priority-source-freshness-guard.mjs
 */
import fs from "fs";
import path from "path";
import { root } from "./source-rotation-guard-lib.mjs";

const articlesPath =
  process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const maxPriorityAgeH = Number(process.env.MAX_PRIORITY_SECTION_AGE_HOURS || "12");
const maxSecondaryAgeH = Number(process.env.MAX_SECONDARY_SECTION_AGE_HOURS || "48");

const PRIORITY_SECTIONS = new Set(["aktualne", "sport"]);
const SECONDARY_SECTIONS = new Set([
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

function effectiveTs(article) {
  const rel = article.iuReleaseAt || article.releaseAt;
  const pub = article.publishedAt;
  const t = Date.parse(rel || pub || "");
  return Number.isFinite(t) ? t : null;
}

function newestInSection(articles, section) {
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

function main() {
  let failed = false;
  if (!fs.existsSync(articlesPath)) {
    fail(`missing ${articlesPath}`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
  const arts = Array.isArray(doc.articles) ? doc.articles : [];
  const now = Date.now();

  let priorityNewest = null;
  for (const sec of PRIORITY_SECTIONS) {
    const t = newestInSection(arts, sec);
    if (t !== null && (priorityNewest === null || t > priorityNewest)) {
      priorityNewest = t;
    }
    const ageH = t ? (now - t) / 3_600_000 : Infinity;
    log(`section=${sec} newest_age_h=${Number.isFinite(ageH) ? ageH.toFixed(2) : "n/a"}`);
    if (!t || ageH > maxPriorityAgeH) {
      fail(`${sec} newest article older than ${maxPriorityAgeH}h`);
      failed = true;
    }
  }

  let secondaryNewest = null;
  for (const sec of SECONDARY_SECTIONS) {
    const t = newestInSection(arts, sec);
    if (t !== null && (secondaryNewest === null || t > secondaryNewest)) {
      secondaryNewest = t;
    }
  }

  const priorityAges = [];
  for (const sec of PRIORITY_SECTIONS) {
    const t = newestInSection(arts, sec);
    if (t) priorityAges.push((now - t) / 3_600_000);
  }
  const secondaryAges = [];
  for (const sec of SECONDARY_SECTIONS) {
    const t = newestInSection(arts, sec);
    if (t) secondaryAges.push((now - t) / 3_600_000);
  }
  if (priorityAges.length && secondaryAges.length) {
    const priBest = Math.min(...priorityAges);
    const secBest = Math.min(...secondaryAges);
    log(`priority_best_age_h=${priBest.toFixed(2)} secondary_best_age_h=${secBest.toFixed(2)}`);
    const slackH = Number(process.env.PRIORITY_FRESHNESS_SLACK_HOURS || "6");
    if (priBest > secBest + slackH && priBest > maxPriorityAgeH) {
      fail(
        `priority sections lag secondary by ${(priBest - secBest).toFixed(1)}h (slack ${slackH}h)`,
      );
      failed = true;
    } else {
      log("priority sections at least as fresh as secondary (within slack) PASS");
    }
  }

  for (const sec of SECONDARY_SECTIONS) {
    const t = newestInSection(arts, sec);
    if (!t) continue;
    const ageH = (now - t) / 3_600_000;
    if (ageH > maxSecondaryAgeH) {
      log(`WARN: secondary ${sec} age_h=${ageH.toFixed(2)} > ${maxSecondaryAgeH}h`);
    }
  }

  if (failed) {
    console.error("[priority-source-freshness-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
