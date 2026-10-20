/** Import graph analysis v24 — fail-closed unresolved import detection (Acorn AST). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAndParseModuleImports } from "./iu-cj-affiliate-phase2-email-ingest-import-graph-parse-v23.mjs";

export const FORBIDDEN_MODULE_SUFFIXES = [
  "iu-cj-affiliate-phase2-email-ingest-offline-test-harness.mjs",
  "iu-cj-affiliate-phase2-email-ingest-historical-repro.mjs",
  "iu-cj-affiliate-phase2-email-ingest-legacy-audit.mjs",
  "iu-cj-affiliate-phase2-email-ingest-harness-trust-bridge.mjs",
  "iu-cj-affiliate-phase2-email-ingest-production-trust-vault-harness.mjs",
];

export const FORBIDDEN_VAULT_EXPORTS = [
  "vaultComputeProductionHmacHex",
  "vaultCreateProductionAuthorityToken",
  "vaultTryAssignProductionKey",
  "getProductionSealKeyMaterial",
  "vaultIssueProductionSealGrant",
  "vaultSealProductionHmacWithGrant",
  "vaultRevokeProductionSealGrant",
];

/** Explicit allowlist — unknown bare specifiers fail-closed in production graph. */
export const ALLOWED_EXTERNAL_MODULE_PREFIXES = ["node:"];

export function resolveModule(filePath) {
  if (fs.existsSync(filePath)) return filePath;
  if (fs.existsSync(filePath + ".mjs")) return filePath + ".mjs";
  return null;
}

function classifySpecifier(spec) {
  if (typeof spec !== "string" || spec.length === 0) {
    return { category: "invalid", reason: "empty_specifier" };
  }
  if (spec.startsWith("file:")) return { category: "local", reason: "file_url" };
  if (spec.startsWith(".") || spec.startsWith("/")) return { category: "local", reason: "relative_or_absolute" };
  if (ALLOWED_EXTERNAL_MODULE_PREFIXES.some((p) => spec.startsWith(p))) {
    return { category: "allowed_external", reason: "allowlisted_external_prefix" };
  }
  return { category: "unknown_external", reason: "unknown_external_package" };
}

function isUnderAllowedRoot(realPath, allowedRoots) {
  for (const root of allowedRoots) {
    if (realPath.startsWith(root)) return true;
  }
  return false;
}

function resolveImportSpec(currentFile, spec, allowedRoots) {
  const cls = classifySpecifier(spec);
  if (cls.category === "allowed_external") {
    return { kind: "allowed-external", spec, classification: cls };
  }
  if (cls.category === "unknown_external") {
    return { kind: "unknown-external", spec, classification: cls };
  }
  if (cls.category === "invalid") {
    return { kind: "invalid-spec", spec, classification: cls };
  }
  if (spec.startsWith("file:")) {
    try {
      const p = fileURLToPath(spec);
      const resolved = resolveModule(p);
      if (!resolved) return { kind: "unresolved-local", spec, normalizedPath: p };
      try {
        const real = fs.realpathSync(resolved);
        if (!isUnderAllowedRoot(real, allowedRoots)) {
          return { kind: "out-of-root", spec, normalizedPath: real, repoRoot: allowedRoots[0] };
        }
        return { kind: "resolved", spec, path: real };
      } catch (err) {
        return { kind: "resolution-error", spec, error: String(err.message || err) };
      }
    } catch (err) {
      return { kind: "resolution-error", spec, error: String(err.message || err) };
    }
  }
  const normalized = path.normalize(path.join(path.dirname(currentFile), spec));
  const resolved = resolveModule(normalized);
  if (!resolved) {
    return { kind: "unresolved-local", spec, normalizedPath: normalized };
  }
  try {
    const real = fs.realpathSync(resolved);
    if (!isUnderAllowedRoot(real, allowedRoots)) {
      return { kind: "out-of-root", spec, normalizedPath: real, repoRoot: allowedRoots[0] };
    }
    return { kind: "resolved", spec, path: real };
  } catch (err) {
    return { kind: "resolution-error", spec, normalizedPath: normalized, error: String(err.message || err) };
  }
}

function finding(moduleBase, importKind, spec, outcome, extra = {}) {
  return {
    sourceModule: moduleBase,
    importKind,
    specifier: spec,
    normalizedPath: extra.normalizedPath ?? null,
    reason: extra.reason ?? outcome.kind,
    securityClassification: "production_reachable",
    ...extra,
  };
}

