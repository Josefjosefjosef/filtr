/**
 * Ensure committed / public surfaces do not expose:
 * - full TMC location table
 * - MobilityData credentials / Basic auth
 * - subscriber id A99101DA in frontend assets
 * Exit 0 = PASS
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const fails = [];

function ok(name, cond, detail) {
  if (!cond) fails.push(`${name}: ${detail || "failed"}`);
}

function read(p) {
  return fs.readFileSync(p, "utf8");
}

// Frontend must not contain secrets / subscriber id / pull credentials env dumps
{
  const frontendFiles = [
    "assets/iu-prehled-dne-ui-v1.js",
    "assets/iu-info-system-core-v1.js",
    "projects/index.html",
    "sw.js",
  ];
  for (const rel of frontendFiles) {
    const p = path.join(REPO, rel);
    if (!fs.existsSync(p)) continue;
    const t = read(p);
    ok("no_subscriber_id_" + rel, !/A99101DA/i.test(t), "subscriber id leaked");
    ok("no_basic_auth_literal_" + rel, !/IU_NDIC_PULL_PASS|Authorization:\s*Basic\s+[A-Za-z0-9+/=]{8,}/i.test(t), "auth");
    ok("no_tmc_pull_secret_" + rel, !/IU_NDIC_TMC_PULL_PASS/i.test(t), "tmc pass");
  }
}

// Committed ndic state must not contain points dump
{
  const tmcStore = path.join(REPO, "projects/data/info_events/ndic_datex_v1/tmc_store.json");
  ok("tmc_store_not_present_or_gitignored", !fs.existsSync(tmcStore), "tmc_store.json must not be in tree");
  const meta = path.join(REPO, "projects/data/info_events/ndic_datex_v1/tmc_meta.json");
  if (fs.existsSync(meta)) {
    const m = JSON.parse(read(meta));
    ok("tmc_meta_no_points_object", !m.points, "points in meta");
  }
}

// git ls-files must not track full TMC store
{
  try {
    const tracked = execSync("git ls-files projects/data/info_events/ndic_datex_v1 .cache/ndic-datex-v1", {
      cwd: REPO,
      encoding: "utf8",
    });
    ok("git_no_tmc_store", !/tmc_store\.json/.test(tracked), tracked.trim());
    ok("git_no_raw_dir", !/ndic_datex_v1\/raw\//.test(tracked), tracked.trim());
  } catch (e) {
    fails.push("git_ls_files: " + String(e && e.message));
  }
}

// No dedicated public TMC/raw download modules under cloudflare workers
{
  const bannedName = /ndic.*(raw|tmc).*(download|export)|tmc.*location.*download/i;
  const walk = (dir, acc = []) => {
    if (!fs.existsSync(dir) || acc.length > 20) return acc;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, acc);
      else if (bannedName.test(ent.name)) acc.push(p);
    }
    return acc;
  };
  const hits = walk(path.join(REPO, "cloudflare")).concat(walk(path.join(REPO, "assets")));
  ok("no_public_tmc_download_module", hits.length === 0, hits.join(","));
}

if (fails.length) {
  console.log("FAIL " + fails.length);
  for (const f of fails) console.log(" - " + f);
  process.exit(1);
}
console.log("PASS ndic-datex-v1-exposure-guard");
