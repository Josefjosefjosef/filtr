/**
 * Summarize iuFeedClassification in projects/data/articles.json (counts + sample URLs).
 * Run: node scripts/audit-feed-classification.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ART = path.join(ROOT, "projects", "data", "articles.json");

function main() {
  if (!fs.existsSync(ART)) {
    console.error("missing", ART);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(ART, "utf8"));
  const items = Array.isArray(raw.articles) ? raw.articles : [];
  const by = Object.create(null);
  let missing = 0;
  const samples = Object.create(null);
  for (const it of items) {
    const cf = it && it.iuFeedClassification;
    if (!cf || cf.v !== 1 || !cf.mediaTopicKey) {
      missing++;
      continue;
    }
    const k = String(cf.mediaTopicKey);
    by[k] = (by[k] || 0) + 1;
    if (!samples[k] && it.url) samples[k] = String(it.url).slice(0, 120);
  }
  console.log(JSON.stringify({ total: items.length, classified: items.length - missing, missing, byKey: by, sampleUrlByKey: samples }, null, 2));
}

main();
