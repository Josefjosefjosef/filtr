/**
 * Shared reader for Silver P0 engine source (Stage-2 lazy split).
 * Prefers assets/iu-silver-p0-engine.js; falls back to markers inside assets/app.js.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const START = "/* IU_SILVER_P0_ENGINE_START */";
const END = "/* IU_SILVER_P0_ENGINE_END */";

function readSilverP0EngineSource() {
  const engPath = path.join(REPO, "assets", "iu-silver-p0-engine.js");
  const appPath = path.join(REPO, "assets", "app.js");
  const src = fs.existsSync(engPath)
    ? fs.readFileSync(engPath, "utf8")
    : fs.readFileSync(appPath, "utf8");
  const m = src.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
  if (!m) {
    throw new Error("IU_SILVER_P0_ENGINE_START/END markers missing (checked iu-silver-p0-engine.js and app.js)");
  }
  const body = m[1].trim();
  /* Reject lazy boot stub accidentally matched from app.js after extract. */
  if (body.length < 50000 || body.indexOf("iuBootDeferredSilverP0Engine") >= 0) {
    if (fs.existsSync(engPath)) {
      const eng = fs.readFileSync(engPath, "utf8");
      const m2 = eng.match(/\/\* IU_SILVER_P0_ENGINE_START \*\/([\s\S]*?)\/\* IU_SILVER_P0_ENGINE_END \*\//);
      if (m2 && m2[1].trim().length >= 50000) return m2[1].trim();
    }
    throw new Error("Silver P0 engine body too small or stub-only");
  }
  return body;
}

module.exports = {
  REPO,
  START,
  END,
  readSilverP0EngineSource,
  readSilverEngineFromApp: readSilverP0EngineSource,
};
