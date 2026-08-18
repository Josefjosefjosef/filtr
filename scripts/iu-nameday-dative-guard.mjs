#!/usr/bin/env node
/**
 * Guard: Czech nameday overlay dative (3. pád) — Laura → Lauře, not Laurě.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  iuNaiveFemaleADativeForProof,
  iuSafeDativeSingleFirstName,
  iuSvatekBuildPoprejLineFromRaw,
} from "../assets/iu-nameday-dative.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..");
const FEED = path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js");

const CASES = [
  ["Laura", "Lauře"],
  ["Petra", "Petře"],
  ["Věra", "Věře"],
  ["Sára", "Sáře"],
  ["Barbora", "Barboře"],
  ["Zora", "Zoře"],
  ["Tamara", "Tamaře"],
];

const FORBIDDEN = ["Laurě", "Petřě", "Věřě", "Sářě", "Barborě", "Zorě", "Tamarě"];

function main() {
  const app = fs.readFileSync(FEED, "utf8");
  assert.ok(app.includes('from "./iu-nameday-dative.js"'), "feed pipeline must import iu-nameday-dative.js");
  for (const bad of FORBIDDEN) {
    assert.ok(!app.includes(bad), `forbidden dative form in app.js: ${bad}`);
  }
  assert.ok(
    !/iuSvatekBuildPoprejLineFromRaw[\s\S]{0,400}slice\(0,\s*-1\)\s*\+\s*["']ě["']/.test(app),
    "Popřej fallback must not use naive -a→-ě"
  );

  console.log("=== NAME_DECLENSION_PROOF ===");
  console.log("");

  let regressionPass = true;

  for (const [name, expected] of CASES) {
    const got = iuSafeDativeSingleFirstName(name, "female");
    assert.equal(got, expected, `${name}: got ${got}, want ${expected}`);
    const line = iuSvatekBuildPoprejLineFromRaw(name, "female");
    assert.equal(line, "Popřej " + expected, `${name} overlay line`);

    if (name === "Laura") {
      const before = iuNaiveFemaleADativeForProof(name);
      const capBefore =
        name.charAt(0) === name.charAt(0).toUpperCase()
          ? before.charAt(0).toUpperCase() + before.slice(1)
          : before;
      console.log(`${name}:`);
      console.log(`BEFORE: ${capBefore}`);
      console.log(`AFTER: ${got}`);
      console.log("PASS");
      console.log("");
    } else {
      console.log(`${name}:`);
      console.log(`AFTER: ${got}`);
      console.log("PASS");
      console.log("");
    }
  }

  for (const bad of FORBIDDEN) {
    if (iuSafeDativeSingleFirstName("Laura", "female") === bad) regressionPass = false;
    if (iuSvatekBuildPoprejLineFromRaw("Laura", "female").includes(bad)) regressionPass = false;
  }
  const lauraNaive = iuNaiveFemaleADativeForProof("Laura");
  if (lauraNaive !== "Laurě") regressionPass = false;
  assert.ok(regressionPass, "regression checks");

  console.log("Regression:");
  console.log("PASS");
  console.log("");
  console.log("=== END_NAME_DECLENSION_PROOF ===");
}

main();
