/**
 * Shared cutover probe for legacy media-article Playwright/CI guards.
 * When commercial aggregation is off (structural media removal), those guards
 * must SKIP — not FAIL — while the universal engine + Přehled dne remain tested elsewhere.
 */
import {
  describeMediaArticleAggregationState,
  isMediaArticleAggregationEnabled,
  MEDIA_ARTICLE_CUTOVER_REL,
} from "./media-article-aggregation-state.mjs";
import { fileURLToPath } from "url";
import path from "path";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export { isMediaArticleAggregationEnabled, describeMediaArticleAggregationState, MEDIA_ARTICLE_CUTOVER_REL };

export function mediaArticlesGuardsShouldSkip(root = REPO) {
  if (!isMediaArticleAggregationEnabled(root)) {
    return {
      skip: true,
      reason: `commercialAggregationActive=false (${MEDIA_ARTICLE_CUTOVER_REL})`,
    };
  }
  return { skip: false, reason: "" };
}

export function exitIfMediaArticlesGuardsSkipped(label) {
  const st = mediaArticlesGuardsShouldSkip();
  if (!st.skip) return false;
  console.log(
    `[${label}] SKIP (${st.reason}; media-article section-switch is not a production path while cutover home is Přehled dne)`
  );
  process.exit(0);
}
