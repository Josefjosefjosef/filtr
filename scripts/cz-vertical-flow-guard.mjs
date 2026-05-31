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
  let s = String(name || "").trim();
  for (const sep of [" – ", " — ", " - ", " / "]) {
    if (s.includes(sep)) {
      s = s.split(sep, 1)[0].trim();
      break;
    }
  }
  return s.toLowerCase() || "unknown";
}

const ingestedByTopic = {};
const healthSourceNamesByTopic = {};
const healthFeedUrlsByTopic = {};
for (const k of VERT) {
  ingestedByTopic[k] = 0;
  healthSourceNamesByTopic[k] = new Set();
  healthFeedUrlsByTopic[k] = new Set();
}

for (const url of Object.keys(feeds)) {
  const meta = feeds[url];
  if (!meta || typeof meta !== "object") continue;
  const topic = String(meta.topic || "").trim().toLowerCase();
  if (!VERT.includes(topic)) continue;
  const kept = Number(meta.itemsKept || meta.accepted || 0);
  if (kept > 0) {
    ingestedByTopic[topic] += kept;
    healthFeedUrlsByTopic[topic].add(url);
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
  const hf = healthFeedUrlsByTopic[k];
  const ingestFeedCount = hf ? hf.size : 0;
  /* ingest: ≥2 RSS URL s itemsKept; výstup: ≥2 feedId (nebo normalizované jméno bez feedId). */
  if (ingestFeedCount >= 2 && cnt >= 2) {
    const feedIds = new Set();
    const normNames = new Set();
    let allHaveFeedId = true;
    for (const it of items) {
      const fid = String(it.feedId || "").trim();
      if (fid) feedIds.add(fid);
      else allHaveFeedId = false;
      const s0 = Array.isArray(it.sources) && it.sources[0] ? it.sources[0].name : "";
      normNames.add(normSource(s0));
    }
    const diverse = allHaveFeedId && feedIds.size > 0 ? feedIds.size : normNames.size;
    if (diverse < 2) {
      console.error(
        `[cz-vertical-flow-guard] SOURCE_DIVERSITY FAIL: topic=${k} ingest feeds=${ingestFeedCount} but output diversity=${diverse} (feedIds=${[...feedIds].join(",")} norms=${[...normNames].join(",")})`,
      );
      failed = true;
    }
  }
  /* Legacy: velký výřez jen display-name ingest vs výstup (když health měl jen normalizované názvy). */
  if (hs && hs.size >= 2 && cnt >= 5 && ingestFeedCount < 2) {
    const srcs = new Set();
    for (const it of items) {
      const s0 = Array.isArray(it.sources) && it.sources[0] ? it.sources[0].name : "";
      srcs.add(normSource(s0));
    }
    if (srcs.size < 2) {
      console.error(
        `[cz-vertical-flow-guard] SOURCE_DIVERSITY FAIL (display): topic=${k} ${hs.size} distinct ingest sources but output uses one (${[...srcs].join(",")})`,
      );
      failed = true;
    }
  }

  if (cnt >= 1) {
    let newest = 0;
    for (const it of items) {
      const pub = Date.parse(String(it.publishedAt || ""));
      const iu = Date.parse(String(it.iuReleaseAt || ""));
      let eff = 0;
      if (Number.isFinite(pub) && Number.isFinite(iu)) eff = Math.max(pub, iu);
      else if (Number.isFinite(iu)) eff = iu;
      else if (Number.isFinite(pub)) eff = pub;
      if (eff > newest) newest = eff;
    }
    if (newest > 0 && now - newest > livenessMs) {
      const msg = `[cz-vertical-flow-guard] LIVENESS WARN: topic=${k} newest effective time (publishedAt/iuReleaseAt) older than ${LIVENESS_H}h`;
      if (process.env.CZ_VERTICAL_LIVENESS_FAIL === "1") {
        console.error(msg + " (strict FAIL)");
        failed = true;
      } else {
        console.warn(msg);
      }
    }
  }
}

const staleTopics = [];
for (const k of VERT) {
  const items = byTopic[k] || [];
  if (items.length < 1) continue;
  let newest = 0;
  for (const it of items) {
    const pub = Date.parse(String(it.publishedAt || ""));
    const iu = Date.parse(String(it.iuReleaseAt || ""));
    let eff = 0;
    if (Number.isFinite(pub) && Number.isFinite(iu)) eff = Math.max(pub, iu);
    else if (Number.isFinite(iu)) eff = iu;
    else if (Number.isFinite(pub)) eff = pub;
    if (eff > newest) newest = eff;
  }
  if (newest > 0 && now - newest > livenessMs) staleTopics.push(k);
}
if (staleTopics.length) {
  console.warn(
    `[cz-vertical-flow-guard] LIVENESS_SUMMARY: stale_topics=${staleTopics.join(",")} (threshold ${LIVENESS_H}h, effective date)`,
  );
} else {
  console.log(`[cz-vertical-flow-guard] LIVENESS_SUMMARY: stale_topics= (threshold ${LIVENESS_H}h)`);
}

if (failed) process.exit(1);
console.log("[cz-vertical-flow-guard] OK");
