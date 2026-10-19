/**
 * Content-aware diff checks for production deploy scope (no path-only bypass).
 */

export function wranglerTomlDiffIsCommentOnly(diff) {
  if (!diff || !String(diff).trim()) return false;
  for (const line of String(diff).split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
      continue;
    }
    if (line.startsWith("@@")) continue;
    if (line.startsWith(" ")) continue;
    if (line.startsWith("+") || line.startsWith("-")) {
      const content = line.slice(1).trim();
      if (content === "") continue;
      if (content.startsWith("#")) continue;
      return false;
    }
  }
  return true;
}

export function typesTsDiffIsCjOptionalEnvOnly(diff, allowedFields = ["ADS_CJ_AFFILIATE_ARCHIVE_ENABLED"]) {
  if (!diff || !String(diff).trim()) return false;
  const allowed = new Set(allowedFields);
  let sawAllowedField = false;
  for (const line of String(diff).split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (line.slice(1).trim() !== "") return false;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      const t = line.slice(1).trim();
      if (t === "") continue;
      if (t.startsWith("/**") || t.startsWith("*") || t.startsWith("*/")) continue;
      const m = t.match(/^([A-Z0-9_]+)\?:\s*string;/);
      if (m && allowed.has(m[1])) {
        sawAllowedField = true;
        continue;
      }
      return false;
    }
  }
  return sawAllowedField;
}

export function deployWorkflowDiffIsProductionDeployGateSafe(diff) {
  if (!diff || !String(diff).trim()) return false;
  const removed = [];
  const added = [];
  for (const line of String(diff).split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) removed.push(line.slice(1));
    if (line.startsWith("+") && !line.startsWith("+++")) added.push(line.slice(1));
  }

  if (
    removed.some((r) => r.includes("resolve_production_deploy_scope")) &&
    !added.some((a) => a.includes("resolve_production_deploy_scope"))
  ) {
    return false;
  }

  if (
    removed.some((r) => r.includes("needs: resolve_production_deploy_scope")) &&
    !added.some((a) => a.includes("needs: resolve_production_deploy_scope"))
  ) {
    return false;
  }

  if (
    removed.some((r) => r.includes("production_deploy == 'run'")) &&
    !added.some((a) => a.includes("production_deploy == 'run'"))
  ) {
    return false;
  }

  if (
    removed.some((r) => r.includes("DECISION") && r.includes("blocked")) &&
    !added.some((a) => a.includes("blocked"))
  ) {
    return false;
  }

  const remoteMarkers = ["wrangler d1 migrations apply", "wrangler secret put", "wrangler r2 bucket", "wrangler d1 execute"];
  for (const r of removed) {
    for (const marker of remoteMarkers) {
      if (r.includes(marker) && !added.some((a) => a.includes(marker))) {
        return false;
      }
    }
  }

  for (const a of added) {
    if (/wrangler deploy/.test(a) && !/index-production\.ts/.test(a) && !/cj-affiliate/.test(a)) {
      return false;
    }
  }

  if (
    removed.some((r) => r.includes("index-production.ts")) &&
    !added.some((a) => a.includes("index-production.ts"))
  ) {
    return false;
  }

  return true;
}

export function testHelperApplyMigrationsDiffIsTestOnlyCj(diff) {
  if (!diff || !String(diff).trim()) return false;
  if (!String(diff).includes("migrations-cj-affiliate-archive")) return false;
  const forbidden = [/wrangler/i, /--remote/i, /production/i, /secret put/i];
  for (const line of String(diff).split("\n")) {
    if (!line.startsWith("+") && !line.startsWith("-")) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const t = line.slice(1);
    for (const re of forbidden) {
      if (re.test(t)) return false;
    }
    if (line.startsWith("-") && /migrations_dir\s*=/.test(t) && !/migrations-cj-affiliate-archive/.test(t)) {
      return false;
    }
    if (line.startsWith("+") && /migrations_dir\s*=/.test(t) && !/"migrations"/.test(t)) {
      return false;
    }
  }
  return true;
}

export function indexProductionDiffWiresCjRoutes(diff) {
  if (!diff) return false;
  const text = String(diff);
  return (
    /admin-affiliate-archive/.test(text) ||
    /affiliate-ad-archive/.test(text) ||
    /index-cj-affiliate-archive/.test(text)
  );
}
