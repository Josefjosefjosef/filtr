/**
 * Real Human Chaos V3 — deterministic Template DNA primitives (shared, no engine).
 * - No Math.random; use mulberry32(seed) streams.
 * - Mutation bitmask layers for reproducible Czech surface forms.
 */
/* eslint-disable no-console */

const RHC_V3_CORE_ID = "rhc_v3_deterministic_core_v1";
const RHC_V3_GLOBAL_SEED = 0x52484333; // "RHC3" as hex-ish discriminator

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick: index in [0, n) */
function pickIndex(rng, n) {
  if (n <= 0) return 0;
  return Math.floor(rng() * n);
}

function pickFrom(rng, arr) {
  if (!arr || !arr.length) return "";
  return arr[pickIndex(rng, arr.length)];
}

const CAL_ENTITIES = [
  "zubař",
  "právník",
  "účetní",
  "schůzka s bankéřem",
  "servis auta",
  "rodičák",
  "doktor",
  "jednání",
  "porada",
  "úřad",
  "pojišťovna"
];

const TASK_ENTITIES = [
  "koupit mlíko",
  "zavolat právníkovi",
  "poslat dokumenty",
  "zaplatit nájem",
  "vyzvednout balík",
  "objednat servis",
  "doplnit smlouvu",
  "připravit podklady"
];

const NOTE_ENTITIES = [
  "PIN ke kartě",
  "dokumenty ve spodní přihrádce",
  "heslo k WiFi",
  "narozeniny tety",
  "pojistka auta",
  "číslo smlouvy",
  "poznámka k nájmu",
  "údaje k bance"
];

const RETRIEVAL_TOPIC_FORMS = [
  "narozeniny",
  "narozeninách",
  "dokumenty",
  "dokumentů",
  "smlouva",
  "smlouvě",
  "smlouvách",
  "účtenka",
  "účtence",
  "banka",
  "bankou",
  "banky",
  "pojištění",
  "pojistka",
  "PIN",
  "karta",
  "firemní karta"
];

const TIME_SLOTS = [
  "8:00",
  "9:30",
  "10:15",
  "12:00",
  "14:00",
  "15:30",
  "17:45",
  "večer",
  "ráno kolem deváté",
  "po obědě"
];

const DATE_PHRASES = [
  "dnes",
  "zítra",
  "pozítří",
  "ve čtvrtek",
  "v pátek",
  "příští týden",
  "za týden",
  "o víkendu"
];

const FILLER_PREFIXES = ["hele ", "ee ", "no jo ", "vlastně ", "prostě "];
const FILLER_SUFFIXES = [" díky", " prosím", " jo", " no"];
const MOBILE_PREFIXES = ["jo hele ", "teda ", "promiň ", "můžeš ", "kámo "];
const HESITATION_INFIX = [" jako ", " no ", " fakt ", " trochu ", " nějak "];
const EMOTIONAL_SUFFIXES = [
  " — spěchám.",
  " (honem)",
  " díky moc",
  " prosím rychle",
  " no stress"
];

const NONSENSE_CANON = [
  "včera tam poletuje modrá schůzka s rohlíkem",
  "ulož nevím co asi tam někam",
  "dej mi to do toho jak jsme říkali",
  "ten člověk s tím papírem někdy",
  "nepiš nic ale vytvoř mi něco",
  "modrá větev lítá přes účtenku zítra možná",
  "schůzka s kýblem a kávou v patře",
  "ulož to tam kam patří no víš",
  "kde je ten dokument co jsme neměli",
  "zítra včera možná úkol kalendář mix"
];

const IMPOSSIBLE_OBJECTS = [
  "letadlo z papíru v lednici",
  "schůzka s duhou",
  "úkol pro mlhu",
  "poznámka z černé díry"
];

/** Bit flags for mutation layers (deterministic composition). */
const M = {
  STRIP_DIACRITICS: 1,
  TYPO_LITE: 2,
  FILLER_PREFIX: 4,
  FILLER_SUFFIX: 8,
  HESITATION: 16,
  MOBILE_PREFIX: 32,
  SELF_CORR_PHRASE: 64,
  NEGATION_OVERLAY: 128,
  AMBIGUITY_OVERLAY: 256,
  TIME_AMBIGUITY: 512,
  PARTIAL_REF: 1024,
  EMOTIONAL: 2048,
  SPOKEN_COMPRESS: 4096
};

