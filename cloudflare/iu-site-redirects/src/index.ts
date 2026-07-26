/**
 * Legacy /projects/* → root permanent redirects (301).
 * Pass-through: /projects/data/*, /projects/version.json
 */
function isDataOrVersionPath(pathname: string): boolean {
  if (pathname === "/projects/version.json") return true;
  if (pathname.startsWith("/projects/data/")) return true;
  return false;
}

function redirectTarget(pathname: string): string | null {
  if (pathname === "/projects" || pathname === "/projects/") return "/";
  if (pathname === "/projects/manifest.json") return "/manifest.json";
  if (pathname.startsWith("/projects/icons/")) {
    return "/icons/" + pathname.slice("/projects/icons/".length);
  }
  if (pathname.startsWith("/projects/")) {
    const rest = pathname.slice("/projects/".length);
    if (!rest) return "/";
    return "/" + rest;
  }
  return null;
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (isDataOrVersionPath(pathname)) {
      return fetch(request);
    }

    const destPath = redirectTarget(pathname);
    if (!destPath) {
      return fetch(request);
    }

    const dest = new URL(url.toString());
    dest.pathname = destPath;
    // Preserve query; fragment is client-only.
    return Response.redirect(dest.toString(), 301);
  },
};
