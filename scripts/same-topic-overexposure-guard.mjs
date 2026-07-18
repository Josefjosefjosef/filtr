/**
 * same_topic_overexposure_guard — detect bursts of near-duplicate titles per section (Zprávy/Sport).
 *
 * PUBLISH_ALWAYS (default): incidents WARN only, release continues.
 * STRICT: same-event clusters above threshold block release.
 *
 * Env:
 *   ARTICLES_JSON_PATH
 *   MAX_SAME_EVENT_VISIBLE — max visible articles per same-event cluster (default 1)
 *   SAME_EVENT_WINDOW_HOURS — lookback window (default 48)
 *   SAME_EVENT_JACCARD_MIN — title token Jaccard threshold (default 0.34)
 *   SAME_EVENT_SECTIONS — comma list (default aktualne,sport)
 *   SAME_TOPIC_POLICY — PUBLISH_ALWAYS | STRICT (default PUBLISH_ALWAYS)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const articlesPath =
  process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const maxSameEvent = Number(process.env.MAX_SAME_EVENT_VISIBLE || "1");
const windowHours = Number(process.env.SAME_EVENT_WINDOW_HOURS || "48");
const jaccardMin = Number(process.env.SAME_EVENT_JACCARD_MIN || "0.34");
const SAME_TOPIC_POLICY = (process.env.SAME_TOPIC_POLICY || "PUBLISH_ALWAYS").trim().toUpperCase();

const STRICT_SECTIONS = new Set(
  (process.env.SAME_EVENT_SECTIONS || "aktualne,sport").split(",").map((s) => s.trim()),
);

const STOP = new Set(
  "a i v ve na do z ze u o od po za pro se si k ke s by že jsou je byl byla bylo budou bude".split(" "),
);

function isPublishAlwaysPolicy() {
  return SAME_TOPIC_POLICY === "PUBLISH_ALWAYS";
}

function log(msg) {
  console.log(`[same-topic-overexposure-guard] ${msg}`);
}

function warn(msg) {
  console.warn(`[same-topic-overexposure-guard] WARN: ${msg}`);
}

function incident(msg) {
  console.warn(`[same-topic-overexposure-guard] INCIDENT: ${msg}`);
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
    .replace(/^\s*(video|foto|online|souhrn|analýza|analýza)\s*:\s*/i, "")
    .trim();
}

