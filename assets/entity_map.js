/**
 * Kanonické entity + synonyma pro sémantické slučování titulků (O(1) lookup).
 */

export const ENTITY_MAP = {
  rusko: ["putin", "moskva", "kreml"],
  ukrajina: ["kyjev", "zelenskyj"],
  usa: ["biden", "washington"],
  cesko: ["praha", "vlada", "fiala", "babis"],
  eu: ["brusel", "evropska", "komise"],
  policie: ["policie", "kriminaliste"],
  soud: ["soud", "justice"],
  ekonomika: ["inflace", "ceny", "rozpocet"],
  sport: ["fotbal", "hokej", "liga"],
  technologie: ["ai", "umela", "inteligence"],
};

/** Token (malá písmena) → kanonický klíč */
export const ENTITY_LOOKUP = (() => {
  const m = new Map();
  for (const [canonical, syns] of Object.entries(ENTITY_MAP)) {
    m.set(canonical, canonical);
    for (const s of syns) {
      m.set(s, canonical);
    }
  }
  return m;
})();
