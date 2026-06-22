/**
 * Feed photo selection engine (phase 2A) — illustrative galleries only.
 * Article → section/supplemental routing → gallery → photo (usage rotation).
 * FEED_RENDER_ENABLED=false: engine only, no feed UI wiring.
 */
import { IU_IMAGE_GUESSING_ALLOWED, IU_IMAGE_MODE_ILLUSTRATIVE } from "./iu-photo-article-safety.js";
import { IU_INTERNAL_GALLERY_PROVIDER } from "./iu-internal-image-gallery.js";

export const IU_FEED_PHOTO_LABEL = "Ilustrační foto";
export const IU_FEED_RENDER_ENABLED = false;
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
  { galleryId: "technologie", keywords: ["technologie", "technolog", "digitalni", "software", "hardware", " umele", " ai"] },
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

const IMPORT_MANIFESTS = Object.freeze([
  { key: "pilot", rel: "imported/pilot/manifest.json" },
  { key: "batch-1", rel: "imported/batch-1/manifest.json" },
  { key: "batch-2", rel: "imported/batch-2/manifest.json" },
]);

export function iuFeedPhotoNormalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

export function iuFeedPhotoDetectSupplementalGallery(article) {
  const hay = iuFeedPhotoArticleHaystack(article);
  if (!hay) return null;
  for (const rule of IU_FEED_SUPPLEMENTAL_KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      const needle = iuFeedPhotoNormalizeText(kw);
      if (needle && hay.includes(needle)) return rule.galleryId;
    }
  }
  return null;
}

/**
 * Resolve target gallery: supplemental keyword → section gallery → general_fallback.
 */
export function iuFeedPhotoResolveTargetGallery(article) {
  const supplemental = iuFeedPhotoDetectSupplementalGallery(article);
  if (supplemental) {
    return { galleryId: supplemental, routingType: "supplemental", reason: "supplemental_keyword_match" };
  }
  const sectionGallery = iuFeedPhotoResolveSectionGallery(article);
  if (sectionGallery && IU_FEED_SECTION_GALLERY_IDS.includes(sectionGallery)) {
    return { galleryId: sectionGallery, routingType: "section", reason: "section_primary_gallery" };
  }
  return {
    galleryId: IU_FEED_GENERAL_FALLBACK_GALLERY_ID,
    routingType: "general_fallback",
    reason: "section_unknown_or_missing",
  };
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

export function iuFeedPhotoPickFromPool(pool, galleryId) {
  const candidates = (pool || []).filter(
    (entry) => entry.galleryId === galleryId && iuFeedPhotoIsIllustrativeImportEntry(entry)
  );
  if (!candidates.length) return null;
  const sorted = candidates.slice().sort(iuFeedPhotoCompareRotation);
  return sorted[0];
}

export function iuFeedPhotoSelectWithFallback(article, pool) {
  const routing = iuFeedPhotoResolveTargetGallery(article);
  const tryOrder = [routing.galleryId];
  if (routing.routingType !== "general_fallback") {
    tryOrder.push(IU_FEED_GENERAL_FALLBACK_GALLERY_ID);
  }
  let entry = null;
  let usedGalleryId = routing.galleryId;
  for (const gid of tryOrder) {
    entry = iuFeedPhotoPickFromPool(pool, gid);
    if (entry) {
      usedGalleryId = gid;
      break;
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
  return {
    ok: true,
    feedLabel: IU_FEED_PHOTO_LABEL,
    feedRenderEnabled: IU_FEED_RENDER_ENABLED,
    routingType: fallbackUsed ? "general_fallback" : routing.routingType,
    galleryId: usedGalleryId,
    requestedGalleryId: routing.galleryId,
    reason: fallbackUsed ? "gallery_empty_used_general_fallback" : routing.reason,
    autoGuessCount: 0,
    verifiedPersonSelectionEnabled: false,
    verifiedPlaceSelectionEnabled: false,
    photo: iuFeedPhotoEntryToPayload(entry, usedGalleryId),
  };
}

export function iuFeedPhotoEntryToPayload(entry, galleryId) {
  return {
    id: entry.id,
    galleryId: galleryId || entry.galleryId,
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
    imageSelectionSource: "feed_photo_engine",
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
  const result = iuFeedPhotoSelectWithFallback(article, pool);
  if (options.recordUsage && result.ok && result.photo?.id) {
    const entry = pool.find((e) => e.id === result.photo.id);
    if (entry) {
      iuFeedPhotoRecordUsage(entry, options.nowIso);
      result.photo = iuFeedPhotoEntryToPayload(entry, result.galleryId);
    }
  }
  return result;
}
