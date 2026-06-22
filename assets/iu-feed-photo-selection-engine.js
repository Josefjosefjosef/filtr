/**
 * Feed photo selection engine — illustrative galleries only.
 * Phase 2D: title topic matching → supplemental → section → general_fallback (last).
 * FEED_RENDER_ENABLED=false (timeline V1): middle feed photos off; engine files kept for later cleanup.
 */
import { IU_IMAGE_GUESSING_ALLOWED, IU_IMAGE_MODE_ILLUSTRATIVE } from "./iu-photo-article-safety.js";
import { IU_INTERNAL_GALLERY_PROVIDER } from "./iu-internal-image-gallery.js";

export const IU_FEED_PHOTO_LABEL = "Ilustrační foto";
export const IU_FEED_RENDER_ENABLED = false;
export const IU_FEED_PHOTO_MAX_WIDTH_PERCENT = 33;
export const IU_FEED_PHOTO_TEXT_MIN_PERCENT = 67;
export const IU_FEED_PHOTO_SELECTION_SOURCE = "feed_photo_engine";
export const IU_FEED_PHOTO_CONFIG_FILE = "image_gallery/feed_photo_engine_config.json";
export const IU_FEED_PHOTO_ENGINE_VERSION = 1;

export const IU_FEED_SECTION_GALLERY_IDS = [
  "zpravy",
  "sport",
  "finance",
  "zdravi",
  "cestovani",
  "hry",
  "kultura-akce",
  "veda-historie",
  "vzdelavani",
  "prehled-dne",
];

export const IU_FEED_SUPPLEMENTAL_GALLERY_IDS = [
  "doprava",
  "priroda",
  "pocasi",
  "politika",
  "ekonomika",
  "technologie",
  "bezpecnost",
  "kriminalita",
  "energetika",
  "prumysl",
  "bydleni",
  "zemedelstvi",
];

export const IU_FEED_GENERAL_FALLBACK_GALLERY_ID = "general_fallback";

/** Feed topic / section slug → primary illustrative gallery. */
export const IU_FEED_SECTION_TO_GALLERY = Object.freeze({
  zpravy: "zpravy",
  aktualne: "zpravy",
  feed: "zpravy",
  sport: "sport",
  finance: "finance",
  zdravi: "zdravi",
  cestovani: "cestovani",
  hry: "hry",
  kultura: "kultura-akce",
  "kultura-akce": "kultura-akce",
  veda: "veda-historie",
  "veda-historie": "veda-historie",
  vzdelavani: "vzdelavani",
  "prehled-dne": "prehled-dne",
  prehled_dne: "prehled-dne",
});

/** Supplemental galleries — matched by keyword in title/description (no entity guessing). */
export const IU_FEED_SUPPLEMENTAL_KEYWORD_RULES = Object.freeze([
  { galleryId: "doprava", keywords: ["doprava", "dopravni", "dalnic", "autobus", "vlak", "metro", "letiste"] },
  { galleryId: "pocasi", keywords: ["pocasi", "boure", "dest", "snih", "predpoved", "vikendova predpoved"] },
  { galleryId: "technologie", keywords: ["technologie", "technolog", "digitalni", "software", "hardware", "umela inteligence", " umele", " ai"] },
  { galleryId: "ekonomika", keywords: ["ekonomika", "ekonomick", "inflace", "hdp", "trh prace"] },
  { galleryId: "energetika", keywords: ["energetika", "energie", "elektrarn", "solarni", "vetrna", "plyn"] },
  { galleryId: "bezpecnost", keywords: ["bezpecnost", "bezpecnostni", "hasici", "zachran"] },
  { galleryId: "kriminalita", keywords: ["kriminalita", "kriminal", "zlocin", "policie", "soud"] },
  { galleryId: "zemedelstvi", keywords: ["zemedelstvi", "zemedelsk", "farma", "sklizen", "chov"] },
  { galleryId: "prumysl", keywords: ["prumysl", "prumyslov", "tovarna", "vyroba", "fabrika"] },
  { galleryId: "bydleni", keywords: ["bydleni", "hypoteka", "nemovitost", "najem", "reality"] },
  { galleryId: "priroda", keywords: ["priroda", "prirodn", "les", "fauna", "flora"] },
  { galleryId: "politika", keywords: ["politika", "politick", "parlament", "vlada", "volby"] },
]);

