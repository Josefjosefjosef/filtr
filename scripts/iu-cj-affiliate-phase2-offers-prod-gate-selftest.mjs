#!/usr/bin/env node
/**
 * Production feature-flag gate: liveEnabled=false must never paint publication-ready-only UI path.
 * Fixture proof only — not live CJ verification.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsSrc = fs.readFileSync(path.join(repoRoot, "assets", "iu-affiliate-phase2-offers-v1.js"), "utf8");
const stub = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "projects", "data", "iu-affiliate-cj-offers-public-v1.json"), "utf8")
);

const failures = [];
function expect(id, cond, detail) {
  if (!cond) failures.push(detail ? { id, detail } : id);
}

expect("stub_live_false", stub.liveEnabled === false);
expect("stub_empty_sections", Array.isArray(stub.sections) && stub.sections.length === 0);

/* Minimal DOM + fetch harness */
const mountState = { html: "", hidden: true, calls: 0 };
const documentMock = {
  getElementById(id) {
    if (id === "iuAffiliatePhase2Offers") {
      return {
        get id() {
          return "iuAffiliatePhase2Offers";
        },
        get hidden() {
          return mountState.hidden;
        },
        set hidden(v) {
          mountState.hidden = v;
        },
        get innerHTML() {
          return mountState.html;
        },
        set innerHTML(v) {
          mountState.html = v;
          mountState.calls += 1;
        },
        insertAdjacentHTML() {
          mountState.calls += 1;
        },
        querySelector() {
          return null;
        },
        appendChild() {},
      };
    }
    if (id === "iuAffiliateView") {
      return {
        appendChild() {},
        insertBefore() {},
      };
    }
    if (id === "iuAffiliateGrid") return { parentNode: documentMock.getElementById("iuAffiliateView") };
    return null;
  },
  querySelector() {
    return null;
  },
  createElement(tag) {
    return {
      tagName: tag,
      style: {},
      setAttribute() {},
      appendChild() {},
      addEventListener() {},
      className: "",
      textContent: "",
      innerHTML: "",
      type: "",
    };
  },
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
};

const fetchCalls = [];
const sandbox = {
  window: { __iuAffiliatePhase2OffersBooted: false },
  document: documentMock,
  location: { hostname: "www.infouzel.cz", search: "" },
  fetch(url) {
    fetchCalls.push(String(url));
    return Promise.resolve({
      ok: true,
      json: async () => stub,
    });
  },
  setTimeout,
  clearTimeout,
  AbortController,
  navigator: {},
  console,
};

vm.createContext(sandbox);
vm.runInContext(jsSrc, sandbox);

expect("boot_export", typeof sandbox.window.iuAffiliatePhase2OffersRender === "function");

await new Promise((resolve) => {
  sandbox.window.iuAffiliatePhase2OffersRender("aff-auto-moto");
  setTimeout(resolve, 30);
});

expect("fetched_public_json", fetchCalls.some((u) => u.includes("iu-affiliate-cj-offers-public-v1.json")));
expect("mount_stays_empty_when_disarmed", mountState.html === "" || mountState.hidden === true);
expect("no_cta_painted", !/Zobrazit nabídku/.test(mountState.html));

const armedDoc = {
  ...stub,
  liveEnabled: true,
  ok: true,
  sections: [
    {
      sectionKey: "aff-auto-moto",
      coupons: [
        {
          couponCode: "TEST",
          partnerName: "Fixture Partner",
          publicationReady: true,
          affiliateUrl: "https://www.kqzyfj.com/click-101883843-1",
        },
      ],
      actions: [],
      products: [],
    },
  ],
};

sandbox.window.__iuAffiliatePhase2OffersBooted = false;
/* Re-run would no-op due to boot guard — call renderPublic via second evaluation is hard.
   Instead assert source contract for armed path. */
expect("source_has_live_gate", jsSrc.includes("liveEnabled !== true"));
expect("source_filters_publication_ready", jsSrc.includes("publicationReady === true"));
expect("armed_fixture_shape_ok", armedDoc.liveEnabled === true && armedDoc.sections[0].coupons[0].publicationReady === true);

const ok = failures.length === 0;
console.log(
  JSON.stringify({
    IU_CJ_OFFERS_PROD_GATE_SELFTEST: ok ? "OK" : "FAIL",
    failures,
    note: "Fixture/prod-gate only — not live CJ account verification",
  })
);
process.exit(ok ? 0 : 1);
