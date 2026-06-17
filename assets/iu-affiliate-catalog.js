/**
 * infoUzel.cz — Affiliate services catalog (UI + data).
 * Partner URLs are placeholders until affiliate programs are approved.
 */
(function iuAffiliateCatalog() {
  "use strict";

  if (window.__iuAffiliateCatalogBooted) return;
  window.__iuAffiliateCatalogBooted = true;

  var IU_AFFILIATE_DISCLOSURE =
    "Některé odkazy v této sekci jsou partnerské nebo reklamní. Pokud přes ně nakoupíte nebo si objednáte službu, InfoUzel.cz může získat provizi. Cena pro vás zůstává stejná.";

  function affItem(title, slug) {
    return {
      title: title,
      url: "#affiliate-placeholder-" + slug,
      affiliateUrlReady: false,
    };
  }

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

  var IU_AFFILIATE_COLORS = {
    "aff-cestovni-kancelare": "#C9A227",
    "aff-ubytovani-hotely": "#60A5FA",
    "aff-letenky": "#2DD4BF",
    "aff-cestovni-pojisteni": "#34D399",
    "aff-auto-moto": "#FB923C",
    "aff-pojisteni": "#059669",
    "aff-finance": "#10B981",
    "aff-energie-uspor": "#A3E635",
    "aff-lekarny": "#22C55E",
    "aff-zdravi-doplnky": "#6EE7B7",
    "aff-kosmetika": "#F9A8D4",
    "aff-drogerie": "#C4B5FD",
    "aff-moda": "#A78BFA",
    "aff-boty": "#A8A29E",
    "aff-sportovni-obleceni": "#3B82F6",
    "aff-sport-outdoor": "#4ADE80",
    "aff-dum-zahrada": "#65A30D",
    "aff-nabytek": "#D6C4A8",
    "aff-kuchyn": "#FDBA74",
    "aff-elektro": "#22D3EE",
    "aff-mobily": "#7DD3FC",
    "aff-software": "#14B8A6",
    "aff-knihy": "#8B5CF6",
    "aff-jidlo": "#FBBF24",
    "aff-zvirata": "#86EFAC",
  };

  var catalogById = {};
  for (var ci = 0; ci < IU_AFFILIATE_CATALOG.length; ci++) {
    catalogById[IU_AFFILIATE_CATALOG[ci].id] = IU_AFFILIATE_CATALOG[ci];
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
        host.innerHTML = xhr.responseText.replace("<svg ", '<svg id="iuAffInlineSprite" ');
        loaded = !!document.getElementById("iuAffInlineSprite");
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
          host.innerHTML = txt.replace("<svg ", '<svg id="iuAffInlineSprite" ');
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
    if (disclosureEl) disclosureEl.textContent = IU_AFFILIATE_DISCLOSURE;

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
    try {
      var accent = IU_AFFILIATE_COLORS[cat.id] || "";
      if (accent) view.style.setProperty("--iuSectionAccent", accent);
    } catch (_) {}
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
    title.className = "iuLeftRailSectionTitle";
    title.textContent = "Doporučené služby";
    nav.appendChild(title);

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
      try {
        var navAccent = IU_AFFILIATE_COLORS[cat.id];
        if (navAccent) a.style.setProperty("--iuNavAccent", navAccent);
      } catch (_) {}
      nav.appendChild(a);
    }

    nav.setAttribute("data-iu-aff-nav-mounted", "1");
  }

  function initAffiliateCatalog() {
    ensureAffiliateInlineSprite();
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
  window.IU_AFFILIATE_COLORS = IU_AFFILIATE_COLORS;
  window.IU_AFFILIATE_DISCLOSURE = IU_AFFILIATE_DISCLOSURE;
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
