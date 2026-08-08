/**
 * Shared helpers for Přehled dne info-events connectors.
 * Only concrete item URLs are accepted (never source homepages / listing roots).
 */
import crypto from "crypto";

export const IU_INFO_EVENTS_UA = "InfoUzelInfoEvents/1.1 (+https://infouzel.cz)";

const LISTING_PATH_RE =
  /^\/(aktuality|novinky|tiskove-zpravy|tiskove_zpravy|press|rss|rss\.aspx|feed|zpravodajstvi|media-centrum|informacni-servis|cnb-news|pro-media)\/?$/i;

export function canonicalizeUrl(url) {
  const n = normalizeItemUrl(url);
  if (!n) return "";
  try {
    const u = new URL(n);
    u.hash = "";
    u.hostname = u.hostname.replace(/^www\./, "").toLowerCase();
    let path = u.pathname || "/";
    if (path.length > 1) path = path.replace(/\/+$/, "");
    u.pathname = path || "/";
    return u.toString();
  } catch {
    return n;
  }
}

export function stripHtml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try {
        return String.fromCodePoint(parseInt(h, 16));
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return "";
      }
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeXmlEntities(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function normalizeItemUrl(raw, baseUrl) {
  if (!raw) return "";
  let u = decodeXmlEntities(String(raw).trim());
  if (!u) return "";
  try {
    const abs = new URL(u, baseUrl || undefined);
    if (abs.protocol === "http:") abs.protocol = "https:";
    abs.hash = "";
    // Drop common tracking params
    ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"].forEach((k) =>
      abs.searchParams.delete(k)
    );
    return abs.toString();
  } catch {
    return "";
  }
}

export function isConcreteItemUrl(url, sourceHomeUrl) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    // Malformed / truncated hrefs from broken CMS markup
    if (/https?&/i.test(url) || /%20https/i.test(url)) return false;
    const path = (u.pathname || "/").replace(/\/+$/, "") || "/";
    if (path === "/") return false;
    if (LISTING_PATH_RE.test(path)) return false;
    if (sourceHomeUrl) {
      try {
        const home = new URL(sourceHomeUrl);
        const homePath = (home.pathname || "/").replace(/\/+$/, "") || "/";
        if (u.hostname.replace(/^www\./, "") === home.hostname.replace(/^www\./, "") && path === homePath) {
          return false;
        }
      } catch {
        /* ignore */
      }
    }
    if (path.split("/").filter(Boolean).length < 1) return false;
    return true;
  } catch {
    return false;
  }
}

