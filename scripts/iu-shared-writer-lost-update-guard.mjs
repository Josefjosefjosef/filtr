#!/usr/bin/env node
/** Guard: shared data writers must share concurrency group info-events-data-writers. */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const ie = fs.readFileSync(path.join(REPO, ".github/workflows/update-info-events.yml"), "utf8");
const chmi = fs.readFileSync(path.join(REPO, ".github/workflows/update-chmi-cap-v2.yml"), "utf8");
ok("ie_group", /group:\s*info-events-data-writers/.test(ie), "ie");
ok("chmi_group", /group:\s*info-events-data-writers/.test(chmi), "chmi");
ok("ie_no_cancel", /cancel-in-progress:\s*false/.test(ie), "ieCancel");
ok("chmi_no_cancel", /cancel-in-progress:\s*false/.test(chmi), "chmiCancel");

if (fails.length) {
  console.error("IU_SHARED_WRITER_LOST_UPDATE_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_SHARED_WRITER_LOST_UPDATE_GUARD=PASS");
process.exit(0);
