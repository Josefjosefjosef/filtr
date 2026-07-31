#!/usr/bin/env node
/**
 * Guard: update-info-events checkout must not fetch-depth:0 / all tags.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(REPO, ".github/workflows/update-info-events.yml");
const fails = [];
function ok(name, cond, detail) {
  if (!cond) fails.push(name + (detail != null ? "=" + detail : ""));
}

const src = fs.readFileSync(WF, "utf8");
const yamlOnly = src
  .split(/\r?\n/)
  .filter((l) => !/^\s*#/.test(l))
  .join("\n");
ok("no_fetch_depth_0", !/fetch-depth:\s*0\b/.test(yamlOnly), "depth0");
ok("has_fetch_depth_1_or_2", /fetch-depth:\s*[12]\b/.test(yamlOnly), "depth");
ok("fetch_tags_false_or_absent", !/fetch-tags:\s*true/.test(yamlOnly), "tags");
ok("no_submodules", !/submodules:\s*true/.test(yamlOnly) && !/submodules:\s*recursive/.test(yamlOnly), "sub");
ok("shared_or_local_concurrency", /concurrency:/.test(yamlOnly), "conc");
ok(
  "shared_writer_group",
  /info-events-data-writers|update-info-events/.test(yamlOnly),
  "group"
);

if (fails.length) {
  console.error("IU_INFO_EVENTS_CHECKOUT_SCOPE_GUARD=FAIL");
  for (const f of fails) console.error("FAIL " + f);
  process.exit(1);
}
console.log("IU_INFO_EVENTS_CHECKOUT_SCOPE_GUARD=PASS");
process.exit(0);