/**
 * Title-first topic rules (phase 2D) — ordered; first match drives gallery try-order.
 * No verified-person / entity face matching — illustrative alt-text scoring only.
 */
export const IU_FEED_TITLE_TOPIC_RULES = Object.freeze([
  {
    topicId: "football",
    galleryIds: ["sport"],
    keywords: [
      "fotbal",
      "fotbalovy",
      "fotbalove",
      "gol",
      "fifa",
      "slavia",
      "sparta",
      "messi",
      "ronaldo",
      "trener",
      "prestup",
      " hrac",
      "zapas",
      "mbappe",
      "demichelis",
      "ligovy klub",
      "ligove",
      "mistrovstvi",
      "champions league",
      "premier league",
      "penalt",
      "kopan",
      "lipsko",
    ],
    positiveAltKeywords: ["football", "soccer", "stadium", "goal", "pitch", "match", "team", "ball"],
    negativeAltKeywords: ["marathon", "runner", "jogging", "running event", "track and field", "sprinter"],
  },
  {
    topicId: "politics",
    galleryIds: ["politika", "zpravy"],
    keywords: [
      "trump",
      "vlada",
      "prezident",
      "ministr",
      "poslanc",
      "ustava",
      "ankara",
      "washington",
      "babis",
      "pavel",
      "havlicek",
      "magyar",
      "parlament",
      "volby",
      "senat",
      "premier",
      "rezident",
      "bily dum",
      "kongres",
      "diplomat",
    ],
    positiveAltKeywords: ["parliament", "government", "politic", "capitol", "flag", "democracy", "congress", "minister"],
    negativeAltKeywords: ["newspaper", "reading a newspaper", "reading news", "magazine"],
  },
  {
    topicId: "crime",
    galleryIds: ["kriminalita", "bezpecnost"],
    keywords: [
      "soud",
      "trest",
      "vrah",
      "mafie",
      "policie",
      "utok",
      "odriz",
      "masakr",
      "zakaz",
      "vysetrov",
      "ocistec",
      "zlozin",
      "krimi",
      "lupic",
      "vez",
    ],
    positiveAltKeywords: ["police", "court", "crime", "handcuff", "prison", "security", "law"],
    negativeAltKeywords: ["newspaper", "reading a newspaper"],
  },
  {
    topicId: "technology",
    galleryIds: ["technologie", "bezpecnost", "doprava"],
    keywords: [
      "umela inteligence",
      " umele",
      " ai",
      "robot",
      "software",
      "integr",
      "technolog",
      "digital",
      "chip",
      "obrnen",
      "vozidlo",
      "drone",
      "kyber",
      "autonom",
    ],
    positiveAltKeywords: ["technology", "computer", "robot", "digital", "software", "vehicle", "military", "tech", "armored"],
    negativeAltKeywords: ["newspaper", "reading a newspaper"],
  },
  {
    topicId: "transport",
    galleryIds: ["doprava"],
    keywords: [
      "auto",
      "ridic",
      "motocykl",
      "silnice",
      "nehoda",
      "promile",
      "letadlo",
      "aerolink",
      "dalnic",
      "autobus",
      "vlak",
      "metro",
      "doprav",
    ],
    positiveAltKeywords: ["car", "road", "traffic", "vehicle", "airplane", "highway", "transport"],
    negativeAltKeywords: ["newspaper", "reading a newspaper"],
  },
  {
    topicId: "media",
    galleryIds: ["kultura-akce", "technologie", "zpravy"],
    keywords: ["televiz", "rozhlas", "vysilani", " c t", " ctv", " c ro", " c ro ", "medi", "novinar"],
    positiveAltKeywords: ["broadcast", "television", "radio", "studio", "microphone", "media", "camera"],
    negativeAltKeywords: ["newspaper", "reading a newspaper"],
  },
]);

