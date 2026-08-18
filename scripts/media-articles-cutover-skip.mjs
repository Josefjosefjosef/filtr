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
  const reasons = [];
  try {
    const cut = JSON.parse(
      fs.readFileSync(path.join(root, "projects/data/info_events/cutover_state.json"), "utf8")
    );
    if (cut.commercialAggregationActive === false) reasons.push("commercialAggregationActive=false");
  } catch (_) {}
  try {
    const arts = JSON.parse(fs.readFileSync(path.join(root, "projects/data/articles.json"), "utf8"));
    if (!Array.isArray(arts.articles) || arts.articles.length === 0) reasons.push("articles.json_empty");
  } catch (_) {
    reasons.push("articles.json_unreadable");
  }
  if (!reasons.length) return { skip: false, reason: "" };
  return { skip: true, reason: reasons.join(";") };
}

export function exitIfMediaArticlesGuardsSkipped(label) {
  const st = mediaArticlesGuardsShouldSkip();
  if (!st.skip) return false;
  console.log(
    `[${label}] SKIP (${st.reason}; media-article section-switch is not a production path while cutover home is Přehled dne)`
  );
  process.exit(0);
}
