const fs = require("fs");
const path = require("path");

function readAppRuntimeSrc(repoRoot) {
  const root = repoRoot || path.resolve(__dirname, "..", "..");
  const app = path.join(root, "assets", "app.js");
  const feed = path.join(root, "assets", "iu-app-feed-pipeline-v1.js");
  const shell = path.join(root, "assets", "iu-mobile-bottom-nav-shell-v1.js");
  const calendar = path.join(root, "assets", "iu-calendar-overlay-v1.js");
  const notes = path.join(root, "assets", "iu-notes-overlay-v1.js");
  let out = fs.readFileSync(app, "utf8");
  if (fs.existsSync(feed)) out += "\n" + fs.readFileSync(feed, "utf8");
  if (fs.existsSync(shell)) out += "\n" + fs.readFileSync(shell, "utf8");
  if (fs.existsSync(calendar)) out += "\n" + fs.readFileSync(calendar, "utf8");
  if (fs.existsSync(notes)) out += "\n" + fs.readFileSync(notes, "utf8");
  return out;
}

module.exports = { readAppRuntimeSrc };
