/**
 * service_worker_articles_cache_guard — SW must not serve stale articles/bootstrap JSON from cache.
 * Run: node scripts/service-worker-articles-cache-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const swPath = path.join(root, "sw.js");

function fail(msg) {
  console.error(`[service-worker-articles-cache-guard] FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  const sw = fs.readFileSync(swPath, "utf8");

  if (!sw.includes("handleProjectsFeedDataPassthrough")) {
    fail("sw.js missing handleProjectsFeedDataPassthrough");
  }
  if (!sw.includes('cache: "no-store"')) {
    fail("sw.js missing cache: no-store for feed data");
  }

  const feedFn = sw.match(/function isProjectsFeedDataPath\([\s\S]*?\n\}/);
  if (!feedFn) fail("isProjectsFeedDataPath not found");

  const body = feedFn[0];
  for (const needle of ["articles.json", "articles/bootstrap.json", 'name.startsWith("articles/")']) {
    if (!body.includes(needle)) {
      fail(`isProjectsFeedDataPath missing ${needle}`);
    }
  }

  const articlesHandler = sw.match(/if \(url\.origin === self\.location\.origin && isProjectsFeedDataPath\(path\)\)[\s\S]*?return;\s*\}/);
  if (!articlesHandler || !articlesHandler[0].includes("handleProjectsFeedDataPassthrough")) {
    fail("articles feed paths must use handleProjectsFeedDataPassthrough");
  }

  const fetchHandler = sw.match(/self\.addEventListener\("fetch"[\s\S]*?\n\}\);/);
  if (!fetchHandler) fail("fetch handler not found");
  const fh = fetchHandler[0];
  const passthroughIdx = fh.indexOf("isProjectsFeedDataPath(path)");
  const dataReqIdx = fh.indexOf("handleDataRequest(event)");
  if (passthroughIdx < 0 || dataReqIdx < 0 || passthroughIdx > dataReqIdx) {
    fail("fetch handler must route isProjectsFeedDataPath before handleDataRequest");
  }

  console.log("[service-worker-articles-cache-guard] passthrough paths: articles.json, bootstrap.json, articles/*.json");
  console.log("[service-worker-articles-cache-guard] RESULT=PASS");
}

main();