export const IU_FEED_GENERIC_NEWS_ALT_MARKERS = Object.freeze([
  "newspaper",
  "reading a newspaper",
  "reading news",
  "couple sitting indoors reading",
]);

const IMPORT_MANIFESTS = Object.freeze([
  { key: "pilot", rel: "imported/pilot/manifest.json" },
  { key: "batch-1", rel: "imported/batch-1/manifest.json" },
  { key: "batch-2", rel: "imported/batch-2/manifest.json" },
]);

const IMPORT_MANIFESTS_BROWSER = Object.freeze([
  { key: "pilot", file: "image_gallery/imported/pilot/manifest.json" },
  { key: "batch-1", file: "image_gallery/imported/batch-1/manifest.json" },
  { key: "batch-2", file: "image_gallery/imported/batch-2/manifest.json" },
]);

export function iuFeedPhotoPublicMediaUrl(localPath, importSource, projectsBase) {
  const base = String(projectsBase || "/projects/").replace(/\/?$/, "/");
  const relPath = String(localPath || "").replace(/^\/+/, "");
  const rel = `data/image_gallery/imported/${importSource}/${relPath}`;
  const pathOnly = base + rel;
  try {
    if (typeof location !== "undefined" && location.origin) {
      return String(location.origin).replace(/\/$/, "") + pathOnly;
    }
  } catch (_) {}
  return pathOnly;
}

