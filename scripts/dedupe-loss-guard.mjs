/**
 * dedupe_loss_guard — dedupe/limits must not zero-out today's articles for a whole section
 * when today's ingest telemetry shows items were written for that topic.
 *
 * Compares today-scoped metrics only: today_written_to_articles_json_count vs json_today.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pragueDayFromIso, pragueTodayIso } from "./iu-source-display.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

export const VERTICALS = ["cestovani", "hry", "kultura", "veda", "vzdelavani"];
export const MIN_TODAY_WRITTEN_FOR_FAIL = 3;

const localArticles = process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const remoteArticles = (process.env.ARTICLES_JSON_URL || "").trim();
const telemetryPath =
  process.env.INGEST_TELEMETRY_PATH || path.join(root, "projects", "data", "ingest_telemetry", "latest.json");
const healthPath = process.env.FEED_HEALTH_PATH || path.join(root, "projects", "data", "feed_health.json");

/** Novinky/Seznam vertical rubric RSS mirrors homepage — not native vertical ingest signal. */
export function isVerticalRubricMirror(row) {
  if (!row || typeof row !== "object") return false;
  const topic = String(row.topic || row.section || row.section_primary || "")
    .trim()
    .toLowerCase();
  if (!VERTICALS.includes(topic)) return false;
  const entryType = String(row.entry_type || "").trim().toLowerCase();
  if (entryType === "rubric") {
    const feedUrl = String(row.feed_url || "").toLowerCase();
    const sid = String(row.source_id || row.registry_id || "").toLowerCase();
    if (feedUrl.includes("novinky.cz/rss/") || feedUrl.includes("seznamzpravy.cz/rss/")) return true;
    if (sid.includes("novinky") || sid.includes("seznam")) return true;
  }
  const sid = String(row.source_id || row.registry_id || "").trim();
  if (sid === "ces_novinky_cestovani" || sid === "hry_novinky") return true;
  return false;
}

export function countJsonTodayBySection(articles, today, feedMetaById = new Map()) {
  const out = Object.fromEntries(VERTICALS.map((k) => [k, 0]));
  for (const a of articles) {
    if (pragueDayFromIso(a.publishedAt) !== today) continue;
    const feedId = String(a.feedId || "").trim();
    const meta = feedMetaById.get(feedId);
    if (meta && !meta.skip && VERTICALS.includes(meta.topic)) {
      out[meta.topic] += 1;
      continue;
    }
    const sec = String(a.topic || a.section || "").trim().toLowerCase();
    if (VERTICALS.includes(sec)) {
      out[sec] += 1;
    }
  }
  return out;
}

function feedMetaFromTelemetryRows(rows) {
  const byFeedId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const sid = String(row.source_id || row.registry_id || "").trim();
    if (!sid) continue;
    const topic = String(row.topic || row.section || row.section_primary || "")
      .trim()
      .toLowerCase();
    byFeedId.set(sid, {
      topic,
      skip: isVerticalRubricMirror(row),
    });
  }
  return byFeedId;
}

function countTodayWrittenFromArticles(articles, feedMetaById, today) {
  const out = Object.fromEntries(VERTICALS.map((k) => [k, 0]));
  for (const a of articles) {
    if (pragueDayFromIso(a.publishedAt) !== today) continue;
    const feedId = String(a.feedId || "").trim();
    const meta = feedMetaById.get(feedId);
    if (meta && !meta.skip && VERTICALS.includes(meta.topic)) {
      out[meta.topic] += 1;
      continue;
    }
    const sec = String(a.topic || a.section || "").trim().toLowerCase();
    if (VERTICALS.includes(sec)) out[sec] += 1;
  }
  return out;
}

function countTodayWrittenFromTelemetryRows(rows) {
  const out = Object.fromEntries(VERTICALS.map((k) => [k, 0]));
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (isVerticalRubricMirror(row)) continue;
    const topic = String(row.topic || row.section || row.section_primary || "")
      .trim()
      .toLowerCase();
    if (!VERTICALS.includes(topic)) continue;

    const explicit = Number(
      row.today_written_to_articles_json_count ??
        row.todayWrittenToArticlesJsonCount ??
        row.today_written_count ??
        0,
    );
    if (explicit > 0) {
      out[topic] += explicit;
    }
  }
  return out;
}

