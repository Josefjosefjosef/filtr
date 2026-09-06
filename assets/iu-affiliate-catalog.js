/**
 * infoUzel.cz — Affiliate services catalog (UI + data).
 * Partner URLs are placeholders until affiliate programs are approved.
 */
(function iuAffiliateCatalog() {
  "use strict";

  if (window.__iuAffiliateCatalogBooted) return;
  window.__iuAffiliateCatalogBooted = true;

  var IU_AFFILIATE_DISCLOSURE_TEXT =
    "Tato sekce obsahuje reklamní a partnerské odkazy na externí služby a obchody.";

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

  function affSeo(title, paragraphs) {
    return {
      title: title,
      paragraphs: paragraphs,
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
      "Cestovní kanceláře – odkazy na vybrané externí služby",
      [
        "Sekce Cestovní kanceláře obsahuje odkazy na vybrané externí cestovní kanceláře, cestovní portály a související služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky, ceny, dostupnost, podmínky, informace o zájezdech a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-ubytovani-hotely": affSeo(
      "Ubytování a hotely – odkazy na vybrané externí služby",
      [
        "Sekce Ubytování a hotely obsahuje odkazy na vybrané externí služby pro rezervaci ubytování, hotelů a souvisejících pobytů. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-letenky": affSeo(
      "Letenky a cestovní pomoc – odkazy na vybrané externí služby",
      [
        "Sekce Letenky a cestovní pomoc obsahuje odkazy na vybrané externí služby související s letenkami, dopravou a cestovní podporou. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-cestovni-pojisteni": affSeo(
      "Cestovní pojištění – odkazy na vybrané externí služby",
      [
        "Sekce Cestovní pojištění obsahuje odkazy na vybrané externí pojišťovny a asistenční služby související s cestováním. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Rozsah krytí, ceny, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-auto-moto": affSeo(
      "Auto a moto – odkazy na vybrané externí služby",
      [
        "Sekce Auto a moto obsahuje odkazy na vybrané externí obchody a služby se sortimentem pro automobily a motocykly. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-pojisteni": affSeo(
      "Pojištění – odkazy na vybrané externí služby",
      [
        "Sekce Pojištění obsahuje odkazy na vybrané externí pojišťovny a srovnávací služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, rozsah krytí, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-finance": affSeo(
      "Finance – odkazy na vybrané externí služby",
      [
        "Sekce Finance obsahuje odkazy na vybrané externí finanční služby a produkty. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, podmínky, dostupnost produktů a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-energie-uspor": affSeo(
      "Energie a úspory – odkazy na vybrané externí služby",
      [
        "Sekce Energie a úspory obsahuje odkazy na vybrané externí služby a obchody související s energiemi a domácími produkty. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, tarify, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-lekarny": affSeo(
      "Lékárny – odkazy na vybrané externí služby",
      [
        "Sekce Lékárny obsahuje odkazy na vybrané externí lékárny a související obchody. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky prodeje a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-zdravi-doplnky": affSeo(
      "Zdraví a doplňky – odkazy na vybrané externí služby",
      [
        "Sekce Zdraví a doplňky obsahuje odkazy na vybrané externí obchody se sortimentem souvisejícím se zdravím a doplňky. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-kosmetika": affSeo(
      "Kosmetika a parfémy – odkazy na vybrané externí služby",
      [
        "Sekce Kosmetika a parfémy obsahuje odkazy na vybrané externí obchody s kosmetikou a parfémy. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-drogerie": affSeo(
      "Drogerie – odkazy na vybrané externí služby",
      [
        "Sekce Drogerie obsahuje odkazy na vybrané externí drogerie a související obchody. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-moda": affSeo(
      "Móda – odkazy na vybrané externí služby",
      [
        "Sekce Móda obsahuje odkazy na vybrané externí obchody s oblečením a módním sortimentem. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-boty": affSeo(
      "Boty a tenisky – odkazy na vybrané externí služby",
      [
        "Sekce Boty a tenisky obsahuje odkazy na vybrané externí obchody s obuví. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-sportovni-obleceni": affSeo(
      "Sportovní oblečení – odkazy na vybrané externí služby",
      [
        "Sekce Sportovní oblečení obsahuje odkazy na vybrané externí obchody se sportovním oblečením. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-sport-outdoor": affSeo(
      "Sport a outdoor – odkazy na vybrané externí služby",
      [
        "Sekce Sport a outdoor obsahuje odkazy na vybrané externí obchody se sportovním a outdoorovým vybavením. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-dum-zahrada": affSeo(
      "Dům a zahrada – odkazy na vybrané externí služby",
      [
        "Sekce Dům a zahrada obsahuje odkazy na vybrané externí obchody se sortimentem pro dům, zahradu a hobby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-nabytek": affSeo(
      "Nábytek a bydlení – odkazy na vybrané externí služby",
      [
        "Sekce Nábytek a bydlení obsahuje odkazy na vybrané externí obchody s nábytkem a vybavením interiéru. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-kuchyn": affSeo(
      "Kuchyně a domácnost – odkazy na vybrané externí služby",
      [
        "Sekce Kuchyně a domácnost obsahuje odkazy na vybrané externí obchody s vybavením kuchyně a domácnosti. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-elektro": affSeo(
      "Elektro a chytrá domácnost – odkazy na vybrané externí služby",
      [
        "Sekce Elektro a chytrá domácnost obsahuje odkazy na vybrané externí obchody s elektronikou a produkty pro domácnost. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-mobily": affSeo(
      "Mobily a příslušenství – odkazy na vybrané externí služby",
      [
        "Sekce Mobily a příslušenství obsahuje odkazy na vybrané externí obchody s telefony a příslušenstvím. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-software": affSeo(
      "Software a bezpečnost – odkazy na vybrané externí služby",
      [
        "Sekce Software a bezpečnost obsahuje odkazy na vybrané externí softwarové a bezpečnostní služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-knihy": affSeo(
      "Knihy, filmy a hry – odkazy na vybrané externí služby",
      [
        "Sekce Knihy, filmy a hry obsahuje odkazy na vybrané externí obchody a služby se sortimentem knih, filmů a her. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-jidlo": affSeo(
      "Jídlo a potraviny – odkazy na vybrané externí služby",
      [
        "Sekce Jídlo a potraviny obsahuje odkazy na vybrané externí obchody a služby s potravinami. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-zvirata": affSeo(
      "Zvířata a chovatelství – odkazy na vybrané externí služby",
      [
        "Sekce Zvířata a chovatelství obsahuje odkazy na vybrané externí obchody se sortimentem pro domácí mazlíčky. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
  };

  var IU_AFFILIATE_CATALOG = [
    {
      id: "aff-cestovni-kancelare",
      title: "Cestovní kanceláře",
      icon: "iu-aff-suitcase",
      description: "Odkazy na vybrané cestovní kanceláře a služby související s cestováním.",
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
      description: "Odkazy na vybrané služby pro ubytování a hotely.",
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
      description: "Odkazy na vybrané služby související s letenkami a cestovní pomocí.",
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
      description: "Odkazy na vybrané služby cestovního pojištění.",
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
      description: "Odkazy na vybrané obchody a služby v kategorii auto a moto.",
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
      description: "Odkazy na vybrané pojišťovny a srovnávací služby.",
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
      description: "Odkazy na vybrané externí finanční služby.",
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
      description: "Odkazy na vybrané služby a obchody související s energiemi a úsporami.",
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
      description: "Odkazy na vybrané externí lékárny a související obchody.",
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
      description: "Odkazy na vybrané obchody se sortimentem zdraví a doplňků.",
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
      description: "Odkazy na vybrané obchody s kosmetikou a parfémy.",
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
      description: "Odkazy na vybrané drogerie a související obchody.",
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
      description: "Odkazy na vybrané obchody s módou a oblečením.",
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
      description: "Odkazy na vybrané obchody s obuví.",
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
      description: "Odkazy na vybrané obchody se sportovním oblečením.",
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
      description: "Odkazy na vybrané obchody se sportovním a outdoorovým vybavením.",
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
      description: "Odkazy na vybrané obchody pro dům, zahradu a hobby.",
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
      description: "Odkazy na vybrané obchody s nábytkem a bydlením.",
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
      description: "Odkazy na vybrané obchody s vybavením kuchyně a domácnosti.",
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
      description: "Odkazy na vybrané obchody s elektronikou a chytrou domácností.",
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
      description: "Odkazy na vybrané obchody s mobily a příslušenstvím.",
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
      description: "Odkazy na vybrané softwarové a bezpečnostní služby.",
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
      description: "Odkazy na vybrané obchody s knihami, filmy a hrami.",
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
      description: "Odkazy na vybrané obchody a služby s potravinami.",
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
      description: "Odkazy na vybrané obchody pro zvířata a chovatelství.",
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
    /* keywords block removed: affiliate-selected-services-neutral-v1-20260907 */
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
    title.textContent = "Vybrané služby a odkazy";
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
