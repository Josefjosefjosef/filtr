/**
 * infoUzel.cz — Affiliate services catalog (UI + data).
 * Partner URLs are placeholders until affiliate programs are approved.
 */
(function iuAffiliateCatalog() {
  "use strict";

  if (window.__iuAffiliateCatalogBooted) return;
  window.__iuAffiliateCatalogBooted = true;

  var IU_AFFILIATE_DISCLOSURE_TEXT =
    "Tato sekce obsahuje reklamní a partnerské odkazy na ověřené služby a obchody.";

  function renderAffiliateDisclosure(el) {
    if (!el) return;
    el.innerHTML = escapeHtml(IU_AFFILIATE_DISCLOSURE_TEXT);
  }

  function affItem(title, slug) {
    return {
      title: title,
      url: "#affiliate-placeholder-" + slug,
      affiliateUrlReady: false,
    };
  }

  function affSeo(title, paragraphs, keywords) {
    return {
      title: title,
      paragraphs: paragraphs,
      keywords: keywords,
    };
  }

  function getAffCssColor(catId) {
    try {
      var v = getComputedStyle(document.documentElement)
        .getPropertyValue("--iuAff-" + catId)
        .trim();
      return v || "";
    } catch (_) {
      return "";
    }
  }

  var IU_AFFILIATE_SEO = {
    "aff-cestovni-kancelare": affSeo(
      "Cestovní kanceláře a zájezdy online",
      [
        "V sekci Cestovní kanceláře najdete přehled známých touroperátorů a portálů se zájezdy do Evropy i exotických destinací. Rychle otevřete nabídky last minute, rodinných dovolených u moře, poznávacích cest i lyžařských pobytů.",
        "Praktický rozcestník ušetří čas při hledání aktuálních akcí, termínů odletů a dostupnosti kapacit. Hodí se, když chcete porovnat více cestovních kanceláří na jednom místě.",
        "Cílem je nabídnout přehledné odkazy na ověřené služby pro plánování dovolené bez zbytečného proklikávání.",
      ],
      "cestovní kanceláře, zájezdy, last minute, dovolená u moře, poznávací cesty"
    ),
    "aff-ubytovani-hotely": affSeo(
      "Ubytování, hotely a apartmány",
      [
        "Sekce Ubytování a hotely shrnuje služby pro rezervaci hotelů, apartmánů, penzionů i wellness pobytů v Česku i v zahraničí.",
        "Snadno najdete nabídky pro víkendové pobyty, rodinnou dovolenou, pracovní cesty nebo romantický výlet. Užitečné je i při rychlém porovnání dostupnosti termínů a cen.",
        "Jde o praktický rozcestník pro každého, kdo hledá spolehlivé ubytování online.",
      ],
      "ubytování, hotely, apartmány, rezervace, wellness pobyty"
    ),
    "aff-letenky": affSeo(
      "Letenky a cestovní pomoc online",
      [
        "Letenky a cestovní pomoc spojují vyhledávače letenek, dopravce a služby pro cestující, včetně pomoci s kompenzacemi nebo zpožděními.",
        "Sekce je užitečná při plánování cest po Evropě i do vzdálenějších destinací, a také když potřebujete rychle ověřit spojení autobusem či vlakem.",
        "Cílem je mít po ruce ověřené odkazy pro cestování bez zbytečného hledání.",
      ],
      "letenky, levné letenky, cestovní pomoc, kompenzace, autobusy"
    ),
    "aff-cestovni-pojisteni": affSeo(
      "Cestovní pojištění a asistence",
      [
        "Cestovní pojištění chrání před neočekávanými výdaji na zahraniční dovolené i pracovní cesty. V této sekci najdete přehled pojišťoven a asistenčních služeb.",
        "Hodí se před odletem k moři, na hory i na krátký víkend v EU, kdy potřebujete rychle srovnat rozsah krytí, limity a asistenci.",
        "Praktický rozcestník usnadní výběr cestovního pojištění podle typu cesty.",
      ],
      "cestovní pojištění, asistenční služby, pojištění na dovolenou"
    ),
    "aff-auto-moto": affSeo(
      "Auto, moto a příslušenství",
      [
        "Sekce Auto a moto sdružuje e-shopy s autodoplňky, pneumatikami, moto vybavením i servisními produkty pro řidiče a motorkáře.",
        "Pomůže při nákupu sezónních pneumatik, olejů, autokosmetiky, brašen, helmic nebo příslušenství pro údržbu vozu.",
        "Cílem je rychlý přístup k ověřeným obchodům pro motoristy.",
      ],
      "auto, moto, pneumatiky, autodoplňky, motorkářské vybavení"
    ),
    "aff-pojisteni": affSeo(
      "Pojištění vozidel, majetku a odpovědnosti",
      [
        "V kategorii Pojištění najdete odkazy na srovnání a sjednání pojištění vozidel, domácnosti, odpovědnosti i dalších běžných produktů.",
        "Sekce je užitečná, když chcete rychle porovnat nabídky pojišťoven, ceny a rozsah krytí před obnovou smlouvy.",
        "Jde o praktický rozcestník pro informované rozhodnutí o pojištění.",
      ],
      "pojištění, povinné ručení, havarijní pojištění, pojištění domácnosti"
    ),
    "aff-finance": affSeo(
      "Finance, investice a platební služby",
      [
        "Finance shrnují digitální bankovní služby, investiční platformy, půjčky, splátkové programy a další finanční nástroje pro běžné použití.",
        "Sekce pomáhá rychle najít ověřené služby pro správu peněz, spoření, investování nebo výhodnější placení online.",
        "Cílem je přehledný vstup do světa osobních financí bez zbytečného hledání.",
      ],
      "finance, investice, půjčky, platební služby, spoření"
    ),
    "aff-energie-uspor": affSeo(
      "Energie, úspory a domácí efektivita",
      [
        "Energie a úspory nabízejí odkazy na srovnání dodavatelů energií, úsporné produkty a technologie pro nižší spotřebu domácnosti.",
        "Hodí se při hledání levnějšího tarifu, LED osvětlení, chytrého měření nebo tipů, jak snížit náklady na elektřinu a plyn.",
        "Praktický rozcestník pro každého, kdo chce lépe hospodařit s domácí energií.",
      ],
      "energie, úspory, elektřina, plyn, LED osvětlení"
    ),
    "aff-lekarny": affSeo(
      "Online lékárny a zdravotní sortiment",
      [
        "Lékárny online umožňují rychlý nákup volně prodejných léků, doplňků, kosmetiky a zdravotnických potřeb s doručením domů.",
        "Sekce je užitečná, když potřebujete rychle objednat běžné preparáty, vitamíny nebo produkty pro celou rodinu.",
        "Cílem je přehledný přístup k ověřeným internetovým lékárnám.",
      ],
      "lékárna online, e-lékárna, volně prodejné léky, zdravotní potřeby"
    ),
    "aff-zdravi-doplnky": affSeo(
      "Zdraví, doplňky stravy a wellness",
      [
        "Zdraví a doplňky sdružují e-shopy se doplňky stravy, produkty pro aktivní životní styl, rehabilitaci a celkovou pohodu.",
        "Sekce pomáhá najít ověřené značky vitamínů, proteinů, bylinných produktů i pomůcek pro domácí péči o zdraví.",
        "Praktický rozcestník pro každodenní podporu zdravého životního stylu.",
      ],
      "zdraví, doplňky stravy, vitamíny, wellness, rehabilitace"
    ),
    "aff-kosmetika": affSeo(
      "Kosmetika, parfémy a péče o pleť",
      [
        "Kosmetika a parfémy nabízejí přehled obchodů s makeupy, parfémy, pleťovou péčí a dárkovými sady pro ženy i muže.",
        "Hodí se při hledání novinek, slev, niche vůní nebo osvědčené péče pro citlivou pleť.",
        "Cílem je rychlý přístup ke kvalitní kosmetice online.",
      ],
      "kosmetika, parfémy, péče o pleť, makeup, dárkové sady"
    ),
    "aff-drogerie": affSeo(
      "Drogerie a domácí péče",
      [
        "Drogerie online spojují běžné produkty pro domácnost, hygienu, péči o tělo i ekologické alternativy.",
        "Sekce je praktická pro pravidelný nákup papírenského zboží, pracích prostředků, kosmetiky a drobností pro celou rodinu.",
        "Rozcestník šetří čas při objednávání z ověřených drogerií.",
      ],
      "drogerie, domácí péče, hygiena, ekologická drogerie"
    ),
    "aff-moda": affSeo(
      "Móda a oblečení online",
      [
        "Móda sdružuje e-shopy s oblečením pro ženy, muže i děti včetně běžné módy, značkových kolekcí a sezónních výprodejů.",
        "Sekce pomáhá rychle najít nové kolekce, slevy a ověřené obchody s doručením po celé ČR.",
        "Praktický rozcestník pro nákup oblečení online.",
      ],
      "móda, oblečení, fashion e-shopy, slevy, značková móda"
    ),
    "aff-boty": affSeo(
      "Boty, tenisky a barefoot obuv",
      [
        "Boty a tenisky nabízejí přehled obchodů s volnočasovou, sportovní i elegantní obuví včetně barefoot a minimalistických střihů.",
        "Hodí se při výběru sezónní obuvi, běžeckých tenisek nebo pohodlné obuvi na každý den.",
        "Cílem je rychlý přístup k široké nabídce obuvi online.",
      ],
      "boty, tenisky, barefoot, obuv online, sportovní obuv"
    ),
    "aff-sportovni-obleceni": affSeo(
      "Sportovní oblečení a funkční móda",
      [
        "Sportovní oblečení sdružuje značky s funkčními materiály pro běh, fitness, outdoor i týmové sporty.",
        "Sekce je užitečná při hledání kvalitního sportovního oblečení, termo vrstev nebo výbavy pro pravidelný trénink.",
        "Praktický rozcestník pro aktivní sportovce i rekreační uživatele.",
      ],
      "sportovní oblečení, funkční móda, fitness, běžecké oblečení"
    ),
    "aff-sport-outdoor": affSeo(
      "Sport, outdoor a aktivní život",
      [
        "Sport a outdoor spojují e-shopy s vybavením na turistiku, kempování, cyklistiku, rybaření i další volnočasové aktivity.",
        "Hodí se při plánování výletu, nákupu stanu, batohu, trekingového vybavení nebo sportovních potřeb pro děti.",
        "Cílem je mít po ruce ověřené obchody pro aktivní trávení volného času.",
      ],
      "outdoor, sport, turistika, kempování, cyklistika"
    ),
    "aff-dum-zahrada": affSeo(
      "Dům, zahrada a hobby",
      [
        "Dům a zahrada shrnují obchody se stavebním materiálem, zahradní technikou, nářadím a vybavením pro rekonstrukce i hobby projekty.",
        "Sekce pomáhá rychle najít produkty pro údržbu zahrady, stavbu pergoly, zavlažování nebo vybavení dílny.",
        "Praktický rozcestník pro majitele domů a zahrádkáře.",
      ],
      "dům, zahrada, hobby, zahradní technika, rekonstrukce"
    ),
    "aff-nabytek": affSeo(
      "Nábytek, bydlení a dekorace",
      [
        "Nábytek a bydlení nabízejí e-shopy s nábytkem, matracemi, osvětlením a doplňky pro obývák, ložnici i pracovnu.",
        "Hodí se při zařizování bytu, výměně matrace nebo hledání designových kousků za rozumnou cenu.",
        "Cílem je přehledný vstup do světa online nábytku a bydlení.",
      ],
      "nábytek, bydlení, matrace, dekorace, interiér"
    ),
    "aff-kuchyn": affSeo(
      "Kuchyně, domácnost a spotřebiče",
      [
        "Kuchyně a domácnost sdružují obchody s kuchyňskými potřebami, spotřebiči, úklidovými produkty a vybavením pro každodenní provoz domácnosti.",
        "Sekce je užitečná při výběru hrnců, nožů, robotů, vysavačů nebo organizace kuchyně.",
        "Praktický rozcestník pro vybavení moderní domácnosti.",
      ],
      "kuchyně, domácnost, spotřebiče, kuchyňské potřeby, úklid"
    ),
    "aff-elektro": affSeo(
      "Elektro a chytrá domácnost",
      [
        "Elektro a chytrá domácnost spojují e-shopy s elektronikou, spotřebiči, robotickými vysavači, chytrými zařízeními a příslušenstvím.",
        "Hodí se při výběru televize, audio vybavení, domácích robotů nebo produktů pro automatizaci bytu.",
        "Cílem je rychlý přístup k ověřeným prodejcům elektroniky.",
      ],
      "elektro, chytrá domácnost, robotický vysavač, elektronika, spotřebiče"
    ),
    "aff-mobily": affSeo(
      "Mobily, tablety a příslušenství",
      [
        "Mobily a příslušenství nabízejí obchody s telefony, kryty, tvrzeným sklem, nabíječkami a dalšími doplňky pro každodenní použití.",
        "Sekce pomáhá rychle najít vhodné příslušenství, ochranu displeje nebo repasované a nové telefony.",
        "Praktický rozcestník pro mobilní techniku a doplňky.",
      ],
      "mobily, telefony, příslušenství, tvrzené sklo, kryty"
    ),
    "aff-software": affSeo(
      "Software, antiviry a digitální bezpečnost",
      [
        "Software a bezpečnost sdružují antiviry, VPN služby, kancelářské nástroje a další digitální produkty pro ochranu soukromí i práci.",
        "Hodí se při výběru zabezpečení počítače, mobilu nebo domácí sítě a také pro nákup licencí software.",
        "Cílem je přehledný vstup do světa digitální bezpečnosti.",
      ],
      "software, antivir, VPN, bezpečnost, digitální služby"
    ),
    "aff-knihy": affSeo(
      "Knihy, filmy, hry a zábava",
      [
        "Knihy, filmy a hry spojují knihkupectví, prodejce deskových her, audioknih a streamovacích služeb pro volný čas.",
        "Sekce je užitečná při hledání nové četby, dárků pro děti nebo zábavy pro celou rodinu.",
        "Praktický rozcestník pro kulturu a volnočasové aktivity doma.",
      ],
      "knihy, filmy, hry, deskové hry, zábava"
    ),
    "aff-jidlo": affSeo(
      "Jídlo, potraviny a online nákup",
      [
        "Jídlo a potraviny shrnují služby pro online nákup potravin, kávy, čokolády, zdravé výživy a gastronomických specialit.",
        "Hodí se pro pravidelný rozvoz nákupu, objednání kvalitní kávy nebo výběr produktů pro zdravější stravování.",
        "Cílem je rychlý přístup k ověřeným potravinovým e-shopům.",
      ],
      "potraviny, online nákup, rozvoz potravin, káva, zdravá výživa"
    ),
    "aff-zvirata": affSeo(
      "Zvířata, krmiva a chovatelské potřeby",
      [
        "Zvířata a chovatelství nabízejí e-shopy s krmivy, hračkami, pelíšky a vybavením pro psy, kočky i další domácí mazlíčky.",
        "Sekce pomáhá rychle najít kvalitní krmivo, antiparazitika nebo doplňky pro péči o zvíře.",
        "Praktický rozcestník pro chovatele a majitele domácích mazlíčků.",
      ],
      "zvířata, krmivo, chovatelské potřeby, psi, kočky"
    ),
  };

  var IU_AFFILIATE_CATALOG = [
    {
      id: "aff-cestovni-kancelare",
      title: "Cestovní kanceláře",
      icon: "iu-aff-suitcase",
      description: "Vyberte si cestovní kancelář a zobrazte aktuální nabídku zájezdů.",
      items: [
        affItem("Čedok", "cedok"),
        affItem("Blue Style", "blue-style"),
        affItem("Fischer", "fischer"),
        affItem("Exim Tours", "exim-tours"),
        affItem("Nev-Dama", "nev-dama"),
        affItem("TUI", "tui"),
        affItem("Invia", "invia"),
        affItem("Dovolená.cz", "dovolena-cz"),
      ],
    },
    {
      id: "aff-ubytovani-hotely",
      title: "Ubytování a hotely",
      icon: "iu-aff-hotel",
      description: "Najděte ubytování, hotely, apartmány nebo wellness pobyty.",
      items: [
        affItem("Booking.com", "booking"),
        affItem("Agoda", "agoda"),
        affItem("Hotels.com", "hotels-com"),
        affItem("Spa.cz", "spa-cz"),
        affItem("Slevomat pobyty", "slevomat-pobyty"),
        affItem("Travelking", "travelking"),
        affItem("Hotel.cz", "hotel-cz"),
        affItem("MegaUbytko", "megaubytka"),
      ],
    },
    {
      id: "aff-letenky",
      title: "Letenky a cestovní pomoc",
      icon: "iu-aff-plane",
      description: "Služby pro cesty, letenky, kompenzace a cestovní podporu.",
      items: [
        affItem("AirHelp", "airhelp"),
        affItem("Refundio", "refundio"),
        affItem("Kiwi.com", "kiwi"),
        affItem("Letuška", "letuska"),
        affItem("Pelikan", "pelikan"),
        affItem("LOT", "lot"),
        affItem("Leo Express", "leo-express"),
        affItem("FlixBus", "flixbus"),
      ],
    },
    {
      id: "aff-cestovni-pojisteni",
      title: "Cestovní pojištění",
      icon: "iu-aff-shield",
      description: "Cestovní pojištění a asistence na cesty.",
      items: [
        affItem("AXA Assistance", "axa"),
        affItem("Direct", "direct-cestovni"),
        affItem("ERGO cestovní pojištění", "ergo-cestovni"),
        affItem("Generali", "generali-cestovni"),
        affItem("ČSOB Pojišťovna", "csob-cestovni"),
        affItem("Slavia pojišťovna", "slavia-cestovni"),
      ],
    },
    {
      id: "aff-auto-moto",
      title: "Auto a moto",
      icon: "iu-aff-car",
      description: "Auto-moto obchody, příslušenství, pneumatiky a motorkářské vybavení.",
      items: [
        affItem("24MX", "24mx"),
        affItem("Ahifi", "ahifi"),
        affItem("Autohotarek", "autohotarek"),
        affItem("BestDrive", "bestdrive"),
        affItem("XL Moto", "xl-moto"),
        affItem("Pneuboss", "pneuboss"),
        affItem("PneuLeader", "pneuleader"),
        affItem("Motozem", "motozem"),
      ],
    },
    {
      id: "aff-pojisteni",
      title: "Pojištění",
      icon: "iu-aff-shield",
      description: "Porovnání a sjednání pojištění.",
      items: [
        affItem("Direct", "direct-pojisteni"),
        affItem("Klikpojištění", "klikpojisteni"),
        affItem("Kalkulator.cz", "kalkulator-pojisteni"),
        affItem("Generali", "generali-pojisteni"),
        affItem("ČSOB Pojišťovna", "csob-pojisteni"),
        affItem("Slavia pojišťovna", "slavia-pojisteni"),
        affItem("Pillow", "pillow"),
        affItem("UNIQA", "uniqa"),
      ],
    },
    {
      id: "aff-finance",
      title: "Finance",
      icon: "iu-finance",
      description: "Finanční produkty, splátky, investice a platební služby.",
      items: [
        affItem("Skip Pay", "skip-pay"),
        affItem("Portu", "portu"),
        affItem("Zonky", "zonky"),
        affItem("Kalkulator.cz", "kalkulator-finance"),
        affItem("Partners", "partners"),
        affItem("Kamali", "kamali"),
        affItem("Twisto", "twisto"),
        affItem("ČSOB produkty", "csob-finance"),
      ],
    },
    {
      id: "aff-energie-uspor",
      title: "Energie a úspory",
      icon: "iu-aff-bulb",
      description: "Srovnání energií, úsporné produkty a domácí technologie.",
      items: [
        affItem("Kalkulator.cz", "kalkulator-energie"),
        affItem("SMD LED žárovky", "smd-led"),
        affItem("LEDVANCE", "ledvance"),
        affItem("TIPA", "tipa"),
        affItem("E.ON produkty", "eon"),
        affItem("ČEZ produkty", "cez"),
        affItem("Energetické srovnávače", "energeticky-srovnavac"),
        affItem("Úsporné osvětlení", "usporne-osvetleni"),
      ],
    },
    {
      id: "aff-lekarny",
      title: "Lékárny",
      icon: "iu-aff-cross",
      description: "Online lékárny a zdravotní sortiment.",
      items: [
        affItem("Dr. Max", "dr-max"),
        affItem("Pilulka", "pilulka"),
        affItem("Lékárna.cz", "lekarna-cz"),
        affItem("Benu", "benu"),
        affItem("Lékárna Lemon", "lekarna-lemon"),
        affItem("Unizdrav", "unizdrav"),
        affItem("Moje lékárna", "moje-lekarna"),
        affItem("GigaLékárna", "gigalekarna"),
      ],
    },
    {
      id: "aff-zdravi-doplnky",
      title: "Zdraví a doplňky",
      icon: "iu-health",
      description: "Doplňky stravy, zdravý životní styl a zdravotní pomůcky.",
      items: [
        affItem("Klub zdraví", "klub-zdravi"),
        affItem("GS Klub", "gs-klub"),
        affItem("Terezia", "terezia"),
        affItem("Sensilab", "sensilab"),
        affItem("Prodietix", "prodietix"),
        affItem("Rehabilitační pomůcky", "rehabilitacni-pomucky"),
        affItem("Prozdravi.cz", "prozdravi"),
        affItem("BrainMarket", "brainmarket"),
      ],
    },
    {
      id: "aff-kosmetika",
      title: "Kosmetika a parfémy",
      icon: "iu-aff-perfume",
      description: "Kosmetika, parfémy, péče o pleť a osobní péče.",
      items: [
        affItem("Notino", "notino"),
        affItem("Sephora", "sephora"),
        affItem("Dermacol", "dermacol"),
        affItem("FAnn", "fann"),
        affItem("Marionnaud", "marionnaud"),
        affItem("L'Occitane", "loccitane"),
        affItem("Brasty", "brasty"),
        affItem("PinkPanda", "pinkpanda"),
      ],
    },
    {
      id: "aff-drogerie",
      title: "Drogerie",
      icon: "iu-aff-bottle",
      description: "Drogerie, domácí péče a ekologické čisticí prostředky.",
      items: [
        affItem("Rossmann", "rossmann"),
        affItem("Teta drogerie", "teta-drogerie"),
        affItem("Drogerko", "drogerko"),
        affItem("Dedra", "dedra"),
        affItem("Tierra Verde", "tierra-verde"),
        affItem("Econea", "econea"),
        affItem("VMD drogerie", "vmd-drogerie"),
        affItem("Country Life drogerie", "country-life-drogerie"),
      ],
    },
    {
      id: "aff-moda",
      title: "Móda",
      icon: "iu-aff-shirt",
      description: "Oblečení, módní značky a módní e-shopy.",
      items: [
        affItem("Answear", "answear"),
        affItem("Reserved", "reserved"),
        affItem("Cropp", "cropp"),
        affItem("HouseBrand", "housebrand"),
        affItem("Factcool", "factcool"),
        affItem("Bushman", "bushman"),
        affItem("PRM", "prm"),
        affItem("GANT", "gant"),
      ],
    },
    {
      id: "aff-boty",
      title: "Boty a tenisky",
      icon: "iu-aff-shoe",
      description: "Obuv, tenisky, barefoot a módní boty.",
      items: [
        affItem("Footshop", "footshop"),
        affItem("Queens", "queens"),
        affItem("Shooos", "shooos"),
        affItem("Rejnok obuv", "rejnok"),
        affItem("Realfoot", "realfoot"),
        affItem("BeLenka", "belenka"),
        affItem("Barebarics", "barebarics"),
        affItem("Skinners", "skinners"),
      ],
    },
    {
      id: "aff-sportovni-obleceni",
      title: "Sportovní oblečení",
      icon: "iu-aff-jersey",
      description: "Sportovní móda, funkční oblečení a značkové sportovní kolekce.",
      items: [
        affItem("Sportisimo", "sportisimo"),
        affItem("Decathlon", "decathlon"),
        affItem("Bezvasport", "bezvasport"),
        affItem("Meatfly", "meatfly"),
        affItem("Horsefeathers", "horsefeathers"),
        affItem("Husky", "husky"),
        affItem("JD Sports", "jd-sports"),
        affItem("Top4Sport", "top4sport"),
      ],
    },
    {
      id: "aff-sport-outdoor",
      title: "Sport a outdoor",
      icon: "iu-aff-tent",
      description: "Outdoor vybavení, sportovní potřeby, rybaření a aktivní život.",
      items: [
        affItem("4camping", "4camping"),
        affItem("inSPORTline", "insportline"),
        affItem("SportObchod", "sportobchod"),
        affItem("2sport", "2sport"),
        affItem("Bauer Hockey", "bauer-hockey"),
        affItem("D-sport", "d-sport"),
        affItem("Chytapust", "chytapust"),
        affItem("Parys", "parys"),
      ],
    },
    {
      id: "aff-dum-zahrada",
      title: "Dům a zahrada",
      icon: "iu-home-hobby",
      description: "Vybavení domu, zahrady, stavby a hobby.",
      items: [
        affItem("OBI", "obi"),
        affItem("Baumax", "baumax"),
        affItem("DEK", "dek"),
        affItem("Jarabák", "jarabak"),
        affItem("Sanitino", "sanitino"),
        affItem("SIKO", "siko"),
        affItem("Dumzahrada", "dumzahrada"),
        affItem("Mountfield", "mountfield"),
      ],
    },
    {
      id: "aff-nabytek",
      title: "Nábytek a bydlení",
      icon: "iu-aff-chair",
      description: "Nábytek, dekorace, matrace a vybavení interiéru.",
      items: [
        affItem("ASKO Nábytek", "asko-nabytek"),
        affItem("Benlemi", "benlemi"),
        affItem("Bonami", "bonami"),
        affItem("Ráj nábytku", "raj-nabytku"),
        affItem("eŽidle", "ezidle"),
        affItem("Diablochairs", "diablochairs"),
        affItem("Dormeo", "dormeo"),
        affItem("Beliani", "beliani"),
      ],
    },
    {
      id: "aff-kuchyn",
      title: "Kuchyně a domácnost",
      icon: "iu-aff-pot",
      description: "Kuchyňské vybavení, spotřebiče a pomocníci do domácnosti.",
      items: [
        affItem("Tescoma", "tescoma"),
        affItem("Fabini", "fabini"),
        affItem("Home&Cook", "home-cook"),
        affItem("DUKA", "duka"),
        affItem("Philips Home Appliances", "philips-home"),
        affItem("Kärcher", "karcher"),
        affItem("MediaShop", "mediashop"),
        affItem("Lauben", "lauben"),
      ],
    },
    {
      id: "aff-elektro",
      title: "Elektro a chytrá domácnost",
      icon: "iu-aff-plug",
      description: "Elektronika, spotřebiče, robotické vysavače a chytrá domácnost.",
      items: [
        affItem("LG", "lg"),
        affItem("Philips", "philips"),
        affItem("iRobot", "irobot"),
        affItem("Robotworld", "robotworld"),
        affItem("Robotický vysavač", "roboticky-vysavac"),
        affItem("DJIshop", "djishop"),
        affItem("Gorenje", "gorenje"),
        affItem("TrueLife", "truelife"),
      ],
    },
    {
      id: "aff-mobily",
      title: "Mobily a příslušenství",
      icon: "iu-aff-phone",
      description: "Mobily, kryty, ochranná skla a příslušenství.",
      items: [
        affItem("F-mobil", "f-mobil"),
        affItem("Tvrzenaskla.cz", "tvrzenaskla"),
        affItem("Momanio", "momanio"),
        affItem("Picasee", "picasee"),
        affItem("RCobchod", "rcobchod"),
        affItem("Allegro", "allegro"),
        affItem("Temu", "temu"),
        affItem("Mobil Pohotovost", "mobil-pohotovost"),
      ],
    },
    {
      id: "aff-software",
      title: "Software a bezpečnost",
      icon: "iu-aff-lock",
      description: "Antiviry, bezpečnostní software a digitální služby.",
      items: [
        affItem("Kaspersky", "kaspersky"),
        affItem("Norton", "norton"),
        affItem("ESET", "eset"),
        affItem("Avast", "avast"),
        affItem("NordVPN", "nordvpn"),
        affItem("Surfshark", "surfshark"),
        affItem("CyberGhost", "cyberghost"),
        affItem("SoftwarePro", "softwarepro"),
      ],
    },
    {
      id: "aff-knihy",
      title: "Knihy, filmy a hry",
      icon: "iu-aff-book",
      description: "Knihy, deskové hry, filmy, hudba a zábava.",
      items: [
        affItem("Knihy Dobrovský", "dobrovsky"),
        affItem("Martinus", "martinus"),
        affItem("Libristo", "libristo"),
        affItem("Grada", "grada"),
        affItem("Albi", "albi"),
        affItem("Bambule", "bambule"),
        affItem("DVD-premiéry", "dvd-premiery"),
        affItem("SkyShowtime", "skyshowtime"),
      ],
    },
    {
      id: "aff-jidlo",
      title: "Jídlo a potraviny",
      icon: "iu-aff-cart",
      description: "Online potraviny, káva, čokoláda, zdravá výživa a dobroty.",
      items: [
        affItem("Rohlík", "rohlik"),
        affItem("Tesco", "tesco"),
        affItem("Grizly", "grizly"),
        affItem("GourmetKava", "gourmetkava"),
        affItem("Svět plodů", "svet-plodu"),
        affItem("BAM čokoláda", "bam-cokolada"),
        affItem("Country Life", "country-life"),
        affItem("Aktin", "aktin"),
      ],
    },
    {
      id: "aff-zvirata",
      title: "Zvířata a chovatelství",
      icon: "iu-aff-paw",
      description: "Chovatelské potřeby, krmiva a vybavení pro mazlíčky.",
      items: [
        affItem("SuperZoo", "superzoo"),
        affItem("PetCenter", "petcenter"),
        affItem("Petissimo", "petissimo"),
        affItem("Spokojený pes", "spokojeny-pes"),
        affItem("Dogbarkode", "dogbarkode"),
        affItem("Reedog", "reedog"),
        affItem("Demix", "demix"),
        affItem("Zoohit", "zoohit"),
      ],
    },
  ];

  var IU_AFFILIATE_COLORS = {};

  function refreshAffiliateColorsFromCss() {
    for (var ri = 0; ri < IU_AFFILIATE_CATALOG.length; ri++) {
      var cid = IU_AFFILIATE_CATALOG[ri].id;
      IU_AFFILIATE_COLORS[cid] = getAffCssColor(cid);
    }
  }

  var catalogById = {};
  for (var ci = 0; ci < IU_AFFILIATE_CATALOG.length; ci++) {
    catalogById[IU_AFFILIATE_CATALOG[ci].id] = IU_AFFILIATE_CATALOG[ci];
  }

  /**
   * Defense-in-depth for SVG→innerHTML (SEC-FE-007): same-origin sprite is trusted,
   * but strip script/handlers/javascript: so a compromised asset cannot XSS.
   */
  function sanitizeInlineSvgMarkup(raw) {
    var txt = String(raw || "");
    if (!txt) return "";
    if (!/<svg[\s>]/i.test(txt)) return "";
    txt = txt.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    txt = txt.replace(/<\/?foreignObject\b[^>]*>/gi, "");
    txt = txt.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    txt = txt.replace(/javascript\s*:/gi, "");
    txt = txt.replace(/data\s*:\s*text\/html/gi, "");
    txt = txt.replace(/xlink:href\s*=\s*("|')\s*javascript:[^"']*\1/gi, "");
    return txt.replace("<svg ", '<svg id="iuAffInlineSprite" ').replace(/<svg>/i, '<svg id="iuAffInlineSprite">');
  }

  function ensureAffiliateInlineSprite(done) {
    if (document.getElementById("iuAffInlineSprite")) {
      if (typeof done === "function") done();
      return;
    }
    var host = document.getElementById("iuAffInlineSpriteHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "iuAffInlineSpriteHost";
      host.hidden = true;
      host.setAttribute("aria-hidden", "true");
      document.body.insertBefore(host, document.body.firstChild);
    }
    var loaded = false;
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", "/assets/icons/iu-sprite.svg", false);
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
        var safeSync = sanitizeInlineSvgMarkup(xhr.responseText);
        if (safeSync) {
          host.innerHTML = safeSync;
          loaded = !!document.getElementById("iuAffInlineSprite");
        }
      }
    } catch (_) {}
    if (loaded) {
      if (typeof done === "function") done();
      return;
    }
    try {
      fetch("/assets/icons/iu-sprite.svg", { cache: "force-cache" })
        .then(function (r) {
          return r.text();
        })
        .then(function (txt) {
          if (!txt) return;
          var safeAsync = sanitizeInlineSvgMarkup(txt);
          if (!safeAsync) return;
          host.innerHTML = safeAsync;
          if (typeof done === "function") done();
        })
        .catch(function () {});
    } catch (_) {}
  }

  function createAffiliateNavIcon(iconId) {
    ensureAffiliateInlineSprite();
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "iuSvgIcon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + iconId);
    try {
      use.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#" + iconId);
    } catch (_) {}
    svg.appendChild(use);
    return svg;
  }

  function ensureAffiliateViewMountPoint() {
    var view = document.getElementById("iuAffiliateView");
    var centerStage = document.getElementById("iuCenterStage");
    var jr = document.getElementById("iuJrEmptyView");
    var quickFeed = document.getElementById("iuQuickFeed");
    if (!view || !centerStage) return;

    var refNode = null;
    if (jr && jr.parentElement === centerStage) {
      refNode = jr.nextSibling;
    } else if (quickFeed && quickFeed.parentElement === centerStage) {
      refNode = quickFeed.nextSibling;
    }

    if (view.parentElement !== centerStage) {
      centerStage.insertBefore(view, refNode);
      return;
    }
    if (jr && jr.parentElement === centerStage && view.previousElementSibling !== jr) {
      centerStage.insertBefore(view, jr.nextSibling);
      return;
    }
    if (!jr && quickFeed && quickFeed.parentElement === centerStage && view.previousElementSibling !== quickFeed) {
      centerStage.insertBefore(view, quickFeed.nextSibling);
    }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function isAffiliateSectionKey(key) {
    return String(key || "").indexOf("aff-") === 0;
  }

  function getCategoryBySection(section) {
    return catalogById[String(section || "").trim().toLowerCase()] || null;
  }

  function showPlaceholderNotice(host) {
    try {
      var note = host && host.querySelector ? host.querySelector(".iuAffiliatePlaceholderNote") : null;
      if (!note) {
        note = document.createElement("div");
        note.className = "iuAffiliatePlaceholderNote";
        note.setAttribute("role", "status");
        note.setAttribute("aria-live", "polite");
        note.textContent = "Odkaz připravujeme.";
        if (host) host.appendChild(note);
      }
      note.hidden = false;
      note.classList.add("is-visible");
      clearTimeout(note.__iuAffHideTimer);
      note.__iuAffHideTimer = setTimeout(function () {
        try {
          note.classList.remove("is-visible");
          note.hidden = true;
        } catch (_) {}
      }, 2800);
    } catch (_) {}
  }

  function renderAffiliateSeo(cat) {
    var seoEl = document.getElementById("iuAffiliateSeo");
    if (!seoEl || !cat) return;
    var seo = IU_AFFILIATE_SEO[cat.id];
    if (!seo) {
      seoEl.hidden = true;
      seoEl.innerHTML = "";
      return;
    }
    var parts = ['<h2>', escapeHtml(seo.title), "</h2>"];
    for (var pi = 0; pi < seo.paragraphs.length; pi++) {
      parts.push("<p>", escapeHtml(seo.paragraphs[pi]), "</p>");
    }
    if (seo.keywords) {
      parts.push(
        '<p class="iuAffiliateSeoKeywords"><strong>Klíčová slova:</strong> ',
        escapeHtml(seo.keywords),
        "</p>"
      );
    }
    seoEl.innerHTML = parts.join("");
    seoEl.hidden = false;
  }

  function renderAffiliateSection(section) {
    var cat = getCategoryBySection(section);
    var view = document.getElementById("iuAffiliateView");
    if (!view || !cat) return false;

    var titleEl = document.getElementById("iuAffiliateTitle");
    var subtitleEl = document.getElementById("iuAffiliateSubtitle");
    var disclosureEl = document.getElementById("iuAffiliateDisclosure");
    var gridEl = document.getElementById("iuAffiliateGrid");

    if (titleEl) titleEl.textContent = cat.title;
    if (subtitleEl) subtitleEl.textContent = cat.description;
    if (disclosureEl) renderAffiliateDisclosure(disclosureEl);

    if (gridEl) {
      var parts = [];
      for (var i = 0; i < cat.items.length; i++) {
        var it = cat.items[i];
        var ready = it.affiliateUrlReady === true && /^https:\/\//i.test(String(it.url || ""));
        var href = ready ? String(it.url) : "#";
        var attrs =
          ' class="iuRadioChip iuAffiliateChip" role="listitem" href="' +
          escapeHtml(href) +
          '" data-aff-ready="' +
          (ready ? "1" : "0") +
          '"';
        if (ready) {
          attrs +=
            ' target="_blank" rel="nofollow sponsored noopener noreferrer"';
        } else {
          attrs += ' aria-disabled="true"';
        }
        parts.push(
          "<a" +
            attrs +
            '><span class="iuRadioChipTitle">' +
            escapeHtml(it.title) +
            "</span></a>"
        );
      }
      gridEl.innerHTML = parts.join("");
    }

    view.setAttribute("data-aff-category", cat.id);
    renderAffiliateSeo(cat);
    ensureAffiliateViewMountPoint();
    return true;
  }

  function handleAffiliateGridClick(e) {
    var chip = e.target && e.target.closest ? e.target.closest(".iuAffiliateChip") : null;
    if (!chip) return;
    if (chip.getAttribute("data-aff-ready") === "1") return;
    e.preventDefault();
    e.stopPropagation();
    var view = document.getElementById("iuAffiliateView");
    showPlaceholderNotice(view);
  }

  function mountLeftRailNav() {
    var nav = document.querySelector("#iuLeftRail .iu-leftNav");
    if (!nav || nav.getAttribute("data-iu-aff-nav-mounted") === "1") return;

    var title = document.createElement("div");
    title.className = "iuLeftRailSectionTitle iuLeftRailSectionTitle--affiliate";
    title.textContent = "Doporučené služby";
    nav.appendChild(title);

    refreshAffiliateColorsFromCss();

    for (var i = 0; i < IU_AFFILIATE_CATALOG.length; i++) {
      var cat = IU_AFFILIATE_CATALOG[i];
      var a = document.createElement("a");
      a.className = "iu-leftNavItem";
      a.href = "#";
      a.setAttribute("data-rail", "affiliate");
      a.setAttribute("data-accent", cat.id);
      var iconWrap = document.createElement("span");
      iconWrap.className = "iu-leftNavIcon";
      iconWrap.setAttribute("aria-hidden", "true");
      iconWrap.appendChild(createAffiliateNavIcon(cat.icon));
      var label = document.createElement("span");
      label.className = "iu-leftNavLabel";
      label.textContent = cat.title;
      a.appendChild(iconWrap);
      a.appendChild(label);
      nav.appendChild(a);
    }

    nav.setAttribute("data-iu-aff-nav-mounted", "1");
  }

  function initAffiliateCatalog() {
    ensureAffiliateInlineSprite();
    refreshAffiliateColorsFromCss();
    mountLeftRailNav();
    if (!document.__iuAffClickBound) {
      document.addEventListener("click", handleAffiliateGridClick);
      document.__iuAffClickBound = true;
    }
  }

  function applyAffiliateFromSection(section) {
    if (!isAffiliateSectionKey(section)) return false;
    try {
      if (window.__iuSectionViewsLazyMount) window.__iuSectionViewsLazyMount.ensure("affiliate");
    } catch (_) {}
    ensureAffiliateViewMountPoint();
    return renderAffiliateSection(section);
  }

  window.IU_AFFILIATE_CATALOG = IU_AFFILIATE_CATALOG;
  window.IU_AFFILIATE_SEO = IU_AFFILIATE_SEO;
  window.IU_AFFILIATE_COLORS = IU_AFFILIATE_COLORS;
  window.iuAffiliateRefreshColors = refreshAffiliateColorsFromCss;
  window.IU_AFFILIATE_DISCLOSURE_TEXT = IU_AFFILIATE_DISCLOSURE_TEXT;
  window.iuAffiliateCatalogInit = initAffiliateCatalog;
  window.iuAffiliateApplySection = applyAffiliateFromSection;
  window.iuAffiliateIsSection = isAffiliateSectionKey;
  window.iuAffiliateGetCategory = getCategoryBySection;

  initAffiliateCatalog();
  try {
    var pEarly = new URLSearchParams(typeof location !== "undefined" ? location.search || "" : "");
    var secEarly = String(pEarly.get("section") || "").trim().toLowerCase();
    if (isAffiliateSectionKey(secEarly)) {
      applyAffiliateFromSection(secEarly);
    }
  } catch (_) {}

  document.addEventListener("iu:section-view-mounted", function (ev) {
    try {
      if (ev && ev.detail && ev.detail.key === "affiliate") {
        ensureAffiliateInlineSprite();
        initAffiliateCatalog();
        ensureAffiliateViewMountPoint();
        var sec =
          (document.body && document.body.dataset && document.body.dataset.section) || "";
        if (isAffiliateSectionKey(sec)) renderAffiliateSection(sec);
      }
    } catch (_) {}
  });
})();
