/**
 * Authoritative inventory of public affiliate section buttons (read-only).
 * Does not mutate assets/iu-affiliate-catalog.js.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractCjLinkIdFromClickUrl } from "./iu-cj-affiliate-phase1-lib.mjs";
import { isTrustedCjClickHost, parseAffiliateClickUrl } from "./iu-cj-affiliate-phase2-product-api.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SLOT_KIND = Object.freeze({
  occupied: "occupied",
  reserved: "reserved",
  free_empty: "free_empty",
  blocked: "blocked",
  paid: "paid",
});

/** Slots with explicit empty inventory markers (truly free). */
export function isFreeEmptySlug(slug) {
  return /(?:^|-)empty-\d+$/i.test(String(slug || ""));
}

/**
 * Parse catalog preserving item order within each section.
 * @param {string} [catalogSrc]
 */
export function parseAffiliateCatalogOrdered(catalogSrc) {
  const src =
    catalogSrc != null
      ? String(catalogSrc)
      : fs.readFileSync(path.join(ROOT, "assets", "iu-affiliate-catalog.js"), "utf8");
  const sections = [];
  const sectionRe = /\{\s*id:\s*"(aff-[^"]+)"[\s\S]*?title:\s*"([^"]+)"[\s\S]*?items:\s*\[([\s\S]*?)\]\s*,?\s*\}/g;
  let sm;
  while ((sm = sectionRe.exec(src)) !== null) {
    const sectionId = sm[1];
    const sectionTitle = sm[2];
    const itemsBlock = sm[3];
    const items = [];
    const tokenRe =
      /affPartner\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"(https:\/\/[^"]+)"\s*\)|affItem\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"([^"]+)"\s*\)/g;
    let tm;
    while ((tm = tokenRe.exec(itemsBlock)) !== null) {
      if (tm[1] != null && tm[2] != null) {
        const title = tm[1].replace(/\\u2019/g, "'").replace(/\\"/g, '"');
        const url = tm[2];
        items.push({
          kind: "partner",
          title,
          url,
          slug: null,
          cjLinkId: extractCjLinkIdFromClickUrl(url),
          affiliateUrlReady: true,
        });
      } else {
        items.push({
          kind: "placeholder",
          title: tm[3] || "",
          url: null,
          slug: tm[4],
          cjLinkId: null,
          affiliateUrlReady: false,
        });
      }
    }
    sections.push({ sectionId, sectionTitle, items });
  }
  return { generatedAt: new Date().toISOString(), sections, source: "assets/iu-affiliate-catalog.js" };
}

/**
 * @param {{ sectionId: string, blockedSlotIndexes?: number[], paidSlotIndexes?: number[] }[]} [policy]
 */
export function classifySectionSlots(section, policyEntry = null) {
  const blockedSet = new Set(policyEntry?.blockedSlotIndexes || []);
  const paidSet = new Set(policyEntry?.paidSlotIndexes || []);
  const slots = [];
  (section.items || []).forEach((it, index) => {
    let slotKind = SLOT_KIND.reserved;
    if (blockedSet.has(index)) slotKind = SLOT_KIND.blocked;
    else if (paidSet.has(index)) slotKind = SLOT_KIND.paid;
    else if (it.affiliateUrlReady || (it.title && String(it.title).trim())) slotKind = SLOT_KIND.occupied;
    else if (isFreeEmptySlug(it.slug)) slotKind = SLOT_KIND.free_empty;
    else slotKind = SLOT_KIND.reserved;

    const click = it.url ? parseAffiliateClickUrl(it.url, null) : null;
    slots.push({
      sectionId: section.sectionId,
      sectionTitle: section.sectionTitle,
      slotIndex: index,
      slotKind,
      title: it.title || "",
      slug: it.slug || null,
      url: it.url || null,
      cjLinkId: it.cjLinkId || null,
      affiliateUrlReady: it.affiliateUrlReady === true,
      affiliateUrlVerified:
        it.affiliateUrlReady === true && it.url
          ? isTrustedCjClickHost(it.url) && click?.documentedFormat === true
          : false,
      verifiedAt: it.affiliateUrlReady ? new Date().toISOString() : null,
    });
  });
  return slots;
}

