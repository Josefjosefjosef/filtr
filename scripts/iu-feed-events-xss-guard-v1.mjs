#!/usr/bin/env node
/**
 * Guard: feed debug events panel must not inject item.name as raw HTML.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FEED = path.join(ROOT, "assets", "iu-app-feed-pipeline-v1.js");
const src = fs.readFileSync(FEED, "utf8");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

const fnStart = src.indexOf("function updateEventsUI()");
must(fnStart >= 0, "updateEventsUI_exists");
const fnSlice = fnStart >= 0 ? src.slice(fnStart, fnStart + 1200) : "";

must(fnSlice.includes("function updateEventsUI"), "updateEventsUI_block");
must(fnSlice.includes("escapeHtml(String(item"), "events_name_escaped");
must(!/\$\{item\.name\}/.test(fnSlice), "events_name_not_raw_interpolation");

if (fails.length) {
  console.error("IU_FEED_EVENTS_XSS_GUARD_FAIL");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("IU_FEED_EVENTS_XSS_GUARD_PASS");
