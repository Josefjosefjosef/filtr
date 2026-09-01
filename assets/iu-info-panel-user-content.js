/**
 * Uživatelský obsah informačních dialogů — informační lišta InfoUzel.cz.
 * Každý ukazatel: význam, důležitost, interpretace, dopad do běžného života.
 */
export const IU_INFO_PANEL_GROUP_LABELS = {
  daily: "Denní ukazatele",
  economy: "Ekonomika a finance",
  labor: "Trh práce",
  population: "Populace a demografie",
  society: "Společnost",
};

export const IU_INFO_PANEL_FREQUENCY_LABELS = {
  hourly: "Hodinově",
  daily: "Denně (pracovní dny)",
  weekly: "Týdně",
  monthly: "Měsíčně",
  quarterly: "Čtvrtletně",
  semi_annual: "Pololetně",
  annual: "Ročně",
  school_year: "Školní rok",
  event: "Po konání akce",
};

/** @type {Record<string, { meaning: string, importance: string, rise: string, fall: string, life: string }>} */
export const IU_INFO_PANEL_USER_CONTENT = {
  fuel: {
    meaning:
      "Průměrná cena motorového benzínu Natural 95 v Česku. Ukazuje, kolik stojí tankování u běžného benzinu na čerpacích stanicích.",
    importance: "Palivo ovlivňuje náklady na dojíždění, dopravu zboží i ceny v obchodech.",
    rise: "Růst ceny znamená dražší tankování a často i vyšší náklady na dopravu.",
    fall: "Pokles ceny zlevňuje cestování autem a může pomoci domácnostem ušetřit.",
    life: "Sledujte ho při plánování cest, porovnávání nákladů na auto a rodinného rozpočtu.",
  },
  transport: {
    meaning: "Průměrná cena motorové nafty. Nafta pohání většinu nákladní dopravy i mnoho osobních aut.",
    importance: "Cena nafty se promítá do cen potravin, stavebnin i služeb závislých na dopravě.",
    rise: "Dražší nafta zvyšuje náklady dopravců a může zdražit zboží v obchodech.",
    fall: "Levnější nafta snižuje provozní náklady firem i domácností.",
    life: "Důležité pro řidiče naftových vozů a pro pochopení, proč se mění ceny v obchodech.",
  },
  eur_czk: {
    meaning: "Kolik korun stojí jedno euro podle oficiálního kurzu České národní banky.",
    importance: "Euro ovlivňuje ceny dováženého zboží, dovolenou v zahraničí i splátky úvěrů v eurech.",
    rise: "Silnější euro znamená dražší nákupy v eurozóně a dražší dovážené zboží.",
    fall: "Slabší euro zlevňuje nákupy v zahraničí a může pomoci exportérům.",
    life: "Sledujte ho před cestou do EU, při nákupu online ze zahraničí nebo při splácení eur.",
  },
  usd_czk: {
    meaning: "Oficiální kurz amerického dolaru vůči koruně podle ČNB.",
    importance: "Dolar ovlivňuje ceny surovin, technologií a mnoha globálních komodit.",
    rise: "Dražší dolar zdražuje dovážené zboží a služby placené v USD.",
    fall: "Levnější dolar zlevňuje nákupy z USA a některé globální produkty.",
    life: "Užitečné při cestách, online nákupech a pochopení cen energií či kovů.",
  },
  electricity: {
    meaning:
      "Index spotřebitelských cen za bydlení, vodu, energie a paliva (COICOP). Není to cena za kilowatthodinu, ale vývoj cen této kategorie.",
    importance: "Energie jsou velká položka domácností — ovlivňují účty za elektřinu, plyn i topení.",
    rise: "Růst indexu signalizuje dražší energie a vyšší náklady na provoz domácnosti.",
    fall: "Pokles indexu znamená levnější energie nebo pomalejší růst jejich cen.",
    life: "Pomáhá pochopit, zda rostou náklady na bydlení rychleji než váš příjem.",
  },
  gold: {
    meaning: "Orientační tržní cena tokenizovaného zlata PAX Gold v korunách.",
    importance: "Zlato bývá považováno za útočiště v nejistých dobách a hedge proti inflaci.",
    rise: "Růst ceny může signalizovat nejistotu na trzích nebo silnou poptávku po zlatu.",
    fall: "Pokles může znamenat větší důvěru v rizikové investice nebo silnou korunu.",
    life: "Relevantní pro investory; běžný uživatel ho vnímá jako ukazatel tržní nálady.",
  },
  bitcoin: {
    meaning: "Orientační tržní cena bitcoinu v korunách podle agregovaných burzovních dat.",
    importance: "Bitcoin je volatilní digitální aktivum sledované investory i médii.",
    rise: "Růst může znamenat rostoucí zájem investorů, ale i spekulaci.",
    fall: "Pokles signalizuje korekci nebo nižší důvěru v krypto trhy.",
    life: "Pro běžného uživatele spíše ukazatel sentimentu než každodenní výdaje.",
  },
  inflation: {
    meaning: "Meziroční růst spotřebitelských cen — o kolik procent je dnes nákupní košík dražší než před rokem.",
    importance: "Inflace snižuje kupní sílu peněz a ovlivňuje úspory, mzdy i úroky.",
    rise: "Vyšší inflace znamená rychlejší zdražování — peníze mají menší hodnotu.",
    fall: "Nižší inflace znamená pomalejší růst cen a větší stabilitu pro domácnosti.",
    life: "Sledujte ji u úspor, vyjednávání o platu a plánování rodinného rozpočtu.",
  },
  unemployment: {
    meaning:
      "Podíl nezaměstnaných osob (PNO) dle metodiky MPSV: dosažitelní uchazeči o zaměstnání ve věku 15–64 let vůči obyvatelstvu ve stejném věku. Nejde o obecnou míru nezaměstnanosti ČSÚ z VŠPS.",
    importance: "Ukazuje registrovanou nezaměstnanost z evidence Úřadu práce a sílu nabídky práce.",
    rise: "Růst podílu znamená více dosažitelných uchazečů vůči produktivnímu obyvatelstvu.",
    fall: "Pokles znamená relativně méně registrovaných dosažitelných uchazečů.",
    life: "Důležité při hledání práce, změně kariéry nebo podnikání v daném odvětví.",
  },
  avg_wage: {
    meaning: "Průměrná hrubá měsíční mzda zaměstnanců v Česku (čtvrtletní údaj). Průměr zahrnuje i velmi vysoké platy.",
    importance: "Ukazuje, jak se vyvíjí mzdy v ekonomice, ale nemusí odpovídat typickému platu.",
    rise: "Růst průměrné mzdy znamená celkově vyšší odměny v ekonomice.",
    fall: "Pokles nebo zpomalení růstu může signalizovat tlak na firemní náklady.",
    life: "Porovnejte ho se svým platem — medián bývá nižší než průměr.",
  },
  avg_gross_wage: {
    meaning: "Roční průměr hrubé měsíční mzdy zaměstnanců. Doplňuje čtvrtletní ukazatel dlouhodobým pohledem.",
    importance: "Pomáhá sledovat dlouhodobý růst mezd a kupní sílu.",
    rise: "Růst znamená, že mzdy v průměru rostou — pokud ne rychleji než inflace.",
    fall: "Pokles reálných mezd znamená, že peníze nestačí na stejnou životní úroveň.",
    life: "Užitečné při plánování kariéry a vyjednávání o platu.",
  },
  gdp: {
    meaning: "Hrubý domácí produkt — celková hodnota zboží a služeb vyprodukovaných v Česku. Zde mezičtvrtletní růst.",
    importance: "HDP ukazuje, zda ekonomika roste, stagnuje, nebo klesá.",
    rise: "Růst HDP obvykle znamená více práce, investic a vyšší prosperitu.",
    fall: "Pokles (recese) může znamenat propouštění a nižší jistotu příjmů.",
    life: "Ovlivňuje dostupnost práce, růst mezd a celkovou ekonomickou náladu.",
  },
  industry: {
    meaning: "Index průmyslové produkce — kolik zboží české továrny a dílny vyrobily oproti minulému roku.",
    importance: "Průmysl je páteří exportu a zaměstnanosti v mnoha regionech.",
    rise: "Růst produkce signalizuje silnou poptávku a dobré časy pro průmyslové firmy.",
    fall: "Pokles může znamenat slabší export nebo nižší objednávky.",
    life: "Důležité pro zaměstnance ve výrobě a dodavatelském řetězci.",
  },
  construction: {
    meaning: "Index stavební produkce — vývoj objemu stavebních prací v Česku.",
    importance: "Stavebnictví ovlivňuje bydlení, infrastrukturu i zaměstnanost řemeslníků.",
    rise: "Růst znamená více staveb a silnější poptávku po stavebních službách.",
    fall: "Pokles může znamenat méně nových projektů a nižší poptávku po stavebních firmách.",
    life: "Relevantní při plánování rekonstrukce, koupě nemovitosti nebo práce ve stavebnictví.",
  },
  retail: {
    meaning: "Index tržeb maloobchodu — jak se vyvíjí prodej zboží v obchodech oproti minulému roku.",
    importance: "Maloobchod odráží spotřebu domácností a jejich ochotu utrácet.",
    rise: "Růst tržeb znamená, že lidé více nakupují — ekonomika je silná.",
    fall: "Pokles může signalizovat úsporné chování nebo nižší kupní sílu.",
    life: "Pomáhá pochopit, zda se spotřebitelé utahují opasky.",
  },
  agriculture: {
    meaning: "Index cen zemědělských výrobců — za kolik farmáři prodávají své produkty.",
    importance: "Ceny z farmy se postupně promítají do cen potravin v obchodech.",
    rise: "Růst může předcházet dražším potravinám v obchodech.",
    fall: "Pokles může znamenat levnější suroviny, ale i tlak na příjmy farmářů.",
    life: "Sledujte ho u plánování nákupů potravin a stravování.",
  },
  job_vacancies: {
    meaning: "Počet volných pracovních míst evidovaných úřadem práce.",
    importance: "Ukazuje, kolik firem hledá zaměstnance a jak snadné je sehnat práci.",
    rise: "Více volných míst znamená větší nabídku práce pro uchazeče.",
    fall: "Méně míst signalizuje převis nabídky práce nebo opatrnost firem.",
    life: "Důležité při hledání zaměstnání nebo změně oboru.",
  },
  employment: {
    meaning: "Počet zaměstnaných osob podle výběrového šetření pracovních sil (VŠPS).",
    importance: "Ukazuje, kolik lidí má práci a jak se vyvíjí trh práce.",
    rise: "Růst zaměstnanosti znamená více pracovních míst a silnější ekonomiku.",
    fall: "Pokles může signalizovat propouštění nebo demografické změny.",
    life: "Pomáhá pochopit celkovou situaci na trhu práce ve vašem regionu.",
  },
  registered_unemployment: {
    meaning: "Počet uchazečů o zaměstnání v evidenci úřadu práce.",
    importance: "Doplňuje podíl nezaměstnanosti absolutním počtem lidí bez práce.",
    rise: "Více uchazečů znamená vyšší konkurenci o pracovní místa.",
    fall: "Méně uchazečů signalizuje snazší hledání práce.",
    life: "Užitečné pro orientaci v situaci na trhu práce.",
  },
  population: {
    meaning: "Počet obyvatel České republiky k referenčnímu datu.",
    importance: "Populace ovlivňuje poptávku po bydlení, školách, zdravotnictví i důchodech.",
    rise: "Růst populace znamená více obyvatel — větší poptávka po službách.",
    fall: "Pokles může znamenat stárnoucí společnost a tlak na systém péče.",
    life: "Důležité pro dlouhodobé plánování regionu, kde žijete.",
  },
  births: {
    meaning: "Počet živě narozených dětí za rok v Česku.",
    importance: "Narozenost ovlivňuje budoucí velikost populace, školy a trh práce.",
    rise: "Více narození znamená mladší populaci a vyšší poptávku po školkách.",
    fall: "Méně narození může v budoucnu znamenat nedostatek pracovníků.",
    life: "Relevantní pro plánování rodiny a veřejných služeb v obci.",
  },
  deaths: {
    meaning: "Počet zemřelých osob za rok v Česku.",
    importance: "Spolu s narozeností určuje přirozený přírůstek populace.",
    rise: "Vyšší úmrtnost může souviset se stárnoucí populací nebo mimořádnými událostmi.",
    fall: "Nižší úmrtnost přispívá k růstu populace.",
    life: "Statistický ukazatel demografického vývoje země.",
  },
  marriages: {
    meaning: "Počet uzavřených manželství za rok.",
    importance: "Odráží společenské a demografické trendy.",
    rise: "Více sňatků může souviset s demografickými vlnami.",
    fall: "Pokles může odrážet odklad sňatků nebo změnu preferencí.",
    life: "Spíše statistika pro pochopení demografického vývoje.",
  },
  divorces: {
    meaning: "Počet rozvodů za rok v Česku.",
    importance: "Doplňuje obraz o stabilitě rodin a demografických trendech.",
    rise: "Více rozvodů může souviset se společenskými změnami.",
    fall: "Méně rozvodů může znamenat stabilnější rodinné vztahy.",
    life: "Statistický ukazatel bez přímého dopadu na každodenní nákupy.",
  },
  foreigners: {
    meaning: "Počet cizinců s pobytem v České republice.",
    importance: "Migrace ovlivňuje trh práce, školství i demografickou strukturu.",
    rise: "Více cizinců může znamenat silnější pracovní trh a kulturní diverzitu.",
    fall: "Pokles může signalizovat odchod pracovníků nebo přísnější pravidla.",
    life: "Důležité pro pochopení demografických změn ve vašem okolí.",
  },
  seniors: {
    meaning: "Podíl obyvatel ve věku 65 let a více na celkové populaci.",
    importance: "Stárnoucí společnost ovlivňuje zdravotnictví, důchody a péči.",
    rise: "Vyšší podíl seniorů znamená větší poptávku po zdravotní a sociální péči.",
    fall: "Nižší podíl znamená mladší populaci.",
    life: "Relevantní pro plánování péče o rodiče a dlouhodobé veřejné služby.",
  },
  migration: {
    meaning: "Počet přistěhovalých osob do Česka za rok.",
    importance: "Přistěhovalectví doplňuje pracovní trh a ovlivňuje demografii.",
    rise: "Více přistěhovalých může posílit ekonomiku a trh práce.",
    fall: "Méně přistěhovalých může znamenat nižší demografický přírůstek.",
    life: "Pomáhá pochopit, proč se mění složení obyvatelstva v regionech.",
  },
  education: {
    meaning: "Počet žáků středních škol v Česku.",
    importance: "Ukazuje poptávku po středoškolském vzdělávání a demografické vlny.",
    rise: "Více žáků může znamenat větší tlak na kapacity škol.",
    fall: "Méně žáků může souviset s demografickým poklesem mládeže.",
    life: "Důležité pro rodiče plánující školu pro děti.",
  },
  health: {
    meaning: "Náklady zdravotních pojišťoven na zdravotní služby (v milionech korun).",
    importance: "Ukazuje, kolik se v Česku utratí za zdravotní péči.",
    rise: "Rostoucí náklady mohou signalizovat dražší péči nebo vyšší využití služeb.",
    fall: "Pokles může znamenat efektivnější systém nebo nižší poptávku.",
    life: "Relevantní pro pochopení financování zdravotnictví, které platíme z pojištění.",
  },
  crime: {
    meaning: "Počet registrovaných skutků celkové kriminality v Česku.",
    importance: "Ukazuje bezpečnostní situaci v zemi.",
    rise: "Více registrovaných skutků může znamenat vyšší kriminalitu nebo lepší evidenci.",
    fall: "Pokles obvykle znamená bezpečnější prostředí.",
    life: "Pomáhá vnímat celkovou bezpečnost, i když lokální situace se liší.",
  },
  elections: {
    meaning: "Volební účast ve volbách do Poslanecké sněmovny Parlamentu ČR.",
    importance: "Ukazuje, jak moc lidé participují na demokratickém rozhodování.",
    rise: "Vyšší účast znamená větší zapojení voličů.",
    fall: "Nišší účast může signalizovat apatii nebo nespokojenost.",
    life: "Důležité před volbami — vyšší účast posiluje legitimitu výsledku.",
  },
};

export function getInfoPanelUserContent(id) {
  return IU_INFO_PANEL_USER_CONTENT[id] || null;
}
