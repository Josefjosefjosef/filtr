/**
 * removed-media-regression-guard
 *
 * Prevents accidental return of concrete removed media sources/feeds.
 * Does NOT ban sourceType=media generally — future media require an explicit PR
 * that updates config/removed_media_deny_list.json together with legal/connector work.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function readJson(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.error("[removed-media-regression-guard] FAIL missing:" + rel);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fail(msg) {
  console.error("[removed-media-regression-guard] FAIL " + msg);
  process.exit(1);
}

const deny = readJson("config/removed_media_deny_list.json");
const removedFeedIds = new Set((deny.removedFeedIds || []).map(String));
const removedDomains = new Set((deny.removedDomains || []).map((d) => String(d).toLowerCase()));

const cutover = readJson("projects/data/info_events/cutover_state.json");
if (cutover.commercialAggregationActive !== false) {
  fail("cutover:commercialAggregationActive must be false");
}
if (cutover.infoSystemActive !== true) {
  fail("cutover:infoSystemActive must be true");
}

const configSources = readJson("config/sources.json");
if (Array.isArray(configSources.sources) && configSources.sources.length > 0) {
  const hit = configSources.sources.find((s) => removedFeedIds.has(String(s.id)));
  if (hit) fail("config/sources.json contains removed id:" + hit.id);
  fail("config/sources.json must be empty after media removal (found " + configSources.sources.length + ")");
}

const registry = readJson("projects/data/source_registry.json");
const entries = registry.entries || [];
const active = entries.filter((e) => e && e.active === true && !e.blocked);
if (active.length > 0) {
  fail("source_registry has active entries:" + active.map((e) => e.id).join(","));
}
for (const e of entries) {
  if (!e || !e.id) continue;
  if (removedFeedIds.has(String(e.id)) && e.active === true) {
    fail("denied feedId reactivated:" + e.id);
  }
  if (e.domain && removedDomains.has(String(e.domain).toLowerCase()) && e.active === true) {
    fail("denied domain reactivated:" + e.domain);
  }
}

const articles = readJson("projects/data/articles.json");
const arts = Array.isArray(articles.articles) ? articles.articles : [];
if (arts.length > 0) {
  const bad = arts.find((a) => {
    const fid = String(a.feedId || "");
    if (fid && removedFeedIds.has(fid)) return true;
    try {
      const host = new URL(String(a.url || "")).hostname.replace(/^www\./, "").toLowerCase();
      return removedDomains.has(host);
    } catch (_) {
      return false;
    }
  });
  if (bad) fail("articles.json still publishes removed media item feedId=" + (bad.feedId || "?"));
  fail("articles.json must be empty after media removal (found " + arts.length + ")");
}

const pool = readJson("projects/data/publishable_pool.json");
const poolArts = Array.isArray(pool.articles) ? pool.articles : [];
if (poolArts.length > 0) {
  fail("publishable_pool.json must be empty (found " + poolArts.length + ")");
}

const manifest = readJson("projects/data/article_feed_chunks/manifest.json");
const feedSec = manifest.sections && manifest.sections.feed;
if (feedSec && Number(feedSec.totalArticles || 0) > 0) {
  fail("article_feed_chunks manifest totalArticles>0");
}

const iuSourcesPath = path.join(ROOT, "assets/iu-sources.js");
const iuSources = fs.readFileSync(iuSourcesPath, "utf8");
if (!/export const IU_SOURCES = \[\];/.test(iuSources)) {
  fail("assets/iu-sources.js must export empty IU_SOURCES");
}

const yt = readJson("scripts/feeds_youtube.json");
if (Array.isArray(yt) && yt.length > 0) {
  fail("scripts/feeds_youtube.json must be empty");
}

console.log("[removed-media-regression-guard] PASS");
console.log("denied_feedIds=" + removedFeedIds.size);
console.log("denied_domains=" + removedDomains.size);
console.log("articles=0 registry_active=0 config_sources=0");
