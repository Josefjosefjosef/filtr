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

const writers = rows.filter((r) =>
  /update-info-events\.yml|update-chmi-cap-v2\.yml/.test(r.file)
);
const writersPinned = writers.every((r) => r.pinned);
if (!writersPinned) {
  console.error("IU_ACTIONS_CHECKOUT_INVENTORY=FAIL writers_not_sha_pinned");
  process.exit(1);
}
console.log("IU_ACTIONS_CHECKOUT_INVENTORY=PASS writers_sha_pinned=" + writers.length);
process.exit(0);