function mergeTodayWrittenCounts(fromArticles, fromTelemetry) {
  const out = Object.fromEntries(VERTICALS.map((k) => [k, 0]));
  for (const k of VERTICALS) {
    out[k] = Math.max(fromArticles[k] || 0, fromTelemetry[k] || 0);
  }
  return out;
}

/**
 * Evaluate dedupe-loss guard for one bundle + telemetry snapshot.
 * Returns { jsonToday, todayWritten, failures, failed }.
 */
export function evaluateDedupeLossGuard({
  today,
  articles = [],
  telemetryRows = [],
  minTodayWritten = MIN_TODAY_WRITTEN_FOR_FAIL,
}) {
  const feedMetaById = feedMetaFromTelemetryRows(telemetryRows);
  const jsonToday = countJsonTodayBySection(articles, today, feedMetaById);
  const fromArticles = countTodayWrittenFromArticles(articles, feedMetaById, today);
  const fromTelemetry = countTodayWrittenFromTelemetryRows(telemetryRows);
  const todayWritten = mergeTodayWrittenCounts(fromArticles, fromTelemetry);

  const failures = [];
  for (const k of VERTICALS) {
    if (todayWritten[k] >= minTodayWritten && jsonToday[k] === 0) {
      failures.push(k);
    }
  }

  return { jsonToday, todayWritten, failures, failed: failures.length > 0 };
}

async function loadArticlesDoc() {
  if (remoteArticles) {
    const res = await fetch(remoteArticles, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    return res.json();
  }
  if (!fs.existsSync(localArticles)) throw new Error(`missing ${localArticles}`);
  return JSON.parse(fs.readFileSync(localArticles, "utf8"));
}

function loadTelemetryRows(articlesDoc) {
  if (fs.existsSync(telemetryPath)) {
    const tel = JSON.parse(fs.readFileSync(telemetryPath, "utf8"));
    const telGen = tel.generatedAt || tel.generated_at || "";
    const artGen = articlesDoc.generatedAt || "";
    const sameRun =
      telGen && artGen && Math.abs(Date.parse(String(telGen)) - Date.parse(String(artGen))) < 3_600_000;
    if (!sameRun && remoteArticles) {
      console.log("[dedupe-loss-guard] SKIP ingest comparison (telemetry not from same run as remote articles)");
      return [];
    }
    const perSource = tel.per_source || tel.sources || [];
    return Array.isArray(perSource) ? perSource : [];
  }

  if (fs.existsSync(healthPath) && !remoteArticles) {
    console.log("[dedupe-loss-guard] SKIP ingest comparison (feed_health has no today-scoped metrics)");
  }
  return [];
}

async function main() {
  const today = pragueTodayIso();
  const articlesDoc = await loadArticlesDoc();
  const articles = Array.isArray(articlesDoc.articles) ? articlesDoc.articles : [];
  const telemetryRows = loadTelemetryRows(articlesDoc);

  const { jsonToday, todayWritten, failures, failed } = evaluateDedupeLossGuard({
    today,
    articles,
    telemetryRows,
  });

  console.log(`[dedupe-loss-guard] today=${today} generatedAt=${articlesDoc.generatedAt || "n/a"}`);
  for (const k of VERTICALS) {
    console.log(
      `[dedupe-loss-guard] topic=${k} today_written=${todayWritten[k]} json_today=${jsonToday[k]}`,
    );
  }

  if (failed) {
    for (const k of failures) {
      console.error(
        `[dedupe-loss-guard] FAIL: topic=${k} today_written=${todayWritten[k]} but json_today=0 (possible dedupe/limit/stagger wipeout)`,
      );
    }
    console.error("[dedupe-loss-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[dedupe-loss-guard] RESULT=PASS");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error("[dedupe-loss-guard] ERROR", e.message || e);
    process.exit(1);
  });
}