function stripDiacriticsCs(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function typoLite(s) {
  return String(s || "")
    .replace(/\bzítra\b/gi, "zejtra")
    .replace(/\bmléko\b/gi, "mlíko")
    .replace(/\bprotože\b/gi, "ptže")
    .replace(/\bschůzka\b/gi, "schuzka")
    .replace(/\bpoznámka\b/gi, "poznamka");
}

function spokenCompress(s) {
  return String(s || "")
    .replace(/\bprosím\b/gi, "pls")
    .replace(/\bděkuji\b/gi, "dík")
    .replace(/\bdokumenty\b/gi, "dokumenty fakt");
}

function injectHesitation(s, rng) {
  const parts = String(s || "").split(/\s+/).filter(Boolean);
  if (parts.length < 4) return s;
  const ins = pickFrom(rng, HESITATION_INFIX);
  const at = 2 + pickIndex(rng, Math.max(1, parts.length - 3));
  parts.splice(at, 0, ins.trim());
  return parts.join(" ");
}

function partialReferenceWrap(topic, rng) {
  const vague = ["to co jsme říkali", "ten jeden dokument", "to tam", "ten údaj", "to co jsem měl"][pickIndex(rng, 5)];
  return "něco kolem " + vague + " ohledně " + topic;
}

function deriveMutationMask(familyKey, localIndex, streamSalt) {
  const base = (RHC_V3_GLOBAL_SEED ^ streamSalt ^ (familyKey.length * 1315423911) ^ (localIndex * 2654435761)) >>> 0;
  const rng = mulberry32(base);
  let mask = pickIndex(rng, 8192);
  if (familyKey === "no_diacritics") mask |= M.STRIP_DIACRITICS;
  if (familyKey === "mobile_voice_dirty_czech") mask |= M.MOBILE_PREFIX | M.FILLER_PREFIX;
  if (familyKey === "filler_speech") mask |= M.FILLER_PREFIX | M.FILLER_SUFFIX;
  if (familyKey === "self_correction") mask |= M.SELF_CORR_PHRASE;
  if (familyKey === "negation_no_write") mask |= M.NEGATION_OVERLAY;
  if (familyKey === "ambiguity_should_clarify") mask |= M.AMBIGUITY_OVERLAY;
  if (familyKey === "partial_references") mask |= M.PARTIAL_REF | M.TIME_AMBIGUITY;
  if (familyKey === "nonsense_negative_mining") mask |= M.NEGATION_OVERLAY;
  return mask >>> 0;
}

function applyMutationLayers(text, mask, rng) {
  let s = String(text || "").replace(/\s+/g, " ").trim();
  if (!s) return s;
  if (mask & M.MOBILE_PREFIX) s = pickFrom(rng, MOBILE_PREFIXES) + s;
  if (mask & M.FILLER_PREFIX) s = pickFrom(rng, FILLER_PREFIXES) + s;
  if (mask & M.HESITATION) s = injectHesitation(s, rng);
  if (mask & M.SPOKEN_COMPRESS) s = spokenCompress(s);
  if (mask & M.TYPO_LITE) s = typoLite(s);
  if (mask & M.STRIP_DIACRITICS) s = stripDiacriticsCs(s);
  if (mask & M.FILLER_SUFFIX) s = s + pickFrom(rng, FILLER_SUFFIXES);
  if (mask & M.EMOTIONAL) s = s + pickFrom(rng, EMOTIONAL_SUFFIXES);
  return s.replace(/\s+/g, " ").trim();
}

function allocateFamilySizes(totalCases, familiesLen) {
  const base = Math.floor(totalCases / familiesLen);
  const rem = totalCases - base * familiesLen;
  const sizes = [];
  for (let i = 0; i < familiesLen; i++) {
    sizes.push(base + (i < rem ? 1 : 0));
  }
  return sizes;
}

module.exports = {
  RHC_V3_CORE_ID,
  RHC_V3_GLOBAL_SEED,
  mulberry32,
  pickIndex,
  pickFrom,
  CAL_ENTITIES,
  TASK_ENTITIES,
  NOTE_ENTITIES,
  RETRIEVAL_TOPIC_FORMS,
  TIME_SLOTS,
  DATE_PHRASES,
  NONSENSE_CANON,
  IMPOSSIBLE_OBJECTS,
  M,
  deriveMutationMask,
  applyMutationLayers,
  stripDiacriticsCs,
  allocateFamilySizes
};
