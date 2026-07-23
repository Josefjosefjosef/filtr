/**
 * Target URL allowlist (Etapa 4, kap. 43 / 03-security-threat-model.md#ssrf-dangerous-url).
 * Only absolute http(s) URLs or root-relative internal paths are accepted; `javascript:`,
 * `data:`, `vbscript:`, `file:`, protocol-relative `//host/...`, and any other scheme are
 * rejected outright. Used by admin-campaigns.ts (campaign `target_url`) and admin-preview.ts.
 */

const SCHEME_RE = /^\s*[a-z][a-z0-9+.-]*:/i;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export type UrlSafetyResult = { ok: true; normalized: string } | { ok: false; reason: string };

export function validateTargetUrl(raw: unknown): UrlSafetyResult {
  if (typeof raw !== "string") return { ok: false, reason: "invalid_url" };
  const value = raw.trim();
  if (!value) return { ok: false, reason: "invalid_url" };
  if (/[\r\n\t]/.test(value)) return { ok: false, reason: "invalid_url" };

  // Root-relative internal path (never `//host`, which is protocol-relative to an external host).
  if (value.startsWith("/") && !value.startsWith("//")) {
    return { ok: true, normalized: value };
  }

  if (!SCHEME_RE.test(value)) return { ok: false, reason: "unsafe_scheme" };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (!ALLOWED_SCHEMES.has(parsed.protocol)) return { ok: false, reason: "unsafe_scheme" };
  return { ok: true, normalized: parsed.toString() };
}

export function isSafeTargetUrl(raw: unknown): boolean {
  return validateTargetUrl(raw).ok;
}
