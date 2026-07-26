#!/usr/bin/env node
/**
 * Deploy-time only (pages.yml): publish app shell at site root and replace
 * legacy /projects/*.html entrypoints with client redirects that preserve query/hash.
 * Does NOT rename projects/data — JSON feeds stay at /projects/data/*.
 */
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = process.cwd();

function writeRedirect(outRel, dest) {
  const out = join(ROOT, outRel);
  mkdirSync(dirname(out), { recursive: true });
  const html = `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex,follow" />
  <meta http-equiv="refresh" content="0;url=${dest}" />
  <link rel="canonical" href="https://infouzel.cz${dest}" />
  <title>Přesměrování…</title>
  <script>
    (function () {
      var targetPath = ${JSON.stringify(dest)};
      var q = location.search || "";
      var h = location.hash || "";
      location.replace(targetPath + q + h);
    })();
  </script>
</head>
<body></body>
</html>
`;
  writeFileSync(out, html, "utf8");
  console.log("LEGACY_REDIRECT", outRel, "->", dest);
}

const appSrc = join(ROOT, "projects", "index.html");
if (!existsSync(appSrc)) {
  console.error("BLOCKER: missing projects/index.html");
  process.exit(1);
}
writeFileSync(join(ROOT, "index.html"), readFileSync(appSrc));
console.log("ROOT_APP=index.html");

for (const name of ["statistiky", "zdroje-a-licence"]) {
  const from = join(ROOT, "projects", name);
  const to = join(ROOT, name);
  if (!existsSync(from)) {
    console.error("BLOCKER: missing", from);
    process.exit(1);
  }
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log("ROOT_COPY=" + name);
}

writeRedirect("projects/index.html", "/");
writeRedirect("projects/statistiky/index.html", "/statistiky/");
writeRedirect("projects/zdroje-a-licence/index.html", "/zdroje-a-licence/");
console.log("ROOT_PUBLISH=OK");
