/**
 * dedupe_loss_guard — dedupe/limits must not zero-out today's articles for a whole section
 * when ingest telemetry shows items were accepted for that topic.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pragueDayFromIso, pragueTodayIso } from "./iu-source-display.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const VERTICALS = ["cestovani", "hry", "kultura", "veda", "vzdelavani"];
const localArticles = process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const remoteArticles = (process.env.ARTICLES_JSON_URL || "").trim();
const telemetryPath =
  process.env.INGEST_TELEMETRY_PATH || path.join(root, "projects", "data", "ingest_telemetry", "latest.json");
const healthPath = process.env.FEED_HEALTH_PATH || path.join(root, "projects", "data", "feed_health.json");

async function loadArticlesDoc() {
  if (remoteArticles) {
    const res = await fetch(remoteArticles, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    return res.json();
  }
  if (!fs.existsSync(localArticles)) throw new Error(`missing ${localArticles}`);
  return JSON.parse(fs.readFileSync(localArticles, "utf8"));
}

async function main() {
  const today = pragueTodayIso();
  const articlesDoc = await loadArticlesDoc();
  const articles = Array.isArray(articlesDoc.articles) ? articlesDoc.articles : [];

  const todayBySection = {};
  for (const k of VERTICALS) todayBySection[k] = 0;
  for (const a of articles) {
    const sec = String(a.topic || a.section || "").trim().toLowerCase();
    if (VERTICALS.includes(sec) && pragueDayFromIso(a.publishedAt) === today) {
      todayBySection[sec] += 1;
    }
  }

  const ingestedByTopic = {};
  for (const k of VERTICALS) ingestedByTopic[k] = 0;

  if (fs.existsSync(telemetryPath)) {
    const tel = JSON.parse(fs.readFileSync(telemetryPath, "utf8"));
    const perSource = tel.per_source || tel.sources || [];
    if (Array.isArray(perSource)) {
      for (const row of perSource) {
        const topic = String(row.topic || row.section || "").trim().toLowerCase();
        if (!VERTICALS.includes(topic)) continue;
        const kept = Number(row.written_to_articles_json_count || row.itemsKept || row.accepted || 0);
        if (kept > 0) ingestedByTopic[topic] += kept;
      }
    }
  } else if (fs.existsSync(healthPath)) {
    const health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
    const feeds = health.feeds && typeof health.feeds === "object" ? health.feeds : {};
    for (const url of Object.keys(feeds)) {
      const meta = feeds[url];
      const topic = String(meta?.topic || "").trim().toLowerCase();
      if (!VERTICALS.includes(topic)) continue;
      ingestedByTopic[topic] += Number(meta.itemsKept || meta.accepted || 0);
    }
  }

  let failed = false;
  console.log(`[dedupe-loss-guard] today=${today} generatedAt=${articlesDoc.generatedAt || "n/a"}`);
  for (const k of VERTICALS) {
    console.log(
      `[dedupe-loss-guard] topic=${k} ingest_kept=${ingestedByTopic[k]} json_today=${todayBySection[k]}`,
    );
    if (ingestedByTopic[k] >= 3 && todayBySection[k] === 0) {
      console.error(
        `[dedupe-loss-guard] FAIL: topic=${k} ingest kept ${ingestedByTopic[k]} but json_today=0 (possible dedupe/limit/stagger wipeout)`,
      );
      failed = true;
    }
  }

  if (failed) {
    console.error("[dedupe-loss-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[dedupe-loss-guard] RESULT=PASS");
}

main().catch((e) => {
  console.error("[dedupe-loss-guard] ERROR", e.message || e);
  process.exit(1);
});
