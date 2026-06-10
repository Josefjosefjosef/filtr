#!/usr/bin/env node
/**
 * Source registry / section purity root-cause audit (P0, READ-ONLY diagnostic).
 *
 * Proves WHERE section impurity comes from:
 *  A) Rubric-RSS identity probe: several registered rubric feeds (Novinky /rss/hry,
 *     /rss/cestovani, /rss/ekonomika, /rss/skola, /rss/veda; ProŽeny /rss/zdravi)
 *     return the SAME items as the site-wide global feed -> every fetched article
 *     inherits the registry section (topic field) and the classifier trusts it
 *     (topic_field, conf 0.95).
 *  B) Production section composition: per-source counts inside each section's
 *     newest chunks, to quantify how much of each section is fed by suspect feeds.
 *
 * No production change. No classifier change. No registry change.
 * Output: scripts/iu-source-registry-purity-audit-report.json + stdout summary.
 *
 * Run: node scripts/iu-source-registry-purity-audit.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_PATH = path.join(REPO, "scripts", "iu-source-registry-purity-audit-report.json");
const DATA_BASE = process.env.IU_AUDIT_DATA_BASE || "https://infouzel.cz/projects/data/";
const SECTIONS = ["zpravy", "sport", "finance", "zdravi", "cestovani", "hry", "kultura", "veda", "vzdelavani"];
const MAX_CHUNKS_PER_SECTION = 5;

/** Registered rubric feeds under suspicion vs the site-global feed of the same host. */
const RUBRIC_IDENTITY_PROBES = [
  { registryId: "hry_novinky", section: "hry", rubricUrl: "https://www.novinky.cz/rss/hry", globalUrl: "https://www.novinky.cz/rss" },
  { registryId: "ces_novinky_cestovani", section: "cestovani", rubricUrl: "https://www.novinky.cz/rss/cestovani", globalUrl: "https://www.novinky.cz/rss" },
  { registryId: "fin_novinky_ekonomika", section: "finance", rubricUrl: "https://www.novinky.cz/rss/ekonomika", globalUrl: "https://www.novinky.cz/rss" },
  { registryId: "vzd_novinky_skola", section: "vzdelavani", rubricUrl: "https://www.novinky.cz/rss/skola", globalUrl: "https://www.novinky.cz/rss" },
  { registryId: "ved_novinky", section: "veda", rubricUrl: "https://www.novinky.cz/rss/veda", globalUrl: "https://www.novinky.cz/rss" },
  { registryId: "zdr_prozeny_zdravi", section: "zdravi", rubricUrl: "https://www.prozeny.cz/rss/zdravi", globalUrl: "https://www.prozeny.cz/rss" },
];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (infouzel purity audit; read-only)" },
    redirect: "follow",
  });
  return { status: res.status, finalUrl: res.url, body: res.ok ? await res.text() : "" };
}

function rssItemLinks(xml, limit = 20) {
  const out = [];
  const re = /<link>([\s\S]*?)<\/link>/gi;
  let m;
  while ((m = re.exec(xml)) && out.length < limit + 1) {
    const v = m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(1, limit + 1); // drop channel-level link
}

async function probeRubricIdentity() {
  const results = [];
  const globalCache = new Map();
  for (const probe of RUBRIC_IDENTITY_PROBES) {
    try {
      if (!globalCache.has(probe.globalUrl)) {
        globalCache.set(probe.globalUrl, await fetchText(probe.globalUrl));
      }
      const globalRes = globalCache.get(probe.globalUrl);
      const rubricRes = await fetchText(probe.rubricUrl);
      const globalLinks = new Set(rssItemLinks(globalRes.body));
      const rubricLinks = rssItemLinks(rubricRes.body);
      const overlap = rubricLinks.filter((l) => globalLinks.has(l)).length;
      const overlapPct = rubricLinks.length ? Math.round((1000 * overlap) / rubricLinks.length) / 10 : null;
      results.push({
        registry_id: probe.registryId,
        registered_section: probe.section,
        rubric_url: probe.rubricUrl,
        http_status: rubricRes.status,
        redirected_to: rubricRes.finalUrl !== probe.rubricUrl ? rubricRes.finalUrl : null,
        items_compared: rubricLinks.length,
        overlap_with_global_pct: overlapPct,
        rubric_feed_is_global_feed: overlapPct != null && overlapPct >= 80,
      });
    } catch (e) {
      results.push({ registry_id: probe.registryId, error: String(e && e.message ? e.message : e) });
    }
  }
  return results;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`HTTP_${res.status} ${url}`);
  return res.json();
}

async function sectionComposition() {
  const out = {};
  for (const sec of SECTIONS) {
    const bySource = {};
    let total = 0;
    let chunksRead = 0;
    for (let i = 0; i < MAX_CHUNKS_PER_SECTION; i++) {
      const idx = String(i).padStart(3, "0");
      let payload;
      try {
        payload = await fetchJson(`${DATA_BASE}article_feed_chunks/${sec}/${idx}.json?cb=registry-audit`);
      } catch (_) {
        break;
      }
      chunksRead++;
      for (const a of payload.articles || []) {
        const src = a.sources && a.sources[0] && a.sources[0].name ? String(a.sources[0].name) : "?";
        bySource[src] = (bySource[src] || 0) + 1;
        total++;
      }
      if ((payload.articles || []).length < 100) break;
    }
    out[sec] = {
      articles_counted: total,
      chunks_read: chunksRead,
      by_source: Object.fromEntries(Object.entries(bySource).sort((a, b) => b[1] - a[1])),
    };
  }
  return out;
}

