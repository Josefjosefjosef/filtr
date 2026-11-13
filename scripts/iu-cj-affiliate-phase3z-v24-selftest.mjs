#!/usr/bin/env node
/**
 * V24 — scheduled-automation selftest gates (post-V23 schedule failures).
 * Proves Novakid catalog assign + armed static catalog counts that blocked cron.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(detail ? `${id}:${detail}` : id);
  else console.log("PASS", id);
}

function runNode(rel) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return { code: r.status ?? 1, out: String(r.stdout || "") + String(r.stderr || "") };
}

const staticCatalog = JSON.parse(
  fs.readFileSync(path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json"), "utf8")
);
const buttonCount = Number(staticCatalog.counts?.buttons || 0);
const joinedCount = Number(staticCatalog.counts?.joined || 0);
const buttonsLen = Array.isArray(staticCatalog.buttons) ? staticCatalog.buttons.length : 0;
ok("armed", staticCatalog.publicButtonSwapArmed === true && staticCatalog.liveEnabled === true);
/* V51.8: after 4camping/Picasee/Impresi enrollment — keep in lockstep with static V13 + v14-selftest. */
ok("buttons_match_array", buttonCount === buttonsLen, JSON.stringify(staticCatalog.counts));
ok("buttons_178_after_three_partner_enroll", buttonCount === 178, JSON.stringify(staticCatalog.counts));
ok("joined_179_after_three_partner_enroll", joinedCount === 179, JSON.stringify(staticCatalog.counts));
ok(
  "joined_matches_buttons_plus_blockers",
  joinedCount === buttonCount + Number(staticCatalog.counts?.missingMainButtons || 0),
  JSON.stringify(staticCatalog.counts)
);
ok(
  "svelt_elektro",
  (staticCatalog.buttons || []).some((b) => String(b.advertiserId) === "7995512" && b.sectionId === "aff-elektro")
);
ok(
  "paragon_blocked",
  (staticCatalog.remainingBlockers || []).some((b) => String(b.advertiserId) === "4686326")
);

const e = runNode("scripts/iu-cj-affiliate-phase3e-partner-recon-v1-selftest.mjs");
ok("phase3e_selftest", e.code === 0, `code=${e.code}`);
ok("phase3e_novakid_not_manual_fp", !/novakid_manual/.test(e.out) || /novakid_catalog_assign/.test(e.out));

const v14 = runNode("scripts/iu-cj-affiliate-phase3z-v14-selftest.mjs");
ok("v14_selftest", v14.code === 0, `code=${v14.code}`);
ok("v14_armed_verified", /"productionArmedVerified": true/.test(v14.out));

const out = { ok: fails.length === 0, fails, suite: "v24-scheduled-selftest-repair" };
console.log(JSON.stringify(out, null, 2));
if (!out.ok) process.exitCode = 1;
