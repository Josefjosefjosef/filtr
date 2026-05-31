/**
 * crawler_identity_guard — single canonical User-Agent + contact across fetchers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const EXPECTED_UA =
  process.env.IU_EXPECTED_USER_AGENT ||
  "infoUzelBot/1.0 (+https://infouzel.cz; contact: Info@infoUzel.cz)";
const EXPECTED_CONTACT = "Info@infoUzel.cz";

function log(msg) {
  console.log(`[crawler-identity-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[crawler-identity-guard] FAIL: ${msg}`);
}

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function main() {
  let failed = false;
  const crawler = readFile("scripts/iu_crawler.py");
  if (!crawler.includes(EXPECTED_UA)) {
    fail(`iu_crawler.py missing canonical UA`);
    failed = true;
  } else {
    log("iu_crawler.py canonical UA PASS");
  }
  if (!crawler.includes(EXPECTED_CONTACT)) {
    fail(`iu_crawler.py missing contact ${EXPECTED_CONTACT}`);
    failed = true;
  } else {
    log("contact email PASS");
  }

  const articles = readFile("scripts/build_articles.py");
  if (!articles.includes("from iu_crawler import") || !articles.includes("IU_USER_AGENT")) {
    fail("build_articles.py must import IU_USER_AGENT from iu_crawler");
    failed = true;
  } else {
    log("build_articles imports iu_crawler PASS");
  }

  const videos = readFile("scripts/build_videos.py");
  if (!videos.includes("from iu_crawler import")) {
    fail("build_videos.py must import from iu_crawler");
    failed = true;
  } else {
    log("build_videos imports iu_crawler PASS");
  }

  if (articles.includes("admin@infouzel.cz")) {
    fail("legacy admin@infouzel.cz still in build_articles.py");
    failed = true;
  }

  if (failed) {
    console.error("[crawler-identity-guard] RESULT=FAIL");
    process.exit(1);
  }
  log(`user_agent=${EXPECTED_UA}`);
  log("RESULT=PASS");
}

main();