function isDigestTitle(title) {
  const t = fold(String(title || ""));
  return (
    t.startsWith("souhrn") ||
    t.includes("zasadni udalosti") ||
    t.includes("prehled dne") ||
    t.length < 12
  );
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

/**
 * @returns {{ violations: object[], sectionSummaries: object[], policy: string }}
 */
export function evaluateSameTopicOverexposure(articles, options = {}) {
  const maxVisible = Number(options.maxSameEventVisible ?? maxSameEvent);
  const winH = Number(options.windowHours ?? windowHours);
  const jacMin = Number(options.jaccardMin ?? jaccardMin);
  const sections = new Set(
    (options.strictSections
      ? Array.from(options.strictSections)
      : Array.from(STRICT_SECTIONS)).map((s) => String(s).trim()),
  );
  const nowMs = options.nowMs ?? Date.now();
  const winMs = winH * 3_600_000;
  const lookbackMs = winH * 3_600_000;
  const arts = Array.isArray(articles) ? articles : [];
  const violations = [];
  const sectionSummaries = [];

  for (const sec of sections) {
    const sectionArts = arts.filter((a) => String(a.topic || a.section || "") === sec);
    const recent = sectionArts
      .map((a) => ({
        a,
        ts: parseTs(a.publishedAt),
        tok: tokens(a.title),
        url: String(a.url || "").trim(),
      }))
      .filter(
        (x) =>
          x.ts &&
          x.tok.size >= 3 &&
          nowMs - x.ts <= lookbackMs &&
          !isDigestTitle(x.a.title),
      );

    const used = new Set();
    let violationClusters = 0;
    for (let i = 0; i < recent.length; i++) {
      if (used.has(i)) continue;
      const cluster = [recent[i]];
      used.add(i);
      for (let j = i + 1; j < recent.length; j++) {
        if (used.has(j)) continue;
        if (recent[i].url === recent[j].url) continue;
        if (Math.abs(recent[i].ts - recent[j].ts) > winMs) continue;
        if (jaccard(recent[i].tok, recent[j].tok) >= jacMin) {
          cluster.push(recent[j]);
          used.add(j);
        }
      }
      if (cluster.length > maxVisible) {
        violationClusters++;
        violations.push({
          section: sec,
          observedCount: cluster.length,
          threshold: maxVisible,
          jaccardMin: jacMin,
          windowHours: winH,
          sampleTitle: cluster[0].a.title || "",
          urls: cluster.map((c) => c.url).filter(Boolean),
          titles: cluster.map((c) => String(c.a.title || "").slice(0, 120)),
          publishedAt: cluster.map((c) => c.a.publishedAt || ""),
        });
      }
    }

    sectionSummaries.push({
      section: sec,
      articlesTotal: sectionArts.length,
      recentCandidates: recent.length,
      violationClusters,
    });
  }

  return {
    violations,
    sectionSummaries,
    policy: options.policy ?? SAME_TOPIC_POLICY,
    threshold: maxVisible,
    windowHours: winH,
    jaccardMin: jacMin,
  };
}

function writeReport(report) {
  const outPath = path.join(os.tmpdir(), "iu_same_topic_overexposure_guard_report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  log(`report=${outPath}`);
  return outPath;
}

function main() {
  const publishAlways = isPublishAlwaysPolicy();
  if (!fs.existsSync(articlesPath)) {
    fail(`missing ${articlesPath}`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
  const arts = Array.isArray(doc.articles) ? doc.articles : [];
  const nowMsEnv = Number(process.env.SAME_EVENT_NOW_MS || "");
  const evaluation = evaluateSameTopicOverexposure(arts, {
    nowMs: Number.isFinite(nowMsEnv) && nowMsEnv > 0 ? nowMsEnv : undefined,
  });

  for (const summary of evaluation.sectionSummaries) {
    log(
      `section=${summary.section} recent_window_h=${evaluation.windowHours} candidates=${summary.recentCandidates}`,
    );
    log(
      `section=${summary.section} articles=${summary.articlesTotal} violation_clusters=${summary.violationClusters}`,
    );
  }

  for (const v of evaluation.violations.slice(0, 5)) {
    warn(
      `section=${v.section} observed=${v.observedCount} threshold=${v.threshold} sample="${v.sampleTitle.slice(0, 60)}"`,
    );
    for (const url of v.urls.slice(0, 3)) {
      warn(`offending_url=${url}`);
    }
  }

  const report = {
    guard: "same-topic-overexposure",
    policy: evaluation.policy,
    blocking: publishAlways ? false : evaluation.violations.length > 0,
    threshold: evaluation.threshold,
    windowHours: evaluation.windowHours,
    jaccardMin: evaluation.jaccardMin,
    violationCount: evaluation.violations.length,
    violations: evaluation.violations,
    sectionSummaries: evaluation.sectionSummaries,
    generatedAt: new Date().toISOString(),
  };
  writeReport(report);

  if (evaluation.violations.length > 0) {
    const msg = `${evaluation.violations.length} same-event clusters with >${evaluation.threshold} visible`;
    incident(msg);
    log(
      `SAME_TOPIC_ALERT=YES SAME_TOPIC_BLOCKING=${publishAlways ? "NO" : "YES"} violations=${evaluation.violations.length}`,
    );
    if (!publishAlways) {
      fail(msg);
      console.error("[same-topic-overexposure-guard] RESULT=FAIL");
      process.exit(1);
    }
    log("[same-topic-overexposure-guard] RESULT=PASS_WITH_WARN (publish-always incident logged, release continues)");
    process.exit(0);
  }

  log("RESULT=PASS");
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
