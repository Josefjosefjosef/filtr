#!/usr/bin/env node
/** Negative publication proof gates (library policy, no live services). */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adsDir = path.join(repoRoot, "cloudflare", "iu-ads");

try {
  execSync("npx vitest run test/affiliate-ad-archive-publication-trust.test.ts", {
    cwd: adsDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  console.log(JSON.stringify({ IU_CJ_ARCHIVE_PUBLICATION_NEGATIVE_SELFTEST: "OK" }));
  process.exit(0);
} catch (e) {
  console.log(
    JSON.stringify({
      IU_CJ_ARCHIVE_PUBLICATION_NEGATIVE_SELFTEST: "FAIL",
      output: String(e.stdout || e.stderr || e.message || e).slice(-4000),
    })
  );
  process.exit(1);
}
