#!/usr/bin/env node
/**
 * Structural guard: Sledovat/Skrýt must not rebuild the whole feed via paint()+wire().
 * Run: npm run iu-traffic-follow-local-patch-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

must(/function applyLocalTrafficFollow\(/.test(ui), "helper:applyLocalTrafficFollow");
must(/function patchTrafficFollowButton\(/.test(ui), "helper:patchTrafficFollowButton");
must(/function syncFeedCardsAfterMembershipChange\(/.test(ui), "helper:syncFeedCardsAfterMembershipChange");
must(/applyLocalTrafficFollow\(t, peid, meta\)/.test(ui), "handler:follow_calls_local");

const followBlock = ui.match(/if \(act === "traffic-follow"\) \{[\s\S]*?\n    \}/);
must(!!followBlock, "handler:follow_block");
must(followBlock && !/\bpaint\(\);/.test(followBlock[0]), "handler:follow_no_paint");
must(followBlock && !/\bwire\(\);/.test(followBlock[0]), "handler:follow_no_wire");

const hideBlock = ui.match(/if \(act === "hide"\) \{[\s\S]*?\n    \}/);
must(hideBlock && /syncFeedCardsAfterMembershipChange\(\)/.test(hideBlock[0]), "handler:hide_sync");
must(hideBlock && !/\bpaint\(\);/.test(hideBlock[0]), "handler:hide_no_paint");

const unhideBlock = ui.match(/if \(act === "unhide"\) \{[\s\S]*?\n    \}/);
must(unhideBlock && /syncFeedCardsAfterMembershipChange\(\)/.test(unhideBlock[0]), "handler:unhide_sync");
must(unhideBlock && !/\bpaint\(\);/.test(unhideBlock[0]), "handler:unhide_no_paint");

must(/tf\.followedOnly && !res\.followed/.test(ui), "follow:followedOnly_membership_path");
must(/btn\.textContent = followed \? "Sleduji" : "Sledovat"/.test(ui), "follow:button_copy_unchanged");

if (fails.length) {
  console.error("[iu-traffic-follow-local-patch-guard] FAIL");
  for (let i = 0; i < fails.length; i++) console.error("[iu-traffic-follow-local-patch-guard] " + fails[i]);
  process.exit(1);
}
console.log("[iu-traffic-follow-local-patch-guard] PASS");
console.log("RESULT=PASS");
