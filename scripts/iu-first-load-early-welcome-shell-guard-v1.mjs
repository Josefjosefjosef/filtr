#!/usr/bin/env node
/**
 * FIRST LOAD: greeting+date must paint via early local shell before deferred feed-pipeline.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
}

must(/iuEarlyWelcomeShellV1/.test(index), "index:activator");
must(/early-welcome-shell-v1-20260822/.test(index), "index:cache_bust");
must(/data-iu-early-welcome/.test(index), "index:early_attr");
must(/id="iuSilverWelcomeGreet"/.test(index) && /iuEarlyWelcomeShellV1/.test(index), "index:greet_and_shell");
must(/Dobré ráno/.test(index) && /Hezké dopoledne/.test(index), "index:phrases");

if (fails.length) {
  console.error("[iu-first-load-early-welcome-shell-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-first-load-early-welcome-shell-guard] PASS");
