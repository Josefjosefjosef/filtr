/**
 * Analytics Worker CORS — fail-closed allowlist.
 * Never treat "*" as allow-all / arbitrary-Origin reflection.
 *
 * Browser client uses navigator.sendBeacon (credentials mode "include") with
 * fetch fallback credentials:"omit". Allowed origins therefore need concrete
 * ACAO + ACAC=true. Disallowed / missing Origin must not receive CORS trust.
 */

export const DEFAULT_PRODUCTION_ORIGINS: readonly string[] = [
  "https://infouzel.cz",
  "https://www.infouzel.cz",
];

export type CorsEnv = {
  CORS_ALLOW_ORIGIN?: string;
};

/** Parse env allowlist. "*" / empty / malformed → production defaults (never allow-all). */
export function resolveAllowedOrigins(raw: string | undefined | null): string[] {
  const s = String(raw ?? "").trim();
  if (!s || s === "*") {
    return DEFAULT_PRODUCTION_ORIGINS.slice();
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of s.split(",")) {
    const item = part.trim();
    if (!item || item === "*") continue;
    try {
      const u = new URL(item);
      // Exact origin only (scheme + host + port); reject paths/suffix tricks.
      if (u.origin !== item) continue;
      if (seen.has(u.origin)) continue;
      seen.add(u.origin);
      out.push(u.origin);
    } catch {
      // skip malformed entry
    }
  }
  return out.length ? out : DEFAULT_PRODUCTION_ORIGINS.slice();
}

/** Exact Origin match against allowlist. null / empty / malformed → false. */
export function isAllowedBrowserOrigin(originHeader: string, allowed: string[]): boolean {
  if (!originHeader || originHeader === "null") return false;
  try {
    const u = new URL(originHeader);
    if (u.origin !== originHeader) return false;
    return allowed.includes(u.origin);
  } catch {
    return false;
  }
}

/**
 * Build CORS response headers for a request.
 * Disallowed Origin → Vary only (no ACAO / ACAC).
 */
export function buildCorsHeaders(env: CorsEnv, req: Request): HeadersInit {
  const origin = req.headers.get("Origin") || "";
  const allowed = resolveAllowedOrigins(env.CORS_ALLOW_ORIGIN);
  const headers: Record<string, string> = {
    vary: "Origin",
  };

  if (!isAllowedBrowserOrigin(origin, allowed)) {
    return headers;
  }

  // sendBeacon(JSON) uses credentials mode "include" — browsers require ACAC + concrete ACAO.
  headers["access-control-allow-origin"] = origin;
  headers["access-control-allow-credentials"] = "true";
  headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
  // Public analytics client only sends content-type (Authorization is admin/Bearer, not CORS browser path).
  headers["access-control-allow-headers"] = "content-type";
  headers["access-control-max-age"] = "86400";
  return headers;
}
