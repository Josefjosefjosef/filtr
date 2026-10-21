"use strict";
/**
 * Guard scripts assert npm script is wired in CI via smoke.yml step OR manifest v1 pool.
 */
const fs = require("fs");
const path = require("path");

function guardWiredInSmokeCi(repoRoot, needle) {
  if (!needle || typeof needle !== "string") return false;
  const root = path.resolve(repoRoot);
  const smokePath = path.join(root, ".github", "workflows", "smoke.yml");
  if (fs.existsSync(smokePath)) {
    const smoke = fs.readFileSync(smokePath, "utf8");
    if (smoke.includes(needle)) return true;
  }
  const manifestPath = path.join(root, "scripts", "ci", "smoke-guard-manifest-v1.json");
  if (!fs.existsSync(manifestPath)) return false;
  return fs.readFileSync(manifestPath, "utf8").includes(needle);
}

module.exports = { guardWiredInSmokeCi };
