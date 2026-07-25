/**
 * Node guard: empty delivery → zero .iu-ad nodes; mocked ads → labeled nodes.
 * Runs without a browser (minimal DOM shim).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type FakeEl = {
  tagName: string;
  className: string;
  style: { display: string };
  children: FakeEl[];
  firstChild: FakeEl | null;
  attributes: Record<string, string>;
  textContent: string;
  href?: string;
  src?: string;
  alt?: string;
  rel?: string;
  target?: string;
  loading?: string;
  decoding?: string;
  width?: number;
  height?: number;
  appendChild(c: FakeEl): void;
  removeChild(c: FakeEl): void;
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  removeAttribute(k: string): void;
  querySelectorAll(sel: string): FakeEl[];
};

function makeEl(tag: string): FakeEl {
  const el: FakeEl = {
    tagName: tag.toUpperCase(),
    className: "",
    style: { display: "" },
    children: [],
    get firstChild() {
      return el.children[0] || null;
    },
    attributes: {},
    textContent: "",
    appendChild(c: FakeEl) {
      el.children.push(c);
    },
    removeChild(c: FakeEl) {
      el.children = el.children.filter((x) => x !== c);
    },
    setAttribute(k: string, v: string) {
      el.attributes[k] = v;
    },
    getAttribute(k: string) {
      return el.attributes[k] ?? null;
    },
    removeAttribute(k: string) {
      delete el.attributes[k];
    },
    querySelectorAll(sel: string) {
      const out: FakeEl[] = [];
      const walk = (n: FakeEl) => {
        if (sel.startsWith(".") && (" " + n.className + " ").includes(" " + sel.slice(1) + " ")) out.push(n);
        n.children.forEach(walk);
      };
      walk(el);
      return out;
    },
  };
  return el;
}

describe("public inject empty-box guard", () => {
  let root: FakeEl;
  let api: {
    clearAds: (r: FakeEl) => void;
    renderAds: (r: FakeEl, ads: unknown[]) => void;
    AD_CLASS: string;
  };

  beforeEach(() => {
    root = makeEl("div");
    root.setAttribute("data-iu-ads-root", "1");
    const head = makeEl("head");
    const body = makeEl("body");
    const doc = {
      getElementById: () => null,
      querySelector: () => root,
      createElement: (t: string) => makeEl(t),
      head,
      body,
      readyState: "complete",
      addEventListener: () => {},
    };
    const g: Record<string, unknown> = {
      document: doc,
      innerWidth: 1200,
      navigator: { userAgent: "Mozilla/5.0" },
      location: { search: "" },
      setTimeout: () => 0,
      clearTimeout: () => {},
      fetch: () => Promise.reject(new Error("no_net")),
      addEventListener: () => {},
    };
    // Load script into this global
    const src = readFileSync(join(process.cwd(), "../../assets/iu-ads-public-v1.js"), "utf8");
    // eslint-disable-next-line no-new-func
    const fn = new Function("window", "globalThis", src + "\nreturn globalThis.IUAdsPublicV1 || window.IUAdsPublicV1;");
    api = fn(g, g) as typeof api;
  });

  it("empty ads clears to zero .iu-ad nodes and collapses root", () => {
    api.renderAds(root as never, []);
    expect(root.querySelectorAll(".iu-ad").length).toBe(0);
    expect(root.style.display).toBe("none");
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("mocked ads insert labeled .iu-ad nodes", () => {
    api.renderAds(root as never, [
      {
        label: "Reklama",
        target_url: "https://example.com/landing",
        creative: {
          format: "banner",
          width: 300,
          height: 100,
          cdn_url: "https://ads.infouzel.cz/v1/objects/get?x=1",
        },
      },
    ]);
    const nodes = root.querySelectorAll(".iu-ad");
    expect(nodes.length).toBe(1);
    expect(nodes[0].children.some((c) => c.className === "iu-ad__label" && c.textContent === "Reklama")).toBe(true);
    expect(root.style.display).not.toBe("none");
  });
});
