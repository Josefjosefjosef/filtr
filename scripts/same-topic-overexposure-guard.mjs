/**
 * same_topic_overexposure_guard — no burst of near-duplicate titles per section (Zprávy/Sport).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const articlesPath =
  process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const maxSameEvent = Number(process.env.MAX_SAME_EVENT_VISIBLE || "1");
const windowHours = Number(process.env.SAME_EVENT_WINDOW_HOURS || "48");
const jaccardMin = Number(process.env.SAME_EVENT_JACCARD_MIN || "0.34");

const STRICT_SECTIONS = new Set(
  (process.env.SAME_EVENT_SECTIONS || "aktualne,sport").split(",").map((s) => s.trim()),
);

const STOP = new Set(
  "a i v ve na do z ze u o od po za pro se si k ke s by že jsou je byl byla bylo budou bude".split(" "),
);

function log(msg) {
  console.log(`[same-topic-overexposure-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[same-topic-overexposure-guard] FAIL: ${msg}`);
}

function fold(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokens(title) {
  const t = fold(cleanTitle(title));
  return new Set(
    t
      .replace(/[^0-9a-z]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function cleanTitle(t) {
  return String(t || "")
    .replace(/^\s*(video|foto|online)\s*:\s*/i, "")
    .trim();
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

function parseTs(v) {
  const t = Date.parse(v || "");
  return Number.isFinite(t) ? t : null;
}

function main() {
  let failed = false;
  if (!fs.existsSync(articlesPath)) {
    fail(`missing ${articlesPath}`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
  const arts = Array.isArray(doc.articles) ? doc.articles : [];
  const winMs = windowHours * 3_600_000;

  for (const sec of STRICT_SECTIONS) {
    const sectionArts = arts.filter(
      (a) => String(a.topic || a.section || "") === sec,
    );
    const recent = sectionArts
      .map((a) => ({
        a,
        ts: parseTs(a.publishedAt),
        tok: tokens(a.title),
        url: String(a.url || "").trim(),
      }))
      .filter((x) => x.ts && x.tok.size >= 3);

    let violations = 0;
    for (let i = 0; i < recent.length; i++) {
      const cluster = [recent[i]];
      for (let j = i + 1; j < recent.length; j++) {
        if (recent[i].url === recent[j].url) continue;
        if (Math.abs(recent[i].ts - recent[j].ts) > winMs) continue;
        if (jaccard(recent[i].tok, recent[j].tok) >= jaccardMin) {
          cluster.push(recent[j]);
        }
      }
      if (cluster.length > maxSameEvent) {
        violations++;
        if (violations <= 3) {
          log(
            `violation section=${sec} count=${cluster.length} sample="${cluster[0].a.title?.slice(0, 60)}"`,
          );
        }
      }
    }
    log(`section=${sec} articles=${sectionArts.length} violation_clusters=${violations}`);
    if (violations > 0) {
      fail(`${violations} same-event clusters with >${maxSameEvent} visible in ${sec}`);
      failed = true;
    }
  }

  if (failed) {
    console.error("[same-topic-overexposure-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
