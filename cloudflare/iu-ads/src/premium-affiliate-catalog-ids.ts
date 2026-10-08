import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Parse `id: "aff-…"` entries from assets/iu-affiliate-catalog.js (authoritative public site sections). */
export function readAffiliateCatalogSectionIdsFromRepo(repoRoot: string): string[] {
  const catalogPath = path.join(repoRoot, "assets", "iu-affiliate-catalog.js");
  const src = fs.readFileSync(catalogPath, "utf8");
  const ids: string[] = [];
  const re = /\bid:\s*"(aff-[a-z0-9-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids.sort();
}

export function defaultRepoRootFromAdsModule(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}