export function extractFeedItems(xml) {
  const items = [];
  const blocks = String(xml || "").split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const chunk = block.split(/<\/item>/i)[0] || block;
    const title = stripHtml((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link =
      decodeXmlEntities((chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "").trim() ||
      decodeXmlEntities((chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || "").trim() ||
      decodeXmlEntities((chunk.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || "").trim();
    const pubDate = ((chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || "").trim();
    const dcDate = ((chunk.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i) || [])[1] || "").trim();
    const published = ((chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1] || "").trim();
    const pub = pubDate || dcDate || published;
    let timeSourceHint = "";
    if (pubDate) timeSourceHint = "rss_pub_date";
    else if (dcDate) timeSourceHint = "rss_dc_date";
    else if (published) timeSourceHint = "rss_published";
    items.push({ title, link, pubDate: pub, timeSourceHint, feedFormat: "rss" });
  }
  if (items.length === 0) {
    const entries = String(xml || "").split(/<entry[\s>]/i).slice(1);
    for (const block of entries) {
      const chunk = block.split(/<\/entry>/i)[0] || block;
      const title = stripHtml((chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
      const link = decodeXmlEntities((chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || "").trim();
      const published = ((chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1] || "").trim();
      const updated = ((chunk.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1] || "").trim();
      const pub = published || updated;
      const timeSourceHint = published ? "atom_published" : updated ? "atom_updated" : "";
      items.push({ title, link, pubDate: pub, timeSourceHint, feedFormat: "atom" });
    }
  }
  return items;
}

export function looksLikeFeedXml(text) {
  if (!text) return false;
  const s = text.trim().replace(/^\uFEFF/, "");
  const low = s.slice(0, 240).toLowerCase();
  return low.startsWith("<?xml") || low.startsWith("<rss") || low.startsWith("<feed") || low.startsWith("<rdf:");
}

export function foldCs(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeGroupKey(title, publishedAt) {
  const day = String(publishedAt || "").slice(0, 10) || "unknown";
  const words = foldCs(title).split(" ").filter(Boolean).slice(0, 8).join("-");
  const base = words || "item";
  return `${day}:${base}`;
}

export function makeItemId(sourceId, url, publishedAt) {
  const h = crypto.createHash("sha1").update(`${sourceId}|${url}|${publishedAt || ""}`).digest("hex").slice(0, 12);
  return `ie-${sourceId}-${h}`;
}

/**
 * Parse Czech / ISO dates into ISO string. Returns "" if invalid / unreasonable.
 * Prefers DD.MM.YYYY[+time], then ISO/RFC.
 */
export function parsePublishDateToIso(raw, opts = {}) {
  const nowMs = Number(opts.nowMs) || Date.now();
  const s = String(raw || "").trim();
  if (!s) return "";
  let ms = 0;
  const cz = s.match(
    /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:\s+[–-]?\s*|\s+|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  const czDateOnly = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\b/);
  if (cz) {
    ms = Date.UTC(Number(cz[3]), Number(cz[2]) - 1, Number(cz[1]), Number(cz[4]), Number(cz[5]), Number(cz[6] || 0));
    // Interpret as Europe/Prague roughly: store as local-wall → ISO via Date with local components
    ms = new Date(Number(cz[3]), Number(cz[2]) - 1, Number(cz[1]), Number(cz[4]), Number(cz[5]), Number(cz[6] || 0)).getTime();
  } else if (czDateOnly) {
    ms = new Date(Number(czDateOnly[3]), Number(czDateOnly[2]) - 1, Number(czDateOnly[1]), 12, 0, 0).getTime();
  } else {
    ms = Date.parse(s);
  }
  if (!Number.isFinite(ms) || ms <= 0) return "";
  // Reject absurd future (> 48h) and ancient past (> 10y)
  if (ms > nowMs + 48 * 3600000) return "";
  if (ms < nowMs - 10 * 365 * 24 * 3600000) return "";
  return new Date(ms).toISOString();
}

/** Extract leading DD.MM.YYYY from titles (e.g. Správa železnic listings). */
export function extractTitleLeadingDate(title) {
  const m = String(title || "").match(/^(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\b/);
  return m ? m[1] : "";
}

export function mapGroupToSection(group) {
  const g = String(group || "");
  if (g === "policie" || g === "hzs" || g === "kyber") return { sectionId: "bezpecnost", subsectionId: g === "hzs" ? "hasici" : g === "kyber" ? "varovani" : "policie" };
  if (g === "pocasi" || g === "chmi") return { sectionId: "pocasi", subsectionId: "vystrahy" };
  if (g === "doprava") return { sectionId: "doprava", subsectionId: "silnice" };
  if (g === "zdravotnictvi" || g === "hygiena") return { sectionId: "zdravi", subsectionId: "mzcr" };
  if (g === "ministerstva" || g === "verejna-sprava" || g === "stat") return { sectionId: "stat", subsectionId: "urady" };
  if (g === "veda" || g === "skoly") return { sectionId: "veda", subsectionId: "avcr" };
  if (g === "kultura") return { sectionId: "kultura", subsectionId: "mkcr" };
  if (g === "sport") return { sectionId: "sport", subsectionId: "msmt-sport" };
  if (g === "verejnopravni-media") return { sectionId: "cesko-svet", subsectionId: "ekonomika-cr" };
  return { sectionId: "cesko-svet", subsectionId: "ekonomika-cr" };
}

export async function fetchText(url, timeoutMs = 15000, retries = 2) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": IU_INFO_EVENTS_UA,
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        text,
        finalUrl: res.url || url,
        ms: Date.now() - t0,
        attempts: attempt + 1,
      };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  throw lastErr || new Error("fetch failed");
}

const HTML_NAV_TITLE_RE =
  /^(přejít|prejit|skoč|skoc|menu|přihlásit|prihlasit|odhlásit|odhlasit|hledat|search|cookie|přijmout|prijmout|odmítnout|odmitnout|více|vice|zpět|zpet|domů|domu|mapa webu|rss|english|deutsch|facebook|twitter|instagram|linkedin|youtube|členové|clenove|ministerstvo|základní|zakladni|organizační|organizacni|kontakt|úvod|uvod)\b/i;

const HTML_ARTICLE_PATH_RE =
  /(\d{5,})|\/(-\/)|\/(clanek|aktualit|aktualita|novinka|tiskov|press|zprava|zpravy|news|mediaservice|detail|dokument)|\.aspx(?:\?|$)|\/\d{4}\/\d{2}\/|\.xml$/i;

const HTML_REJECT_PATH_RE =
  /\/(login|auth|c\/portal|o-serveru|ochrana-osobnich|cookies?|mapa-webu|sitemap|rss\.aspx|feed)(\/|$)/i;

/** Extract article-like anchors from an HTML listing page (official press lists). */
export function extractHtmlListItems(html, pageUrl, opts = {}) {
  const max = Number(opts.max || 40);
  const pathInclude = opts.pathInclude ? new RegExp(opts.pathInclude, "i") : null;
  const hrefRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = hrefRe.exec(String(html || ""))) && out.length < max * 4) {
    const href = normalizeItemUrl(m[1], pageUrl);
    let title = stripHtml(m[2]).replace(/\s+/g, " ").trim();
    if (!href || !title || title.length < 28) continue;
    if (HTML_NAV_TITLE_RE.test(title)) continue;
    if (!isConcreteItemUrl(href, opts.homeUrl)) continue;
    try {
      const u = new URL(href);
      const path = u.pathname || "/";
      if (HTML_REJECT_PATH_RE.test(path)) continue;
      if (pathInclude) {
        if (!pathInclude.test(path + u.search)) continue;
      } else if (!HTML_ARTICLE_PATH_RE.test(path + u.search)) {
        continue;
      }
      const hu = opts.homeUrl ? new URL(opts.homeUrl).hostname.replace(/^www\./, "") : "";
      const iu = u.hostname.replace(/^www\./, "");
      if (hu && iu !== hu && !iu.endsWith("." + hu) && !hu.endsWith("." + iu)) continue;
      const listPath = new URL(pageUrl).pathname.replace(/\/+$/, "") || "/";
      const itemPath = path.replace(/\/+$/, "") || "/";
      if (itemPath === listPath) continue;
    } catch {
      continue;
    }
    const key = href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const titleDate = extractTitleLeadingDate(title);
    const pubDate = titleDate ? parsePublishDateToIso(titleDate) : "";
    out.push({
      title,
      link: href,
      pubDate: pubDate || "",
      timeSourceHint: pubDate ? "title_date" : "",
    });
  }
  return out.slice(0, max);
}

/** List CAP XML files from CHMI opendata directory index (with mtime when present). */
export function listCapXmlFromIndex(html, indexUrl) {
  const months = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  function parseApacheDate(s) {
    // 01-Jul-2026 08:43
    const m = String(s || "").match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2})$/);
    if (!m) return 0;
    const mon = months[m[2]];
    if (mon == null) return 0;
    return Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]), Number(m[5]));
  }
  const out = [];
  const re =
    /<a\s+href=["']([^"']+\.xml)["'][^>]*>[^<]*<\/a>\s*(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2})?/gi;
  let m;
  while ((m = re.exec(String(html || "")))) {
    const abs = normalizeItemUrl(m[1], indexUrl);
    if (!abs || !/\.xml$/i.test(abs)) continue;
    out.push({ url: abs, mtime: m[2] ? parseApacheDate(m[2]) : 0 });
  }
  if (!out.length) {
    const re2 = /href=["']([^"']+\.xml)["']/gi;
    while ((m = re2.exec(String(html || "")))) {
      const abs = normalizeItemUrl(m[1], indexUrl);
      if (abs && /\.xml$/i.test(abs)) out.push({ url: abs, mtime: 0 });
    }
  }
  out.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return out;
}

