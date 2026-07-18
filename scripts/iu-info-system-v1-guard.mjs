#!/usr/bin/env node
/** Guard: InfoUzel info-system v1 integrity. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isConcreteItemUrl } from "./iu-info-events-lib.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];

function mustExist(rel) {
  if (!fs.existsSync(path.join(REPO, rel))) fails.push(`missing:${rel}`);
}

mustExist("projects/data/info_events/taxonomy.json");
mustExist("projects/data/info_events/source_registry.json");
mustExist("projects/data/info_events/feed.json");
mustExist("projects/data/info_events/cutover_state.json");
mustExist("assets/iu-info-system-core-v1.js");
mustExist("assets/iu-prehled-dne-ui-v1.js");
mustExist("assets/iu-prehled-dne-v1.css");
mustExist("scripts/iu-info-events-lib.mjs");
mustExist("scripts/iu-info-events-refresh.mjs");

const taxonomy = JSON.parse(fs.readFileSync(path.join(REPO, "projects/data/info_events/taxonomy.json"), "utf8"));
const registry = JSON.parse(fs.readFileSync(path.join(REPO, "projects/data/info_events/source_registry.json"), "utf8"));
const feed = JSON.parse(fs.readFileSync(path.join(REPO, "projects/data/info_events/feed.json"), "utf8"));

if (!Array.isArray(taxonomy.sections) || taxonomy.sections.length < 9) fails.push("taxonomy:sections");
if (!Array.isArray(registry.entries) || registry.entries.length < 20) fails.push("registry:entries");
if (!Array.isArray(feed.items) || feed.items.length < 50) fails.push("feed:items_min_50");

const active = (registry.entries || []).filter((e) => e.productionApproved && e.productionActive);
if (active.length < 15) fails.push("registry:active_min_15");

for (const e of registry.entries || []) {
  if (e.productionApproved && e.productionActive) {
    if (e.legalStatus !== "approved") fails.push(`legal:${e.id}`);
    if (!e.monitoring) fails.push(`monitoring:${e.id}`);
    const hasConnector = !!(e.feedUrl || (e.feedUrls && e.feedUrls.length) || e.htmlListUrl || (e.htmlListUrls && e.htmlListUrls.length));
    if (!hasConnector) fails.push(`connector_missing:${e.id}`);
  }
}

const homeBySource = new Map((registry.entries || []).map((e) => [e.id, e.url]));
const banned = [/perex/i, /image/i, /thumbnail/i, /photo/i, /bodyHtml/i, /contentHtml/i];
let homepageHits = 0;
for (const it of feed.items || []) {
  for (const k of Object.keys(it)) {
    if (banned.some((re) => re.test(k))) fails.push(`banned_field:${it.id}:${k}`);
  }
  if (it.image || it.perex || it.body || it.thumbnail) fails.push(`content_leak:${it.id}`);
  const url = String(it.url || "");
  if (!/^https?:\/\//i.test(url)) fails.push(`bad_url:${it.id}`);
  const home = homeBySource.get(it.sourceId) || null;
  if (!isConcreteItemUrl(url, home)) {
    homepageHits += 1;
    fails.push(`homepage_or_listing_url:${it.id}`);
  }
}
if (homepageHits) fails.push(`homepage_urls_count:${homepageHits}`);

if (!(registry.deactivatedCommercialMedia || []).length) fails.push("missing:deactivatedCommercialMedia");

const cutover = JSON.parse(fs.readFileSync(path.join(REPO, "projects/data/info_events/cutover_state.json"), "utf8"));
if (cutover.commercialAggregationActive !== false) fails.push("cutover:commercialAggregationActive_must_be_false");
if (cutover.infoSystemActive !== true) fails.push("cutover:infoSystemActive_must_be_true");

if (fails.length) {
  console.error("[iu-info-system-v1-guard] FAIL");
  for (const f of fails.slice(0, 40)) console.error(" -", f);
  if (fails.length > 40) console.error(" - … +" + (fails.length - 40));
  console.log("RESULT=FAIL");
  process.exit(1);
}
console.log(
  "[iu-info-system-v1-guard] OK items=" +
    feed.items.length +
    " sources=" +
    registry.entries.length +
    " active=" +
    active.length
);
console.log("RESULT=PASS");
