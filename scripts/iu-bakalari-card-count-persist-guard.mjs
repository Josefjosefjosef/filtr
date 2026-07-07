#!/usr/bin/env node
/**
 * Guard — Bakaláři multi-card count persists across section leave/reopen.
 * Run: npm run iu-bakalari-card-count-persist-guard
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(ROOT, "assets", "app.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");

function chunkAfter(fnName, src) {
  const parts = src.split("function " + fnName);
  return parts[1] ? parts[1].split(/\n  function /)[0] : "";
}

const failures = [];
const bakalariChunk = chunkAfter("renderBakalariModal(container)", app);

if (/isBakalariProfileEmpty\(p\)/.test(chunkAfter("getBakalariProfilesFromStorage()", app))) {
  failures.push("getBakalariProfilesFromStorage must not drop empty card slots on load");
}
if (/filter\(function \(p\) \{ return p && !isBakalariProfileEmpty\(p\)/.test(chunkAfter("setBakalariProfilesToStorage(arr)", app))) {
  failures.push("setBakalariProfilesToStorage must persist empty card slots");
}
if (!/setBakalariProfilesToStorage\(profiles\)/.test(bakalariChunk.split('addAnotherBtn.addEventListener("click"')[1] || "")) {
  failures.push("Bakaláři add-another must persist card count to storage");
}
if (!/window\.iuBakalariPersistOpenCards/.test(bakalariChunk)) {
  failures.push("renderBakalariModal must register iuBakalariPersistOpenCards hook");
}
if (!/iuBakalariPersistOpenCards/.test(chunkAfter("iuEnsureArticlesView()", app))) {
  failures.push("iuEnsureArticlesView must flush Bakaláři cards before QuickFeed teardown");
}
const cacheOk =
  indexHtml.includes("bakalari-card-count-persist-v1-20260707") ||
  indexHtml.includes("state-holiday-label-v1-20260706");
if (!cacheOk) {
  failures.push("index.html app.js cache bust token missing");
}

const pass = failures.length === 0;
process.stdout.write(JSON.stringify({ pass, failures }) + "\n");
if (!pass) process.exitCode = 1;
