/**
 * MIN_ITEMS: ingest > 0 for topic but final articles.json count < 2 → FAIL
 * SOURCE_DIVERSITY: ≥2 feeds in health with itemsKept>0 for topic but all final rows same display source → FAIL
 * LIVENESS: newest publishedAt per topic older than 72h → WARN (stderr); FAIL if CZ_VERTICAL_LIVENESS_FAIL=1
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
  console.error("[cz-vertical-flow-guard] SKIP: missing articles.json or feed_health.json");
  process.exit(0);
}

const articles = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
const list = Array.isArray(articles.articles) ? articles.articles : [];
const health = JSON.parse(fs.readFileSync(healthPath, "utf8"));
const feeds = health.feeds && typeof health.feeds === "object" ? health.feeds : {};

function normSource(name) {
  const s = String(name || "")
    .trim()
    .split(/\s*[–—-]\s*/)[0]
    .trim()
    .toLowerCase();
  return s || "unknown";
}

const ingestedByTopic = {};
const healthSourceNamesByTopic = {};
for (const k of VERT) {
  ingestedByTopic[k] = 0;
  healthSourceNamesByTopic[k] = new Set();
}

for (const url of Object.keys(feeds)) {
  const meta = feeds[url];
  if (!meta || typeof meta !== "object") continue;
  const topic = String(meta.topic || "").trim().toLowerCase();
  if (!VERT.includes(topic)) continue;
  const kept = Number(meta.itemsKept || meta.accepted || 0);
  if (kept > 0) {
    ingestedByTopic[topic] += kept;
    const sn = normSource(meta.source);
    if (sn) healthSourceNamesByTopic[topic].add(sn);
  }
}

const byTopic = { hry: [], kultura: [], veda: [], vzdelavani: [] };
for (const it of list) {
  const t = String(it.topic || it.section || "").trim().toLowerCase();
  if (VERT.includes(t)) byTopic[t].push(it);
}

let failed = false;
const LIVENESS_H = Number(process.env.CZ_VERTICAL_LIVENESS_HOURS || "72");
const livenessMs = LIVENESS_H * 3600 * 1000;
const now = Date.now();

for (const k of VERT) {
  const ing = ingestedByTopic[k];
  const items = byTopic[k] || [];
  const cnt = items.length;

  if (ing > 0 && cnt < 2) {
    console.error(
      `[cz-vertical-flow-guard] MIN_ITEMS FAIL: topic=${k} ingest sum=${ing} but articles count=${cnt} (need >=2)`,
    );
    failed = true;
  }

  const hs = healthSourceNamesByTopic[k];
  /* Až při větším výřezu: první stagger batch může mít 2–4 řádky ze stejného zdroje. */
  if (hs && hs.size >= 2 && cnt >= 5) {
    const srcs = new Set();
    for (const it of items) {
      const s0 = Array.isArray(it.sources) && it.sources[0] ? it.sources[0].name : "";
      srcs.add(normSource(s0));
    }
    if (srcs.size < 2) {
      console.error(
        `[cz-vertical-flow-guard] SOURCE_DIVERSITY FAIL: topic=${k} ${hs.size} distinct ingest sources but output uses one (${[...srcs].join(",")})`,
      );
      failed = true;
    }
  }

  if (cnt >= 1) {
    let newest = 0;
    for (const it of items) {
      const t0 = Date.parse(String(it.publishedAt || ""));
      if (Number.isFinite(t0) && t0 > newest) newest = t0;
    }
    if (newest > 0 && now - newest > livenessMs) {
      const msg = `[cz-vertical-flow-guard] LIVENESS WARN: topic=${k} newest publishedAt older than ${LIVENESS_H}h`;
      if (process.env.CZ_VERTICAL_LIVENESS_FAIL === "1") {
        console.error(msg + " (strict FAIL)");
        failed = true;
      } else {
        console.warn(msg);
      }
    }
  }
}

if (failed) process.exit(1);
console.log("[cz-vertical-flow-guard] OK");
