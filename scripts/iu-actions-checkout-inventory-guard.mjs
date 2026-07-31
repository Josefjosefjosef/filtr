#!/usr/bin/env node
/**
 * Inventory guard: list actions/checkout usages (version/SHA) across workflows.
 * Fail if Update info events writers use floating major without pin comment intent.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WF = path.join(REPO, ".github/workflows");
const rows = [];

for (const name of fs.readdirSync(WF).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
  const src = fs.readFileSync(path.join(WF, name), "utf8");
  const re = /uses:\s*actions\/checkout@([^\s#]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const ver = m[1].trim();
    const pinned = /^[0-9a-f]{40}$/i.test(ver);
    rows.push({ file: name, ref: ver, pinned });
  }
}

console.log("IU_ACTIONS_CHECKOUT_INVENTORY_COUNT=" + rows.length);
for (const r of rows) {
  console.log("checkout\t" + r.file + "\t" + r.ref + "\t" + (r.pinned ? "sha" : "tag"));
}

const EXPECTED_SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const writers = rows.filter((r) =>
  /update-info-events\.yml|update-chmi-cap-v2\.yml/.test(r.file)
);
const unpinned = rows.filter((r) => !r.pinned);
const wrongSha = rows.filter((r) => r.pinned && r.ref.toLowerCase() !== EXPECTED_SHA);
if (unpinned.length) {
  console.error("IU_ACTIONS_CHECKOUT_INVENTORY=FAIL unpinned=" + unpinned.length);
  for (const r of unpinned) console.error("UNPINNED\t" + r.file + "\t" + r.ref);
  process.exit(1);
}
if (wrongSha.length) {
  console.error("IU_ACTIONS_CHECKOUT_INVENTORY=FAIL wrong_sha=" + wrongSha.length);
  process.exit(1);
}
if (!writers.length) {
  console.error("IU_ACTIONS_CHECKOUT_INVENTORY=FAIL writers_missing");
  process.exit(1);
}
console.log(
  "IU_ACTIONS_CHECKOUT_INVENTORY=PASS all_sha_pinned=" +
    rows.length +
    " writers=" +
    writers.length +
    " sha=" +
    EXPECTED_SHA
);
process.exit(0);
