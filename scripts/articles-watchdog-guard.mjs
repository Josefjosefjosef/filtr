/**
 * Articles watchdog guard — config, secrets docs, optional live health probe.
 *
 * Run: node scripts/articles-watchdog-guard.mjs
 *
 * Env:
 *   WRANGLER_TOML — default cloudflare/articles-watchdog/wrangler.toml
 *   WATCHDOG_README — default cloudflare/articles-watchdog/README.md
 *   WATCHDOG_HEALTH_URL — GET /health (default prod workers.dev URL)
 *   REQUIRE_ARTICLES_WATCHDOG — "true" → unreachable worker is FAIL (else WARN)
 *   EXPECTED_CHECK_CRON — default every 15 minutes (star-slash-15 cron)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const WRANGLER_PATH = path.join(root, process.env.WRANGLER_TOML || "cloudflare/articles-watchdog/wrangler.toml");
const README_PATH = path.join(root, process.env.WATCHDOG_README || "cloudflare/articles-watchdog/README.md");
const HEALTH_URL =
  (process.env.WATCHDOG_HEALTH_URL || "").trim() ||
  "https://infouzel-articles-watchdog.josef-zmrhal.workers.dev/health";
const REQUIRE = String(process.env.REQUIRE_ARTICLES_WATCHDOG || "").toLowerCase() === "true";
const EXPECTED_CRON = (process.env.EXPECTED_CHECK_CRON || "*/15 * * * *").trim();

const REQUIRED_SECRET_DOCS = ["GITHUB_TOKEN"];
const OPTIONAL_SECRET_DOCS = ["MANUAL_TRIGGER_SECRET"];

function log(msg) {
  console.log(`[articles-watchdog-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[articles-watchdog-guard] FAIL: ${msg}`);
}

function warn(msg) {
  console.warn(`[articles-watchdog-guard] WARN: ${msg}`);
}

function parseWranglerCron(tomlText) {
  const m = tomlText.match(/crons\s*=\s*\[\s*"([^"]+)"/);
  return m ? m[1] : null;
}

function checkConfig() {
  let ok = true;
  if (!fs.existsSync(WRANGLER_PATH)) {
    fail(`wrangler.toml missing: ${WRANGLER_PATH}`);
    return { ok: false, cron: null };
  }
  const toml = fs.readFileSync(WRANGLER_PATH, "utf8");
  const cron = parseWranglerCron(toml);
  log(`config cron=${cron ?? "n/a"}`);
  if (cron !== EXPECTED_CRON) {
    fail(`cron ${cron} != expected ${EXPECTED_CRON}`);
    ok = false;
  } else {
    log("config cron PASS");
  }
  for (const key of ["GITHUB_REPOSITORY", "WORKFLOW_FILE", "FRESHNESS_URL", "STALE_AFTER_MINUTES"]) {
    if (!toml.includes(key)) {
      fail(`wrangler var ${key} missing`);
      ok = false;
    }
  }
  if (ok) log("wrangler vars PASS");
  return { ok, cron };
}

function checkSecretsDoc() {
  if (!fs.existsSync(README_PATH)) {
    fail(`README missing: ${README_PATH}`);
    return false;
  }
  const text = fs.readFileSync(README_PATH, "utf8");
  let ok = true;
  for (const s of REQUIRED_SECRET_DOCS) {
    if (!text.includes(s)) {
      fail(`README must document secret ${s}`);
      ok = false;
    }
  }
  for (const s of OPTIONAL_SECRET_DOCS) {
    if (!text.includes(s)) {
      warn(`README should document optional secret ${s}`);
    }
  }
  if (ok) log("required secrets documented PASS");
  return ok;
}

async function checkHealth() {
  log(`health url=${HEALTH_URL} require=${REQUIRE}`);
  try {
    const res = await fetch(HEALTH_URL, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!res.ok) {
      const msg = `HTTP ${res.status}`;
      if (REQUIRE) fail(`health ${msg}`);
      else warn(`health ${msg} (watchdog_deployed=false)`);
      return { ok: !REQUIRE, deployed: false, reachable: false };
    }
    const body = await res.json();
    if (body?.ok !== true || body?.service !== "infouzel-articles-watchdog") {
      if (REQUIRE) fail("health body invalid");
      else warn("health body invalid (watchdog_deployed=unknown)");
      return { ok: !REQUIRE, deployed: true, reachable: true };
    }
    log("health PASS (watchdog_deployed=true reachable=true)");
    return { ok: true, deployed: true, reachable: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (REQUIRE) fail(`health unreachable: ${msg}`);
    else warn(`health unreachable: ${msg} (watchdog_deployed=false)`);
    return { ok: !REQUIRE, deployed: false, reachable: false };
  }
}

async function main() {
  let failed = false;

  const cfg = checkConfig();
  if (!cfg.ok) failed = true;

  if (!checkSecretsDoc()) failed = true;

  const health = await checkHealth();
  if (!health.ok) failed = true;

  log(
    `summary watchdog_config=${cfg.ok ? "ok" : "bad"} watchdog_deployed=${health.deployed} watchdog_reachable=${health.reachable}`,
  );

  if (failed) {
    console.error("[articles-watchdog-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main().catch((e) => {
  fail(e.message || String(e));
  process.exit(1);
});
