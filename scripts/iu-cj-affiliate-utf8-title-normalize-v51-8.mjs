/**
 * CJ product title/description UTF-8 normalize (V51.8).
 *
 * Observed production mojibake: UTF-8 bytes mis-decoded as IBM CP852 (OEM CE),
 * then re-stored as Unicode (e.g. "é" → "├ę"). Legitimate box-drawing in titles
 * is vanishingly rare; repair applies only when CP852 reverse round-trip yields
 * valid UTF-8 with a strictly better CE-diacritic score and fewer box glyphs.
 *
 * Does NOT invent titles: refuses repair when reverse map is incomplete or
 * score does not improve. No bulk rewrite of unverified source payloads.
 */
"use strict";

/** CP852 glyphs for bytes 0x80..0xFF (IBM code page 852). */
export const CP852_80_FF =
  "\u00c7\u00fc\u00e9\u00e2\u00e4\u016f\u0107\u00e7\u0142\u00eb\u0150\u0151\u00ee\u0179\u00c4\u0106" +
  "\u00c9\u0139\u013a\u00f4\u00f6\u013d\u013e\u015a\u015b\u00d6\u00dc\u0164\u0165\u0141\u00d7\u010d" +
  "\u00e1\u00ed\u00f3\u00fa\u0104\u0105\u017d\u017e\u0118\u0119\u00ac\u017a\u010c\u015f\u00ab\u00bb" +
  "\u2591\u2592\u2593\u2502\u2524\u00c1\u00c2\u011a\u015e\u2563\u2551\u2557\u255d\u017b\u017c\u2510" +
  "\u2514\u2534\u252c\u251c\u2500\u253c\u0102\u0103\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u00a4" +
  "\u0111\u0110\u010e\u00cb\u010f\u0147\u00cd\u00ce\u011b\u2518\u250c\u2588\u2584\u0162\u016e\u2580" +
  "\u00d3\u00df\u00d4\u0143\u0144\u0148\u0160\u0161\u0154\u00da\u0155\u0170\u00fd\u00dd\u0163\u00b4" +
  "\u00ad\u02dd\u02db\u02c7\u02d8\u00a7\u00f7\u00b8\u00b0\u00a8\u02d9\u0171\u0158\u0159\u25a0\u00a0";

const CE_GOOD =
  "áäčďéěíĺľňóôöŕřšťúůüýžÁÄČĎÉĚÍĹĽŇÓÔÖŔŘŠŤÚŮÜÝŽąćęłńóśźżĄĆĘŁŃÓŚŹŻ";

const BOX_RE = /[\u2500-\u257F\u2580-\u259F\u25A0]/;

/** @type {Map<string, number>|null} */
let reverseMapCache = null;

function getCp852ReverseMap() {
  if (reverseMapCache) return reverseMapCache;
  const map = new Map();
  for (let b = 0; b < 128; b++) {
    map.set(String.fromCharCode(b), b);
  }
  for (let i = 0; i < CP852_80_FF.length; i++) {
    const ch = CP852_80_FF[i];
    if (!map.has(ch)) map.set(ch, 0x80 + i);
  }
  reverseMapCache = map;
  return map;
}

export function countBoxDrawing(text) {
  const t = String(text || "");
  let n = 0;
  for (const ch of t) {
    if (BOX_RE.test(ch)) n++;
  }
  return n;
}

export function countCeDiacritics(text) {
  const t = String(text || "");
  let n = 0;
  for (const ch of t) {
    if (CE_GOOD.includes(ch)) n++;
  }
  return n;
}

export function looksLikeCp852Utf8Mojibake(text) {
  const t = String(text || "");
  if (!t) return false;
  return countBoxDrawing(t) > 0;
}

/**
 * Reverse CP852 misdecode → UTF-8. Returns null when incomplete or invalid.
 * @param {string} text
 * @returns {string|null}
 */
export function tryRepairCp852Utf8Mojibake(text) {
  const input = String(text || "");
  if (!input || !looksLikeCp852Utf8Mojibake(input)) return null;
  const map = getCp852ReverseMap();
  const bytes = [];
  for (const ch of input) {
    if (!map.has(ch)) return null;
    bytes.push(map.get(ch));
  }
  let repaired;
  try {
    repaired = Buffer.from(bytes).toString("utf8");
  } catch {
    return null;
  }
  if (!repaired || repaired.includes("\uFFFD")) return null;
  if (repaired === input) return null;
  const boxBefore = countBoxDrawing(input);
  const boxAfter = countBoxDrawing(repaired);
  if (boxAfter >= boxBefore) return null;
  const scoreBefore = countCeDiacritics(input) - boxBefore * 3;
  const scoreAfter = countCeDiacritics(repaired) - boxAfter * 3;
  if (scoreAfter <= scoreBefore) return null;
  return repaired;
}

