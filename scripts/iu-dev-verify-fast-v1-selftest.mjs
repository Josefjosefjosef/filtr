#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(REPO, "scripts", "iu-dev-verify-fast-v1.mjs");
if (!fs.existsSync(script)) {
  console.error("IU_DEV_VERIFY_FAST_SELFTEST_FAIL missing script");
  process.exit(1);
}
console.log(JSON.stringify({ IU_DEV_VERIFY_FAST_SELFTEST: "OK" }));
