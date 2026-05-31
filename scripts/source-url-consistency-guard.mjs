/**
 * source_url_consistency_guard — article URL domain must match sourceLabel media.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { articleSourceLabel, mediaSourceDisplay } from "./iu-source-display.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const localPath = process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const remoteUrl = (process.env.ARTICLES_JSON_URL || "").trim();
const maxSample = Number(process.env.MAX_SOURCE_URL_MISMATCH_SAMPLE || "25");

async function loadDoc() {
  if (remoteUrl) {
    const res = await fetch(remoteUrl, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    return res.json();
  }
  if (!fs.existsSync(localPath)) throw new Error(`missing ${localPath}`);
  return JSON.parse(fs.readFileSync(localPath, "utf8"));
}

async function main() {
  const doc = await loadDoc();
  const list = Array.isArray(doc.articles) ? doc.articles : [];
  const mismatches = [];
  for (const a of list) {
    const url = String(a.url || a.sources?.[0]?.url || "").trim();
    const raw = String(a.sourceLabel || a.sources?.[0]?.name || "").trim();
    const display = String(a.sourceLabel || "").trim();
    if (!url || !display) continue;
    const expected = mediaSourceDisplay(raw, url);
    if (display !== expected) {
      mismatches.push({
        title: String(a.title || "").slice(0, 80),
        url,
        sourceLabel: display,
        expected,
        section: a.topic || a.section,
      });
    }
  }
  console.log(
    `[source-url-consistency-guard] articles=${list.length} mismatch_count=${mismatches.length}`,
  );
  if (mismatches.length) {
    console.error("[source-url-consistency-guard] sample mismatches:");
    for (const row of mismatches.slice(0, maxSample)) {
      console.error(`  - [${row.section}] got="${row.sourceLabel}" expected="${row.expected}" | ${row.url}`);
    }
    console.error("[source-url-consistency-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[source-url-consistency-guard] RESULT=PASS");
}

main().catch((e) => {
  console.error("[source-url-consistency-guard] ERROR", e.message || e);
  process.exit(1);
});