export function iuFeedPhotoRenderGuardAllowsArticleImage(fields) {
  if (!fields || typeof fields !== "object") return false;
  if (fields.imageProvider !== IU_INTERNAL_GALLERY_PROVIDER) return false;
  if (fields.imageSelectionSource !== IU_FEED_PHOTO_SELECTION_SOURCE) return false;
  if (fields.imageMode !== IU_IMAGE_MODE_ILLUSTRATIVE) return false;
  if (fields.imageIllustrativeVerified !== true) return false;
  const thumb = String(fields.imageThumbUrl || fields.imageUrl || "").trim();
  if (!thumb || !/^https?:\/\//i.test(thumb)) return false;
  if (/api\.pexels\.com|images\.pexels\.com/i.test(thumb)) return false;
  if (!/\.webp(\?|$)/i.test(thumb)) return false;
  return true;
}

export function iuFeedPhotoArticleImageFromSelection(photo, importSource, projectsBase) {
  if (!photo || !importSource) return null;
  const thumbPath = photo.localThumbPath || photo.localImagePath;
  if (!thumbPath) return null;
  const thumbUrl = iuFeedPhotoPublicMediaUrl(thumbPath, importSource, projectsBase);
  const fields = {
    imageProvider: IU_INTERNAL_GALLERY_PROVIDER,
    imageThumbUrl: thumbUrl,
    imageUrl: thumbUrl,
    imageAlt: String(photo.imageAlt || IU_FEED_PHOTO_LABEL).trim(),
    imageAuthor: String(photo.imageAuthor || "").trim(),
    imageAuthorUrl: String(photo.imageAuthorUrl || "").trim(),
    imageSourceUrl: String(photo.imageSourceUrl || "").trim(),
    imageLicenseSource: String(photo.imageLicenseSource || "Pexels License").trim(),
    imageMode: IU_IMAGE_MODE_ILLUSTRATIVE,
    imageIllustrativeVerified: true,
    imageIllustrativeScope: "generic",
    imageIllustrativeCategory: photo.imageIllustrativeCategory || photo.galleryId || "generic",
    imageSelectionSource: IU_FEED_PHOTO_SELECTION_SOURCE,
    imageGalleryEntryId: photo.id,
    imageFeedLabel: IU_FEED_PHOTO_LABEL,
  };
  return iuFeedPhotoRenderGuardAllowsArticleImage(fields) ? fields : null;
}

export async function iuFeedPhotoLoadCatalogBrowser(fetchJson, dataUrlFn) {
  const pool = [];
  const byGallery = {};
  for (const src of IMPORT_MANIFESTS_BROWSER) {
    let manifest;
    try {
      manifest = await fetchJson(dataUrlFn(src.file));
    } catch {
      continue;
    }
    for (const entry of manifest.entries || []) {
      if (!iuFeedPhotoIsIllustrativeImportEntry(entry)) continue;
      const row = { ...entry, _importSource: src.key };
      pool.push(row);
      if (!byGallery[row.galleryId]) byGallery[row.galleryId] = [];
      byGallery[row.galleryId].push(row);
    }
  }
  return { pool, byGallery, total: pool.length };
}

export function iuFeedPhotoApplySelectionToArticle(article, catalog, projectsBase, options = {}) {
  if (!IU_FEED_RENDER_ENABLED || !catalog?.pool?.length) return article;
  const result = iuFeedPhotoSelectForArticle(article, catalog, options);
  if (!result.ok || !result.photo) return article;
  const importSource = result.photo._importSource || result.photo.importSource || "batch-2";
  const fields = iuFeedPhotoArticleImageFromSelection(result.photo, importSource, projectsBase);
  if (!fields) return article;
  return { ...article, ...fields };
}

export function iuFeedPhotoNormalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function iuFeedPhotoHaystackIncludesKeyword(hay, keyword) {
  const needle = iuFeedPhotoNormalizeText(keyword);
  if (!needle || !hay) return false;
  if (needle.length <= 3) {
    const re = new RegExp(`(?:^|[\\s,.;:!?()\\[\\]"'/-])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[\\s,.;:!?()\\[\\]"'/-])`);
    return re.test(` ${hay} `);
  }
  return hay.includes(needle);
}

export function iuFeedPhotoArticleHaystack(article) {
  const parts = [
    article?.title,
    article?.description,
    article?.summary,
    article?.perex,
    article?.subtitle,
  ];
  return iuFeedPhotoNormalizeText(parts.filter(Boolean).join(" "));
}

export function iuFeedPhotoResolveSectionSlug(article) {
  const raw = String(
    article?.section ||
      article?.topic ||
      article?.category ||
      article?.iuFeedClassification?.sectionPrimary ||
      ""
  )
    .trim()
    .toLowerCase();
  return raw || "zpravy";
}

export function iuFeedPhotoResolveSectionGallery(article) {
  const slug = iuFeedPhotoResolveSectionSlug(article);
  return IU_FEED_SECTION_TO_GALLERY[slug] || null;
}

export function iuFeedPhotoDetectTitleTopicRule(article) {
  const hay = iuFeedPhotoArticleHaystack(article);
  if (!hay) return null;
  for (const rule of IU_FEED_TITLE_TOPIC_RULES) {
    for (const kw of rule.keywords) {
      if (iuFeedPhotoHaystackIncludesKeyword(hay, kw)) return rule;
    }
  }
  return null;
}

export function iuFeedPhotoDetectSupplementalGallery(article) {
  const hay = iuFeedPhotoArticleHaystack(article);
  if (!hay) return null;
  for (const rule of IU_FEED_SUPPLEMENTAL_KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (iuFeedPhotoHaystackIncludesKeyword(hay, kw)) return rule.galleryId;
    }
  }
  return null;
}

/**
 * Resolve target gallery: title topic → supplemental keyword → section → general_fallback.
 */