/**
 * Parse one CAP bulletin into feed-ready raw items.
 * Uses the CAP XML file URL as concrete original document (not portal homepage).
 */
export function extractCapBulletinItems(xml, fileUrl, opts = {}) {
  const max = Number(opts.max || 8);
  const sent = ((String(xml || "").match(/<sent>([^<]+)<\/sent>/i) || [])[1] || "").trim();
  const identifier = ((String(xml || "").match(/<identifier>([^<]+)<\/identifier>/i) || [])[1] || "").trim();
  const infos = String(xml || "").split(/<info[\s>]/i).slice(1);
  const seen = new Set();
  const out = [];
  for (const block of infos) {
    if (out.length >= max) break;
    const chunk = block.split(/<\/info>/i)[0] || "";
    const lang = ((chunk.match(/<language>([^<]*)<\/language>/i) || [])[1] || "").trim().toLowerCase();
    if (lang && !lang.startsWith("cs") && !lang.startsWith("cz")) continue;
    const event = stripHtml((chunk.match(/<event>([^<]*)<\/event>/i) || [])[1] || "");
    const severity = ((chunk.match(/<severity>([^<]*)<\/severity>/i) || [])[1] || "").trim();
    const area = stripHtml((chunk.match(/<areaDesc>([^<]*)<\/areaDesc>/i) || [])[1] || "");
    if (!event) continue;
    if (/^žádn|^no warning|^no outlook|^minor (heat|cold) warning/i.test(event)) continue;
    if (/^None$/i.test(severity)) continue;
    if (!/Extreme|Severe|Moderate/i.test(severity)) continue;
    const onset = ((chunk.match(/<onset>([^<]+)<\/onset>/i) || [])[1] || "").trim();
    const expires = ((chunk.match(/<expires>([^<]+)<\/expires>/i) || [])[1] || "").trim();
    const areaShort = area.split("(")[0].trim() || area;
    const key = foldCs(event + "|" + areaShort + "|" + severity);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = `Výstraha ČHMÚ: ${event}${areaShort ? " — " + areaShort : ""}`;
    // Concrete official CAP document URL (unique per event via query, same resource)
    const link = normalizeItemUrl(fileUrl) + (identifier ? `?id=${encodeURIComponent(identifier.slice(-24))}&e=${encodeURIComponent(foldCs(event).slice(0, 40))}` : "");
    out.push({
      title,
      link,
      pubDate: sent,
      severity,
      area: areaShort,
      identifier,
      validFrom: onset || sent,
      validTo: expires || "",
      lifecycleHint: "warning",
    });
  }
  // Fallback: one bulletin item if no active severe events
  if (!out.length && fileUrl) {
    out.push({
      title: `Bulletin výstrah ČHMÚ (CAP)${sent ? " — " + sent.slice(0, 16).replace("T", " ") : ""}`,
      link: normalizeItemUrl(fileUrl),
      pubDate: sent,
      severity: "Unknown",
      area: "Česká republika",
      identifier,
    });
  }
  return out;
}

