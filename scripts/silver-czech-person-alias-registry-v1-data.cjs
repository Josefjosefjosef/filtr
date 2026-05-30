#!/usr/bin/env node
"use strict";

/** Deterministic Czech person alias groups — canonical folded key → alias tokens (folded). */
const IU_SILVER_CZECH_PERSON_ALIAS_GROUPS_V1 = {
  josef: ["josef", "pepa", "pepik", "pepicek", "jozka", "joska"],
  jan: ["jan", "honza", "honzik", "jenda", "jenik", "jenicek"],
  petr: ["petr", "peta", "petrik", "peca"],
  tomas: ["tomas", "tom", "tomik", "tomasek"],
  jiri: ["jiri", "jirka", "jirko", "jira", "jirik"],
  martin: ["martin", "martas", "martinek", "martinek"],
  michal: ["michal", "misa", "michalek", "miki"],
  lukas: ["lukas", "luky", "lukasek", "lukesh"],
  jakub: ["jakub", "kuba", "kubik", "kubicek"],
  david: ["david", "davca", "davidek"],
  ondrej: ["ondrej", "ondra", "ondras", "ondrasek"],
  marek: ["marek", "maro", "marecek"],
  pavel: ["pavel", "pavlik", "paja"],
  vaclav: ["vaclav", "vasek", "vasik", "venda"],
  karel: ["karel", "kaja", "karlik"],
  roman: ["roman", "romca"],
  milan: ["milan", "milánek", "milanek"],
  radek: ["radek", "rada", "radim"],
  ales: ["ales", "alik"],
  filip: ["filip", "fila", "filipek"],
  dominik: ["dominik", "domca", "dominicek"],
  daniel: ["daniel", "dan", "danik", "danicek"],
  adam: ["adam", "adamek"],
  matej: ["matej", "mates", "matysek"],
  matyas: ["matyas", "maty", "matysek"],
  vojtech: ["vojtech", "vojta", "vojtisek"],
  stanislav: ["stanislav", "standa", "stanik"],
  jaroslav: ["jaroslav", "jarda", "jarousek"],
  miroslav: ["miroslav", "mirek", "mira", "mirda"],
  zdenek: ["zdenek", "zdena", "zdenda"],
  frantisek: ["frantisek", "franta", "fanda", "fanous"],
  ladislav: ["ladislav", "lada", "ladik"],
  libor: ["libor", "liborek"],
  robert: ["robert", "rob", "robik"],
  patrik: ["patrik", "pata"],
  erik: ["erik", "ericek"],
  tadeas: ["tadeas", "tadeasek", "tady"],
  richard: ["richard", "risa"],
  bohumil: ["bohumil", "bohous", "bohus"],
  antonin: ["antonin", "tonda", "tonik"],
  jaromir: ["jaromir", "jarda", "mira"],
  rudolf: ["rudolf", "ruda", "rudik"],
  vladimir: ["vladimir", "vlada", "vladik"],
  lubos: ["lubos", "lubosek"],
  milos: ["milos", "milosek"],
  viktor: ["viktor", "viky"],
  nikolas: ["nikolas", "nicolas", "niko", "niky", "nik"],
  katerina: ["katerina", "katka", "kata", "kacka", "kacenka", "katynka", "kaca", "kacena"],
  veronika: ["veronika", "verca", "verunka", "veru", "nika"],
  jana_f: ["jana", "jani", "janka", "janca", "janicka"],
  petra: ["petra", "peta", "petruska", "peca"],
  tereza: ["tereza", "terka", "terezka", "terinka"],
  lucie: ["lucie", "lucka", "lucinka", "luca"],
  michaela: ["michaela", "misa", "misina", "misenka", "miska"],
  marie: ["marie", "maruska", "maja", "majka", "marus"],
  eva: ["eva", "evicka", "evca", "evka"],
  anna: ["anna", "anicka", "anka", "anca"],
  barbora: ["barbora", "bara", "barca", "barunka"],
  monika: ["monika", "monca", "moni"],
  lenka: ["lenka", "lenca", "lenicka"],
  andrea: ["andrea", "andy", "andrejka"],
  nikola: ["nikola", "niki", "nikca"],
  natalie: ["natalie", "natka", "naty", "natalka"],
  kristyna: ["kristyna", "kiki", "kristynka", "tyna"],
  simona: ["simona", "simca", "simi"],
  martina: ["martina", "marta", "martinka"],
  alena: ["alena", "ala", "alenka"],
  helena: ["helena", "hela", "helenka"],
  iva: ["iva", "ivuska", "ivca"],
  ivana: ["ivana", "ivanka", "ivca"],
  zuzana: ["zuzana", "zuzka", "zuza", "zuzanka"],
  denisa: ["denisa", "denca", "denda"],
  karolina: ["karolina", "kaja", "karolinka"],
  adela: ["adela", "ada", "adelka"],
  eliska: ["eliska", "eli", "elis", "eli"],
  klara: ["klara", "klarka", "klari"],
  gabriela: ["gabriela", "gabina", "gabi"],
  marketa: ["marketa", "market", "maky", "marketka"],
  sarka: ["sarka", "sari", "sarenka"],
  pavla: ["pavla", "pavli", "pata"],
  pavlina: ["pavlina", "pavli", "pavlinka", "pata"],
  hana: ["hana", "hanka", "hanicka"],
  jitka: ["jitka", "jitus", "jitunka"],
  renata: ["renata", "renca", "reni"],
  romana: ["romana", "romca"],
  vendula: ["vendula", "vendy", "vendulka"],
  miroslava: ["miroslava", "mirka", "mira"],
  stanislava: ["stanislava", "stana", "standa"],
  jaroslava: ["jaroslava", "jarka", "jaruska"],
  vera: ["vera", "verka", "veruska"],
  blanka: ["blanka", "blani", "blanicka"],
  dana: ["dana", "danka", "danuska"],
  jarmila: ["jarmila", "jarka", "jaruska", "jarmilka"],
  milada: ["milada", "miladka", "mila"],
  bozena: ["bozena", "bozenka", "bozka"],
  ruzena: ["ruzena", "ruza", "ruzenka"],
  libuse: ["libuse", "libuska"],
  ludmila: ["ludmila", "lida", "lidka", "liduska"]
};

