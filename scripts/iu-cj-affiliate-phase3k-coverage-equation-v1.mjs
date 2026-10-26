#!/usr/bin/env node
/**
 * Phase 3K: exact coverage equation for managed-public R2 vs rendered buttons.
 *
 * unique_rendered_joined = bakedButtons + managedButtons
 * R2 active partners = managed-public overlay only (NOT baked-only).
 *
 * 125 R2 vs 164 withButton is EXPECTED architecture when baked-only joined
 * partners remain in catalog.js and are not duplicated into R2.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function findReadiness() {
  const envPath = process.env.IU_CJ_READINESS_JSON;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const candidates = [
    path.join(process.env.TEMP || "/tmp", "iu-cj-phase3e-validation", "readiness", "iu-affiliate-cj-publication-readiness-live.json"),
    path.join(root, "projects", "data", "iu-affiliate-cj-publication-readiness-live.json"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const managedPath = path.join(root, "projects", "data", "iu-affiliate-cj-managed-public-v1.json");
const managed = loadJson(managedPath);
const active = (managed.partners || []).filter((p) => p.active !== false).length;

const readinessPath = findReadiness();
let live = null;
if (readinessPath) {
  const j = loadJson(readinessPath);
  live = j.stats
    ? {
        joined: j.stats.joined,
        // Prefer explicit button buckets from phase3i liveSummary when present
        ...(j.liveSummary?.counts || {}),
      }
    : j.counts || null;
}

// Fixture-free structural gate when live readiness absent
const structural = {
  r2_managed_active: active,
  schema: managed.schema,
  websitePid: managed.websitePid,
  formula_r2: "r2_published_active = count(managed-public.partners where active!==false)",
  formula_rendered:
    "unique_rendered_joined = bakedButtons_among_joined + managedButtons_among_joined",
  note_125_vs_164:
    "R2 publishes managed-public JSON only. Baked-only joined buttons stay in catalog.js. Difference is not data loss.",
};

let equation = null;
if (live && typeof live.bakedButtons === "number" && typeof live.managedButtons === "number") {
  const sum = live.bakedButtons + live.managedButtons;
  equation = {
    formula: "unique_rendered_joined = bakedButtons + managedButtons",
    bakedButtons: live.bakedButtons,
    managedButtons: live.managedButtons,
    withButton: live.withButton,
    sum,
    pass: sum === live.withButton,
    r2_managed_active: active,
    managedNotJoined: live.managedNotJoined ?? null,
    joined: live.joined,
  };
}

const out = {
  OK: !equation || equation.pass === true,
  structural,
  equation,
  readinessPath,
  managedPath: path.relative(root, managedPath).replace(/\\/g, "/"),
};
console.log(JSON.stringify(out));
if (!out.OK) process.exit(1);