export function buildCatalogSlotInventory(options = {}) {
  const parsed = parseAffiliateCatalogOrdered(options.catalogSrc);
  const policyBySection = new Map((options.slotPolicy || []).map((p) => [p.sectionId, p]));
  const sections = [];
  let occupied = 0;
  let freeEmpty = 0;
  let reserved = 0;
  let blocked = 0;
  let paid = 0;
  const livePartners = [];

  for (const sec of parsed.sections) {
    const slots = classifySectionSlots(sec, policyBySection.get(sec.sectionId));
    for (const s of slots) {
      if (s.slotKind === SLOT_KIND.occupied) {
        occupied += 1;
        livePartners.push({
          sectionId: s.sectionId,
          slotIndex: s.slotIndex,
          title: s.title,
          url: s.url,
          cjLinkId: s.cjLinkId,
          affiliateUrlVerified: s.affiliateUrlVerified,
        });
      } else if (s.slotKind === SLOT_KIND.free_empty) freeEmpty += 1;
      else if (s.slotKind === SLOT_KIND.reserved) reserved += 1;
      else if (s.slotKind === SLOT_KIND.blocked) blocked += 1;
      else if (s.slotKind === SLOT_KIND.paid) paid += 1;
    }
    const firstFree = slots.find((s) => s.slotKind === SLOT_KIND.free_empty);
    sections.push({
      sectionId: sec.sectionId,
      sectionTitle: sec.sectionTitle,
      slotCount: slots.length,
      occupiedCount: slots.filter((s) => s.slotKind === SLOT_KIND.occupied).length,
      freeEmptyCount: slots.filter((s) => s.slotKind === SLOT_KIND.free_empty).length,
      reservedCount: slots.filter((s) => s.slotKind === SLOT_KIND.reserved).length,
      firstFreeSlotIndex: firstFree ? firstFree.slotIndex : null,
      slots,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    sectionCount: sections.length,
    occupiedButtonCount: occupied,
    freeEmptySlotCount: freeEmpty,
    reservedSlotCount: reserved,
    blockedSlotCount: blocked,
    paidSlotCount: paid,
    livePartnerCount: livePartners.length,
    livePartners,
    sections,
    catalogMutated: false,
    publishable: false,
  };
}

/** First truly free empty-* slot in section; never returns occupied/reserved/paid/blocked. */
export function findFirstFreeEmptySlot(inventory, sectionId) {
  const sec = (inventory.sections || []).find((s) => s.sectionId === sectionId);
  if (!sec) return { ok: false, reason: "section_not_found" };
  const slot = (sec.slots || []).find((s) => s.slotKind === SLOT_KIND.free_empty);
  if (!slot) return { ok: false, reason: "no_free_slot" };
  return { ok: true, slot };
}

export function findOccupiedButtonForPartner(inventory, partner) {
  const titleNorm = String(partner?.displayName || partner?.partnerName || "")
    .trim()
    .toLowerCase();
  const linkId = partner?.cjLinkId ? String(partner.cjLinkId) : null;
  const advertiserHints = [];
  for (const p of inventory.livePartners || []) {
    if (linkId && String(p.cjLinkId) === linkId) return { found: true, match: "cj_link_id", button: p };
    if (titleNorm && String(p.title).trim().toLowerCase() === titleNorm) {
      advertiserHints.push(p);
    }
  }
  if (advertiserHints.length === 1) return { found: true, match: "display_name", button: advertiserHints[0] };
  if (advertiserHints.length > 1) return { found: true, match: "ambiguous_title", button: advertiserHints[0], ambiguous: true };
  return { found: false };
}
