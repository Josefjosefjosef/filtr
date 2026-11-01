#!/usr/bin/env node
/**
 * Phase 3Z V16 hotfix — ATOMIC PUBLIC_SWAP applicator (explicit GO only).
 *
 * Rebuilds static catalog from registry, rewrites assets/iu-affiliate-catalog.js
 * (purge all historical CJ chips; bake static CJ buttons; preserve non-CJ),
 * arms publicButtonSwapArmed + liveEnabled on static JSON, and points runtime
 * refresh at the static catalog (single CJ renderer).
 *
 * Requires: IU_CJ_PUBLIC_SWAP_GO=1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isCjTrackingUrl,
  assertAllowedDataWrite,
} from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import { parseAffiliateCatalogOrdered } from "./iu-cj-affiliate-phase2-partner-slot-inventory-v1.mjs";
import { buildStaticMainButtonCatalog, buildStaticMainButtonPreview } from "./iu-cj-affiliate-phase3z-static-main-catalog-v13.mjs";
import { simulateAtomicSwap } from "./iu-cj-affiliate-phase3z-atomic-swap-dry-run-v13.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = path.join(ROOT, "projects", "data", "iu-affiliate-cj-public-swap-lock-v16.json");
const CATALOG_JS = path.join(ROOT, "assets", "iu-affiliate-catalog.js");
const REG_OUT = path.join(ROOT, "projects", "data", "iu-affiliate-cj-partner-registry-v1.json");
const STATIC_OUT = path.join(ROOT, "projects", "data", "iu-affiliate-cj-main-buttons-static-v13.json");
const PREVIEW_OUT = path.join(
  ROOT,
  "projects",
  "data",
  "iu-affiliate-cj-main-buttons-static-preview-v13.json"
);
const PROOF_OUT = path.join(ROOT, "projects", "data", "iu-affiliate-cj-atomic-swap-public-v16.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJson(p, obj) {
  assertAllowedDataWrite(p);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

function escJs(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function formatItemsBlock(items) {
  if (!items.length) return "\n      ";
  const lines = items.map((it) => {
    if (it.source === "preserved_non_cj" || (!isCjTrackingUrl(it.url || "") && it.url)) {
      if (it.advertiserId) {
        return `        affPartner("${escJs(it.title)}", "${escJs(it.url)}", "${escJs(it.advertiserId)}")`;
      }
      return `        affPartner("${escJs(it.title)}", "${escJs(it.url)}")`;
    }
    // static CJ
    return `        affPartner("${escJs(it.title)}", "${escJs(it.url)}", "${escJs(it.advertiserId)}")`;
  });
  return "\n" + lines.join(",\n") + "\n      ";
}

/**
 * Replace items:[...] inside each section object matched by id.
 */
