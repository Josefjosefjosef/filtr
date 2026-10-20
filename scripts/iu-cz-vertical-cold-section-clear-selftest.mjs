#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(
  /if \(usesFeed\)[\s\S]{0,320}iuPwaClearColdSectionAttrsForHub/.test(appJs),
  "applySection_clears_cold_section_on_feed_nav"
);

must(
  /data-iu-cold-section/.test(fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8")),
  "index_sets_cold_section_boot"
);

console.log("IU_CZ_VERTICAL_COLD_SECTION_CLEAR_SELFTEST_PASS=" + (fails.length === 0));
if (fails.length) {
  console.log("IU_CZ_VERTICAL_COLD_SECTION_CLEAR_SELFTEST_FAILS=" + fails.join(","));
  process.exitCode = 1;
}
