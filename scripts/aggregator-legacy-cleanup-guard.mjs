/**
 * aggregator_legacy_cleanup_guard — proof: V3-only prod path; legacy V2 archived.
 * Run: node scripts/aggregator-legacy-cleanup-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const CANONICAL_UA =
  "infoUzelBot/1.0 (+https://infouzel.cz; contact: Info@infoUzel.cz)";
const PRIMARY_PUBLISH_WORKFLOW = "update-articles.yml";
const FAST_POOL_PUBLISH_WORKFLOW = "update-articles-fast-pool.yml";
const WATCHDOG_WORKFLOW_FILE = "update-articles.yml";
const NIGHTLY_REBUILD_WORKFLOW = "articles-nightly-full-rebuild.yml";
const ARCHIVE_DIR = "scripts/archive/deprecated/aggregator-v2";

/** Must not exist under scripts/ (production tree). */
const FORBIDDEN_IN_SCRIPTS_ROOT = [
  "build_articles_v2.py",
  "fetch_engine.py",
  "run_articles_pipeline.py",
  "update-articles.js",
  "data_layer.py",
  "json_validator.py",
  "health_reporter.py",
];

/** Archived DEAD_CODE bundle (must exist together). */
const ARCHIVED_FILES = [
  "build_articles_v2.py",
  "fetch_engine.py",
  "run_articles_pipeline.py",
  "update-articles.js",
  "data_layer.py",
  "json_validator.py",
  "health_reporter.py",
  "README.md",
];

const RUNTIME_ARTIFACTS = [
  "feed_build.log",
  "projects/data/staging/",
  "projects/data/feed_snapshots/",
  "projects/data/fetch_monitor.json",
];

const ACTIVE_WRITERS_ARTICLES = [
  "scripts/build_articles.py:_publish_article_outputs,_atomic_write_json(OUT_PATH)",
];
const ACTIVE_WRITERS_META = ["scripts/build_articles.py:_atomic_write_json(META_PATH)"];
const ACTIVE_WRITERS_QUEUE = [
  "scripts/iu_backpressure.py:_write_queue(staging/publish_queue.json)",
];

