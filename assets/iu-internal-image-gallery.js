/** Internal image gallery — VERIFIED_PERSONS, VERIFIED_PLACES_OBJECTS, ILLUSTRATIVE_GALLERY selection. */
import {
  IU_IMAGE_MODE_EXACT,
  IU_IMAGE_MODE_ILLUSTRATIVE,
  IU_IMAGE_MODE_NO_IMAGE,
} from "./iu-photo-article-safety.js";

export const IU_INTERNAL_GALLERY_LAYER_VERIFIED_PERSONS = "verified_persons";
export const IU_INTERNAL_GALLERY_LAYER_VERIFIED_PLACES = "verified_places_objects";
export const IU_INTERNAL_GALLERY_LAYER_ILLUSTRATIVE = "illustrative_gallery";
export const IU_INTERNAL_GALLERY_PROVIDER = "internal_gallery";

export const IU_INTERNAL_GALLERY_REQUIRED_FIELDS = [
  "id",
  "type",
  "category",
  "entityName",
  "entityAliases",
  "imageMode",
  "imageProvider",
  "imageThumbUrl",
  "imageUrl",
  "imageAlt",
  "imageAuthor",
  "imageAuthorUrl",
  "imageSourceUrl",
  "imageLicenseSource",
  "verifiedByHuman",
  "approved",
  "createdAt",
  "updatedAt",
  "usageCount",
  "lastUsedAt",
];

const FORBIDDEN_CAR_BRANDS = ["toyota", "bmw", "audi", "mercedes", "volkswagen", "ford", "honda"];

function iuGalleryTextNorm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function iuGalleryTitleNorm(title) {
  return iuGalleryTextNorm(title);
}

function iuGalleryEntityInTitle(titleNorm, entityName, aliases) {
  const names = [entityName, ...(Array.isArray(aliases) ? aliases : [])]
    .map((n) => iuGalleryTextNorm(n))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (name && titleNorm.includes(name)) return true;
  }
  return false;
}

function iuGalleryEntryApproved(entry) {
  return (
    entry &&
    entry.approved === true &&
    entry.verifiedByHuman === true &&
    String(entry.imageProvider || "").trim().toLowerCase() === IU_INTERNAL_GALLERY_PROVIDER
  );
}

export function iuInternalGalleryValidateEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  for (const field of IU_INTERNAL_GALLERY_REQUIRED_FIELDS) {
    if (!(field in entry)) return false;
  }
  return iuGalleryEntryApproved(entry);
}

export function iuInternalGalleryFindVerifiedPerson(title, persons) {
  const titleNorm = iuGalleryTitleNorm(title);
  const entries = Array.isArray(persons?.entries) ? persons.entries : [];
  for (const entry of entries) {
    if (!iuGalleryEntryApproved(entry)) continue;
    if (entry.type !== "verified_person") continue;
    if (iuGalleryEntityInTitle(titleNorm, entry.entityName, entry.entityAliases)) {
      return entry;
    }
  }
  return null;
}

export function iuInternalGalleryFindVerifiedPlace(title, places) {
  const titleNorm = iuGalleryTitleNorm(title);
  const entries = Array.isArray(places?.entries) ? places.entries : [];
  for (const entry of entries) {
    if (!iuGalleryEntryApproved(entry)) continue;
    if (entry.type !== "verified_place_object") continue;
    if (iuGalleryEntityInTitle(titleNorm, entry.entityName, entry.entityAliases)) {
      return entry;
    }
  }
  return null;
}

function iuGalleryIllustrativeScore(entry, titleNorm, categoryNorm) {
  let score = 0;
  const entryCategory = iuGalleryTextNorm(entry.category);
  if (categoryNorm && entryCategory === categoryNorm) score += 2;
  const keywords = Array.isArray(entry.matchKeywords) ? entry.matchKeywords : [];
  for (const kw of keywords) {
    const needle = iuGalleryTextNorm(kw);
    if (needle && titleNorm.includes(needle)) score += 3;
  }
  return score;
}

function iuGalleryIllustrativeForbiddenHit(entry, titleNorm) {
  const forbidden = Array.isArray(entry.forbiddenSimilarEntities)
    ? entry.forbiddenSimilarEntities
    : [];
  const hay = titleNorm;
  for (const raw of forbidden) {
    const needle = iuGalleryTextNorm(raw);
    if (needle && hay.includes(needle)) return true;
  }
  for (const brand of FORBIDDEN_CAR_BRANDS) {
    if (hay.includes(brand) && String(entry.id || "").includes("industry")) {
      /* brand names in title must not pull wrong automotive illustrative */
    }
  }
  return false;
}