/**
 * Common Windows-1252 / UTF-8 misdecode literals (e.g. ellipsis/quotes as ÔÇŽ).
 * Applied only as exact multi-char sequence replacements — never touches × / Úž / ß.
 */
export const WIN1252_UTF8_LITERAL_REPAIRS = Object.freeze([
  ["ÔÇŽ", "…"],
  ["ÔÇÖ", "’"],
  ["ÔÇØ", "“"],
  ["ÔÇù", "”"],
  ["ÔÇô", "–"],
  ["ÔÇö", "—"],
  ["Â©", "©"],
  ["Â®", "®"],
]);

export function tryRepairWin1252Utf8Literals(text) {
  const input = String(text || "");
  if (!input) return null;
  let out = input;
  let hit = false;
  for (const [bad, good] of WIN1252_UTF8_LITERAL_REPAIRS) {
    if (out.includes(bad)) {
      out = out.split(bad).join(good);
      hit = true;
    }
  }
  return hit && out !== input ? out : null;
}

/**
 * Normalize a CJ product text field. Returns original when repair is refused.
 * @param {string|null|undefined} text
 * @returns {{ text: string|null, repaired: boolean, reason: string|null }}
 */
export function normalizeCjProductText(text) {
  if (text == null) return { text: null, repaired: false, reason: null };
  const input = String(text);
  if (!input) return { text: input, repaired: false, reason: null };

  // Stage A: CP852→UTF-8 reverse (titleBox historical class)
  if (looksLikeCp852Utf8Mojibake(input)) {
    const repaired = tryRepairCp852Utf8Mojibake(input);
    if (repaired) {
      const stageB = tryRepairWin1252Utf8Literals(repaired) || repaired;
      return {
        text: stageB,
        repaired: true,
        reason:
          stageB !== repaired
            ? "CP852_UTF8_REPAIRED+WIN1252_LITERALS"
            : "CP852_UTF8_REPAIRED",
      };
    }
  }

  // Stage B: Windows-1252 literal sequences (descriptions with ÔÇŽ etc.)
  const win = tryRepairWin1252Utf8Literals(input);
  if (win) {
    return { text: win, repaired: true, reason: "WIN1252_UTF8_LITERALS_REPAIRED" };
  }

  if (looksLikeCp852Utf8Mojibake(input)) {
    return { text: input, repaired: false, reason: "CP852_REPAIR_REFUSED" };
  }
  return { text: input, repaired: false, reason: null };
}

export function normalizeCjProductFields(fields = {}) {
  const titleN = normalizeCjProductText(fields.title ?? fields.name ?? null);
  const descN = normalizeCjProductText(fields.description ?? null);
  return {
    title: titleN.text,
    name: titleN.text,
    description: descN.text,
    utf8Normalize: {
      titleRepaired: titleN.repaired,
      descriptionRepaired: descN.repaired,
      titleReason: titleN.reason,
      descriptionReason: descN.reason,
    },
  };
}

/**
 * In-place final pass over offers-public sections[].products[] titles/descriptions.
 * Covers LKG-carried rows and any path that skipped toPublicProductCard.
 * @param {object|null|undefined} doc
 * @returns {{ titleRepaired: number, descriptionRepaired: number, scanned: number }}
 */
export function normalizeOffersPublicDocTexts(doc) {
  const stats = { titleRepaired: 0, descriptionRepaired: 0, scanned: 0 };
  if (!doc || typeof doc !== "object") return stats;
  for (const sec of doc.sections || []) {
    for (const p of sec.products || []) {
      if (!p || typeof p !== "object") continue;
      stats.scanned += 1;
      const titleN = normalizeCjProductText(p.title ?? p.name ?? null);
      const descN = normalizeCjProductText(p.description ?? null);
      if (titleN.repaired) {
        p.title = titleN.text;
        if (p.name != null) p.name = titleN.text;
        stats.titleRepaired += 1;
      }
      if (descN.repaired) {
        p.description = descN.text;
        stats.descriptionRepaired += 1;
      }
      if (titleN.repaired || descN.repaired) {
        p.utf8Normalize = {
          ...(p.utf8Normalize && typeof p.utf8Normalize === "object" ? p.utf8Normalize : {}),
          titleRepaired: titleN.repaired === true,
          descriptionRepaired: descN.repaired === true,
          titleReason: titleN.reason,
          descriptionReason: descN.reason,
          appliedAt: "offers_public_final_pass",
        };
      }
    }
  }
  return stats;
}
