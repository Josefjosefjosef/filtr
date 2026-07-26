/**
 * Central security headers for InfoUzel Ads Worker responses.
 * HTML shells get nonce-based CSP; API/object responses get base headers without HTML CSP.
 */

export const HSTS_VALUE = "max-age=31536000; includeSubDomains";

/** Explicit deny of unused powerful features (Ads portals do not use device sensors/media). */
export const PERMISSIONS_POLICY_VALUE = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "serial=()",
  "bluetooth=()",
  "accelerometer=()",
  "gyroscope=()",
  "magnetometer=()",
  "interest-cohort=()",
].join(", ");

/**
 * Inventory-backed CSP (admin/client SPA-lite):
 * - scripts/styles: same-document inline only, gated by per-response nonce (no unsafe-eval)
 * - connect/img/font/media: 'self' only (no CDN, no third-party fonts)
 * - no workers, objects, frames, or wildcards
 * Inline style="" attributes were removed from admin UI so style-src needs no unsafe-inline.
 */
export function buildHtmlContentSecurityPolicy(nonce: string): string {
  const n = "'nonce-" + nonce + "'";
  return [
    "default-src 'self'",
    "script-src " + n,
    "style-src " + n,
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "frame-src 'none'",
    "media-src 'self'",
    "manifest-src 'none'",
  ].join("; ");
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // base64url — valid in CSP nonce tokens
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isHttpsRequest(request: Request): boolean {
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Base headers applied to every Worker response (HTML, JSON, downloads). */
export function applyBaseSecurityHeaders(headers: Headers, request: Request): void {
  if (!headers.has("X-Content-Type-Options")) {
    headers.set("X-Content-Type-Options", "nosniff");
  }
  if (!headers.has("Referrer-Policy")) {
    headers.set("Referrer-Policy", "same-origin");
  }
  if (!headers.has("X-Frame-Options")) {
    headers.set("X-Frame-Options", "SAMEORIGIN");
  }
  if (!headers.has("Permissions-Policy")) {
    headers.set("Permissions-Policy", PERMISSIONS_POLICY_VALUE);
  }
  if (isHttpsRequest(request) && !headers.has("Strict-Transport-Security")) {
    headers.set("Strict-Transport-Security", HSTS_VALUE);
  }
}

/**
 * HTML shell response headers (CSP + COOP + base).
 * COEP/CORP intentionally omitted — signed object streams and future embeds must not break.
 */
export function htmlSecurityHeaders(request: Request, nonce: string): HeadersInit {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "text/html; charset=utf-8",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": buildHtmlContentSecurityPolicy(nonce),
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  applyBaseSecurityHeaders(headers, request);
  return headers;
}

/**
 * Finalize any Worker Response with consistent security headers.
 * Does not attach HTML CSP to non-HTML (API/JSON/object/export) bodies.
 * Preserves Content-Type / Content-Disposition / Set-Cookie.
 */
export function finalizeSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  applyBaseSecurityHeaders(headers, request);
  const ct = headers.get("Content-Type") || "";
  if (ct.includes("text/html") && !headers.has("Cross-Origin-Opener-Policy")) {
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