export function iuFeedPhotoResolveTargetGallery(article) {
  const titleTopic = iuFeedPhotoDetectTitleTopicRule(article);
  if (titleTopic) {
    return {
      galleryId: titleTopic.galleryIds[0],
      galleryIds: titleTopic.galleryIds.slice(),
      routingType: "title_topic",
      reason: `title_topic_${titleTopic.topicId}`,
      topicRule: titleTopic,
    };
  }
  const supplemental = iuFeedPhotoDetectSupplementalGallery(article);
  if (supplemental) {
    return {
      galleryId: supplemental,
      galleryIds: [supplemental],
      routingType: "supplemental",
      reason: "supplemental_keyword_match",
      topicRule: null,
    };
  }
  const sectionGallery = iuFeedPhotoResolveSectionGallery(article);
  if (sectionGallery && IU_FEED_SECTION_GALLERY_IDS.includes(sectionGallery)) {
    return {
      galleryId: sectionGallery,
      galleryIds: [sectionGallery],
      routingType: "section",
      reason: "section_primary_gallery",
      topicRule: null,
    };
  }
  return {
    galleryId: IU_FEED_GENERAL_FALLBACK_GALLERY_ID,
    galleryIds: [IU_FEED_GENERAL_FALLBACK_GALLERY_ID],
    routingType: "general_fallback",
    reason: "section_unknown_or_missing",
    topicRule: null,
  };
}

export function iuFeedPhotoBuildGalleryTryOrder(routing, article) {
  const order = [];
  const add = (gid) => {
    if (!gid || order.includes(gid)) return;
    order.push(gid);
  };
  for (const gid of routing.galleryIds || [routing.galleryId]) add(gid);
  const sectionGallery = iuFeedPhotoResolveSectionGallery(article);
  if (sectionGallery && routing.routingType !== "section") add(sectionGallery);
  add(IU_FEED_GENERAL_FALLBACK_GALLERY_ID);
  return order;
}

export function iuFeedPhotoAltIsGenericNews(altNorm) {
  if (!altNorm) return false;
  return IU_FEED_GENERIC_NEWS_ALT_MARKERS.some((m) => altNorm.includes(iuFeedPhotoNormalizeText(m)));
}

export function iuFeedPhotoHashTieBreak(article, entry) {
  const seed = String(article?.title || article?.id || "") + "|" + String(entry?.id || "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export function iuFeedPhotoScoreEntry(entry, article, topicRule, options = {}) {
  const hay = iuFeedPhotoArticleHaystack(article);
  const alt = iuFeedPhotoNormalizeText(entry?.imageAlt || "");
  let score = 0;

  const titleWords = hay.split(/\s+/).filter((w) => w.length >= 5);
  for (const w of titleWords) {
    if (alt.includes(w)) score += 2;
  }

  const rule = topicRule || iuFeedPhotoDetectTitleTopicRule(article);
  if (rule) {
    for (const kw of rule.positiveAltKeywords || []) {
      if (alt.includes(iuFeedPhotoNormalizeText(kw))) score += 10;
    }
    for (const kw of rule.negativeAltKeywords || []) {
      if (alt.includes(iuFeedPhotoNormalizeText(kw))) score -= 25;
    }
  }

  if (rule && iuFeedPhotoAltIsGenericNews(alt)) score -= 30;

  score -= (Number(entry?.usageCount) || 0) * 4;
  if (entry?.lastUsedAt) {
    const ageMs = Date.now() - Date.parse(entry.lastUsedAt);
    if (!Number.isNaN(ageMs) && ageMs < 6 * 3600000) score -= 12;
  }

  const recent = options.recentlyUsedIds;
  if (recent && typeof recent.has === "function" && recent.has(entry.id)) score -= 2000;

  return { score, tie: iuFeedPhotoHashTieBreak(article, entry) };
}

export function iuFeedPhotoIsIllustrativeImportEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.imageMode !== IU_IMAGE_MODE_ILLUSTRATIVE) return false;
  if (!entry.galleryId || typeof entry.galleryId !== "string") return false;
  if (entry.type === "verified_person" || entry.type === "verified_place_object") return false;
  if (entry.galleryId === "verified_persons" || entry.galleryId === "verified_places_objects") return false;
  return true;
}

