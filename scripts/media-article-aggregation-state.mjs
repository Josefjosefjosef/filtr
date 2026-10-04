/**
 * Authoritative media (commercial RSS) article aggregation enablement.
 * Source: projects/data/info_events/cutover_state.json (commercialAggregationActive).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MEDIA_ARTICLE_CUTOVER_REL = "projects/data/info_events/cutover_state.json";

export function cutoverStatePath(root = REPO) {
  return path.join(root, MEDIA_ARTICLE_CUTOVER_REL);
}

/** @returns {boolean} true when commercial media article aggregation is expected to run */
export function isMediaArticleAggregationEnabled(root = REPO) {
  try {
    const p = cutoverStatePath(root);
    if (!fs.existsSync(p)) return true;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return j.commercialAggregationActive !== false;
  } catch (_) {
    return true;
  }
}

export function describeMediaArticleAggregationState(root = REPO) {
  const enabled = isMediaArticleAggregationEnabled(root);
  return {
    enabled,
    authoritativePath: MEDIA_ARTICLE_CUTOVER_REL,
    mediaArticleAggregation: enabled ? "ENABLED" : "DISABLED",
    freshnessCheck: enabled ? "ACTIVE" : "NOT_APPLICABLE",
  };
}