function foldCs(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildFoldedGroups() {
  const out = {};
  const keys = Object.keys(IU_SILVER_CZECH_PERSON_ALIAS_GROUPS_V1);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const arr = IU_SILVER_CZECH_PERSON_ALIAS_GROUPS_V1[k] || [];
    const folded = [];
    const seen = {};
    for (let j = 0; j < arr.length; j++) {
      const f = foldCs(arr[j]);
      if (f.length >= 2 && !seen[f]) {
        seen[f] = 1;
        folded.push(f);
      }
    }
    const ck = foldCs(k);
    if (ck.length >= 2 && !seen[ck]) folded.unshift(ck);
    out[ck] = folded;
  }
  return out;
}

const FOLDED_GROUPS = buildFoldedGroups();

function expandPersonAliasTokens(tokens) {
  const bag = {};
  const add = function (w) {
    const x = String(w || "").trim();
    if (x.length >= 2) bag[x] = 1;
  };
  for (let i = 0; i < tokens.length; i++) add(tokens[i]);
  const gkeys = Object.keys(FOLDED_GROUPS);
  for (let gi = 0; gi < gkeys.length; gi++) {
    const group = FOLDED_GROUPS[gkeys[gi]] || [];
    let hit = false;
    for (let ai = 0; ai < group.length; ai++) {
      if (bag[group[ai]]) {
        hit = true;
        break;
      }
    }
    if (hit) {
      for (let ai = 0; ai < group.length; ai++) add(group[ai]);
    }
  }
  return Object.keys(bag);
}

function aliasGroupKeysForToken(token) {
  const t = foldCs(token);
  const hits = [];
  const gkeys = Object.keys(FOLDED_GROUPS);
  for (let gi = 0; gi < gkeys.length; gi++) {
    const group = FOLDED_GROUPS[gkeys[gi]] || [];
    for (let ai = 0; ai < group.length; ai++) {
      if (group[ai] === t) {
        hits.push(gkeys[gi]);
        break;
      }
    }
  }
  return hits;
}

function countAliases() {
  let total = 0;
  let male = 0;
  let female = 0;
  const femaleKeys =
    /^(katerina|veronika|jana_f|petra|tereza|lucie|michaela|marie|eva|anna|barbora|monika|lenka|andrea|nikola|natalie|kristyna|simona|martina|alena|helena|iva|ivana|zuzana|denisa|karolina|adela|eliska|klara|gabriela|marketa|sarka|pavla|pavlina|hana|jitka|renata|romana|vendula|miroslava|stanislava|jaroslava|vera|blanka|dana|jarmila|milada|bozena|ruzena|libuse|ludmila)$/;
  const keys = Object.keys(FOLDED_GROUPS);
  for (let i = 0; i < keys.length; i++) {
    const n = (FOLDED_GROUPS[keys[i]] || []).length;
    total += n;
    if (femaleKeys.test(keys[i])) female += n;
    else male += n;
  }
  return { total: total, male: male, female: female, groups: keys.length };
}

module.exports = {
  IU_SILVER_CZECH_PERSON_ALIAS_GROUPS_V1,
  FOLDED_GROUPS,
  foldCs,
  expandPersonAliasTokens,
  aliasGroupKeysForToken,
  countAliases
};