export function iuFeedPhotoCompareRotation(a, b) {
  const usageA = Number(a?.usageCount) || 0;
  const usageB = Number(b?.usageCount) || 0;
  if (usageA !== usageB) return usageA - usageB;
  const lastA = a?.lastUsedAt ? Date.parse(a.lastUsedAt) : 0;
  const lastB = b?.lastUsedAt ? Date.parse(b.lastUsedAt) : 0;
  if (lastA !== lastB) return lastA - lastB;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

export function iuFeedPhotoPickFromPool(pool, galleryId, article, options = {}) {
  const candidates = (pool || []).filter(
    (entry) => entry.galleryId === galleryId && iuFeedPhotoIsIllustrativeImportEntry(entry)
  );
  if (!candidates.length) return null;

  const topicRule = options.topicRule || iuFeedPhotoDetectTitleTopicRule(article);
  const isGeneralFallback = galleryId === IU_FEED_GENERAL_FALLBACK_GALLERY_ID;
  const scored = candidates.map((entry) => ({
    entry,
    ...iuFeedPhotoScoreEntry(entry, article, topicRule, options),
  }));

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.tie - b.tie;
  });

  const best = scored[0];
  if (!best) return null;

  const minScore = isGeneralFallback ? -999 : topicRule ? 1 : 0;
  if (best.score < minScore) return null;

  if (topicRule && !isGeneralFallback && iuFeedPhotoAltIsGenericNews(iuFeedPhotoNormalizeText(best.entry.imageAlt || ""))) {
    const alt = scored.find((row) => !iuFeedPhotoAltIsGenericNews(iuFeedPhotoNormalizeText(row.entry.imageAlt || "")));
    if (alt && alt.score >= minScore) return alt.entry;
    if (!isGeneralFallback) return null;
  }

  return best.entry;
}

export function iuFeedPhotoSelectWithFallback(article, pool, options = {}) {
  const routing = iuFeedPhotoResolveTargetGallery(article);
  const tryOrder = iuFeedPhotoBuildGalleryTryOrder(routing, article);
  let entry = null;
  let usedGalleryId = routing.galleryId;
  let usedIndex = -1;

  for (let i = 0; i < tryOrder.length; i++) {
    const gid = tryOrder[i];
    const isGeneral = gid === IU_FEED_GENERAL_FALLBACK_GALLERY_ID;
    if (isGeneral && routing.routingType !== "general_fallback" && entry) break;
    const pick = iuFeedPhotoPickFromPool(pool, gid, article, {
      ...options,
      topicRule: routing.topicRule,
    });
    if (pick) {
      entry = pick;
      usedGalleryId = gid;
      usedIndex = i;
      if (!isGeneral) break;
    }
  }

  if (!entry) {
    return {
      ok: false,
      feedLabel: IU_FEED_PHOTO_LABEL,
      feedRenderEnabled: IU_FEED_RENDER_ENABLED,
      routingType: routing.routingType,
      galleryId: routing.galleryId,
      reason: "no_photo_in_gallery_pool",
      autoGuessCount: 0,
      verifiedPersonSelectionEnabled: false,
      verifiedPlaceSelectionEnabled: false,
      photo: null,
    };
  }

  const fallbackUsed =
    usedGalleryId === IU_FEED_GENERAL_FALLBACK_GALLERY_ID &&
    routing.galleryId !== IU_FEED_GENERAL_FALLBACK_GALLERY_ID;
  const sectionFallbackUsed =
    usedGalleryId === iuFeedPhotoResolveSectionGallery(article) &&
    routing.routingType !== "section" &&
    usedIndex > 0;

  return {
    ok: true,
    feedLabel: IU_FEED_PHOTO_LABEL,
    feedRenderEnabled: IU_FEED_RENDER_ENABLED,
    routingType: fallbackUsed ? "general_fallback" : routing.routingType,
    galleryId: usedGalleryId,
    requestedGalleryId: routing.galleryId,
    reason: fallbackUsed
      ? "gallery_empty_used_general_fallback"
      : sectionFallbackUsed
        ? "topic_empty_used_section_fallback"
        : routing.reason,
    autoGuessCount: 0,
    verifiedPersonSelectionEnabled: false,
    verifiedPlaceSelectionEnabled: false,
    photo: iuFeedPhotoEntryToPayload(entry, usedGalleryId, entry._importSource),
  };
}