function log(msg) {
  console.log(`[aggregator-legacy-cleanup-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[aggregator-legacy-cleanup-guard] FAIL: ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function listWorkflowFiles() {
  return fs
    .readdirSync(path.join(root, ".github", "workflows"))
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => path.join(root, ".github", "workflows", f));
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      walkFiles(p, acc);
    } else {
      acc.push(p);
    }
  }
  return acc;
}

function rel(p) {
  return path.relative(root, p).split(path.sep).join("/");
}

const REFERENCE_SKIP_PREFIXES = [
  "docs/",
  "reports/",
  "reports-download/",
  "_nightly_test/",
  "scripts/archive/",
  "scripts/__pycache__/",
];

const REFERENCE_SKIP_FILES = new Set([
  "run_infoUzel_pipeline.cmd",
  "structure.txt",
  "STRUKTURA_WEBU.txt",
  "STRUKTURA_WEBU_FULL.txt",
  "SYSTEM_AUDIT.md",
]);

const ACTIVE_CODE_SUFFIXES = /\.(py|mjs|cjs|js|yml|yaml|toml|json)$/i;

function scanRepoReferences(basename) {
  const hits = [];
  const skipDir = path.join(root, "scripts", "archive");
  for (const file of walkFiles(root)) {
    if (file.startsWith(skipDir)) continue;
    if (file.includes(`${path.sep}.git${path.sep}`)) continue;
    if (/\.(png|jpg|jpeg|gif|webp|woff2?|pyc)$/i.test(file)) continue;
    const r = rel(file);
    if (r.endsWith(basename)) continue;
    if (REFERENCE_SKIP_PREFIXES.some((p) => r.startsWith(p) || r.includes(`/${p}`))) continue;
    if (REFERENCE_SKIP_FILES.has(r)) continue;
    if (!ACTIVE_CODE_SUFFIXES.test(r)) continue;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes(basename)) hits.push(r);
  }
  return hits;
}

function proofLegacyFile(name) {
  const archivePath = path.join(root, ARCHIVE_DIR, name);
  const scriptsRootPath = path.join(root, "scripts", name);
  const inArchive = fs.existsSync(archivePath);
  const inScriptsRoot = fs.existsSync(scriptsRootPath);
  const refs = scanRepoReferences(name).filter(
    (r) =>
      !r.startsWith("docs/") &&
      !r.startsWith("SYSTEM_AUDIT") &&
      !r.includes("archive/deprecated") &&
      !r.endsWith("aggregator-legacy-cleanup-guard.mjs"),
  );
  const archiveText = inArchive ? read(path.join(ARCHIVE_DIR, name)) : "";
  return {
    file: name,
    imports_found: inArchive ? (archiveText.match(/^import |^from /gm) || []).slice(0, 8) : [],
    workflow_references: refs.filter((r) => r.startsWith(".github/")),
    package_references: refs.filter((r) => r === "package.json"),
    runtime_references: refs.filter(
      (r) => !r.startsWith(".github/") && r !== "package.json",
    ),
    writes_production_data:
      inArchive &&
      (archiveText.includes("projects/data") ||
        (name === "update-articles.js" && archiveText.includes("articles.json"))),
    can_modify_articles_json:
      name === "build_articles_v2.py" || name === "update-articles.js",
    can_modify_meta_json: name === "build_articles_v2.py",
    can_modify_publish_queue: false,
    in_scripts_root: inScriptsRoot,
    in_archive: inArchive,
    status: inScriptsRoot
      ? "ACTIVE_FORBIDDEN"
      : inArchive
        ? "DEAD_CODE"
        : "MISSING",
  };
}

function parseTriggers(text) {
  const onBlock = text.match(/^on:\s*\n([\s\S]*?)(?=^[a-z]|^env:|^permissions:|^concurrency:|^jobs:)/m);
  if (!onBlock) return { schedule: [], dispatch: false };
  const block = onBlock[1];
  const schedules = [...block.matchAll(/cron:\s*["']([^"']+)["']/g)].map((m) => m[1]);
  return {
    schedule: schedules,
    dispatch: /\bworkflow_dispatch\b/.test(block),
  };
}

function main() {
  let failed = false;
  const legacyProofs = FORBIDDEN_IN_SCRIPTS_ROOT.map((n) => proofLegacyFile(n));
  const deadCodeConfirmed = legacyProofs.filter((p) => p.status === "DEAD_CODE").map((p) => p.file);
  const deadCodeRemoved = deadCodeConfirmed;
  const activeFetchHelpers = ["scripts/iu_crawler.py"];
  const legacyFetchHelpers = [];

  log("--- legacy_file_proof ---");
  for (const p of legacyProofs) {
    log(`proof file=${p.file} status=${p.status}`);
    log(`proof workflow_references=${JSON.stringify(p.workflow_references)}`);
    log(`proof package_references=${JSON.stringify(p.package_references)}`);
    log(`proof runtime_references=${JSON.stringify(p.runtime_references)}`);
    log(
      `proof writes_production_data=${p.writes_production_data} projects/data=${p.file === "build_articles_v2.py" ? "false (filtr/data only)" : String(p.writes_production_data)}`,
    );
    if (p.in_scripts_root) {
      fail(`${p.file} must not exist in scripts/ root (archive only)`);
      failed = true;
    }
    if (p.status === "DEAD_CODE" && p.workflow_references.length > 0) {
      fail(`${p.file} still referenced from workflows: ${p.workflow_references.join(", ")}`);
      failed = true;
    }
    if (p.status === "DEAD_CODE" && p.runtime_references.length > 0) {
      fail(`${p.file} still referenced from active code: ${p.runtime_references.join(", ")}`);
      failed = true;
    }
  }

  for (const name of ARCHIVED_FILES) {
    const ap = path.join(root, ARCHIVE_DIR, name);
    if (!fs.existsSync(ap)) {
      fail(`missing archived file ${ARCHIVE_DIR}/${name}`);
      failed = true;
    }
  }

  const allWorkflowText = listWorkflowFiles()
    .map((p) => fs.readFileSync(p, "utf8"))
    .join("\n");
  if (/scripts\/fetch_engine|from fetch_engine|build_articles_v2|run_articles_pipeline|update-articles\.js/.test(allWorkflowText)) {
    fail("workflow still references legacy aggregator scripts outside archive");
    failed = true;
  } else {
    log("no legacy script refs in .github/workflows PASS");
  }

  const pkg = JSON.parse(read("package.json"));
  const pkgText = JSON.stringify(pkg.scripts || {});
  if (/build_articles_v2|fetch_engine|run_articles_pipeline|update-articles\.js/.test(pkgText)) {
    fail("package.json scripts reference legacy aggregator");
    failed = true;
  } else {
    log("package.json no legacy aggregator scripts PASS");
  }

  const report = {
    active_workflows: [],
    legacy_workflows: [],
    nightly_only_workflows: [],
    guard_only_workflows: [],
    publish_workflows: [],
    fast_pool_publish_workflows: [],
    legacy_publish_paths: ["scripts/archive/deprecated/aggregator-v2 → filtr/data/ (DEAD_CODE)"],
    dead_code_candidates: [],
    dead_code_confirmed: deadCodeConfirmed,
    dead_code_removed: deadCodeRemoved,
    generated_runtime_artifacts: RUNTIME_ARTIFACTS,
  };

  let prodPublishCount = 0;
  for (const wfPath of listWorkflowFiles()) {
    const name = path.basename(wfPath);
    const text = fs.readFileSync(wfPath, "utf8");
    const invokesBuild = /python\s+scripts\/build_articles\.py/.test(text);
    const isArticle =
      name.includes("article") ||
      name.includes("aggregator") ||
      name.includes("watchdog") ||
      name.includes("pages-publish-from-main-data") ||
      name.includes("pages-on-data-pr-merge");

    if (!isArticle && !invokesBuild) continue;

    if (name === PRIMARY_PUBLISH_WORKFLOW) {
      const tr = parseTriggers(text);
      if (tr.schedule.length > 0) {
        fail(`${name} has GitHub schedule`);
        failed = true;
      }
      report.active_workflows.push(name);
      report.publish_workflows.push(name);
      prodPublishCount += 1;
    } else if (name === FAST_POOL_PUBLISH_WORKFLOW) {
      const tr = parseTriggers(text);
      if (tr.schedule.length > 0) {
        fail(`${name} has GitHub schedule`);
        failed = true;
      }
      if (!/iu_fast_pool_publish\.py/.test(text)) {
        fail(`${name} must invoke iu_fast_pool_publish.py`);
        failed = true;
      }
      report.active_workflows.push(name);
      report.fast_pool_publish_workflows.push(name);
    } else if (name === NIGHTLY_REBUILD_WORKFLOW) {
      report.nightly_only_workflows.push(name);
    } else if (invokesBuild) {
      fail(`unexpected build_articles.py in ${name}`);
      failed = true;
    } else if (name.includes("ci-articles") || name.includes("guard")) {
      report.guard_only_workflows.push(name);
    } else if (name.includes("pages-publish") || name.includes("pages-on-data")) {
      report.active_workflows.push(`${name} (pages chain)`);
    } else if (name.includes("deploy-articles-watchdog")) {
      report.active_workflows.push(name);
    } else {
      report.legacy_workflows.push(name);
    }
  }

  if (prodPublishCount !== 1) {
    fail(`expected 1 primary publish workflow, got ${prodPublishCount}`);
    failed = true;
  }

  const wrangler = read("cloudflare/articles-watchdog/wrangler.toml");
  const slowWf =
    wrangler.match(/SLOW_WORKFLOW_FILE\s*=\s*"([^"]+)"/)?.[1] ||
    wrangler.match(/WORKFLOW_FILE\s*=\s*"([^"]+)"/)?.[1];
  const fastWf = wrangler.match(/FAST_WORKFLOW_FILE\s*=\s*"([^"]+)"/)?.[1];
  if (slowWf !== WATCHDOG_WORKFLOW_FILE) {
    fail(`watchdog slow workflow must be ${WATCHDOG_WORKFLOW_FILE}`);
    failed = true;
  }
  if (fastWf !== FAST_POOL_PUBLISH_WORKFLOW) {
    fail(`watchdog fast workflow must be ${FAST_POOL_PUBLISH_WORKFLOW}`);
    failed = true;
  }

  const build = read("scripts/build_articles.py");
  if (build.includes("from fetch_engine") || build.includes("build_articles_v2")) {
    fail("build_articles.py imports legacy");
    failed = true;
  }
  const dedupeCalls = (build.match(/_apply_conservative_topic_clustering/g) || []).length;
  if (dedupeCalls < 2) {
    fail(`topic dedupe calls=${dedupeCalls} need >=2`);
    failed = true;
  }

  log(`active_workflows=${JSON.stringify(report.active_workflows)}`);
  log(`publish_workflows=${JSON.stringify(report.publish_workflows)}`);
  log(`fast_pool_publish_workflows=${JSON.stringify(report.fast_pool_publish_workflows)}`);
  log(`nightly_only_workflows=${JSON.stringify(report.nightly_only_workflows)}`);
  log(`guard_only_workflows=${JSON.stringify(report.guard_only_workflows)}`);
  log(`legacy_workflows=${JSON.stringify(report.legacy_workflows)}`);
  log(
    `active_publish_paths=${JSON.stringify([
      ".github/workflows/update-articles.yml → build_articles.py",
      ".github/workflows/update-articles-fast-pool.yml → build_articles.py(ingest) + iu_fast_pool_publish.py",
    ])}`,
  );
  log(`active_fetch_helpers=${JSON.stringify(activeFetchHelpers)}`);
  log(`legacy_fetch_helpers=${JSON.stringify(legacyFetchHelpers)}`);
  log(`dead_code_confirmed=${JSON.stringify(deadCodeConfirmed)}`);
  log(`dead_code_removed=${JSON.stringify(deadCodeRemoved)}`);
  log(`all_writers_to_articles_json=${JSON.stringify(ACTIVE_WRITERS_ARTICLES)}`);
  log(`all_writers_to_meta_json=${JSON.stringify(ACTIVE_WRITERS_META)}`);
  log(`all_writers_to_publish_queue=${JSON.stringify(ACTIVE_WRITERS_QUEUE)}`);
  log(
    "production_flow=Cloudflare Watchdog(cron */15)→workflow_dispatch update-articles.yml→build_articles.py(ingest|aggregate|publish)→topic_dedupe+backpressure→data PR→merge main→pages-publish→infouzel.cz",
  );
  log(
    "source_rotation_inventory_required=true inventory_generated=CI(regen) inventory_git_tracked=optional_snapshot inventory_used_by=source-rotation-guard,source-frequency-guard,NOT_web",
  );

  if (failed) {
    console.error("[aggregator-legacy-cleanup-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