export function discoverEmailIngestEntryPoints(repoRoot) {
  const files = fs
    .readdirSync(repoRoot)
    .filter((n) => n.startsWith("iu-cj-affiliate-phase2-email-ingest") && n.endsWith(".mjs"));
  const entries = [];
  for (const name of files) {
    const full = path.join(repoRoot, name);
    const text = fs.readFileSync(full, "utf8");
    let role = "documentation_or_auxiliary";
    if (name === "iu-cj-affiliate-phase2-email-ingest-lib.mjs") role = "production_public_api";
    else if (FORBIDDEN_MODULE_SUFFIXES.includes(name)) role = "offline_test_or_legacy";
    else if (name.includes("legacy-audit") || name.includes("historical")) role = "legacy";
    else if (name.includes("selftest") || name.includes("adversarial") || name.includes("ops-sim") || name.includes("audit")) role = "offline_test";
    else if (name.includes("production-trust-vault.mjs")) role = "production_vault";
    else if (name.includes("imap-pipeline-seal")) role = "production_pipeline_boundary";
    else if (name.includes("trust-key-state")) role = "production_trust_shim";
    else if (name.includes("import-graph") || name.includes("mutation") || name.includes("classification")) role = "audit_tooling";
    const exported = [...text.matchAll(/export\s+function\s+(\w+)/g)].map((m) => m[1]);
    entries.push({
      module: name,
      role,
      exportCount: exported.length,
      hasMainGuard: text.includes("#!/usr/bin/env node"),
      evidence: role === "production_public_api" ? "primary dedup + ingest API" : role,
    });
  }
  return entries;
}

export function buildTransitiveClosureAstV24(entryPaths, repoRoot, extraEntryPaths = []) {
  const allowedRoots = [
    fs.realpathSync(path.resolve(repoRoot)),
    ...new Set(extraEntryPaths.map((p) => fs.realpathSync(path.dirname(path.resolve(p))))),
  ];
  const seen = new Set();
  const edges = [];
  const unresolvedStaticImports = [];
  const unresolvedReexports = [];
  const unresolvedDynamicImports = [];
  const unresolvedExternalImports = [];
  const allowedExternalImports = [];
  const outOfRootImports = [];
  const parseErrors = [];
  const resolutionErrors = [];
  const unsupportedSecurityRelevantSyntax = [];
  const queue = [...entryPaths];

  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const moduleBase = path.basename(current);
    let parsed;
    try {
      parsed = loadAndParseModuleImports(current);
    } catch (err) {
      resolutionErrors.push(
        finding(moduleBase, "module-read", current, { kind: "read-error" }, { reason: "file_read_failed", error: String(err.message || err) })
      );
      continue;
    }
    if (parsed.parseError) {
      parseErrors.push({
        sourceModule: moduleBase,
        importKind: "parse",
        specifier: null,
        reason: "parse_error",
        error: parsed.parseError,
        securityClassification: "production_reachable",
      });
    }

    function handleSpec(spec, importKind) {
      const outcome = resolveImportSpec(current, spec, allowedRoots);
      if (outcome.kind === "resolved") {
        edges.push({ from: moduleBase, to: path.basename(outcome.path), kind: importKind === "reexport" ? "reexport-static" : "static", specifier: spec });
        queue.push(outcome.path);
        return;
      }
      if (outcome.kind === "allowed-external") {
        allowedExternalImports.push(
          finding(moduleBase, importKind, spec, outcome, { reason: "allowed_external_import", externalTarget: spec })
        );
        edges.push({ from: moduleBase, to: spec, kind: "external-allowed", specifier: spec });
        return;
      }
      if (outcome.kind === "unknown-external") {
        unresolvedExternalImports.push(
          finding(moduleBase, importKind, spec, outcome, { reason: "unknown_external_import" })
        );
        edges.push({ from: moduleBase, to: spec, kind: "external-unknown", specifier: spec });
        return;
      }
      if (outcome.kind === "out-of-root") {
        outOfRootImports.push(
          finding(moduleBase, importKind, spec, outcome, {
            reason: "import_outside_repo_root",
            normalizedPath: outcome.normalizedPath,
          })
        );
        edges.push({ from: moduleBase, to: spec, kind: "escaped-outside-repo", specifier: spec });
        return;
      }
      if (outcome.kind === "resolution-error") {
        resolutionErrors.push(
          finding(moduleBase, importKind, spec, outcome, { reason: "resolution_error", error: outcome.error })
        );
        return;
      }
      if (outcome.kind === "invalid-spec") {
        unsupportedSecurityRelevantSyntax.push(
          finding(moduleBase, importKind, spec, outcome, { reason: "invalid_import_specifier" })
        );
        return;
      }
      if (outcome.kind === "unresolved-local") {
        const rec = finding(moduleBase, importKind, spec, outcome, {
          reason: importKind === "reexport" ? "unresolved_reexport" : "unresolved_static_import",
          normalizedPath: outcome.normalizedPath ?? null,
        });
        if (importKind === "reexport") unresolvedReexports.push(rec);
        else unresolvedStaticImports.push(rec);
        edges.push({
          from: moduleBase,
          to: spec,
          kind: importKind === "reexport" ? "reexport-unresolved" : "static-unresolved",
          specifier: spec,
          normalizedPath: outcome.normalizedPath ?? null,
        });
      }
    }

    for (const spec of parsed.staticImports) handleSpec(spec, "static-import");
    for (const spec of parsed.exportFrom) handleSpec(spec, "reexport");

    for (const dyn of parsed.dynamicImports) {
      if (dyn.kind === "literal") {
        const outcome = resolveImportSpec(current, dyn.value, allowedRoots);
        if (outcome.kind === "resolved") {
          edges.push({ from: moduleBase, to: path.basename(outcome.path), kind: "dynamic-literal", specifier: dyn.value });
          queue.push(outcome.path);
        } else if (outcome.kind === "allowed-external") {
          allowedExternalImports.push(
            finding(moduleBase, "dynamic-import-literal", dyn.value, outcome, { reason: "allowed_external_dynamic_literal" })
          );
        } else {
          unresolvedDynamicImports.push(
            finding(moduleBase, "dynamic-import-literal", dyn.value, outcome, {
              reason: "unresolved_dynamic_import_literal",
              normalizedPath: outcome.normalizedPath ?? null,
            })
          );
          edges.push({ from: moduleBase, to: dyn.value, kind: "dynamic-unresolved", specifier: dyn.value });
        }
      } else {
        unresolvedDynamicImports.push(
          finding(moduleBase, "dynamic-import-non-literal", dyn.snippet, { kind: "non-literal-dynamic" }, {
            reason: "non_literal_dynamic_import",
          })
        );
      }
    }
  }

  return {
    modules: [...seen].map((p) => path.basename(p)),
    modulePaths: [...seen],
    edges,
    unresolvedStaticImports,
    unresolvedReexports,
    unresolvedDynamicImports,
    unresolvedExternalImports,
    allowedExternalImports,
    outOfRootImports,
    parseErrors,
    resolutionErrors,
    unsupportedSecurityRelevantSyntax,
  };
}