export function iuInternalGalleryFindIllustrative(title, illustrative, category) {
  const titleNorm = iuGalleryTitleNorm(title);
  const categoryNorm = iuGalleryTextNorm(category);
  const entries = Array.isArray(illustrative?.entries) ? illustrative.entries : [];
  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    if (!iuGalleryEntryApproved(entry)) continue;
    if (entry.type !== "illustrative") continue;
    if (entry.imageMode !== IU_IMAGE_MODE_ILLUSTRATIVE) continue;
    if (iuGalleryIllustrativeForbiddenHit(entry, titleNorm)) continue;
    const score = iuGalleryIllustrativeScore(entry, titleNorm, categoryNorm);
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }
  return bestScore > 0 ? best : null;
}

function iuGalleryEntityTypeForEntry(entry) {
  if (entry.type === "verified_person") return "person";
  if (entry.type === "verified_place_object") return "building";
  return "";
}

export function iuInternalGalleryEntryToArticleImage(entry, article) {
  if (!entry) return null;
  const title = String(article?.title || "").trim();
  const entityName = String(entry.entityName || "").trim();
  const isIllustrative = entry.imageMode === IU_IMAGE_MODE_ILLUSTRATIVE;
  const isExact = entry.imageMode === IU_IMAGE_MODE_EXACT;

  const out = {
    imageProvider: IU_INTERNAL_GALLERY_PROVIDER,
    imageThumbUrl: entry.imageThumbUrl,
    imageUrl: entry.imageUrl,
    imageAlt: entry.imageAlt,
    imageAuthor: entry.imageAuthor,
    imageAuthorUrl: entry.imageAuthorUrl,
    imageSourceUrl: entry.imageSourceUrl,
    imageLicenseSource: entry.imageLicenseSource,
    imageMode: entry.imageMode,
    imageGalleryLayer: entry.type,
    imageGalleryEntryId: entry.id,
    imageSelectionSource: "internal_gallery",
  };

  if (isExact) {
    out.imageExactMatchVerified = true;
    out.imageTitleEntity = entityName || title;
    out.imageMatchedEntity = entityName;
    out.imageEntityType = iuGalleryEntityTypeForEntry(entry);
  }

  if (isIllustrative) {
    out.imageIllustrativeVerified = true;
    out.imageIllustrativeScope = "generic";
    out.imageIllustrativeCategory = entry.category || "generic";
    if (Array.isArray(entry.forbiddenSimilarEntities) && entry.forbiddenSimilarEntities.length) {
      out.imageForbiddenSimilarEntities = entry.forbiddenSimilarEntities.slice();
    }
  }

  return out;
}

export function iuInternalGallerySelectImage(article, gallery) {
  const title = String(article?.title || "").trim();
  if (!title) {
    return { imageMode: IU_IMAGE_MODE_NO_IMAGE, reason: "empty_title" };
  }

  const persons = gallery?.verified_persons;
  const places = gallery?.verified_places_objects;
  const illustrative = gallery?.illustrative_gallery;

  const person = iuInternalGalleryFindVerifiedPerson(title, persons);
  if (person) {
    return {
      selection: "verified_person",
      reason: "verified_person_exact_match",
      image: iuInternalGalleryEntryToArticleImage(person, article),
    };
  }

  const place = iuInternalGalleryFindVerifiedPlace(title, places);
  if (place) {
    return {
      selection: "verified_place_object",
      reason: "verified_place_exact_match",
      image: iuInternalGalleryEntryToArticleImage(place, article),
    };
  }

  const category = String(article?.category || article?.section || "").trim();
  const ill = iuInternalGalleryFindIllustrative(title, illustrative, category);
  if (ill) {
    return {
      selection: "illustrative",
      reason: "illustrative_category_fallback",
      image: iuInternalGalleryEntryToArticleImage(ill, article),
    };
  }

  return {
    selection: "no_image",
    reason: "no_safe_internal_match",
    imageMode: IU_IMAGE_MODE_NO_IMAGE,
    image: { imageMode: IU_IMAGE_MODE_NO_IMAGE, imageProvider: IU_INTERNAL_GALLERY_PROVIDER },
  };
}

export function iuInternalGalleryLoadFromFs(readFileSync, pathJoin, galleryRoot) {
  const manifest = JSON.parse(readFileSync(pathJoin(galleryRoot, "manifest.json"), "utf8"));
  const verified_persons = JSON.parse(
    readFileSync(pathJoin(galleryRoot, manifest.layers.verified_persons), "utf8")
  );
  const verified_places_objects = JSON.parse(
    readFileSync(pathJoin(galleryRoot, manifest.layers.verified_places_objects), "utf8")
  );
  const illustrative_gallery = JSON.parse(
    readFileSync(pathJoin(galleryRoot, manifest.layers.illustrative_gallery), "utf8")
  );
  return { manifest, verified_persons, verified_places_objects, illustrative_gallery };
}
