import { describe, expect, it } from "vitest";
import {
  ensureFrameAncestors,
  ensurePermissionsPolicy,
  extractMetaCsp,
  isHtmlDocumentPath,
  promoteHtmlCsp,
  secondaryCspForPath,
  IU_CSP_EDGE_MARKER,
  IU_CSP_SECONDARY_EDGE_MARKER,
  PERMISSIONS_POLICY_VALUE,
  CSP_OFFLINE_HTML,
  CSP_BOT_HTML,
  CSP_ZDROJE_HTML,
  OFFLINE_INLINE_SCRIPT_SHA256,
  ZDROJE_INLINE_MODULE_SHA256,
} from "./csp-promote";

describe("csp-promote", () => {
  it("extracts multiline meta CSP", () => {
    const html = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy"
    content="
default-src 'self' https:;
script-src 'self' 'sha256-abc';
trusted-types iu-default iu-escape;
require-trusted-types-for 'script';
">
<script>early()</script>
</head></html>`;
    const csp = extractMetaCsp(html);
    expect(csp).toContain("default-src 'self' https:");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).toContain("sha256-abc");
  });

  it("adds frame-ancestors when missing", () => {
    const out = ensureFrameAncestors("default-src 'self'; object-src 'none'");
    expect(out).toContain("frame-ancestors 'self'");
    expect(out).toContain("object-src 'none'");
  });

  it("does not duplicate frame-ancestors", () => {
    const out = ensureFrameAncestors("default-src 'self'; frame-ancestors 'none'");
    expect(out.match(/frame-ancestors/gi)?.length).toBe(1);
    expect(out).toContain("frame-ancestors 'none'");
  });

  it("classifies HTML document paths", () => {
    expect(isHtmlDocumentPath("/")).toBe(true);
    expect(isHtmlDocumentPath("/index.html")).toBe(true);
    expect(isHtmlDocumentPath("/offline.html")).toBe(true);
    expect(isHtmlDocumentPath("/statistiky/")).toBe(true);
    expect(isHtmlDocumentPath("/zdroje-a-licence/")).toBe(true);
    expect(isHtmlDocumentPath("/bot/")).toBe(true);
    expect(isHtmlDocumentPath("/assets/app.js")).toBe(false);
    expect(isHtmlDocumentPath("/sw.js")).toBe(false);
    expect(isHtmlDocumentPath("/projects/data/x.json")).toBe(false);
  });

  it("resolves secondary CSP by path", () => {
    expect(secondaryCspForPath("/offline.html")).toBe(CSP_OFFLINE_HTML);
    expect(secondaryCspForPath("/bot/")).toBe(CSP_BOT_HTML);
    expect(secondaryCspForPath("/zdroje-a-licence/")).toBe(CSP_ZDROJE_HTML);
    expect(secondaryCspForPath("/")).toBeNull();
    expect(secondaryCspForPath("/statistiky/")).toBeNull();
  });

  it("promotes meta CSP onto HTML response headers", async () => {
    const body = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; object-src 'none'; require-trusted-types-for 'script'; trusted-types iu-default iu-escape;">`;
    const origin = new Response(body, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const out = await promoteHtmlCsp(origin, "/");
    const csp = out.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(out.headers.get("x-iu-csp-edge")).toBe(IU_CSP_EDGE_MARKER);
    expect(out.headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY_VALUE);
    expect(await out.text()).toContain("Content-Security-Policy");
  });

  it("applies secondary offline CSP when meta missing", async () => {
    const origin = new Response("<!doctype html><html><body>offline</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const out = await promoteHtmlCsp(origin, "/offline.html");
    expect(out.headers.get("Content-Security-Policy")).toBe(CSP_OFFLINE_HTML);
    expect(out.headers.get("x-iu-csp-edge")).toBe(IU_CSP_SECONDARY_EDGE_MARKER);
    expect(out.headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY_VALUE);
    expect(CSP_OFFLINE_HTML).toContain(OFFLINE_INLINE_SCRIPT_SHA256);
    expect(CSP_OFFLINE_HTML).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("applies secondary bot CSP when meta missing", async () => {
    const origin = new Response("<!doctype html><html><body>bot</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const out = await promoteHtmlCsp(origin, "/bot/");
    expect(out.headers.get("Content-Security-Policy")).toBe(CSP_BOT_HTML);
    expect(out.headers.get("x-iu-csp-edge")).toBe(IU_CSP_SECONDARY_EDGE_MARKER);
    expect(CSP_BOT_HTML).toContain("script-src 'self'");
    expect(CSP_BOT_HTML).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("applies secondary zdroje CSP when meta missing", async () => {
    const origin = new Response("<!doctype html><html><body>zl</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const out = await promoteHtmlCsp(origin, "/zdroje-a-licence/");
    expect(out.headers.get("Content-Security-Policy")).toBe(CSP_ZDROJE_HTML);
    expect(CSP_ZDROJE_HTML).toContain(ZDROJE_INLINE_MODULE_SHA256);
    expect(CSP_ZDROJE_HTML).toContain("connect-src 'self'");
  });

  it("sets Permissions-Policy on HTML even when meta CSP is missing and no secondary", async () => {
    const origin = new Response("<!doctype html><html><body>ok</body></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const out = await promoteHtmlCsp(origin, "/statistiky/");
    expect(out.headers.get("Content-Security-Policy")).toBeNull();
    expect(out.headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY_VALUE);
  });

  it("does not duplicate Permissions-Policy", () => {
    const headers = new Headers({ "Permissions-Policy": "camera=(self)" });
    ensurePermissionsPolicy(headers);
    expect(headers.get("Permissions-Policy")).toBe("camera=(self)");
  });

  it("policy keeps geolocation self and does not deny clipboard-write", () => {
    expect(PERMISSIONS_POLICY_VALUE).toContain("geolocation=(self)");
    expect(PERMISSIONS_POLICY_VALUE).toContain("camera=()");
    expect(PERMISSIONS_POLICY_VALUE).toContain("clipboard-read=()");
    expect(PERMISSIONS_POLICY_VALUE).not.toMatch(/clipboard-write\s*=\s*\(\)/);
    expect(PERMISSIONS_POLICY_VALUE).not.toMatch(/autoplay\s*=\s*\(\)/);
    expect(PERMISSIONS_POLICY_VALUE).not.toMatch(/fullscreen\s*=\s*\(\)/);
  });

  it("leaves non-HTML unchanged", async () => {
    const origin = new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const out = await promoteHtmlCsp(origin, "/offline.html");
    expect(out.headers.get("Content-Security-Policy")).toBeNull();
    expect(out.headers.get("Permissions-Policy")).toBeNull();
  });
});
