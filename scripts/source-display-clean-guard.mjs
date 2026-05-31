/**
 * source_display_clean_guard — sourceLabel must not contain media subsection rubrics.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  sourceLabelHasForbiddenSubsection,
  articleSourceLabel,
} from "./iu-source-display.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const localPath = process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const remoteUrl = (process.env.ARTICLES_JSON_URL || "").trim();
const maxSample = Number(process.env.MAX_SOURCE_DISPLAY_SAMPLE || "25");

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
  const bad = [];
  for (const a of list) {
    const sl = String(a.sourceLabel || "").trim();
    if (!sl) continue;
    if (sourceLabelHasForbiddenSubsection(sl)) {
      bad.push({ title: String(a.title || "").slice(0, 80), sourceLabel: sl, section: a.topic || a.section });
    }
  }
  console.log(
    `[source-display-clean-guard] articles=${list.length} forbidden_subsection_count=${bad.length}`,
  );
  if (bad.length) {
    console.error("[source-display-clean-guard] sample failures:");
    for (const row of bad.slice(0, maxSample)) {
      console.error(`  - [${row.section}] ${row.sourceLabel} | ${row.title}`);
    }
    console.error("[source-display-clean-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[source-display-clean-guard] RESULT=PASS");
}

main().catch((e) => {
  console.error("[source-display-clean-guard] ERROR", e.message || e);
  process.exit(1);
});
