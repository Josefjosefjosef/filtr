/**
 * Fail if ingest reported items for CZ vertical feeds but articles.json has 0 for that topic
 * (regression: global per-source cap stripping vertical rows).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const VERT = ["hry", "kultura", "veda", "vzdelavani"];

const articlesPath = path.join(root, "projects", "data", "articles.json");
const healthPath = path.join(root, "projects", "data", "feed_health.json");

if (!fs.existsSync(articlesPath) || !fs.existsSync(healthPath)) {
  console.error("[cz-vertical-data-guard] SKIP: missing articles.json or feed_health.json");
  process.exit(0);
}

const articles = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
const list = Array.isArray(articles.articles) ? articles.articles : [];
const health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
const feeds = health.feeds && typeof health.feeds === "object" ? health.feeds : {};

const ingestedByTopic = {};
for (const k of VERT) ingestedByTopic[k] = 0;

for (const url of Object.keys(feeds)) {
  const meta = feeds[url];
  if (!meta || typeof meta !== "object") continue;
  const topic = String(meta.topic || "").trim().toLowerCase();
  if (!VERT.includes(topic)) continue;
  const kept = Number(meta.itemsKept || meta.accepted || 0);
  if (kept > 0) ingestedByTopic[topic] += kept;
}

const countByTopic = {};
for (const k of VERT) countByTopic[k] = 0;
for (const it of list) {
  const t = String(it.topic || it.section || "").trim().toLowerCase();
  if (VERT.includes(t)) countByTopic[t] += 1;
}

let failed = false;
for (const k of VERT) {
  if (ingestedByTopic[k] > 0 && countByTopic[k] === 0) {
    console.error(
      `[cz-vertical-data-guard] FAIL: topic=${k} ingest itemsKept sum >0 but articles.json count=0 (mapping/limit/stagger bug)`,
    );
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("[cz-vertical-data-guard] OK", { ingestedByTopic, countByTopic });
