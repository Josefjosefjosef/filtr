import { describe, expect, it } from "vitest";
import {
  ensureFrameAncestors,
  extractMetaCsp,
  isHtmlDocumentPath,
  promoteHtmlCsp,
  IU_CSP_EDGE_MARKER,
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
    expect(isHtmlDocumentPath("/statistiky/")).toBe(true);
    expect(isHtmlDocumentPath("/assets/app.js")).toBe(false);
    expect(isHtmlDocumentPath("/sw.js")).toBe(false);
    expect(isHtmlDocumentPath("/projects/data/x.json")).toBe(false);
  });

  it("promotes meta CSP onto HTML response headers", async () => {
    const body = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; object-src 'none'; require-trusted-types-for 'script'; trusted-types iu-default iu-escape;">`;
    const origin = new Response(body, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const out = await promoteHtmlCsp(origin);
    const csp = out.headers.get("Content-Security-Policy") || "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(out.headers.get("x-iu-csp-edge")).toBe(IU_CSP_EDGE_MARKER);
    expect(await out.text()).toContain("Content-Security-Policy");
  });

  it("leaves non-HTML unchanged", async () => {
    const origin = new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const out = await promoteHtmlCsp(origin);
    expect(out.headers.get("Content-Security-Policy")).toBeNull();
  });
});
