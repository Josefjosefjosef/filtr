/**
 * Articles aggregator freshness guard — fails on stale snapshot / empty sections.
 * Run: node scripts/articles-aggregator-freshness-guard.mjs
 * Env:
 *   ARTICLES_JSON_PATH — local file (default projects/data/articles.json)
 *   ARTICLES_JSON_URL — fetch URL instead of file (e.g. production)
 *   MAX_GENERATED_AGE_HOURS — bundle generatedAt limit (default 48)
 *   MAX_SECTION_AGE_HOURS — newest article per main section (default 72)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const MAIN_SECTIONS = [
  "aktualne",
  "sport",
  "finance",
  "zdravi",
  "cestovani",
  "hry",
  "kultura",
  "veda",
  "vzdelavani",
];

const MAX_GENERATED_AGE_H = Number(process.env.MAX_GENERATED_AGE_HOURS || "48");
const MAX_SECTION_AGE_H = Number(process.env.MAX_SECTION_AGE_HOURS || "72");
const localPath = process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const remoteUrl = (process.env.ARTICLES_JSON_URL || "").trim();

function parseTs(v) {
  if (!v || typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

async function loadArticlesDoc() {
  if (remoteUrl) {
    const res = await fetch(remoteUrl, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`fetch failed ${res.status} ${remoteUrl}`);
    return res.json();
  }
  if (!fs.existsSync(localPath)) {
    throw new Error(`missing ${localPath} (set ARTICLES_JSON_URL for prod check)`);
  }
  return JSON.parse(fs.readFileSync(localPath, "utf8"));
}

function hoursAgo(tsMs, nowMs) {
  return (nowMs - tsMs) / 3_600_000;
}

async function main() {
  const now = Date.now();
  const doc = await loadArticlesDoc();
  const list = Array.isArray(doc.articles) ? doc.articles : Array.isArray(doc.items) ? doc.items : [];
  let failed = false;

  if (list.length === 0) {
    console.error("[articles-aggregator-freshness-guard] FAIL: empty articles list");
    failed = true;
  } else {
    console.log(`[articles-aggregator-freshness-guard] articles count=${list.length}`);
  }

  const genTs = parseTs(doc.generatedAt);
  if (!genTs) {
    console.error("[articles-aggregator-freshness-guard] FAIL: missing or invalid generatedAt");
    failed = true;
  } else {
    const genAgeH = hoursAgo(genTs, now);
    console.log(
      `[articles-aggregator-freshness-guard] generatedAt=${doc.generatedAt} age_hours=${genAgeH.toFixed(1)} limit=${MAX_GENERATED_AGE_H}`,
    );
    if (genAgeH > MAX_GENERATED_AGE_H) {
      console.error("[articles-aggregator-freshness-guard] FAIL: bundle generatedAt too old");
      failed = true;
    }
  }

  const bySection = Object.fromEntries(MAIN_SECTIONS.map((s) => [s, []]));
  for (const it of list) {
    const sec = String(it.topic || it.section || "").trim().toLowerCase();
    if (bySection[sec]) bySection[sec].push(it);
  }

  for (const sec of MAIN_SECTIONS) {
    const items = bySection[sec];
    if (!items.length) {
      console.error(`[articles-aggregator-freshness-guard] FAIL: section=${sec} has zero articles`);
      failed = true;
      continue;
    }
    const newest = items.reduce((best, it) => {
      const t = parseTs(it.publishedAt || it.pubDate || it.date) || 0;
      return t > best ? t : best;
    }, 0);
    if (!newest) {
      console.error(`[articles-aggregator-freshness-guard] FAIL: section=${sec} no parseable publishedAt`);
      failed = true;
      continue;
    }
    const secAgeH = hoursAgo(newest, now);
    const iso = new Date(newest).toISOString();
    console.log(
      `[articles-aggregator-freshness-guard] section=${sec} newest=${iso} age_hours=${secAgeH.toFixed(1)} limit=${MAX_SECTION_AGE_H}`,
    );
    if (secAgeH > MAX_SECTION_AGE_H) {
      console.error(`[articles-aggregator-freshness-guard] FAIL: section=${sec} newest article too old`);
      failed = true;
    }
  }

  if (failed) {
    console.error("[articles-aggregator-freshness-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[articles-aggregator-freshness-guard] RESULT=PASS");
}

main().catch((e) => {
  console.error("[articles-aggregator-freshness-guard] ERROR:", e.message || e);
  process.exit(1);
});
