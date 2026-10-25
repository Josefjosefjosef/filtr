/**
 * infoUzel.cz — Affiliate services catalog (UI + data).
 * Partner URLs are placeholders until affiliate programs are approved.
 */
/* iu-affiliate-catalog-bust: affiliate-phase2e-fix55-v1-20261023 */
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

  /* Ready partner with live CJ / affiliate tracking URL (text-only chip). */
  function affPartner(title, url, advertiserId) {
    return {
      title: title,
      url: url,
      affiliateUrlReady: true,
      advertiserId: advertiserId || null,
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
      "Doprava a cestování – odkazy na vybrané externí služby",
      [
        "Sekce Doprava a cestování obsahuje odkazy na vybrané externí služby související s dopravou a cestováním, například leteckou, vlakovou nebo autobusovou dopravou a další cestovní podporou. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-letenky-letecka-doprava": affSeo(
      "Letenky a letecká doprava – odkazy na vybrané externí služby",
      [
        "Sekce Letenky a letecká doprava obsahuje odkazy na vybrané externí služby pro vyhledávání a rezervaci letenek a služby související s leteckou dopravou. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
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
    "aff-pneu-pneuservis": affSeo(
      "Pneu a pneuservis – odkazy na vybrané externí služby",
      [
        "Sekce Pneu a pneuservis obsahuje odkazy na vybrané externí prodejce pneumatik, pneuservisy a služby související s pneumatikami, přezutím a servisem kol. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky, rozsah poskytovaných služeb a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
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
      "Móda a doplňky – odkazy na vybrané externí služby",
      [
        "Sekce Móda a doplňky obsahuje odkazy na vybrané externí obchody s oblečením, módou a souvisejícími doplňky. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
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
    "aff-deti-hracky": affSeo(
      "Děti a hračky – odkazy na vybrané externí služby",
      [
        "Sekce Děti a hračky obsahuje odkazy na vybrané externí obchody se sortimentem pro děti a hračkami. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
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
      "Bydlení a vybavení – odkazy na vybrané externí služby",
      [
        "Sekce Bydlení a vybavení obsahuje odkazy na vybrané externí obchody s vybavením bydlení a interiéru. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
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
      "Knihy, hudba a hry – odkazy na vybrané externí služby",
      [
        "Sekce Knihy, hudba a hry obsahuje odkazy na vybrané externí obchody a služby se sortimentem knih, hudby a her. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
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
    "aff-kvetiny-darky": affSeo(
      "Květiny a dárky – odkazy na vybrané externí služby",
      [
        "Sekce Květiny a dárky obsahuje odkazy na vybrané externí obchody s květinami a dárky. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-sperky-hodinky": affSeo(
      "Šperky a hodinky – odkazy na vybrané externí služby",
      [
        "Sekce Šperky a hodinky obsahuje odkazy na vybrané externí obchody se šperky a hodinkami. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-tv-streamovani": affSeo(
      "TV a streamování – odkazy na vybrané externí služby",
      [
        "Sekce TV a streamování obsahuje odkazy na vybrané externí služby televizního a streamovacího obsahu. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-dilna-naradi": affSeo(
      "Dílna a nářadí – odkazy na vybrané externí služby",
      [
        "Sekce Dílna a nářadí obsahuje odkazy na vybrané externí obchody s nářadím a vybavením dílny. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídku, ceny, dostupnost, podmínky a další informace určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-inzerce-bazary": affSeo(
      "Inzerce a bazary – odkazy na vybrané externí služby",
      [
        "Sekce Inzerce a bazary obsahuje odkazy na vybrané externí inzertní portály, bazary, online tržiště a související služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky, ceny, dostupnost, podmínky, informace o nabízeném zboží a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-realitni-kancelare": affSeo(
      "Realitní kanceláře – odkazy na vybrané externí služby",
      [
        "Sekce Realitní kanceláře obsahuje odkazy na vybrané externí realitní kanceláře a společnosti poskytující realitní služby. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky nemovitostí, ceny, dostupnost, podmínky a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-reality-nemovitosti": affSeo(
      "Reality a nemovitosti – odkazy na vybrané externí služby",
      [
        "Sekce Reality a nemovitosti obsahuje odkazy na vybrané externí realitní portály a služby související s nabídkou, prodejem a pronájmem nemovitostí. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky nemovitostí, ceny, dostupnost, podmínky a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
        "InfoUzel.cz uvedené externí služby neprovozuje. Sekce slouží jako orientační rozcestník k vybraným externím službám a nepředstavuje jejich úplný výčet.",
      ]
    ),
    "aff-kancelarske-potreby": affSeo(
      "Kancelářské potřeby a vybavení – odkazy na vybrané externí služby",
      [
        "Sekce Kancelářské potřeby a vybavení obsahuje odkazy na vybrané externí obchody a služby zaměřené na kancelářské potřeby a vybavení. Po výběru je uživatel přesměrován na příslušnou externí stránku nebo službu.",
        "Nabídky, ceny, dostupnost, podmínky, informace o produktech a další obsah určuje provozovatel příslušné externí služby a mohou se v čase měnit.",
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
        affPartner("Cedok.cz", "https://www.anrdoezrs.net/click-101883843-15686662", "6179554"),
        affPartner("Blue-style.cz", "https://www.dpbolvw.net/click-101883843-14358779", "5605390"),
        affPartner("Eximtours.cz", "https://www.dpbolvw.net/click-101883843-15043859", "5906045"),
        affPartner("Tui.cz", "https://www.kqzyfj.com/click-101883843-15704921", "6785595"),
        affPartner("Cestovnakancelariadaka.sk", "https://www.tkqlhce.com/click-101883843-13148950", "5006846"),
        affPartner("Ergo-cestovni.cz", "https://www.jdoqocy.com/click-101883843-17269644", "6767085")
      ],
    },
    {
      id: "aff-ubytovani-hotely",
      title: "Ubytování a hotely",
      icon: "iu-aff-hotel",
      description: "Odkazy na vybrané služby pro ubytování a hotely.",
      items: [
        affPartner("Booking.com", "https://www.anrdoezrs.net/click-101883843-13323565"),
        affPartner("Spa.cz", "https://www.kqzyfj.com/click-101883843-14446400", "5525941")
      ],
    },
    {
      id: "aff-letenky",
      title: "Doprava a cestování",
      icon: "iu-aff-transport",
      description: "Odkazy na vybrané služby související s dopravou a cestováním.",
      items: [
        affPartner("Leo Express", "https://www.jdoqocy.com/click-101883843-15736211")
      ],
    },
    {
      id: "aff-letenky-letecka-doprava",
      title: "Letenky a letecká doprava",
      icon: "iu-aff-plane",
      description: "Odkazy na vybrané služby pro letenky a leteckou dopravu.",
      items: [
        affPartner("Skytours", "https://www.jdoqocy.com/click-101883843-15733491"),
        affPartner("Arangrant", "https://www.kqzyfj.com/click-101883843-17039663", "7226122"),
        affPartner("Cheapvuelos", "https://www.jdoqocy.com/click-101883843-17322005", "7947783")
      ],
    },
    {
      id: "aff-cestovni-pojisteni",
      title: "Cestovní pojištění",
      icon: "iu-aff-shield",
      description: "Odkazy na vybrané služby cestovního pojištění.",
      items: [
        affPartner("AXA Assistance", "https://www.tkqlhce.com/click-101883843-12585182"),
        affPartner("Klik.cz", "https://www.dpbolvw.net/click-101883843-15024030")
      ],
    },
    {
      id: "aff-auto-moto",
      title: "Auto a moto",
      icon: "iu-aff-car",
      description: "Odkazy na vybrané obchody a služby v kategorii auto a moto.",
      items: [
        affPartner("Autohotarek.cz", "https://www.dpbolvw.net/click-101883843-15802025"),
        affPartner("Ahifi.cz", "https://www.dpbolvw.net/click-101883843-17006948")
      ],
    },
    {
      id: "aff-pneu-pneuservis",
      title: "Pneu a pneuservis",
      icon: "iu-aff-wheel",
      description:
        "Odkazy na vybrané prodejce pneumatik, pneuservisy a související služby.",
      items: [
        affPartner("BestDrive", "https://www.jdoqocy.com/click-101883843-17045434")
      ],
    },
    {
      id: "aff-pojisteni",
      title: "Pojištění",
      icon: "iu-aff-shield",
      description: "Odkazy na vybrané pojišťovny a srovnávací služby.",
      items: [
        affPartner("Klik.cz", "https://www.dpbolvw.net/click-101883843-15024026"),
        affPartner("Kalkulator.cz", "https://www.kqzyfj.com/click-101883843-15616442"),
        affPartner("GeneraliCeska.cz", "https://www.jdoqocy.com/click-101883843-13930623", "4711521"),
        affPartner("Direct.cz", "https://www.kqzyfj.com/click-101883843-14550106", "5812291")
      ],
    },
    {
      id: "aff-finance",
      title: "Finance",
      icon: "iu-finance",
      description: "Odkazy na vybrané externí finanční služby.",
      items: [
      ],
    },
    {
      id: "aff-energie-uspor",
      title: "Energie a úspory",
      icon: "iu-aff-bulb",
      description: "Odkazy na vybrané služby a obchody související s energiemi a úsporami.",
      items: [
      ],
    },
    {
      id: "aff-lekarny",
      title: "Lékárny",
      icon: "iu-aff-cross",
      description: "Odkazy na vybrané externí lékárny a související obchody.",
      items: [
        affPartner("Lékárna.cz", "https://www.kqzyfj.com/click-101883843-15734937"),
        affPartner("Lékárna Lemon", "https://www.jdoqocy.com/click-101883843-14563148"),
        affPartner("GSKlub.cz", "https://www.dpbolvw.net/click-101883843-13452077", "5146426"),
        affPartner("DRMAX.CZ", "https://www.jdoqocy.com/click-101883843-12838531", "4883722")
      ],
    },
    {
      id: "aff-zdravi-doplnky",
      title: "Zdraví a doplňky",
      icon: "iu-health",
      description: "Odkazy na vybrané obchody se sortimentem zdraví a doplňků.",
      items: [
        affPartner("Klub zdraví", "https://www.dpbolvw.net/click-101883843-13884010"),
        affPartner("BodyWorld", "https://www.tkqlhce.com/click-101883843-15735791"),
        affPartner("Unizdrav", "https://www.kqzyfj.com/click-101883843-15735719"),
        affPartner("MentisLab", "https://www.tkqlhce.com/click-101883843-13341068"),
        affPartner("NaZuby.cz", "https://www.anrdoezrs.net/click-101883843-11883390"),
        affPartner("Nature's Finest", "https://www.dpbolvw.net/click-101883843-15037573"),
        affPartner("BrainMarket", "https://www.anrdoezrs.net/click-101883843-17053829"),
        affPartner("Ezshop.cz", "https://www.jdoqocy.com/click-101883843-14486512", "5744714"),
        affPartner("Amix-store.cz", "https://www.kqzyfj.com/click-101883843-14545972", "5706839"),
        affPartner("Rehabilitacnipomucky.cz", "https://www.tkqlhce.com/click-101883843-15421726", "6294181"),
        affPartner("Sensilab", "https://www.kqzyfj.com/click-101883843-15056966", "5408233")
      ],
    },
    {
      id: "aff-kosmetika",
      title: "Kosmetika a parfémy",
      icon: "iu-aff-perfume",
      description: "Odkazy na vybrané obchody s kosmetikou a parfémy.",
      items: [
        affPartner("SEPHORA.cz", "https://www.anrdoezrs.net/click-101883843-13212014"),
        affPartner("Dermacol", "https://www.jdoqocy.com/click-101883843-17173455"),
        affPartner("FOREO", "https://www.anrdoezrs.net/click-101883843-15527432"),
        affPartner("Yves Rocher", "https://www.dpbolvw.net/click-101883843-15734904"),
        affPartner("Brasty.cz", "https://www.kqzyfj.com/click-101883843-14095529"),
        affPartner("Byrokko", "https://www.dpbolvw.net/click-101883843-15885523", "7133039"),
        affPartner("Obchod.dermalogica.cz", "https://www.jdoqocy.com/click-101883843-13971612", "5381657"),
        affPartner("FANN.CZ", "https://www.jdoqocy.com/click-101883843-12918759", "4904877"),
        affPartner("Nefertitis.cz", "https://www.kqzyfj.com/click-101883843-15064659", "5894154"),
        affPartner("Obchod.salononline.cz", "https://www.anrdoezrs.net/click-101883843-14099303", "5482931"),
        affPartner("SvetKadernictvi.cz", "https://www.anrdoezrs.net/click-101883843-14386407", "5611262"),
        affPartner("Tierraverde.cz", "https://www.anrdoezrs.net/click-101883843-17274085", "7612998")
      ],
    },
    {
      id: "aff-drogerie",
      title: "Drogerie",
      icon: "iu-aff-bottle",
      description: "Odkazy na vybrané drogerie a související obchody.",
      items: [
        affPartner("Ecomodi", "https://www.dpbolvw.net/click-101883843-15736124"),
        affPartner("Rossmann", "https://www.dpbolvw.net/click-101883843-17204802"),
        affPartner("Puellavune.cz", "https://www.dpbolvw.net/click-101883843-17203359", "7643241")
      ],
    },
    {
      id: "aff-moda",
      title: "Móda a doplňky",
      icon: "iu-aff-shirt",
      description: "Odkazy na vybrané obchody s módou, oblečením a doplňky.",
      items: [
        affPartner("Meatfly.cz", "https://www.jdoqocy.com/click-101883843-15735649"),
        affPartner("Kabea.cz", "https://www.jdoqocy.com/click-101883843-15735243"),
        affPartner("Demix.cz", "https://www.tkqlhce.com/click-101883843-15202259"),
        affPartner("Trenýrkárna.cz", "https://www.dpbolvw.net/click-101883843-15736041", "5938081"),
        affPartner("VIP-pradlo.cz", "https://www.jdoqocy.com/click-101883843-15769149"),
        affPartner("Instamo.cz", "https://www.anrdoezrs.net/click-101883843-15753113", "6754118"),
        affPartner("Lelosi.cz", "https://www.kqzyfj.com/click-101883843-15356564", "6256015"),
        affPartner("Answear.cz", "https://www.jdoqocy.com/click-101883843-11845756", "4327375"),
        affPartner("Factcool", "https://www.jdoqocy.com/click-101883843-14017743", "5402439"),
        affPartner("GUNSANDTUXEDOS.COM", "https://www.dpbolvw.net/click-101883843-13219632", "5043902"),
        affPartner("Imoda.sk", "https://www.dpbolvw.net/click-101883843-15484835", "6306286"),
        affPartner("Jeans-shop.cz", "https://www.dpbolvw.net/click-101883843-15377778", "6258510"),
        affPartner("Kings Camo", "https://www.jdoqocy.com/click-101883843-15774549", "7016567"),
        affPartner("T", "https://www.kqzyfj.com/click-101883843-13457303", "5147910"),
        affPartner("Vivantis.cz", "https://www.tkqlhce.com/click-101883843-12411812", "4384608"),
        affPartner("Wearmedicine.cz", "https://www.kqzyfj.com/click-101883843-17213743", "7726276")
      ],
    },
    {
      id: "aff-boty",
      title: "Boty a tenisky",
      icon: "iu-aff-shoe",
      description: "Odkazy na vybrané obchody s obuví.",
      items: [
        affPartner("Rejnok obuv", "https://www.dpbolvw.net/click-101883843-12939731"),
        affPartner("Zdrava-obuv-eshop.cz", "https://www.jdoqocy.com/click-101883843-17274691"),
        affPartner("Bohempia", "https://www.kqzyfj.com/click-101883843-15127254", "5992572"),
        affPartner("Warsawsneakerstore.com", "https://www.tkqlhce.com/click-101883843-15699570", "6796197"),
        affPartner("Shapenbarefoot.com", "https://www.jdoqocy.com/click-101883843-17258753", "6659563")
      ],
    },
    {
      id: "aff-deti-hracky",
      title: "Děti a hračky",
      icon: "iu-aff-blocks",
      description: "Odkazy na vybrané obchody se sortimentem pro děti a hračkami.",
      items: [
        affPartner("Bambule.cz", "https://www.jdoqocy.com/click-101883843-12990634"),
        affPartner("Feedo.cz", "https://www.anrdoezrs.net/click-101883843-12984087"),
        affPartner("4KIDS.cz", "https://www.kqzyfj.com/click-101883843-14299748"),
        affPartner("Bruderland.cz", "https://www.dpbolvw.net/click-101883843-17073660", "7424533"),
        affPartner("Monkeymum.com", "https://www.kqzyfj.com/click-101883843-15361176", "6253448"),
        affPartner("Rajhraciek.sk", "https://www.kqzyfj.com/click-101883843-17015008", "7260722")
      ],
    },
    {
      id: "aff-sportovni-obleceni",
      title: "Sportovní oblečení",
      icon: "iu-aff-jersey",
      description: "Odkazy na vybrané obchody se sportovním oblečením.",
      items: [
        affPartner("Sportisimo.cz", "https://www.tkqlhce.com/click-101883843-13592781", "5177969"),
        affPartner("Horsefeathers", "https://www.anrdoezrs.net/click-101883843-15064848", "5780936"),
        affPartner("Hs-sport.cz", "https://www.dpbolvw.net/click-101883843-14353861", "5603344")
      ],
    },
    {
      id: "aff-sport-outdoor",
      title: "Sport a outdoor",
      icon: "iu-aff-tent",
      description: "Odkazy na vybrané obchody se sportovním a outdoorovým vybavením.",
      items: [
        affPartner("Bushman", "https://www.kqzyfj.com/click-101883843-15734377"),
        affPartner("Decathlon", "https://www.tkqlhce.com/click-101883843-15698594"),
        affPartner("inSPORTline", "https://www.dpbolvw.net/click-101883843-15734406"),
        affPartner("Bauerhockey.cz", "https://www.tkqlhce.com/click-101883843-15735817"),
        affPartner("PARYS.CZ", "https://www.jdoqocy.com/click-101883843-12905804"),
        affPartner("Urbane.cz", "https://www.kqzyfj.com/click-101883843-15359455"),
        affPartner("E-sportshop.cz", "https://www.anrdoezrs.net/click-101883843-15473642", "6215286"),
        affPartner("Bezvasport.cz", "https://www.tkqlhce.com/click-101883843-13760331", "5277391"),
        affPartner("Huskycz.cz", "https://www.anrdoezrs.net/click-101883843-14024803", "5404810"),
        affPartner("Velocity Outdoor", "https://www.kqzyfj.com/click-101883843-15747470", "6038648")
      ],
    },
    {
      id: "aff-dum-zahrada",
      title: "Dům a zahrada",
      icon: "iu-home-hobby",
      description: "Odkazy na vybrané obchody pro dům, zahradu a hobby.",
      items: [
        affPartner("Obi.cz", "https://www.jdoqocy.com/click-101883843-15816967", "6857406"),
        affPartner("DEK.cz", "https://www.tkqlhce.com/click-101883843-13457236", "5142212"),
        affPartner("Sanitino.cz", "https://www.anrdoezrs.net/click-101883843-17007319", "6358042"),
        affPartner("Dormeo.cz", "https://www.dpbolvw.net/click-101883843-15806382", "6976980"),
        affPartner("Zepter.cz", "https://www.kqzyfj.com/click-101883843-17074303", "7341377"),
        affPartner("Argos.cz", "https://www.anrdoezrs.net/click-101883843-17366260", "8010554"),
        affPartner("DECODOMA.CZ", "https://www.jdoqocy.com/click-101883843-12863118", "4882378"),
        affPartner("Dedoma.sk", "https://www.jdoqocy.com/click-101883843-13219578", "5000412"),
        affPartner("Dopplershop.cz", "https://www.jdoqocy.com/click-101883843-15319222", "6065245"),
        affPartner("Dvere-Erkado.cz", "https://www.jdoqocy.com/click-101883843-13234841", "5027071"),
        affPartner("Gavri.cz", "https://www.anrdoezrs.net/click-101883843-14393799", "5614135"),
        affPartner("Hezkakoupelna.cz", "https://www.anrdoezrs.net/click-101883843-17240342", "7816491"),
        affPartner("KÄRCHER.CZ", "https://www.dpbolvw.net/click-101883843-12975597", "4927529"),
        affPartner("Vladeko.cz", "https://www.anrdoezrs.net/click-101883843-15273907", "5723506"),
        affPartner("Zahradajezek.cz", "https://www.anrdoezrs.net/click-101883843-14298731", "5444910")
      ],
    },
    {
      id: "aff-nabytek",
      title: "Bydlení a vybavení",
      icon: "iu-aff-sofa",
      description: "Odkazy na vybrané obchody s vybavením bydlení a interiéru.",
      items: [
        affPartner("ASKO-NABYTEK.CZ", "https://www.jdoqocy.com/click-101883843-12920057", "4920521"),
        affPartner("Benlemi", "https://www.jdoqocy.com/click-101883843-15013146", "5870560"),
        affPartner("Diablochairs", "https://www.dpbolvw.net/click-101883843-16955725", "7149746"),
        affPartner("Decoronline.cz", "https://www.kqzyfj.com/click-101883843-13628208", "5217822"),
        affPartner("Dx-racer.cz", "https://www.tkqlhce.com/click-101883843-14303779", "5493238"),
        affPartner("Veneti.cz", "https://www.anrdoezrs.net/click-101883843-17258140", "7793108"),
        affPartner("Butlers.cz", "https://www.jdoqocy.com/click-101883843-12070029", "4432968"),
        affPartner("Jan Nowak EU", "https://www.tkqlhce.com/click-101883843-17269525", "7859657"),
        affPartner("Kancelarskestolicky.com", "https://www.jdoqocy.com/click-101883843-14303854", "5493235"),
        affPartner("Nabytekpaul.cz", "https://www.kqzyfj.com/click-101883843-14307225", "5381727"),
        affPartner("Scandishop.cz", "https://www.dpbolvw.net/click-101883843-15041103", "5884820"),
        affPartner("SIKO.CZ", "https://www.tkqlhce.com/click-101883843-12948215", "4932883"),
        affPartner("SoftCotton", "https://www.jdoqocy.com/click-101883843-13101742", "5005974"),
        affPartner("VidaXL", "https://www.anrdoezrs.net/click-101883843-17070510", "5889034"),
        affPartner("Vitapur-home.cz", "https://www.jdoqocy.com/click-101883843-17237812", "6511227"),
        affPartner("Vyprodejpovleceni.cz", "https://www.jdoqocy.com/click-101883843-15245795", "6109393"),
        affPartner("XXXLutz.cz", "https://www.tkqlhce.com/click-101883843-13966880", "5335380")
      ],
    },
    {
      id: "aff-kuchyn",
      title: "Kuchyně a domácnost",
      icon: "iu-aff-pot",
      description: "Odkazy na vybrané obchody s vybavením kuchyně a domácnosti.",
      items: [
        affPartner("Gorenje.cz", "https://www.jdoqocy.com/click-101883843-15409134", "6112132"),
        affPartner("GrilyKrby.cz", "https://www.kqzyfj.com/click-101883843-12522011", "4694431"),
        affPartner("KitchenShop", "https://www.tkqlhce.com/click-101883843-17094894", "7327751"),
        affPartner("Homeandcook.cz", "https://www.kqzyfj.com/click-101883843-14371269", "5598091")
      ],
    },
    {
      id: "aff-elektro",
      title: "Elektro a chytrá domácnost",
      icon: "iu-aff-plug",
      description: "Odkazy na vybrané obchody s elektronikou a chytrou domácností.",
      items: [
        affPartner("LG CZ", "https://www.kqzyfj.com/click-101883843-17358274", "7073996"),
        affPartner("Eshop.ledvance.cz", "https://www.dpbolvw.net/click-101883843-15607577", "6546769"),
        affPartner("KVelektro.cz", "https://www.anrdoezrs.net/click-101883843-13812779", "5303370"),
        affPartner("Svelt", "https://www.dpbolvw.net/click-101883843-17323349", "7995512"),
        affPartner("TIPA.EU", "https://www.kqzyfj.com/click-101883843-12972203", "4921612")
      ],
    },
    {
      id: "aff-mobily",
      title: "Mobily a příslušenství",
      icon: "iu-aff-phone",
      description: "Odkazy na vybrané obchody s mobily a příslušenstvím.",
      items: [
        affPartner("Tvrzenaskla", "https://www.dpbolvw.net/click-101883843-15319706", "6203294")
      ],
    },
    {
      id: "aff-software",
      title: "Software a bezpečnost",
      icon: "iu-aff-lock",
      description: "Odkazy na vybrané softwarové a bezpečnostní služby.",
      items: [
        affPartner("Kaspersky.cz", "https://www.anrdoezrs.net/click-101883843-17364722", "5132330"),
        affPartner("Surfshark", "https://www.kqzyfj.com/click-101883843-15438560", "6282055"),
        affPartner("Paragon Software Group", "https://www.anrdoezrs.net/click-101883843-12643722", "4686326")
      ],
    },
    {
      id: "aff-knihy",
      title: "Knihy, hudba a hry",
      icon: "iu-aff-book",
      description: "Odkazy na vybrané obchody s knihami, hudbou a hrami.",
      items: [
        affPartner("KnihyDobrovsky.cz", "https://www.anrdoezrs.net/click-101883843-12733214", "4805198"),
        affPartner("Martinus.cz", "https://www.kqzyfj.com/click-101883843-13771835", "5284288"),
        affPartner("Grada.cz", "https://www.kqzyfj.com/click-101883843-14036380", "5321357"),
        affPartner("DVD-premiery.cz", "https://www.anrdoezrs.net/click-101883843-13452100", "5143409"),
        affPartner("Gorila.sk", "https://www.jdoqocy.com/click-101883843-13785660", "5284767"),
        affPartner("Kytary.cz", "https://www.tkqlhce.com/click-101883843-15156146", "4851178"),
        affPartner("Hero Wars", "https://www.anrdoezrs.net/click-101883843-17106963", "7520433"),
        affPartner("Imago.cz", "https://www.anrdoezrs.net/click-101883843-15811153", "6972484"),
        affPartner("Supraphonline.cz", "https://www.anrdoezrs.net/click-101883843-14093131", "5477885")
      ],
    },
    {
      id: "aff-jidlo",
      title: "Jídlo a potraviny",
      icon: "iu-aff-cart",
      description: "Odkazy na vybrané obchody a služby s potravinami.",
      items: [
        affPartner("Gourmetkava.cz", "https://www.tkqlhce.com/click-101883843-17138794", "5234320"),
        affPartner("Svetplodu.cz", "https://www.anrdoezrs.net/click-101883843-15154793", "6002445"),
        affPartner("Yummybox.cz", "https://www.jdoqocy.com/click-101883843-17298730", "7899391"),
        affPartner("Zlatezrnko.cz", "https://www.dpbolvw.net/click-101883843-13992103", "5393861"),
        affPartner("BAMchocolate", "https://www.anrdoezrs.net/click-101883843-17072824", "7416299"),
        affPartner("Zivina.cz", "https://www.jdoqocy.com/click-101883843-15852097", "5929753"),
        affPartner("lidl-shop.cz", "https://www.anrdoezrs.net/click-101883843-17367825", "5954793")
      ],
    },
    {
      id: "aff-zvirata",
      title: "Zvířata a chovatelství",
      icon: "iu-aff-paw",
      description: "Odkazy na vybrané obchody pro zvířata a chovatelství.",
      items: [
        affPartner("SUPERZOO.cz", "https://www.tkqlhce.com/click-101883843-12607708", "4758296"),
        affPartner("Reedog.cz", "https://www.tkqlhce.com/click-101883843-14394849", "5306925")
      ],
    },
    {
      id: "aff-kvetiny-darky",
      title: "Květiny a dárky",
      icon: "iu-aff-flower",
      description: "Odkazy na vybrané obchody s květinami a dárky.",
      items: [
        affPartner("Abracadabra NYC", "https://www.dpbolvw.net/click-101883843-17267207", "7889430"),
        affPartner("Firmanazazitky.cz", "https://www.tkqlhce.com/click-101883843-17346622", "7918457"),
        affPartner("Hubatacernoska.cz", "https://www.tkqlhce.com/click-101883843-15082857", "5950512"),
        affPartner("KvetinyExpres.cz", "https://www.tkqlhce.com/click-101883843-12081313", "4409645"),
        affPartner("Manboxeo.cz", "https://www.jdoqocy.com/click-101883843-17033008", "7401912")
      ],
    },
    {
      id: "aff-sperky-hodinky",
      title: "Šperky a hodinky",
      icon: "iu-aff-watch",
      description: "Odkazy na vybrané obchody se šperky a hodinkami.",
      items: [
        affPartner("ELENYS", "https://www.dpbolvw.net/click-101883843-15735899"),
        affPartner("Royalfashion.cz", "https://www.kqzyfj.com/click-101883843-15027011", "5819507")
      ],
    },
    {
      id: "aff-tv-streamovani",
      title: "TV a streamování",
      icon: "iu-aff-tv",
      description: "Odkazy na vybrané televizní a streamovací služby.",
      items: [
      ],
    },
    {
      id: "aff-dilna-naradi",
      title: "Dílna a nářadí",
      icon: "iu-aff-hammer",
      description: "Odkazy na vybrané obchody s nářadím a vybavením dílny.",
      items: [
        affPartner("Expondo GMBH", "https://www.tkqlhce.com/click-101883843-14015762", "5320945"),
        affPartner("Mojedilna.cz", "https://www.jdoqocy.com/click-101883843-14310928", "5476562")
      ],
    },
    {
      id: "aff-inzerce-bazary",
      title: "Inzerce a bazary",
      icon: "iu-aff-marketplace",
      description: "Odkazy na vybrané inzertní portály, bazary, online tržiště a související služby.",
      items: [
        affPartner("Allegro.cz", "https://www.tkqlhce.com/click-101883843-15520149", "6464420"),
        affPartner("Aukro.cz", "https://www.kqzyfj.com/click-101883843-13276590", "5078957")
      ],
    },
    {
      id: "aff-realitni-kancelare",
      title: "Realitní kanceláře",
      icon: "iu-aff-agency",
      description: "Odkazy na vybrané realitní kanceláře a společnosti poskytující realitní služby.",
      items: [
      ],
    },
    {
      id: "aff-reality-nemovitosti",
      title: "Reality a nemovitosti",
      icon: "iu-aff-property",
      description: "Odkazy na vybrané realitní portály a služby související s nabídkou, prodejem a pronájmem nemovitostí.",
      items: [
      ],
    },
    {
      id: "aff-kancelarske-potreby",
      title: "Kancelářské potřeby a vybavení",
      icon: "iu-aff-office",
      description: "Odkazy na vybrané obchody a služby zaměřené na kancelářské potřeby a vybavení.",
      items: [
        affPartner("Obchod.activa.cz", "https://www.anrdoezrs.net/click-101883843-15037752", "5260576"),
        affPartner("Eobaly.cz", "https://www.anrdoezrs.net/click-101883843-15756667", "6721278")
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
        /* Phase 2C: never render empty / not-ready placeholders publicly. */
        if (!ready) continue;
        var attrs =
          ' class="iuRadioChip iuAffiliateChip" role="listitem" href="' +
          escapeHtml(String(it.url)) +
          '" data-aff-ready="1" target="_blank" rel="sponsored noopener"';
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
    try {
      view.removeAttribute("hidden");
      if (view.style && view.style.display === "none") view.style.removeProperty("display");
    } catch (_) {}
    renderAffiliateSeo(cat);
    ensureAffiliateViewMountPoint();
    /* Phase 3B: coupon/product cards — gated by offers-public liveEnabled (default false). */
    try {
      ensurePhase2OffersScript(function () {
        try {
          if (typeof window.iuAffiliatePhase2OffersRender === "function") {
            window.iuAffiliatePhase2OffersRender(cat.id);
          }
        } catch (_) {}
      });
    } catch (_) {}
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


  var IU_AFF_MANAGED_PUBLIC_PATH = "/projects/data/iu-affiliate-cj-managed-public-v1.json";
  var IU_AFF_PHASE2_OFFERS_SRC = "/assets/iu-affiliate-phase2-offers-v1.js?v=cj-phase2c-offers-v3";
  var __iuAffManagedOverlayApplied = false;
  var __iuAffPhase2OffersLoading = false;
  var __iuAffPhase2OffersLoaded = false;

  function ensurePhase2OffersScript(done) {
    if (__iuAffPhase2OffersLoaded || (window.iuAffiliatePhase2OffersRender && window.__iuAffiliatePhase2OffersBooted)) {
      __iuAffPhase2OffersLoaded = true;
      if (typeof done === "function") done(true);
      return;
    }
    if (document.querySelector('script[data-iu-aff-phase2-offers="1"]')) {
      if (typeof done === "function") {
        var waitN = 0;
        var t = setInterval(function () {
          waitN++;
          if (window.iuAffiliatePhase2OffersRender || waitN > 40) {
            clearInterval(t);
            __iuAffPhase2OffersLoaded = Boolean(window.iuAffiliatePhase2OffersRender);
            done(__iuAffPhase2OffersLoaded);
          }
        }, 50);
      }
      return;
    }
    if (__iuAffPhase2OffersLoading) {
      if (typeof done === "function") {
        var waitN2 = 0;
        var t2 = setInterval(function () {
          waitN2++;
          if (__iuAffPhase2OffersLoaded || waitN2 > 40) {
            clearInterval(t2);
            done(__iuAffPhase2OffersLoaded);
          }
        }, 50);
      }
      return;
    }
    __iuAffPhase2OffersLoading = true;
    var s = document.createElement("script");
    s.src = IU_AFF_PHASE2_OFFERS_SRC;
    s.async = true;
    s.setAttribute("data-iu-aff-phase2-offers", "1");
    s.onload = function () {
      __iuAffPhase2OffersLoading = false;
      __iuAffPhase2OffersLoaded = true;
      if (typeof done === "function") done(true);
    };
    s.onerror = function () {
      __iuAffPhase2OffersLoading = false;
      __iuAffPhase2OffersLoaded = false;
      if (typeof done === "function") done(false);
    };
    (document.head || document.documentElement).appendChild(s);
  }

  function __iuAffIsProtectedItem(it) {
    if (!it) return false;
    if (it.management === "MANUAL_PROTECTED" || it.management === "PAID_RESERVED") return true;
    /* Baseline protected partners have no advertiserId in baked catalog historically — keep https items without overlay hide. */
    return false;
  }

  function applyManagedPublicOverlay(overlay) {
    if (!overlay || !Array.isArray(overlay.partners)) return false;
    var byAdv = {};
    for (var i = 0; i < overlay.partners.length; i++) {
      var p = overlay.partners[i];
      if (!p || p.advertiserId == null) continue;
      byAdv[String(p.advertiserId)] = p;
    }
    for (var c = 0; c < IU_AFFILIATE_CATALOG.length; c++) {
      var cat = IU_AFFILIATE_CATALOG[c];
      var kept = [];
      var seenAdv = {};
      for (var j = 0; j < cat.items.length; j++) {
        var it = cat.items[j];
        var adv = it.advertiserId != null ? String(it.advertiserId) : null;
        if (adv && byAdv[adv]) {
          var ov = byAdv[adv];
          if (ov.active === false) {
            /* Never hide MANUAL_PROTECTED / PAID_RESERVED — only CJ_MANAGED */
            if (__iuAffIsProtectedItem(it)) {
              kept.push(it);
              seenAdv[adv] = true;
            }
            continue;
          }
          kept.push({
            title: ov.title || it.title,
            url: ov.url || it.url,
            affiliateUrlReady: true,
            advertiserId: adv,
            management: "CJ_MANAGED",
          });
          seenAdv[adv] = true;
        } else if (!adv || !byAdv[adv]) {
          /* retain MANUAL_PROTECTED / unlisted baked partners (LKG) */
          kept.push(it);
          if (adv) seenAdv[adv] = true;
        }
      }
      /* add new active managed partners for this section */
      for (var k = 0; k < overlay.partners.length; k++) {
        var np = overlay.partners[k];
        if (!np || np.active === false) continue;
        if (String(np.sectionId || "") !== String(cat.id)) continue;
        var nid = String(np.advertiserId);
        if (seenAdv[nid]) continue;
        if (!np.url || !/^https:\/\//i.test(String(np.url))) continue;
        kept.push({
          title: np.title,
          url: np.url,
          affiliateUrlReady: true,
          advertiserId: nid,
          management: "CJ_MANAGED",
        });
        seenAdv[nid] = true;
      }
      cat.items = kept;
    }
    __iuAffManagedOverlayApplied = true;
    return true;
  }

  function loadManagedPublicOverlay(done) {
    var src = IU_AFF_MANAGED_PUBLIC_PATH;
    try {
      var el = document.querySelector("[data-iu-aff-managed-src]");
      if (el) {
        var custom = el.getAttribute("data-iu-aff-managed-src");
        if (custom) src = custom;
      }
    } catch (_) {}
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var to = setTimeout(function () {
      try {
        if (ctrl) ctrl.abort();
      } catch (_) {}
    }, 2500);
    /* PWA/cache: bust query from clock; response also cache: no-store */
    if (src.indexOf("?") === -1) src = src + "?v=" + String(Date.now());
    else src = src + "&v=" + String(Date.now());
    var fetchOpts = { credentials: "same-origin", cache: "no-store" };
    if (ctrl) fetchOpts.signal = ctrl.signal;
    fetch(src, fetchOpts)
      .then(function (r) {
        if (!r.ok) throw new Error("overlay_http_" + r.status);
        return r.json();
      })
      .then(function (data) {
        clearTimeout(to);
        applyManagedPublicOverlay(data);
        if (typeof done === "function") done(true);
      })
      .catch(function () {
        clearTimeout(to);
        /* local-first: keep baked catalog (last-known-good) */
        if (typeof done === "function") done(false);
      });
  }

  window.iuAffiliateApplyManagedPublicOverlay = applyManagedPublicOverlay;
  window.iuAffiliateLoadManagedPublicOverlay = loadManagedPublicOverlay;

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
  loadManagedPublicOverlay(function () {
    try {
      var secNow =
        (document.body && document.body.dataset && document.body.dataset.section) || "";
      if (isAffiliateSectionKey(secNow)) renderAffiliateSection(secNow);
    } catch (_) {}
  });
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