export function dedupeByUrlAndGroup(items) {
  // Exact technical duplicate = same canonical URL. Keep newest update; preserve
  // sourcePublications from all sources that shared the URL (rare cross-feed).
  const byUrl = new Map();
  for (const it of items) {
    const u = canonicalizeUrl(it.canonicalUrl || it.url || "").toLowerCase() || String(it.url || "").toLowerCase();
    if (!u) continue;
    const prev = byUrl.get(u);
    if (!prev) {
      byUrl.set(u, Object.assign({}, it, {
        sourcePublications: [
          {
            sourceId: it.sourceId,
            sourceLabel: it.sourceLabel,
            sourceGroup: it.sourceGroup || it.group || "",
            url: it.url,
            publishedAtSource: it.publishedAtSource || null,
            lane: it.lane || null,
            sectionId: it.sectionId || null,
          },
        ],
      }));
      continue;
    }
    const pubs = Array.isArray(prev.sourcePublications) ? prev.sourcePublications.slice() : [];
    const sid = String(it.sourceId || "");
    if (sid && !pubs.some((p) => String(p.sourceId) === sid)) {
      pubs.push({
        sourceId: it.sourceId,
        sourceLabel: it.sourceLabel,
        sourceGroup: it.sourceGroup || it.group || "",
        url: it.url,
        publishedAtSource: it.publishedAtSource || null,
        lane: it.lane || null,
        sectionId: it.sectionId || null,
      });
    }
    const pt = Date.parse(prev.updatedAt || prev.publishedAt || 0) || 0;
    const et = Date.parse(it.updatedAt || it.publishedAt || 0) || 0;
    const winner = et >= pt ? it : prev;
    byUrl.set(
      u,
      Object.assign({}, winner, {
        sourcePublications: pubs,
        region: mergeRegions(prev.region, it.region),
        sectionIds: uniqueStrings([prev.sectionId, it.sectionId].concat(prev.sectionIds || []).concat(it.sectionIds || [])),
      })
    );
  }
  return Array.from(byUrl.values());
}

function uniqueStrings(arr) {
  return Array.from(new Set((arr || []).map(String).filter(Boolean)));
}

function mergeRegions(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const rank = (r) => {
    const lv = String((r && r.level) || "cr");
    if (lv === "obec" || lv === "mesto") return 0;
    if (lv === "okres") return 1;
    if (lv === "kraj") return 2;
    return 3;
  };
  return rank(b) < rank(a) ? b : a;
}
