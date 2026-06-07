/**
 * Unit tests for articles-release-conflict-marker-guard.
 * Run: node scripts/articles-release-conflict-marker-guard-unit.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import {
  lineHasConflictMarker,
  scanProjectsData,
  scanTextForConflictMarkers,
} from "./articles-release-conflict-marker-guard.mjs";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
}

assert(lineHasConflictMarker("<<<<<<< HEAD"), "marker head");
assert(lineHasConflictMarker(">>>>>>> branch"), "marker tail");
assert(!lineHasConflictMarker('{"ok":true}'), "json ok");

const hits = scanTextForConflictMarkers("line\n<<<<<<< HEAD\n=======\n>>>>>>> x\n", "demo.txt");
assert(hits.length === 3, "three marker lines");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iu-conflict-guard-"));
try {
  const dataRoot = path.join(tmp, "projects", "data");
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(dataRoot, "articles.json"), '{"generatedAt":"2026-01-01T00:00:00Z","articles":[]}\n');
  const clean = scanProjectsData(dataRoot);
  assert(clean.markerHits.length === 0, "clean tree");
  assert(clean.jsonErrors.length === 0, "valid json");

  fs.writeFileSync(
    path.join(dataRoot, "videos.json"),
    '{\n<<<<<<< HEAD\n"items":[]\n=======\n"items":[1]\n>>>>>>> branch\n}\n',
  );
  const bad = scanProjectsData(dataRoot);
  assert(bad.markerHits.length >= 3, "detect markers in videos.json");
  console.log("PASS articles-release-conflict-marker-guard-unit");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
