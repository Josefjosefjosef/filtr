const fs = require("fs");
const path = require("path");

function readPrehledDneUiCacheBust(repoRoot) {
  const ui = fs.readFileSync(path.join(repoRoot, "assets", "iu-prehled-dne-ui-v1.js"), "utf8");
  const m = ui.match(/const CACHE_BUST = "([^"]+)"/);
  return m ? m[1] : "";
}

module.exports = { readPrehledDneUiCacheBust };
