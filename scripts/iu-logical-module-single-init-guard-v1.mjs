#!/usr/bin/env node
/**
 * IU_LOGICAL_MODULE_SINGLE_INIT_GUARD — modulepreload URL must match ES import URL
 * for key startup modules (query-string identity). Prevents dual download/eval (Type C).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fails = [];
const must = (c, id) => {
  if (!c) fails.push(id);
};

const index = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const ui = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
const pages = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
const feedSettings = fs.readFileSync(path.join(ROOT, "assets", "iu-prehled-dne-feed-settings-v1.js"), "utf8");

function extractImportBust(src, logicalFile) {
  const re = new RegExp(`from\\s+"\\./${logicalFile.replace(/\./g, "\\.")}\\?v=([^"]+)"`);
  const m = src.match(re);
  return m ? m[1] : null;
}
function extractPreloadBust(html, logicalFile) {
  const re = new RegExp(
    `<link[^>]*rel="modulepreload"[^>]*href="/assets/${logicalFile.replace(/\./g, "\\.")}\\?v=([^"]+)"`,
    "i"
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

const coreImport = extractImportBust(ui, "iu-info-system-core-v1.js");
const corePreload = extractPreloadBust(index, "iu-info-system-core-v1.js");
const filterImport = extractImportBust(ui, "iu-feed-filter-v1.js");
const filterPreload = extractPreloadBust(index, "iu-feed-filter-v1.js");
const filterSettings = extractImportBust(feedSettings, "iu-feed-filter-v1.js");

must(!!coreImport, "core_import_bust");
must(!!corePreload, "core_preload_bust");
must(coreImport === corePreload, "core_preload_matches_import");
must(!!filterImport, "filter_import_bust");
must(!!filterPreload, "filter_preload_bust");
must(filterImport === filterPreload, "filter_preload_matches_import");
must(filterSettings === filterImport, "filter_settings_matches_ui");

const htmlRewriteBlock = String(pages.split("Rewrite HTML to versioned")[1] || "").split(
  "ES module relative imports"
)[0];
must(
  htmlRewriteBlock.includes("iu-info-system-core-v1.${ASSET_VER}.js"),
  "deploy_html_hashes_core_preload"
);

if (fails.length) {
  console.error("[IU_LOGICAL_MODULE_SINGLE_INIT_GUARD] FAIL");
  console.error(
    JSON.stringify({ coreImport, corePreload, filterImport, filterPreload, filterSettings }, null, 2)
  );
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[IU_LOGICAL_MODULE_SINGLE_INIT_GUARD] PASS");