/**
 * Manual audit of 2026-06-10 (484 articles: newest 60 per section + full vzdelavani).
 * 55 TRUE classification errors were individually reviewed and attributed.
 * Attribution key:
 *  - source_mapping: article entered the wrong section because its REGISTERED FEED
 *    supplies content that does not match the registry section (dead rubric RSS
 *    returning the global feed, all-site feed registered under one vertical, or
 *    plain wrong section registration). Classifier then trusts topic_field @0.95.
 *  - classifier: feed/section registration is correct but a classifier layer or
 *    quality guard produced the wrong section for this item.
 *  - ambiguous_content: correct feed, content legitimately borderline.
 */
const MANUAL_ERROR_ATTRIBUTION = {
  audit_date: "2026-06-10",
  audited_articles: 484,
  true_errors: 55,
  breakdown: {
    source_mapping: {
      count: 51,
      pct: 92.7,
      detail: {
        "hry_novinky (Novinky -> hry)": 20,
        "zdr_prozeny_zdravi (ProŽeny -> zdravi)": 14,
        "ces_novinky_cestovani (Novinky -> cestovani)": 6,
        "kul_vlasta (Vlasta all-site feed -> kultura)": 5,
        "fin_novinky_ekonomika (Novinky -> finance)": 4,
        "vzd_betterlife (BetterLife lifestyle feed -> vzdelavani)": 2,
      },
    },
    classifier: {
      count: 3,
      pct: 5.5,
      detail: {
        "FAEI 'Lidé a společnost' item kept as finance (item-level RSS category ignored)": 1,
        "Ekonomický deník covid-aid dispute routed to zdravi (health-title guard false positive)": 1,
        "Sport.cz speed-skating award routed to zdravi": 1,
      },
    },
    ambiguous_content: {
      count: 1,
      pct: 1.8,
      detail: { "VIPŽivot court-case celebrity story in kultura": 1 },
    },
    harness: { count: 0, pct: 0.0, detail: {} },
  },
  per_source_sample: [
    { source: "Novinky", sections: "hry+cestovani+finance+zdravi", checked: 53, misclassified: 30, error_rate_pct: 56.6 },
    { source: "ProŽeny", sections: "zdravi", checked: 26, misclassified: 14, error_rate_pct: 53.8 },
    { source: "BetterLife (edu)", sections: "vzdelavani", checked: 2, misclassified: 2, error_rate_pct: 100.0 },
    { source: "FAEI", sections: "finance", checked: 3, misclassified: 1, error_rate_pct: 33.3 },
    { source: "Vlasta", sections: "kultura+zdravi+cestovani", checked: 20, misclassified: 5, error_rate_pct: 25.0 },
    { source: "Ekonomický deník", sections: "finance+zdravi+cestovani+zpravy", checked: 7, misclassified: 1, error_rate_pct: 14.3 },
    { source: "Sport.cz", sections: "sport+zdravi", checked: 14, misclassified: 1, error_rate_pct: 7.1 },
    { source: "VIPživot", sections: "kultura", checked: 18, misclassified: 1, error_rate_pct: 5.6 },
    { source: "Seznam Zprávy", sections: "all", checked: 27, misclassified: 0, error_rate_pct: 0.0 },
  ],
  top_feeds_by_harm: [
    { rank: 1, registry_id: "hry_novinky", errors_in_sample: 20 },
    { rank: 2, registry_id: "zdr_prozeny_zdravi", errors_in_sample: 14 },
    { rank: 3, registry_id: "ces_novinky_cestovani", errors_in_sample: 6 },
    { rank: 4, registry_id: "kul_vlasta", errors_in_sample: 5 },
    { rank: 5, registry_id: "fin_novinky_ekonomika", errors_in_sample: 4 },
  ],
  purity_projection: {
    current_pct: 88.6,
    after_top3_fix_pct: 96.9,
    after_top5_fix_pct: 98.8,
  },
};

async function main() {
  const rubricIdentity = await probeRubricIdentity();
  const composition = await sectionComposition();

  const deadRubrics = rubricIdentity.filter((r) => r.rubric_feed_is_global_feed).map((r) => r.registry_id);

  const report = {
    generatedAt: new Date().toISOString(),
    read_only: true,
    rubric_feed_identity_probe: rubricIdentity,
    dead_rubric_feeds_returning_global_feed: deadRubrics,
    production_section_composition: composition,
    manual_error_attribution: MANUAL_ERROR_ATTRIBUTION,
    root_cause_primary:
      "SOURCE REGISTRY / upstream RSS: registered rubric feeds deliver site-global or off-section content; ingest stamps registry section as topic; classifier layer-3 trusts topic_field at confidence 0.95.",
    root_cause_secondary:
      "CLASSIFIER: item-level RSS categories are ignored and per-feed quality guards cover only a few audited feeds (HN archiv, Ekonomický deník sport), so the topic_field trust has no generic content sanity check.",
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("SOURCE_REGISTRY_PURITY_AUDIT");
  for (const r of rubricIdentity) {
    console.log(
      `RUBRIC ${r.registry_id} section=${r.registered_section} overlap_with_global=${r.overlap_with_global_pct}% global_feed=${r.rubric_feed_is_global_feed ? "YES" : "NO"}`
    );
  }
  console.log("DEAD_RUBRIC_FEEDS=" + (deadRubrics.join(",") || "none"));
  for (const sec of SECTIONS) {
    const c = composition[sec];
    const top = Object.entries(c.by_source).slice(0, 3).map(([s, n]) => `${s}:${n}`).join(", ");
    console.log(`SECTION ${sec} counted=${c.articles_counted} top_sources=[${top}]`);
  }
  console.log("REPORT=" + path.relative(REPO, REPORT_PATH));
}

main().catch((e) => {
  console.error("AUDIT_ERROR " + e);
  process.exit(1);
});
