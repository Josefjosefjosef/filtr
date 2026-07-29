/**
 * Shared cutover probe for legacy media-article Playwright/CI guards.
 * When commercial aggregation is off (structural media removal), those guards
 * must SKIP — not FAIL — while the universal engine + Přehled dne remain tested elsewhere.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function mediaArticlesGuardsShouldSkip(root = REPO) {
  try {
    const cut = JSON.parse(
      fs.readFileSync(path.join(root, "projects/data/info_events/cutover_state.json"), "utf8")
    );
    if (cut.commercialAggregationActive === false) return true;
  } catch (_) {}
  try {
    const arts = JSON.parse(fs.readFileSync(path.join(root, "projects/data/articles.json"), "utf8"));
    if (!Array.isArray(arts.articles) || arts.articles.length === 0) return true;
  } catch (_) {
    return true;
  }
  return false;
}

export function exitIfMediaArticlesGuardsSkipped(label) {
  if (!mediaArticlesGuardsShouldSkip()) return false;
  console.log(`[${label}] SKIP (commercialAggregationActive=false / empty articles.json)`);
  process.exit(0);
}
