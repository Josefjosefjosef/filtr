/**
 * Policy unit tests: same-topic overexposure guard must not block release under PUBLISH_ALWAYS.
 * Run: node scripts/same-topic-overexposure-guard-policy-unit.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { evaluateSameTopicOverexposure } from "./same-topic-overexposure-guard.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const guardScript = path.join(root, "scripts", "same-topic-overexposure-guard.mjs");

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

const NOW = Date.parse("2026-06-15T10:00:00.000Z");

function kyivClusterArticles() {
  const base = "2026-06-15T08:00:00.000Z";
  return [
    {
      title: "Útok na kyjevský klášter pokračuje podle zahraničních médií",
      url: "https://www.novinky.cz/clanek/kyiv-1",
      publishedAt: base,
      section: "aktualne",
      topic: "aktualne",
    },
    {
      title: "Útok na kyjevský klášter eskakuje podle zahraničních médií",
      url: "https://www.idnes.cz/zpravy/kyiv-2",
      publishedAt: "2026-06-15T09:30:00.000Z",
      section: "aktualne",
      topic: "aktualne",
    },
  ];
}

// evaluate detects Kyiv cluster (run 27536608320 scenario)
{
  const evaluation = evaluateSameTopicOverexposure(kyivClusterArticles(), { nowMs: NOW });
  assert(evaluation.violations.length === 1, `expected 1 violation got ${evaluation.violations.length}`);
  const v = evaluation.violations[0];
  assert(v.section === "aktualne", "section aktualne");
  assert(v.observedCount === 2, "observed count 2");
  assert(v.threshold === 1, "threshold 1");
  assert(v.urls.length === 2, "two urls");
  assert(v.titles.length === 2, "two titles");
  console.log("PASS test_evaluate_detects_kyiv_cluster");
}

// PUBLISH_ALWAYS: guard process exits 0 and reports warning
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-same-topic-"));
  const articlesPath = path.join(tmpDir, "articles.json");
  fs.writeFileSync(
    articlesPath,
    JSON.stringify({ articles: kyivClusterArticles(), generatedAt: "2026-06-15T10:00:00.000Z" }),
  );
  const run = spawnSync(process.execPath, [guardScript], {
    env: {
      ...process.env,
      ARTICLES_JSON_PATH: articlesPath,
      SAME_TOPIC_POLICY: "PUBLISH_ALWAYS",
      SAME_EVENT_NOW_MS: String(NOW),
    },
    encoding: "utf8",
  });
  assert(run.status === 0, `PUBLISH_ALWAYS must exit 0 got ${run.status}`);
  const out = `${run.stdout || ""}${run.stderr || ""}`;
  assert(out.includes("SAME_TOPIC_ALERT=YES"), "alert flag");
  assert(out.includes("SAME_TOPIC_BLOCKING=NO"), "non-blocking flag");
  assert(out.includes("RESULT=PASS_WITH_WARN"), "pass with warn");
  assert(out.includes("INCIDENT:"), "incident line");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("PASS test_publish_always_exits_zero_with_warning");
}

// STRICT: guard process exits 1 (hard fail preserved for explicit strict mode)
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iu-same-topic-"));
  const articlesPath = path.join(tmpDir, "articles.json");
  fs.writeFileSync(
    articlesPath,
    JSON.stringify({ articles: kyivClusterArticles(), generatedAt: "2026-06-15T10:00:00.000Z" }),
  );
  const run = spawnSync(process.execPath, [guardScript], {
    env: {
      ...process.env,
      ARTICLES_JSON_PATH: articlesPath,
      SAME_TOPIC_POLICY: "STRICT",
      SAME_EVENT_NOW_MS: String(NOW),
    },
    encoding: "utf8",
  });
  assert(run.status === 1, `STRICT must exit 1 got ${run.status}`);
  const out = `${run.stdout || ""}${run.stderr || ""}`;
  assert(out.includes("RESULT=FAIL"), "strict fail result");
  assert(out.includes("SAME_TOPIC_BLOCKING=YES"), "blocking flag");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log("PASS test_strict_mode_still_blocks");
}

console.log("SAME_TOPIC_GUARD_POLICY_UNIT=PASS");