export function rewriteCatalogJsItems(catalogJsText, afterSections) {
  const byId = new Map((afterSections || []).map((s) => [s.sectionId, s.items || []]));
  let out = catalogJsText;
  const sectionRe =
    /(\{\s*id:\s*")(aff-[^"]+)("[\s\S]*?items:\s*\[)([\s\S]*?)(\]\s*,?\s*\})/g;
  out = out.replace(sectionRe, (full, p1, id, p3, _oldItems, p5) => {
    const items = byId.has(id) ? byId.get(id) : [];
    return p1 + id + p3 + formatItemsBlock(items) + p5;
  });
  // Bust marker
  out = out.replace(
    /\/\* iu-affiliate-catalog-bust: [^*]+\*\//,
    `/* iu-affiliate-catalog-bust: cj-phase3z-v16-public-swap-${new Date().toISOString().slice(0, 10)} */`
  );
  return out;
}

/**
 * Patch runtime: arm static catalog path; skip managed-public dual renderer.
 */
export function patchCatalogJsRuntime(catalogJsText) {
  let out = catalogJsText;
  if (!out.includes("IU_AFF_PUBLIC_SWAP_ARMED")) {
    out = out.replace(
      "var IU_AFF_MANAGED_PUBLIC_PATH = \"/projects/data/iu-affiliate-cj-managed-public-v1.json\";",
      [
        "var IU_AFF_PUBLIC_SWAP_ARMED = true;",
        "var IU_AFF_STATIC_MAIN_CATALOG_PATH = \"/projects/data/iu-affiliate-cj-main-buttons-static-v13.json\";",
        "var IU_AFF_MANAGED_PUBLIC_PATH = \"/projects/data/iu-affiliate-cj-managed-public-v1.json\";",
      ].join("\n  ")
    );
  } else {
    out = out.replace(
      /var IU_AFF_PUBLIC_SWAP_ARMED\s*=\s*false;/,
      "var IU_AFF_PUBLIC_SWAP_ARMED = true;"
    );
  }

  // Replace boot: load static catalog when armed instead of managed overlay.
  if (!out.includes("function applyStaticMainCatalogV13")) {
    const helper = `
  function applyStaticMainCatalogV13(catalog) {
    if (!catalog || !Array.isArray(catalog.sections)) return false;
    if (catalog.publicButtonSwapArmed !== true && catalog.liveEnabled !== true) return false;
    var bySection = {};
    for (var si = 0; si < catalog.sections.length; si++) {
      var sec = catalog.sections[si];
      bySection[String(sec.sectionId)] = sec.buttons || [];
    }
    function isCjUrl(u) {
      try {
        var h = String(u || "").toLowerCase();
        return /anrdoezrs\\.net|dpbolvw\\.net|kqzyfj\\.com|jdoqocy\\.com|tkqlhce\\.com|ftjcfx\\.com|lduhtrp\\.net|tqlkg\\.com/.test(h)
          || /\\/click-\\d+-\\d+/.test(h);
      } catch (_) { return false; }
    }
    for (var c = 0; c < IU_AFFILIATE_CATALOG.length; c++) {
      var cat = IU_AFFILIATE_CATALOG[c];
      var kept = [];
      for (var j = 0; j < cat.items.length; j++) {
        var it = cat.items[j];
        if (it && it.url && isCjUrl(it.url)) continue;
        if (it && it.management === "CJ_MANAGED") continue;
        if (it && String(it.source || "") === "static_catalog_v13") continue;
        kept.push(it);
      }
      var buttons = bySection[String(cat.id)] || [];
      for (var bi = 0; bi < buttons.length; bi++) {
        var b = buttons[bi];
        if (!b || !b.url) continue;
        kept.push({
          title: b.title,
          url: b.url,
          affiliateUrlReady: true,
          advertiserId: b.advertiserId != null ? String(b.advertiserId) : null,
          management: "CJ_STATIC_V13",
          source: "static_catalog_v13",
        });
      }
      cat.items = kept;
    }
    window.__iuAffStaticCatalogApplied = true;
    window.__iuAffPublicSwapArmed = true;
    return true;
  }

  function loadStaticMainCatalogV13(done) {
    if (!IU_AFF_PUBLIC_SWAP_ARMED) {
      if (typeof done === "function") done(false);
      return;
    }
    var src = IU_AFF_STATIC_MAIN_CATALOG_PATH;
    try {
      var el = document.querySelector("[data-iu-aff-static-src]");
      if (el) {
        var custom = el.getAttribute("data-iu-aff-static-src");
        if (custom) src = custom;
      }
    } catch (_) {}
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = setTimeout(function () {
      try { if (ctrl) ctrl.abort(); } catch (_) {}
    }, 2500);
    if (src.indexOf("?") === -1) src = src + "?v=" + String(Date.now());
    else src = src + "&v=" + String(Date.now());
    var fetchOpts = { credentials: "same-origin", cache: "no-store" };
    if (ctrl) fetchOpts.signal = ctrl.signal;
    fetch(src, fetchOpts)
      .then(function (r) {
        if (!r.ok) throw new Error("static_http_" + r.status);
        return r.json();
      })
      .then(function (data) {
        clearTimeout(to);
        applyStaticMainCatalogV13(data);
        if (typeof done === "function") done(true);
      })
      .catch(function () {
        clearTimeout(to);
        /* keep baked LKG after swap */
        if (typeof done === "function") done(false);
      });
  }

  window.iuAffiliateApplyStaticMainCatalogV13 = applyStaticMainCatalogV13;
  window.iuAffiliateLoadStaticMainCatalogV13 = loadStaticMainCatalogV13;
`;
    out = out.replace(
      "window.iuAffiliateApplyManagedPublicOverlay = applyManagedPublicOverlay;",
      helper + "\n  window.iuAffiliateApplyManagedPublicOverlay = applyManagedPublicOverlay;"
    );
  }

  // Boot path: when armed, load static catalog; do not apply managed-public dual renderer.
  out = out.replace(
    /initAffiliateCatalog\(\);\s*loadManagedPublicOverlay\(function \(\) \{[\s\S]*?\}\);/,
    `initAffiliateCatalog();
  if (IU_AFF_PUBLIC_SWAP_ARMED) {
    loadStaticMainCatalogV13(function () {
      try {
        var secNow =
          (document.body && document.body.dataset && document.body.dataset.section) || "";
        if (isAffiliateSectionKey(secNow)) renderAffiliateSection(secNow);
      } catch (_) {}
    });
  } else {
    loadManagedPublicOverlay(function () {
      try {
        var secNow =
          (document.body && document.body.dataset && document.body.dataset.section) || "";
        if (isAffiliateSectionKey(secNow)) renderAffiliateSection(secNow);
      } catch (_) {}
    });
  }`
  );

  return out;
}

function acquireLock() {
  if (fs.existsSync(LOCK)) {
    const existing = readJson(LOCK);
    if (existing?.state === "IN_PROGRESS" || existing?.state === "APPLIED") {
      throw new Error("PUBLIC_SWAP_LOCK_HELD:" + JSON.stringify(existing));
    }
  }
  const lock = {
    state: "IN_PROGRESS",
    startedAt: new Date().toISOString(),
    pid: process.pid,
    schema: "iu-affiliate-cj-public-swap-lock-v16",
  };
  writeJson(LOCK, lock);
  return lock;
}

function main() {
  if (process.env.IU_CJ_PUBLIC_SWAP_GO !== "1") {
    console.error(
      JSON.stringify({
        ok: false,
        error: "IU_CJ_PUBLIC_SWAP_GO_required",
        PUBLIC_SWAP: "DISARMED",
      })
    );
    process.exit(2);
  }

  const regPath =
    process.env.IU_CJ_PHASE3Z_REGISTRY_PATH ||
    path.join(
      process.env.TEMP || "/tmp",
      "iu-v16-hotfix-registry",
      "phase3z-out",
      "iu-affiliate-cj-partner-registry-v1.json"
    );

  acquireLock();

  const registry = readJson(regPath);
  if (!registry?.partners?.length) {
    throw new Error("registry_empty");
  }

  // Copy authoritative registry into repo data
  writeJson(REG_OUT, { ...registry, publicButtonSwapArmed: false, liveEnabled: false });

  const titles = new Map();
  const ordered = parseAffiliateCatalogOrdered(fs.readFileSync(CATALOG_JS, "utf8"));
  for (const s of ordered.sections || []) titles.set(s.sectionId, s.sectionTitle);

  let staticCatalog = buildStaticMainButtonCatalog(registry, { sectionTitles: titles });
  // Arm for publication
  staticCatalog = {
    ...staticCatalog,
    publicButtonSwapArmed: true,
    liveEnabled: true,
    activatedAt: new Date().toISOString(),
    activation: "phase3z-v16-hotfix-explicit-go",
    note: "PUBLIC_SWAP ARMED. Single static CJ renderer. Browser does not call CJ API.",
  };
  const preview = buildStaticMainButtonPreview(staticCatalog);
  preview.publicButtonSwapArmed = true;
  preview.previewOnly = false;

  writeJson(STATIC_OUT, staticCatalog);
  writeJson(PREVIEW_OUT, preview);

  const beforeJs = fs.readFileSync(CATALOG_JS, "utf8");
  const sim = simulateAtomicSwap({
    catalogJsText: beforeJs,
    staticCatalog,
    publicButtonSwapArmed: false, // dry helper refuses armed=true; apply happens below
  });
  if (!sim?.ok) {
    throw new Error("atomic_swap_simulate_failed:" + JSON.stringify(sim?.gates || sim));
  }
  if (sim.counts.legacyCjAfterSwap !== 0) {
    throw new Error("legacy_cj_after_swap_nonzero:" + sim.counts.legacyCjAfterSwap);
  }
  if (sim.counts.duplicateAdvertiserIdsAfter !== 0) {
    throw new Error("duplicates_after:" + sim.counts.duplicateAdvertiserIdsAfter);
  }
  const afterSections = sim.snapshot?.after;
  if (!afterSections?.length) throw new Error("missing_after_snapshot");

  let rewritten = rewriteCatalogJsItems(beforeJs, afterSections);
  rewritten = patchCatalogJsRuntime(rewritten);

  // Verify rewrite: parse and count CJ leftover
  const afterParsed = parseAffiliateCatalogOrdered(rewritten);
  let legacyCj = 0;
  let newCj = 0;
  let nonCj = 0;
  const seenAdv = new Set();
  let dups = 0;
  for (const sec of afterParsed.sections || []) {
    for (const it of sec.items || []) {
      if (!it.url) continue;
      if (isCjTrackingUrl(it.url)) {
        newCj += 1;
        const id = it.advertiserId ? String(it.advertiserId) : "";
        if (id) {
          if (seenAdv.has(id)) dups += 1;
          else seenAdv.add(id);
        }
      } else {
        nonCj += 1;
      }
    }
  }

  // Compare newCj to static buttons
  if (newCj !== staticCatalog.counts.buttons) {
    throw new Error("baked_vs_static_mismatch:" + newCj + "!=" + staticCatalog.counts.buttons);
  }
  if (dups !== 0) throw new Error("duplicate_advertiser_ids:" + dups);

  fs.writeFileSync(CATALOG_JS, rewritten, "utf8");

  const proof = {
    schema: "iu-affiliate-cj-atomic-swap-public-v16",
    ok: true,
    PUBLIC_SWAP: "ARMED_AND_VERIFIED",
    publicButtonSwapArmed: true,
    liveEnabled: true,
    syncRunId: process.env.IU_CJ_SYNC_RUN_ID || null,
    registrySource: regPath,
    counts: {
      joined: staticCatalog.counts.joined,
      newButtons: staticCatalog.counts.buttons,
      removedLegacyCj: sim.counts.removedLegacyCj,
      removedManualProtectedCj: sim.counts.removedManualProtectedCj,
      legacyCjAfterSwap: 0,
      bakedCjAfterRewrite: newCj,
      preservedNonCj: nonCj,
      duplicates: dups,
    },
    remainingBlockers: staticCatalog.remainingBlockers,
    sectionCounts: staticCatalog.sectionCounts,
    singleRenderer: true,
    browserCjApiDependency: false,
    appliedAt: new Date().toISOString(),
  };
  writeJson(PROOF_OUT, proof);

  writeJson(LOCK, {
    state: "APPLIED",
    appliedAt: proof.appliedAt,
    proof: PROOF_OUT,
    PUBLIC_SWAP: "ARMED_AND_VERIFIED",
  });

  console.log(JSON.stringify(proof, null, 2));
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (e) {
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    process.exit(1);
  }
}