export function iuFeedPhotoEntryToPayload(entry, galleryId, importSource) {
  return {
    id: entry.id,
    galleryId: galleryId || entry.galleryId,
    _importSource: importSource || entry._importSource || "",
    imageMode: IU_IMAGE_MODE_ILLUSTRATIVE,
    imageProvider: IU_INTERNAL_GALLERY_PROVIDER,
    imageAlt: entry.imageAlt,
    imageAuthor: entry.imageAuthor,
    imageAuthorUrl: entry.imageAuthorUrl,
    imageSourceUrl: entry.imageSourceUrl,
    imageLicenseSource: entry.imageLicenseSource || "Pexels License",
    localImagePath: entry.localImagePath,
    localThumbPath: entry.localThumbPath,
    usageCount: Number(entry.usageCount) || 0,
    lastUsedAt: entry.lastUsedAt ?? null,
    feedLabel: IU_FEED_PHOTO_LABEL,
    imageSelectionSource: IU_FEED_PHOTO_SELECTION_SOURCE,
    imageIllustrativeVerified: true,
    imageIllustrativeScope: "generic",
    imageIllustrativeCategory: galleryId || entry.galleryId,
  };
}

/** Record usage in-memory (publish pipeline persists later). */
export function iuFeedPhotoRecordUsage(entry, nowIso) {
  if (!entry) return entry;
  const next = { ...entry };
  next.usageCount = (Number(next.usageCount) || 0) + 1;
  next.lastUsedAt = nowIso || new Date().toISOString();
  return next;
}

export function iuFeedPhotoLoadImportCatalog(readFileSync, pathJoin, galleryRoot) {
  const pool = [];
  const byGallery = {};
  for (const src of IMPORT_MANIFESTS) {
    const manifestPath = pathJoin(galleryRoot, src.rel);
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    for (const entry of manifest.entries || []) {
      if (!iuFeedPhotoIsIllustrativeImportEntry(entry)) continue;
      const row = { ...entry, _importSource: src.key };
      pool.push(row);
      if (!byGallery[row.galleryId]) byGallery[row.galleryId] = [];
      byGallery[row.galleryId].push(row);
    }
  }
  return { pool, byGallery, total: pool.length };
}

export function iuFeedPhotoSelectForArticle(article, catalog, options = {}) {
  if (IU_IMAGE_GUESSING_ALLOWED) {
    return {
      ok: false,
      reason: "auto_guessing_disabled_required",
      autoGuessCount: 0,
      feedRenderEnabled: IU_FEED_RENDER_ENABLED,
    };
  }
  const pool = catalog?.pool || [];
  const result = iuFeedPhotoSelectWithFallback(article, pool, options);
  if (options.recordUsage && result.ok && result.photo?.id) {
    const entry = pool.find((e) => e.id === result.photo.id);
    if (entry) {
      iuFeedPhotoRecordUsage(entry, options.nowIso);
      result.photo = iuFeedPhotoEntryToPayload(entry, result.galleryId, entry._importSource);
    }
  }
  if (result.ok && result.photo?.id && options.recentlyUsedIds && typeof options.recentlyUsedIds.add === "function") {
    options.recentlyUsedIds.add(result.photo.id);
  }
  return result;
}
