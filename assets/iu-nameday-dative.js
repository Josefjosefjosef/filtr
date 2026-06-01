/**
 * Czech first-name dative (3. pád) for svátek overlay „Popřej …“.
 * Feminine -a names: ř-patterns before generic -ě (Laura → Lauře, not Laurě).
 */

const IU_NAMEDAY_DATIVE_HARD = {
  ferdinand: "ferdinandovi",
  josef: "josefovi",
  pavel: "pavlovi",
  petr: "petrovi",
  martin: "martinovi",
  karel: "karlovi",
  františek: "františkovi",
  frantisek: "františkovi",
  jan: "janovi",
  jakub: "jakubovi",
  tomáš: "tomášovi",
  tomas: "tomášovi",
  lukáš: "lukášovi",
  lukas: "lukášovi",
  david: "davidovi",
  michal: "michalovi",
  roman: "romanovi",
  filip: "filipovi",
  adam: "adamovi",
  daniel: "danielovi",
  ondřej: "ondřeji",
  ondrej: "ondřeji",
  marek: "markovi",
  václav: "václavovi",
  vaclav: "václavovi",
  zdeněk: "zdeňkovi",
  zdenek: "zdeňkovi",
  ladislav: "ladislavovi",
  bohumil: "bohumilovi",
  antonín: "antonínovi",
  antonin: "antonínovi",
  vladimír: "vladimírovi",
  vladimir: "vladimírovi",
  richard: "richardovi",
  patrik: "patrikovi",
  dominik: "dominikovi",
  radek: "radkovi",
  aleš: "alešovi",
  ales: "alešovi",
  stanislav: "stanislavovi",
  jaroslav: "jaroslavovi",
  bohuslav: "bohuslavovi",
  vojtěch: "vojtěchovi",
  vojtech: "vojtěchovi",
  kryštof: "kryštofovi",
  krystof: "kryštofovi",
  matěj: "matěji",
  matej: "matěji",
  honza: "honzovi",
  anna: "anně",
  marie: "marii",
  jana: "janě",
  lenka: "lence",
  petra: "petře",
  eva: "evě",
  hana: "haně",
  vera: "věře",
  věra: "věře",
  sára: "sáře",
  sara: "sáře",
  barbora: "barboře",
  zora: "zoře",
  tamara: "tamaře",
};

function capDativeForm(w, form) {
  if (!form) return "";
  if (w.charAt(0) === w.charAt(0).toUpperCase()) {
    return form.charAt(0).toUpperCase() + form.slice(1);
  }
  return form;
}

function iuFemaleDativeFromAEnding(w) {
  if (/ie$/i.test(w) && w.length >= 4) return w.slice(0, -2) + "ii";
  if (/ora$/i.test(w) && w.length >= 4) return w.slice(0, -3) + "oře";
  if (/ara$/i.test(w) && w.length >= 4) return w.slice(0, -3) + "aře";
  if (/era$/i.test(w) && w.length >= 4) return w.slice(0, -3) + "ře";
  if (/ra$/i.test(w) && w.length >= 3) return w.slice(0, -2) + "ře";
  if (/a$/i.test(w) && w.length >= 3) return w.slice(0, -1) + "ě";
  return "";
}

/** Naive -a → -ě only (pre-fix regression reference; do not use in production). */
export function iuNaiveFemaleADativeForProof(w) {
  if (/a$/i.test(w) && w.length >= 3) return w.slice(0, -1) + "ě";
  return "";
}

/** Jedno křestní jméno → bezpečný 3. pád pro „Popřej …“ (jen spolehlivé mapy/vzory); jinak "". */
export function iuSafeDativeSingleFirstName(raw, namedayGender) {
  const tail0 = String(raw || "").trim();
  if (!tail0 || tail0 === "—") return "";
  if (/[;,]/.test(tail0)) return "";
  if (/\s+a\s+/i.test(tail0)) return "";
  if (/\s{2,}/.test(tail0)) return "";
  const parts = tail0.split(/\s+/).filter(Boolean);
  if (parts.length !== 1) return "";
  const w = parts[0].replace(/[.,;:]+$/g, "");
  if (w.indexOf("-") >= 0) return "";
  if (!/^[\p{L}]{2,40}$/u.test(w)) return "";
  const low = w.normalize("NFC").toLowerCase();
  if (/načítám|svátek|dnes|nikdo|—/.test(low)) return "";
  if (IU_NAMEDAY_DATIVE_HARD[low]) return capDativeForm(w, IU_NAMEDAY_DATIVE_HARD[low]);
  if (namedayGender === "female") {
    const form = iuFemaleDativeFromAEnding(w);
    return capDativeForm(w, form);
  }
  if (/ek$/i.test(w) && w.length >= 4) return capDativeForm(w, w.slice(0, -1) + "kovi");
  if (/el$/i.test(w) && w.length >= 4) return capDativeForm(w, w + "ovi");
  if (/[bcdfghjklmnpqrstvwxzřšťžčň]/i.test(w.slice(-1))) return capDativeForm(w, w + "ovi");
  return "";
}

/** P0 svátek overlay: 3. pád oslavence pro „Popřej …“ (bez DOM závislosti na meta). */
export function iuSvatekBuildPoprejLineFromRaw(raw, namedayGender) {
  let line = "Popřej oslavenci";
  try {
    const r = String(raw || "").trim();
    const dat = iuSafeDativeSingleFirstName(r, namedayGender);
    if (dat) line = "Popřej " + dat;
  } catch (_) {}
  return line;
}
