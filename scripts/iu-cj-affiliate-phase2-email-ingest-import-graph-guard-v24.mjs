#!/usr/bin/env node
/** Production import graph guard v24 — fail-closed on unresolved production imports. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeProductionGraphV24,
  evaluateProductionGraphSecurityV24,
  FORBIDDEN_MODULE_SUFFIXES,
} from "./iu-cj-affiliate-phase2-email-ingest-import-graph-lib-v24.mjs";

const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const extraRaw = process.env.IU_CJ_EMAIL_INGEST_GUARD_EXTRA_ENTRIES || "";
const extraEntryPaths = extraRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p));

const { closure, forbiddenHits, prodLibText, inventory, productionEntryModules } = analyzeProductionGraphV24(
  repoRoot,
  extraEntryPaths
);

const publicEntryExports = [...prodLibText.matchAll(/export\s+function\s+(\w+)/g)].map((m) => m[1]);
const signingLike = publicEntryExports.filter(
  (n) => /^(seal|sign|grant|issue|forge|attach).*Production/i.test(n) || /Production.*(Seal|Sign|Grant|Hmac)/i.test(n)
);
for (const fn of signingLike) {
  if (fn === "sealCommercialActionDedupRecordFromTrustedImapPipeline") continue;
  if (fn === "activateCommercialActionDedupProductionTrustContext") continue;
  if (fn === "configureCommercialActionDedupProductionSealFromEnvironment") continue;
  if (fn === "productionSealWouldCollideWithOfflineSelftestMaterial") continue;
  forbiddenHits.push(`prod-lib:suspicious_export:${fn}`);
}

const harnessImportInProdLib = FORBIDDEN_MODULE_SUFFIXES.some((s) => prodLibText.includes(s));
if (harnessImportInProdLib) forbiddenHits.push("prod-lib:static_text_reference_to_forbidden_module");

const { failClosed } = evaluateProductionGraphSecurityV24(closure, forbiddenHits);
const ok = !failClosed;

const out = {
  IU_CJ_EMAIL_INGEST_IMPORT_GRAPH_GUARD_V24: ok ? "OK" : "FAIL",
  parser: "acorn-ast-v24-fail-closed",
  productionEntryModules,
  entryInventoryCount: inventory.length,
  moduleCount: closure.modules.length,
  edgeCount: closure.edges.length,
  forbiddenHits,
  unresolvedStaticImports: closure.unresolvedStaticImports,
  unresolvedReexports: closure.unresolvedReexports,
  unresolvedDynamicImports: closure.unresolvedDynamicImports,
  unresolvedExternalImports: closure.unresolvedExternalImports,
  allowedExternalImports: closure.allowedExternalImports,
  outOfRootImports: closure.outOfRootImports,
  parseErrors: closure.parseErrors,
  resolutionErrors: closure.resolutionErrors,
  unsupportedSecurityRelevantSyntax: closure.unsupportedSecurityRelevantSyntax,
  failClosed,
  inventory,
  modules: closure.modules.sort(),
  edges: closure.edges,
};
const graphPath = process.env.IU_CJ_EMAIL_INGEST_GUARD_GRAPH_OUT;
if (graphPath) {
  fs.writeFileSync(graphPath, JSON.stringify(out, null, 2), "utf8");
}
console.log(JSON.stringify(out));
process.exit(ok ? 0 : 1);
