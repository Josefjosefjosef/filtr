/**
 * duplicate_metadata_guard — suppressed records + winner metadata when duplicates exist.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const suppressedPath =
  process.env.TOPIC_DEDUPE_SUPPRESSED_PATH ||
  path.join(root, "projects", "data", "topic_dedupe_suppressed.json");
const articlesPath =
  process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");

function log(msg) {
  console.log(`[duplicate-metadata-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[duplicate-metadata-guard] FAIL: ${msg}`);
}

function main() {
  let failed = false;

  if (!fs.existsSync(suppressedPath)) {
    log("suppressed sidecar absent (OK if no duplicates yet)");
    log("RESULT=PASS");
    return;
  }

  const doc = JSON.parse(fs.readFileSync(suppressedPath, "utf8"));
  const suppressed = Array.isArray(doc.suppressed) ? doc.suppressed : [];
  const stats = doc.stats || {};
  log(`suppressed_count=${stats.suppressed_count ?? suppressed.length}`);

  for (const rec of suppressed.slice(0, 50)) {
    if (!rec.duplicate_of) {
      fail(`missing duplicate_of url=${rec.url}`);
      failed = true;
      break;
    }
    if (!rec.duplicate_reason) {
      fail(`missing duplicate_reason url=${rec.url}`);
      failed = true;
      break;
    }
    if (!rec.topic_key) {
      fail(`missing topic_key url=${rec.url}`);
      failed = true;
      break;
    }
    if (rec.duplicate_confidence == null) {
      fail(`missing duplicate_confidence url=${rec.url}`);
      failed = true;
      break;
    }
  }

  if (!failed && fs.existsSync(articlesPath)) {
    const artsDoc = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
    const withAlts = (artsDoc.articles || []).filter(
      (a) => Array.isArray(a.alternativeSources) && a.alternativeSources.length > 0,
    );
    log(`winners_with_alternativeSources=${withAlts.length}`);
    for (const w of withAlts.slice(0, 5)) {
      if (!w.topic_key) {
        fail("winner with alternatives missing topic_key");
        failed = true;
        break;
      }
    }
  }

  if (failed) {
    console.error("[duplicate-metadata-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
