#!/usr/bin/env node
/**
 * D1: After-merge prod gating. Extracts prodHash from first /assets/app.<hash>.js on PROD.
 * Writes artifacts/AFTER_MERGE_RULE_D1_PROOF.txt. Exit 1 if prodHash != localHead.
 * No AFTER_MERGE_PROOF_*_PROD.txt with PASS may be created when verdict is BLOCKED.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const BASE_URL = "https://infouzel.cz/projects/";

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, name), String(text).replace(/\r?\n/g, "\r\n"), "utf8");
}

async function main() {
  let prodLoadedAppUrl = "";
  let prodHash = "";

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on("request", (req) => {
    const u = req.url();
    if (!prodLoadedAppUrl && /\/assets\/app\.[a-f0-9]+\.js/i.test(u)) {
      prodLoadedAppUrl = u;
      const m = u.match(/\/assets\/app\.([a-f0-9]+)\.js/i);
      if (m) prodHash = m[1];
    }
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(2000);
  await browser.close();

  let localHead = "";
  try {
    localHead = execSync("git rev-parse HEAD", { encoding: "utf8", cwd: ROOT }).trim();
  } catch (_) {}

  const match = prodHash && localHead && (localHead === prodHash || localHead.startsWith(prodHash) || prodHash.startsWith(localHead.slice(0, 8)));
  const verdict = match ? "OK" : "BLOCKED";
  const lines = [];
  lines.push("localHead: " + localHead);
  lines.push("prodLoadedAppUrl: " + prodLoadedAppUrl);
  lines.push("prodHash: " + prodHash);
  lines.push("verdict: " + verdict);
  const content = lines.join("\r\n") + "\r\n";
  writeArtifact("AFTER_MERGE_RULE_D1_PROOF.txt", content);
  console.log(content);
  if (verdict !== "OK") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e.message);
  writeArtifact("AFTER_MERGE_RULE_D1_PROOF.txt", "ERROR: " + e.message + "\r\nverdict: BLOCKED\r\n");
  process.exitCode = 1;
});
