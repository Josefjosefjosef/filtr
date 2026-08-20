import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Guard lives in TEMP; read from repo via cwd
const index = fs.readFileSync(path.join(process.cwd(), "projects", "index.html"), "utf8");
const fails = [];
const must = (c, id) => { if (!c) fails.push(id); };
must(/iu-silver-hero-v4\.webp"[^>]*fetchpriority="low"/.test(index), "preload:silver_low");
must(/iu-hero-figureImg[^>]*fetchpriority="low"/.test(index), "img:silver_low");
must(/notes-tile\.jpg[^>]*loading="lazy"/.test(index), "notes:lazy");
must(/tasks-tile\.jpg[^>]*loading="lazy"/.test(index), "tasks:lazy");
must(/iu-silver-button\.png[^>]*loading="lazy"/.test(index), "button:lazy");
must(/perf-loop-iter007-demote-silver-img-v1-20260820/.test(index), "marker");
must(/infouzel-prehled-dne-banner\.webp"[^>]*fetchpriority="high"/.test(index), "banner:stays_high");
if (fails.length) {
  console.error("[iu-perf-loop-iter007-demote-silver-img-guard] FAIL");
  for (const id of fails) console.error(" - " + id);
  process.exit(1);
}
console.log("[iu-perf-loop-iter007-demote-silver-img-guard] PASS");
