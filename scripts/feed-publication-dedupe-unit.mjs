/**
 * Unit proof: publication cluster → max 2 articles, max 1 per source.
 * Run: node scripts/feed-publication-dedupe-unit.mjs
 */
import {
  buildPublicationClusterUrlMap,
  canonicalArticleUrlKey,
  dedupeCanonicalUrl,
  pickPublicationKeptUrlKeys,
  publicationSourceKey,
} from "../assets/cluster_engine.js";

const now = Date.now();
function art(title, host, path, src, sec = "aktualne") {
  return {
    contentType: "article",
    title,
    url: `https://${host}${path}`,
    publishedAt: new Date(now).toISOString(),
    section: sec,
    topic: sec,
    sources: [{ name: src }],
  };
}

const dupStory = [
  art("Kyjev hlásí nové útoky na ukrajinském východě", "ct24.ceskatelevize.cz", "/u1", "ČT24"),
  art("Ukrajina: boje u Kyjeva pokračují", "www.denik.cz", "/u2", "Deník"),
  art("Válka na Ukrajině, Kyjev pod palbou", "novinky.cz", "/u3", "Novinky"),
  art("Zelenskyj reaguje na útok u Kyjeva", "i.idnes.cz", "/u4", "iDNES"),
  art("NATO komentuje situaci u Kyjeva", "reuters.com", "/u5", "Reuters"),
  art("Další zpráva z Kyjeva od zvláštního vyslance", "ft.com", "/u6", "FT"),
  art("Kyjev — přehled noci", "bbc.com", "/u7", "BBC"),
];

const other = art("Kompletně jiné téma: ceny benzínu v Česku", "www.denik.cz", "/e1", "Deník", "finance");
const d = dedupeCanonicalUrl(dupStory.concat(other));
const cm = buildPublicationClusterUrlMap(d, {});
const sorted = [...d].sort((a, b) => String(a.title).localeCompare(String(b.title)));

const keys = pickPublicationKeptUrlKeys(sorted, cm);
const pickedDup = dupStory.filter((a) => keys.has(canonicalArticleUrlKey(a)));
if (pickedDup.length > 2) {
  console.error("FAIL expected at most 2 from duplicate story cluster, got", pickedDup.length);
  process.exit(1);
}
const srcs = pickedDup.map(publicationSourceKey);
if (new Set(srcs).size !== srcs.length) {
  console.error("FAIL duplicate source in picked", srcs);
  process.exit(1);
}
if (!keys.has(canonicalArticleUrlKey(other))) {
  console.error("FAIL unrelated finance article should survive");
  process.exit(1);
}
console.log("PASS publication dedupe unit", {
  dupClusterKept: pickedDup.length,
  sources: srcs,
  totalKept: keys.size,
});
