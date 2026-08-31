/**
 * Promote document meta CSP → HTTP Content-Security-Policy.
 * Canonical policy source remains the HTML meta tag (updated by
 * scripts/iu-csp-apply-script-hashes-v1.mjs). Edge adds HTTP-only
 * frame-ancestors to match X-Frame-Options: SAMEORIGIN.
 */

export const IU_CSP_EDGE_MARKER = "meta-promoted-v1";
export const FRAME_ANCESTORS_SELF = "frame-ancestors 'self'";

/** Extract Content-Security-Policy from a meta http-equiv tag (multiline OK). */
export function extractMetaCsp(html: string): string | null {
  const equivIdx = html.search(/http-equiv\s*=\s*["']Content-Security-Policy["']/i);
  if (equivIdx < 0) return null;

  // Find the opening <meta for THIS http-equiv (walk back; avoid earlier meta tags).
  const back = html.slice(Math.max(0, equivIdx - 300), equivIdx);
  const openRel = back.toLowerCase().lastIndexOf("<meta");
  if (openRel < 0) return null;
  const tagStart = Math.max(0, equivIdx - 300) + openRel;
  const after = html.slice(tagStart, tagStart + 16000);
  const endRel = after.indexOf(">");
  if (endRel < 0) return null;
  const tag = after.slice(0, endRel + 1);
  if (!/http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag)) return null;

  const contentMatch = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i);
  if (!contentMatch) return null;
  const normalized = contentMatch[2].replace(/\s+/g, " ").trim();
  return normalized || null;
}

/** Ensure HTTP-only frame-ancestors is present without duplicating. */
export function ensureFrameAncestors(csp: string, value = FRAME_ANCESTORS_SELF): string {
  const compact = String(csp || "").replace(/\s+/g, " ").trim();
  if (!compact) return value;
  if (/frame-ancestors\s+/i.test(compact)) return compact;
  return compact.replace(/;?\s*$/, "") + "; " + value;
}

export function isHtmlContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return /text\/html/i.test(contentType);
}

/**
 * Paths that serve HTML documents for the public site.
 * Assets/API/JSON are excluded so Worker only wraps document responses.
 */
export function isHtmlDocumentPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/index.html") return true;
  if (pathname === "/statistiky" || pathname.startsWith("/statistiky/")) return true;
  if (pathname === "/zdroje-a-licence" || pathname.startsWith("/zdroje-a-licence/")) return true;
  if (pathname === "/bot" || pathname.startsWith("/bot/")) return true;
  return false;
}

/**
 * Clone an HTML origin response and set Content-Security-Policy from meta.
 * If meta is missing, leave response unchanged (fail-open for non-app HTML).
 */
export async function promoteHtmlCsp(response: Response): Promise<Response> {
  if (!isHtmlContentType(response.headers.get("content-type"))) {
    return response;
  }

  const buf = await response.arrayBuffer();
  const headBytes = Math.min(buf.byteLength, 96 * 1024);
  const headText = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, headBytes));
  const metaCsp = extractMetaCsp(headText);
  if (!metaCsp) {
    return new Response(buf, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", ensureFrameAncestors(metaCsp));
  headers.set("x-iu-csp-edge", IU_CSP_EDGE_MARKER);

  return new Response(buf, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