export function classifyProductionReachableEntries(inventory) {
  const productionRoles = new Set(["production_public_api", "production_vault", "production_pipeline_boundary", "production_trust_shim"]);
  return inventory.filter((e) => productionRoles.has(e.role)).map((e) => e.module);
}

export function evaluateProductionGraphSecurityV24(closure, forbiddenHits = []) {
  const blockers = {
    forbiddenHits,
    unresolvedStaticImports: closure.unresolvedStaticImports,
    unresolvedReexports: closure.unresolvedReexports,
    unresolvedDynamicImports: closure.unresolvedDynamicImports,
    unresolvedExternalImports: closure.unresolvedExternalImports,
    outOfRootImports: closure.outOfRootImports,
    parseErrors: closure.parseErrors,
    resolutionErrors: closure.resolutionErrors,
    unsupportedSecurityRelevantSyntax: closure.unsupportedSecurityRelevantSyntax,
  };
  const failClosed =
    forbiddenHits.length > 0 ||
    closure.unresolvedStaticImports.length > 0 ||
    closure.unresolvedReexports.length > 0 ||
    closure.unresolvedDynamicImports.length > 0 ||
    closure.unresolvedExternalImports.length > 0 ||
    closure.outOfRootImports.length > 0 ||
    closure.parseErrors.length > 0 ||
    closure.resolutionErrors.length > 0 ||
    closure.unsupportedSecurityRelevantSyntax.length > 0;
  return { failClosed, blockers };
}

export function analyzeProductionGraphV24(repoRoot, extraEntryPaths = []) {
  const inventory = discoverEmailIngestEntryPoints(repoRoot);
  const productionModules = classifyProductionReachableEntries(inventory);
  const entries = productionModules.map((b) => path.join(repoRoot, b)).concat(extraEntryPaths);
  const closure = buildTransitiveClosureAstV24(entries, repoRoot, extraEntryPaths);
  const forbiddenHits = [];
  const prodLibPath = path.join(repoRoot, "iu-cj-affiliate-phase2-email-ingest-lib.mjs");
  const prodLibText = fs.readFileSync(prodLibPath, "utf8");
  if (!/export\s+const\s+PRODUCTION_SIGNING_ENABLED\s*=\s*false/.test(prodLibText)) {
    forbiddenHits.push("prod-lib:PRODUCTION_SIGNING_ENABLED_not_false_literal");
  }
  for (const modPath of closure.modulePaths) {
    const base = path.basename(modPath);
    if (FORBIDDEN_MODULE_SUFFIXES.includes(base)) forbiddenHits.push(`forbidden-module:${base}`);
    const text = fs.readFileSync(modPath, "utf8");
    for (const ex of FORBIDDEN_VAULT_EXPORTS) {
      if (new RegExp(`export\\s+function\\s+${ex}\\b`).test(text)) {
        forbiddenHits.push(`${base}:export:${ex}`);
      }
    }
  }
  const security = evaluateProductionGraphSecurityV24(closure, forbiddenHits);
  return {
    closure,
    forbiddenHits,
    prodLibText,
    inventory,
    productionEntryModules: productionModules,
    security,
  };
}
