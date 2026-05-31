/**
 * robots_compliance_guard — robots.txt module present and wired into fetch path.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function log(msg) {
  console.log(`[robots-compliance-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[robots-compliance-guard] FAIL: ${msg}`);
}

function main() {
  let failed = false;
  const crawler = fs.readFileSync(path.join(root, "scripts/iu_crawler.py"), "utf8");
  const articles = fs.readFileSync(path.join(root, "scripts/build_articles.py"), "utf8");

  if (!crawler.includes("RobotFileParser")) {
    fail("iu_crawler.py missing RobotFileParser");
    failed = true;
  } else {
    log("RobotFileParser present PASS");
  }
  if (!crawler.includes("robots_allowed_for_url")) {
    fail("robots_allowed_for_url missing");
    failed = true;
  } else {
    log("robots_allowed_for_url PASS");
  }
  if (!articles.includes("robots_allowed_for_url")) {
    fail("build_articles.py does not call robots_allowed_for_url");
    failed = true;
  } else {
    log("fetch path wired PASS");
  }
  if (!articles.includes("SKIPPED_ROBOTS")) {
    fail("SKIPPED_ROBOTS status missing in ingest");
    failed = true;
  } else {
    log("SKIPPED_ROBOTS handling PASS");
  }

  if (failed) {
    console.error("[robots-compliance-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
