#!/usr/bin/env node
/**
 * Phase 3V layout contract selftest (static + lightweight DOM reorder).
 * PC/tablet/mobile/PWA share the same middle-feed category order:
 * intro → partner buttons → offers (coupons→actions→products) → note → disclosure → SEO.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expect(name, cond) {
  assert.equal(cond, true, name);
}

const html = fs.readFileSync(path.join(ROOT, "projects", "index.html"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-phase2-offers-v1.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-phase2-offers-v1.css"), "utf8");

const tpl = html.match(
  /id="iuLazyViewTpl-affiliate"[\s\S]*?<div id="iuAffiliateView"[\s\S]*?<\/div>\s*<\/template>/
);
expect("tpl_present", Boolean(tpl));
const block = tpl[0];
const ids = [];
const re =
  /id="(iuAffiliateIntro|iuAffiliateGrid|iuAffiliatePhase2Offers|iuAffiliateDisclosure|iuAffiliateSeo)"/g;
let hit;
while ((hit = re.exec(block))) ids.push(hit[1]);

expect("html_intro", ids.includes("iuAffiliateIntro"));
expect("html_grid", ids.includes("iuAffiliateGrid"));
expect("html_offers_mount", ids.includes("iuAffiliatePhase2Offers"));
expect("html_disclosure", ids.includes("iuAffiliateDisclosure"));
expect("html_seo", ids.includes("iuAffiliateSeo"));
expect("html_grid_before_offers", ids.indexOf("iuAffiliateGrid") < ids.indexOf("iuAffiliatePhase2Offers"));
expect(
  "html_offers_before_disclosure",
  ids.indexOf("iuAffiliatePhase2Offers") < ids.indexOf("iuAffiliateDisclosure")
);
expect(
  "html_disclosure_before_seo",
  ids.indexOf("iuAffiliateDisclosure") < ids.indexOf("iuAffiliateSeo")
);
expect("html_seo_last", ids[ids.length - 1] === "iuAffiliateSeo");
expect("html_disclosure_not_before_grid", ids.indexOf("iuAffiliateDisclosure") > ids.indexOf("iuAffiliateGrid"));

expect("js_ensure_order", js.includes("ensureAffiliateCategoryOrder"));
expect("js_export_ensure_order", js.includes("iuAffiliatePhase2OffersEnsureOrder"));
expect("js_coupons_before_products", /for \(var ci[\s\S]*renderCoupon[\s\S]*renderAction[\s\S]*renderProducts/.test(js));
expect("js_live_gate", js.includes("doc.liveEnabled !== true"));
expect("no_affiliate_theme_toggle", !/iuAffiliate.*theme|themeToggle.*affiliate/i.test(block + js));
expect("css_no_fixed_legal", !/iuAffiliateDisclosure\s*\{[^}]*position:\s*fixed/i.test(css));
expect("css_no_abs_legal", !/iuAffiliateDisclosure\s*\{[^}]*position:\s*absolute/i.test(css));
expect("css_no_fixed_seo", !/iuAffiliateSeo\s*\{[^}]*position:\s*fixed/i.test(css + html));

/* Runtime reorder: legacy wrong order → ensureOrder restores contract */
{
  const children = [];
  function node(id, cls) {
    return {
      id: id || "",
      className: cls || "",
      children: [],
      parentNode: null,
      hidden: false,
      attributes: {},
      setAttribute(k, v) {
        this.attributes[k] = String(v);
      },
      querySelector(sel) {
        if (sel === ".iuAffiliatePlaceholderNote") {
          return children.find((c) => c.className === "iuAffiliatePlaceholderNote") || null;
        }
        return null;
      },
      appendChild(child) {
        if (child.parentNode && Array.isArray(child.parentNode.children)) {
          const i = child.parentNode.children.indexOf(child);
          if (i >= 0) child.parentNode.children.splice(i, 1);
        }
        child.parentNode = this;
        this.children.push(child);
        return child;
      },
    };
  }
  const view = node("iuAffiliateView");
  const byId = {
    iuAffiliateView: view,
    iuAffiliateIntro: node("iuAffiliateIntro"),
    iuAffiliateDisclosure: node("iuAffiliateDisclosure"),
    iuAffiliateGrid: node("iuAffiliateGrid"),
    iuAffiliateSeo: node("iuAffiliateSeo"),
  };
  const note = node("", "iuAffiliatePlaceholderNote");
  view.appendChild(byId.iuAffiliateIntro);
  view.appendChild(byId.iuAffiliateDisclosure);
  view.appendChild(byId.iuAffiliateGrid);
  view.appendChild(note);
  view.appendChild(byId.iuAffiliateSeo);
  children.push(...view.children);

  const document = {
    getElementById(id) {
      return byId[id] || null;
    },
    createElement(tag) {
      return node("", tag);
    },
  };
  const sandbox = { window: {}, document, console, setTimeout, clearTimeout, navigator: {}, location: { hostname: "example.com", search: "" } };
  sandbox.window = sandbox;
  vm.runInNewContext(js, sandbox);
  expect("ensure_fn", typeof sandbox.window.iuAffiliatePhase2OffersEnsureOrder === "function");
  sandbox.window.iuAffiliatePhase2OffersEnsureOrder();
  const order = view.children.map((c) => c.id || c.className);
  expect("rt_grid_before_offers", order.indexOf("iuAffiliateGrid") < order.indexOf("iuAffiliatePhase2Offers"));
  expect(
    "rt_offers_before_disclosure",
    order.indexOf("iuAffiliatePhase2Offers") < order.indexOf("iuAffiliateDisclosure")
  );
  expect("rt_seo_last", order[order.length - 1] === "iuAffiliateSeo");
  expect("rt_disclosure_after_grid", order.indexOf("iuAffiliateDisclosure") > order.indexOf("iuAffiliateGrid"));
}

console.log(
  JSON.stringify({
    IU_AFFILIATE_PHASE3V_LAYOUT_ORDER_SELFTEST: "OK",
    htmlOrder: ids,
  })
);
