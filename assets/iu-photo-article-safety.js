/** P0 image legal safety guards — EXACT_MATCH or ILLUSTRATIVE only, no guessing. */
export const IU_IMAGE_GUESSING_ALLOWED = false;
export const IU_IMAGE_MODE_EXACT = "exact_match";
export const IU_IMAGE_MODE_ILLUSTRATIVE = "illustrative";
export const IU_IMAGE_SPECIFIC_ENTITY_TYPES = new Set([
  "person",
  "company",
  "brand",
  "product",
  "place",
  "building",
  "monument",
]);

function iuNormalizeImageMode(raw) {
  const m = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (m === "exact_match" || m === "exact") return IU_IMAGE_MODE_EXACT;
  if (m === "illustrative" || m === "illustration") return IU_IMAGE_MODE_ILLUSTRATIVE;
  return "";
}

function iuPhotoSafetyTextNorm(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function iuPhotoSafetyFlagBlocked(it) {
  if (!it || typeof it !== "object") return true;
  if (IU_IMAGE_GUESSING_ALLOWED) return false;
  const blockedFlags = [
    "imageGuessUsed",
    "imageAutoSubstitution",
    "imageSimilarPlace",
    "imageSimilarPerson",
    "imageSimilarCompany",
    "imageSimilarProduct",
    "imageSimilarBrand",
    "imageSimilarBuilding",
    "imageSimilarMonument",
    "imageGuessingAllowed",
    "imageAutoGuess",
    "imageWrongSubstitutionRisk",
  ];
  for (const f of blockedFlags) {
    const v = it[f];
    if (v === true || String(v || "").trim().toLowerCase() === "yes") return true;
  }
  return false;
}

function iuPhotoSafetyForbiddenSimilarHit(it) {
  if (!it || typeof it !== "object") return false;
  const forbidden = Array.isArray(it.imageForbiddenSimilarEntities)
    ? it.imageForbiddenSimilarEntities
    : Array.isArray(it.imageForbiddenEntities)
      ? it.imageForbiddenEntities
      : [];
  if (!forbidden.length) return false;
  const hay = iuPhotoSafetyTextNorm(
    [it.imageMatchedEntity, it.imageMatchedQuery, it.imageAlt, it.imageDescription]
      .filter(Boolean)
      .join(" ")
  );
  if (!hay) return false;
  for (const raw of forbidden) {
    const needle = iuPhotoSafetyTextNorm(raw);
    if (needle && hay.includes(needle)) return true;
  }
  return false;
}

function iuPhotoSafetyIllustrativeHasSpecificEntity(it) {
  const entityType = String(it?.imageEntityType || it?.imageMatchedEntityType || "")
    .trim()
    .toLowerCase();
  if (entityType && IU_IMAGE_SPECIFIC_ENTITY_TYPES.has(entityType)) return true;
  const scope = String(it?.imageIllustrativeScope || "").trim().toLowerCase();
  if (scope === "specific" || scope === "named") return true;
  const matched = String(it?.imageMatchedEntity || "").trim();
  if (matched && String(it?.imageIllustrativeCategory || "").trim().toLowerCase() !== "generic") {
    return true;
  }
  return false;
}

export function iuPhotoArticleSafetyAudit(it) {
  const audit = {
    allowed: false,
    mode: "",
    showIllustrativeLabel: false,
    reason: "",
    autoGuessing: false,
    wrongPlace: false,
    wrongPerson: false,
    wrongCompany: false,
    wrongProduct: false,
    wrongBrand: false,
  };
  try {
    if (!it || typeof it !== "object") {
      audit.reason = "invalid_item";
      return audit;
    }
    const thumb = String(it.imageThumbUrl || it.imageUrl || "").trim();
    if (!thumb || !/^https?:\/\//i.test(thumb)) {
      audit.reason = "no_valid_thumb";
      return audit;
    }
    const provider = String(it.imageProvider || "").trim().toLowerCase();
    if (provider && provider !== "pexels") {
      audit.reason = "unsupported_provider";
      return audit;
    }
    if (iuPhotoSafetyFlagBlocked(it)) {
      audit.reason = "safety_flag_blocked";
      if (it.imageSimilarPlace) audit.wrongPlace = true;
      if (it.imageSimilarPerson) audit.wrongPerson = true;
      if (it.imageSimilarCompany) audit.wrongCompany = true;
      if (it.imageSimilarProduct) audit.wrongProduct = true;
      if (it.imageSimilarBrand) audit.wrongBrand = true;
      return audit;
    }
    const mode = iuNormalizeImageMode(it.imageMode);
    if (!mode) {
      audit.reason = "missing_image_mode";
      audit.autoGuessing = true;
      return audit;
    }
    if (iuPhotoSafetyForbiddenSimilarHit(it)) {
      audit.reason = "forbidden_similar_entity";
      audit.wrongPlace = true;
      return audit;
    }
    const titleEntity = String(it.imageTitleEntity || "").trim();
    const matchedEntity = String(it.imageMatchedEntity || "").trim();

    if (mode === IU_IMAGE_MODE_EXACT) {
      if (it.imageExactMatchVerified !== true) {
        audit.reason = "exact_match_not_verified";
        return audit;
      }
      if (!titleEntity || !matchedEntity) {
        audit.reason = "exact_match_missing_entity";
        return audit;
      }
      if (iuPhotoSafetyTextNorm(titleEntity) !== iuPhotoSafetyTextNorm(matchedEntity)) {
        audit.reason = "exact_match_entity_mismatch";
        const entityType = String(it.imageEntityType || it.imageTitleEntityType || "")
          .trim()
          .toLowerCase();
        if (entityType === "person") audit.wrongPerson = true;
        else if (entityType === "company") audit.wrongCompany = true;
        else if (entityType === "product") audit.wrongProduct = true;
        else if (entityType === "brand") audit.wrongBrand = true;
        else audit.wrongPlace = true;
        return audit;
      }
      audit.allowed = true;
      audit.mode = IU_IMAGE_MODE_EXACT;
      return audit;
    }

    if (mode === IU_IMAGE_MODE_ILLUSTRATIVE) {
      if (it.imageIllustrativeVerified !== true) {
        audit.reason = "illustrative_not_verified";
        return audit;
      }
      if (iuPhotoSafetyIllustrativeHasSpecificEntity(it)) {
        audit.reason = "illustrative_specific_entity";
        const entityType = String(it.imageEntityType || "").trim().toLowerCase();
        if (entityType === "person") audit.wrongPerson = true;
        else if (entityType === "company") audit.wrongCompany = true;
        else if (entityType === "product") audit.wrongProduct = true;
        else if (entityType === "brand") audit.wrongBrand = true;
        else audit.wrongPlace = true;
        return audit;
      }
      if (
        matchedEntity &&
        titleEntity &&
        iuPhotoSafetyTextNorm(matchedEntity) !== iuPhotoSafetyTextNorm(titleEntity)
      ) {
        audit.reason = "illustrative_entity_substitution";
        audit.wrongPlace = true;
        return audit;
      }
      audit.allowed = true;
      audit.mode = IU_IMAGE_MODE_ILLUSTRATIVE;
      audit.showIllustrativeLabel = true;
      return audit;
    }

    audit.reason = "unknown_image_mode";
    return audit;
  } catch (_) {
    audit.reason = "audit_error";
    return audit;
  }
}

export function iuArticleHasValidPhotoImage(it) {
  try {
    return iuPhotoArticleSafetyAudit(it).allowed === true;
  } catch (_) {
    return false;
  }
}
