import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Parse `id: "aff-…"` entries from assets/iu-affiliate-catalog.js (authoritative public site sections). */
export function readAffiliateCatalogSectionIdsFromRepo(repoRoot: string): string[] {
  return Object.keys(readAffiliateCatalogSectionTitlesFromRepo(repoRoot)).sort();
}

/** Parse public `title` for each affiliate section id from assets/iu-affiliate-catalog.js. */
export function readAffiliateCatalogSectionTitlesFromRepo(repoRoot: string): Record<string, string> {
  const catalogPath = path.join(repoRoot, "assets", "iu-affiliate-catalog.js");
  const src = fs.readFileSync(catalogPath, "utf8");
  const titles: Record<string, string> = {};
  const re = /\bid:\s*"(aff-[a-z0-9-]+)"[\s\S]*?\btitle:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    titles[m[1]] = m[2];
  }
  return titles;
}

export function defaultRepoRootFromAdsModule(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}
