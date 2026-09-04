/**
 * InfoUzel — GDPR / VOP / InfoUzel Ads legal body (v2026-09-05-v1).
 * Mounted into iCentrum section `gdpr-vop` and public /gdpr-a-vop/.
 * Claims must stay aligned with production audit (local-first vault, consent analytics, contextual ads).
 */
(function iuGdprVopLegalBodyV1(global) {
  "use strict";

  var META = {
    versionId: "2026-09-05-v1",
    effectiveDate: "2026-09-05",
    lastUpdated: "2026-09-05",
    documentId: "gdpr-vop-ads",
  };

  function bodyHtml() {
    return [
      '<div data-iu-legal-doc="gdpr-vop-ads" data-iu-legal-version="2026-09-05-v1">',
      '<p class="iuInfoCenter__lead">Tento dokument popisuje zpracování osobních údajů a podmínky používání InfoUzel.cz a služby InfoUzel Ads podle skutečného provozu k datu účinnosti. Nejde o marketingový popis „ideálního stavu“. Identifikační údaje provozovatele jsou shodné se sekcí <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="contact">Provozovatel a kontakt</button>.</p>',
      '<p class="iuInfoCenter__p"><strong>Verze dokumentu:</strong> <span data-iu-legal-version-id>2026-09-05-v1</span> · <strong>Účinnost:</strong> <span data-iu-legal-effective>5.&nbsp;9.&nbsp;2026</span> · <strong>Poslední aktualizace:</strong> <span data-iu-legal-updated>5.&nbsp;9.&nbsp;2026</span></p>',
      '<p class="iuInfoCenter__p">Veřejná trvalá adresa: <a class="iuInfoCenter__link" href="/gdpr-a-vop/">https://infouzel.cz/gdpr-a-vop/</a></p>',

      '<nav class="iuInfoCenter__box" aria-label="Obsah dokumentu" data-iu-legal-toc="1">',
      '<p class="iuInfoCenter__p"><strong>Obsah</strong></p>',
      '<ul class="iuInfoCenter__ul">',
      '<li><a class="iuInfoCenter__link" href="#iu-legal-gdpr">I. Ochrana osobních údajů – GDPR</a></li>',
      '<li><a class="iuInfoCenter__link" href="#iu-legal-vop">II. Všeobecné obchodní podmínky</a></li>',
      '<li><a class="iuInfoCenter__link" href="#iu-legal-ads">III. Pravidla reklamy a InfoUzel Ads</a></li>',
      "</ul></nav>",

      // GDPR
      '<h2 class="iuInfoCenter__h2" id="iu-legal-gdpr">I. Ochrana osobních údajů – GDPR</h2>',
      '<h3 class="iuInfoCenter__h3">1. Správce</h3>',
      '<p class="iuInfoCenter__p">Správcem osobních údajů pro zpracování, které InfoUzel skutečně provádí na straně provozovatele (zejména provoz webu, volitelné anonymizované statistiky po souhlasu, e-mailová komunikace, klientský vztah InfoUzel Ads), je:</p>',
      '<div class="iuInfoCenter__companyCard" data-iu-legal-controller="1">',
      '<p class="iuInfoCenter__companyName">Media Uzel s.r.o.</p>',
      '<p class="iuInfoCenter__companyRow">Kněžická 96, 190 12 Praha 9</p>',
      '<p class="iuInfoCenter__companyRow"><strong>IČ:</strong> 29482241</p>',
      '<p class="iuInfoCenter__companyRow"><strong>E-mail:</strong> <a class="iuInfoCenter__link" href="mailto:info@infouzel.cz">info@infouzel.cz</a></p>',
      '<p class="iuInfoCenter__companyRow"><strong>Web:</strong> <a class="iuInfoCenter__link" href="https://infouzel.cz" rel="noopener noreferrer">https://infouzel.cz</a></p>',
      '<p class="iuInfoCenter__companyRow">Společnost zapsaná u Městského soudu v Praze, sp. zn. <strong>C 447292</strong></p>',
      '<p class="iuInfoCenter__companyRow"><strong>Bankovní účet:</strong> 294822412/5500</p>',
      '<p class="iuInfoCenter__companyRow">DIČ není ve veřejném UI uváděno; společnost není prezentována jako plátce DPH v iCentru.</p>',
      "</div>",
      '<p class="iuInfoCenter__p">Podrobnosti a kontaktní formulace jsou vedeny jednotně v sekci <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="contact">Provozovatel a kontakt</button>.</p>',

      '<h3 class="iuInfoCenter__h3">2. Kontaktní místo pro GDPR</h3>',
      '<p class="iuInfoCenter__p">Žádosti o přístup, opravu, výmaz, omezení, námitku, přenositelnost, odvolání souhlasu a další otázky ochrany osobních údajů zasílejte na <a class="iuInfoCenter__link" href="mailto:info@infouzel.cz">info@infouzel.cz</a>. U GDPR žádostí se snažíme odpovědět do jednoho měsíce (čl. 12 GDPR), případně v zákonné lhůtě prodloužení.</p>',

      '<h3 class="iuInfoCenter__h3">3. Pověřenec (DPO)</h3>',
      '<p class="iuInfoCenter__p">Provozovatel není pověřencem pro ochranu osobních údajů a ke dni účinnosti tohoto dokumentu nevykonává činnost, u níž by byla jmenována povinná funkce DPO podle čl. 37 GDPR. Nebyl jmenován ani dobrovolný DPO. Kontaktní místo je výše uvedené.</p>',

      '<h3 class="iuInfoCenter__h3">4. Základní rozlišení dat</h3>',
      '<ul class="iuInfoCenter__ul">',
      "<li><strong>A. Data pouze v zařízení uživatele (local-first)</strong> — typicky obsah poznámek, úkolů, kalendáře, osobních nastavení, fakturační pomůcky, generátoru smluv/PDF, části MindMenu a šifrované vault úložiště. Provozovatel tento obsah standardně nepřijímá ani neukládá na svých serverech.</li>",
      "<li><strong>B. Data přijatá provozovatelem</strong> — například volitelné agregované statistiky po souhlasu, technické provozní údaje infrastruktury, e-mailová komunikace, údaje reklamních klientů InfoUzel Ads a související fakturace.</li>",
      "<li><strong>C. Data předaná třetí straně</strong> — pouze tam, kde to funkce skutečně vyžaduje (např. souřadnice/město u Open-Meteo po volbě uživatele; YouTube při přehrání; oficiální weby dopravců u zásilek).</li>",
      "<li><strong>D. „Anonymní“ data</strong> — výrazy „anonymní / agregované“ používáme jen u statistik navržených bez identifikace osoby. Pokud by šlo pouze o pseudonymní identifikátory, neuvádíme je jako anonymní.</li>",
      "</ul>",

      '<h3 class="iuInfoCenter__h3">5. Přehled činností zpracování (auditem ověřené)</h3>',
      '<div class="iuInfoCenter__box"><div class="iuInfoCenter__tableWrap"><table class="iuInfoCenter__table" data-iu-legal-processing-table="1">',
      "<thead><tr><th>Účel</th><th>Údaje</th><th>Právní základ</th><th>Příjemce / místo</th><th>Retence</th></tr></thead><tbody>",
      "<tr><td>Provoz webu (GitHub Pages, CDN/Workers)</td><td>Technické requesty (může zahrnovat IP, čas, URL, User-Agent na úrovni infrastruktury)</td><td>Čl. 6(1)(f) GDPR — oprávněný zájem na bezpečném provozu</td><td>GitHub Pages; Cloudflare Workers / infrastruktura</td><td>Dle poskytovatele infrastruktury; provozovatel nevede v aplikaci vlastní přístupový log návštěvníka</td></tr>",
      "<tr><td>Volitelné agregované statistiky (InfoUzel Analytics)</td><td>Typ události, kategorie zařízení, volitelný section_id / reklamní slot ID; <strong>ne</strong> IP, plný UA, cookies identity, GPS, volný text</td><td>Čl. 6(1)(a) — souhlas</td><td>Cloudflare Worker + D1 (iu-analytics)</td><td>Denní agregáty bez automatického výmazu; mazání dle provozní politiky správce</td></tr>",
      "<tr><td>Počasí (Open-Meteo)</td><td>Zeměpisné souřadnice nebo zvolené město (query)</td><td>Čl. 6(1)(a)/(b) dle kontextu — souhlas prohlížeče s geolokací / plnění funkce na žádost</td><td>api.open-meteo.com</td><td>U provozovatele se souřadnice jako historie neukládají; zpracování u Open-Meteo dle jejich podmínek</td></tr>",
      "<tr><td>Veřejná data Přehledu dne (ČHMÚ / NDIC snímky)</td><td>Veřejná data výstrah/dopravy; ne osobní obsah uživatele</td><td>Není zpracování osobních údajů uživatele</td><td>Same-origin snapshoty InfoUzlu</td><td>Dle datových snapshotů</td></tr>",
      "<tr><td>Veřejné doručení reklam</td><td>Kategorie zařízení + volitelná sekce; bez profilování</td><td>Čl. 6(1)(f) — provoz reklamní plochy / smluvní plnění vůči inzerentovi</td><td>ads.infouzel.cz</td><td>Bez ukládání reklamního identifikátoru návštěvníka v public delivery</td></tr>",
      "<tr><td>Klientský portál InfoUzel Ads</td><td>Firemní a kontaktní údaje, objednávky, kampaně, přístupové kódy (hash), relace</td><td>Čl. 6(1)(b) smlouva; 6(1)(c) účetní povinnosti; 6(1)(f) bezpečnost účtu</td><td>Cloudflare Worker/D1/R2 iu-ads</td><td>Po dobu smlouvy + zákonné účetní lhůty u daňových dokladů</td></tr>",
      "<tr><td>E-mailová komunikace</td><td>E-mail, obsah zprávy, metadata</td><td>Čl. 6(1)(f)/(b)/(c) dle typu žádosti</td><td>E-mailový systém provozovatele</td><td>Po dobu vyřízení a oprávněné archivace komunikace</td></tr>",
      "<tr><td>Local-first obsah (poznámky, úkoly, kalendář, vault…)</td><td>Obsah zvolený uživatelem</td><td>Zpracování na straně provozovatele standardně nevzniká</td><td>Zařízení uživatele</td><td>Do smazání uživatelem / smazání dat webu</td></tr>",
      "</tbody></table></div></div>",

      '<h3 class="iuInfoCenter__h3">6. Technické logy a infrastruktura</h3>',
      '<p class="iuInfoCenter__p">Web je hostován na GitHub Pages; části služeb běží na Cloudflare Workers (analytika, reklama, přesměrování). Na úrovni infrastruktura mohou vznikat provozní metadata (včetně IP a User-Agent). Provozovatel <strong>neprovozuje</strong> v InfoUzel Analytics D1 ukládání IP ani plného User-Agent. Retence edge logů poskytovatelů infrastruktury není v aplikaci konfigurována a řídí se jejich podmínkami.</p>',

      '<h3 class="iuInfoCenter__h3">7. Silver a local-first nástroje</h3>',
      '<p class="iuInfoCenter__p">Silver je navržen jako lokální asistent v prohlížeči. Osobní obsah poznámek, úkolů a kalendáře se pro účel Silvera standardně neodesílá na server provozovatele ani na externí AI API. Silver není právní, lékařská ani finanční poradenská služba. Podrobnosti: <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="silver">O Silverovi</button>, <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="data-storage">Ukládání a ochrana vašich dat</button>.</p>',

      '<h3 class="iuInfoCenter__h3">8. Geolokace a počasí</h3>',
      '<p class="iuInfoCenter__p">Geolokace probíhá jen po povolení prohlížečem, nebo můžete zvolit město ručně. Souřadnice/město mohou být odeslány poskytovateli předpovědi Open-Meteo. InfoUzel nepoužívá geolokaci pro reklamní profilování.</p>',

      '<h3 class="iuInfoCenter__h3">9. Statistiky návštěvnosti</h3>',
      '<p class="iuInfoCenter__p">InfoUzel Analytics je defaultně vypnuté. Spouští se jen po souhlasu (localStorage preference). Neslouží k identifikaci osoby, nepoužívá analytické cookies identity, neukládá IP do D1. Souhlas lze kdykoli odvolat v <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="privacy-settings">Nastavení soukromí</button>. Více: <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="stats">Statistiky a transparentnost</button> a <a class="iuInfoCenter__link" href="/statistiky/">/statistiky/</a>.</p>',

      '<h3 class="iuInfoCenter__h3">10. Cookies a technické ukládání</h3>',
      '<p class="iuInfoCenter__p">Technicky nezbytné ukládání (localStorage/sessionStorage/IndexedDB vault, Cache API, service worker, PWA) slouží chodu webu a local-first funkcí. Marketingové cookies třetích stran provozovatel nezavádí. Podrobný popis: <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="cookies">Cookies a technické ukládání</button>.</p>',

      '<h3 class="iuInfoCenter__h3">11. InfoUzel Ads (klienti)</h3>',
      '<p class="iuInfoCenter__p">Klientský portál zpracovává údaje nezbytné pro smlouvu a fakturaci (např. firma, IČO, kontakt, kampaně, přístupový kód v hashované podobě, relace). Veřejné doručení reklam je kontextové (zařízení/sekce), bez personalizace, fingerprintingu a reklamních tracking cookies dle současného produkčního modelu. Portál: <a class="iuInfoCenter__link" href="https://ads.infouzel.cz/client" rel="noopener noreferrer">ads.infouzel.cz/client</a>.</p>',

      '<h3 class="iuInfoCenter__h3">12. Příjemci a zpracovatelé (skuteční)</h3>',
      '<ul class="iuInfoCenter__ul" data-iu-legal-processors="1">',
      "<li><strong>GitHub Pages</strong> — hosting statického webu.</li>",
      "<li><strong>Cloudflare</strong> — Workers, D1, R2 (analytika, ads, přesměrování); možné edge metadata.</li>",
      "<li><strong>Open-Meteo</strong> — předpověď počasí po volbě uživatele.</li>",
      "<li><strong>YouTube / Google</strong> — náhledy a přehrání při použití příslušných funkcí.</li>",
      "<li><strong>Dopravci zásilek</strong> — po kliknutí na oficiální tracking (uživatel opouští InfoUzel).</li>",
      "</ul>",
      '<p class="iuInfoCenter__p">Seznam zdrojů veřejných dat: <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="data-sources">Zdroje dat</button> a <a class="iuInfoCenter__link" href="/zdroje-a-licence/">Zdroje a licence</a>.</p>',

      '<h3 class="iuInfoCenter__h3">13. Předávání mimo EHP</h3>',
      '<p class="iuInfoCenter__p" data-iu-legal-truth="international-transfers-doc">Někteří poskytovatelé mohou mít infrastrukturu mimo EHP (např. služby Google/YouTube, GitHub). Tam, kde to nastane, se řídíme mechanismy daného poskytovatele (např. standardní smluvní doložky / rámce poskytovatele). Provozovatel nezavádí vlastní přenosy osobního obsahu local-first nástrojů mimo zařízení.</p>',

      '<h3 class="iuInfoCenter__h3">14. Práva subjektů údajů</h3>',
      '<p class="iuInfoCenter__p">Máte práva dle čl. 15–22 GDPR v rozsahu, v jakém údaje u správce skutečně existují: přístup, oprava, výmaz, omezení, přenositelnost (u smluvního/souhlasového zpracování), námitka, odvolání souhlasu, stížnost u ÚOOÚ. Automatizované individuální rozhodování ve smyslu čl. 22 GDPR InfoUzel neprovádí.</p>',
      '<p class="iuInfoCenter__p"><strong>Profilování:</strong> Veřejné doručení reklam není personalizované podle profilu uživatele. Agregované statistiky po souhlasu neslouží k vytvoření uživatelského profilu pro cílení.</p>',
      '<p class="iuInfoCenter__p"><strong>Local-first:</strong> Pokud obsah nikdy nepřišel na servery provozovatele, nelze ze serveru vydat jeho kopii ani jej ze serveru smazat — správa probíhá ve vašem zařízení (včetně <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="data-management">Záloha a obnova dat</button>).</p>',
      '<p class="iuInfoCenter__p"><strong>ÚOOÚ:</strong> Úřad pro ochranu osobních údajů, Pplk. Sochora 27, 170 00 Praha 7, <a class="iuInfoCenter__link" href="https://www.uoou.cz" rel="noopener noreferrer">www.uoou.cz</a>.</p>',
      '<p class="iuInfoCenter__p">Při důvodných pochybnostech o totožnosti žadatele může provozovatel požadovat přiměřené ověření (čl. 12 GDPR).</p>',

      '<h3 class="iuInfoCenter__h3">15. DPIA a bezpečnost</h3>',
      '<p class="iuInfoCenter__p">Ke dni účinnosti provozovatel nevyhodnotil povinnost DPIA jako vzniklou jen z existence local-first AI Silvera nebo kontextové reklamy bez profilování. Bezpečnostní incidenty a případná porušení zabezpečení se posuzují dle čl. 33–34 GDPR. Hlášení: <a class="iuInfoCenter__link" href="mailto:info@infouzel.cz">info@infouzel.cz</a> s předmětem „Bezpečnost / GDPR“.</p>',

      // VOP
      '<h2 class="iuInfoCenter__h2" id="iu-legal-vop">II. Všeobecné obchodní podmínky</h2>',
      '<h3 class="iuInfoCenter__h3">1. Základní ustanovení</h3>',
      '<p class="iuInfoCenter__p">Tyto VOP upravují užívání webu InfoUzel.cz (včetně PWA) a — ve spojení s částí III — službu InfoUzel Ads. Provozovatel: Media Uzel s.r.o. (údaje výše). „Uživatel“ je návštěvník webu; „Klient“ je objednatel reklamy; „Spotřebitel“ má význam dle občanského zákoníku.</p>',

      '<h3 class="iuInfoCenter__h3">2. Předmět služby</h3>',
      '<p class="iuInfoCenter__p">InfoUzel poskytuje přehledové informace (např. doprava, ČHMÚ), local-first nástroje (Silver, kalendář, úkoly, poznámky, faktury, generátor textu/PDF), rozcestníky externích služeb a volitelně reklamní plochy. Rozsah funkcí je popsán v <button type="button" class="iuInfoCenter__actionLink" data-iu-info-goto="about">O InfoUzel.cz</button>.</p>',

      '<h3 class="iuInfoCenter__h3">3. Bezplatná část a placené služby</h3>',
      '<p class="iuInfoCenter__p">Běžné užívání webu a local-first nástrojů je bez registrace a bez poplatku. Placenou službou je zejména InfoUzel Ads (reklama / klientský portál) dle aktuální nabídky a objednávky. Neuvádíme ceny služeb, které nejsou skutečně nabízeny.</p>',

      '<h3 class="iuInfoCenter__h3">4. Local-first, PWA a záloha</h3>',
      '<ul class="iuInfoCenter__ul">',
      "<li>Lokální úložiště není cloudový účet provozovatele.</li>",
      "<li>Instalace PWA sama o sobě není záloha dat.</li>",
      "<li>Export/import šifrované zálohy je popsán v sekci Záloha a obnova dat.</li>",
      "<li>Při ztrátě zařízení, smazání dat webu nebo poškození úložiště může dojít ke ztrátě local-first obsahu, pokud neexistuje vaše záloha.</li>",
      "</ul>",

      '<h3 class="iuInfoCenter__h3">5. Orientační povaha výstupů</h3>',
      '<p class="iuInfoCenter__p">Silver, kalkulačky, generátor smluv/PDF a fakturační pomůcka jsou nástroje. Nejde o advokátní, účetní, daňové, lékařské ani investiční poradenství. Výstupy ověřte před použitím. Externí data mohou být zpožděná, neúplná nebo dočasně nedostupná.</p>',

      '<h3 class="iuInfoCenter__h3">6. Externí odkazy a licence</h3>',
      '<p class="iuInfoCenter__p">Po přechodu na externí web platí podmínky daného poskytovatele. Licence a zdroje: <a class="iuInfoCenter__link" href="/zdroje-a-licence/">Zdroje a licence</a>. Ochranné známky třetích stran zůstávají jejich majitelům.</p>',

      '<h3 class="iuInfoCenter__h3">7. Dostupnost a bezpečnost</h3>',
      '<p class="iuInfoCenter__p">Nepřetržitá dostupnost není smluvně garantována, není-li sjednáno jinak. Zakázány jsou útoky, obcházení ochrany, zneužití API, šíření malware a neoprávněný přístup. Provozovatel může provádět údržbu, bezpečnostní a nouzové opravy.</p>',

      '<h3 class="iuInfoCenter__h3">8. Odpovědnost</h3>',
      '<p class="iuInfoCenter__p">Odpovědnost provozovatele se omezuje v rozsahu dovoleném právem. Nevylučujeme odpovědnost tam, kde to kogentní právo nepřipouští (zejména vůči spotřebiteli, za úmysl nebo hrubou nedbalost). Za obsah third-party služeb a dostupnost externích API provozovatel neodpovídá nad rámec zákonných povinností.</p>',

      '<h3 class="iuInfoCenter__h3">9. Spotřebitel a B2B</h3>',
      '<p class="iuInfoCenter__p">InfoUzel Ads je primárně určena podnikatelům (B2B). Pokud by konkrétní smlouva naplnila znaky spotřebitelské smlouvy, použijí se kogentní ustanovení na ochranu spotřebitele a nelze je smluvně vyloučit. Samotné zaškrtnutí „jsem firma“ neobchází zákon, pokud fakticky jde o spotřebitele.</p>',

      '<h3 class="iuInfoCenter__h3">10. Objednávka, odstoupení, reklamace, ADR</h3>',
      '<p class="iuInfoCenter__p">U placených služeb Ads vzniká smlouva potvrzením objednávky / aktivací dle procesu portálu. Před vytvořením platební povinnosti musí být dostupné podstatné informace o službě a ceně. Právo odstoupit od smlouvy se posuzuje podle konkrétního plnění (digitální služba / zahájení plnění). Reklamace: <a class="iuInfoCenter__link" href="mailto:info@infouzel.cz">info@infouzel.cz</a> s identifikací objednávky. Mimosoudní řešení spotřebitelských sporů: Česká obchodní inspekce (<a class="iuInfoCenter__link" href="https://www.coi.cz" rel="noopener noreferrer">www.coi.cz</a>), jsou-li splněny zákonné podmínky.</p>',
      '<p class="iuInfoCenter__p"><strong>Formulář odstoupení (vzor):</strong> Adresát Media Uzel s.r.o., Kněžická 96, 190 12 Praha 9, info@infouzel.cz — „Oznamuji, že odstupuji od smlouvy ze dne …, číslo objednávky …, jméno/firma …, adresa …, datum, podpis (u listiny).“</p>',

      '<h3 class="iuInfoCenter__h3">11. Rozhodné právo</h3>',
      '<p class="iuInfoCenter__p">Vztahy se řídí právem České republiky. Spotřebitele volba práva nezbavuje ochrany, kterou mu poskytují kogentní ustanovení státu jeho obvyklého bydliště, pokud se uplatní.</p>',

      '<h3 class="iuInfoCenter__h3">12. Změny VOP</h3>',
      '<p class="iuInfoCenter__p">Znění pro nové smlouvy se zveřejní s novým <code>versionId</code> a datem účinnosti. U již uzavřených Ads smluv se změny řídí sjednaným procesem; provozovatel nezavádí jednostrannou možnost „okamžitě měnit cokoli“. Pro doložení podmínek objednávky se používá <code>versionId</code> tohoto dokumentu (pole <code>terms_version</code> v evidenci práv/objednávek Ads). Veřejná adresa aktuálního znění: <a class="iuInfoCenter__link" href="/gdpr-a-vop/">/gdpr-a-vop/</a>.</p>',

      // ADS
      '<h2 class="iuInfoCenter__h2" id="iu-legal-ads">III. Pravidla reklamy a InfoUzel Ads</h2>',
      '<h3 class="iuInfoCenter__h3">1. Role a vznik smlouvy</h3>',
      '<p class="iuInfoCenter__p">Objednatel/inzerent odpovídá za podklady a tvrzení reklamy. InfoUzel zajišťuje zveřejnění na vlastních reklamních plochách. Smlouva vzniká potvrzením objednávky a/nebo aktivací kampaně v portálu. Neexistuje automatický nárok na zveřejnění každé reklamy.</p>',

      '<h3 class="iuInfoCenter__h3">2. Model reklamy (produkční realita)</h3>',
      '<ul class="iuInfoCenter__ul">',
      "<li>Kontextové doručení podle zařízení/sekce.</li>",
      "<li>Bez personalizace, retargetingu, fingerprintingu a reklamních tracking cookies v public delivery.</li>",
      "<li>Bez third-party pixelů v inject skriptu.</li>",
      "<li>Statistiky kampaní (pokud jsou klientovi poskytnuty) vycházejí z agregovaných měření provozovatele; nejsou garantovány konverze ani prodeje.</li>",
      "</ul>",

      '<h3 class="iuInfoCenter__h3">3. Označení a oddělení od veřejných dat</h3>',
      '<p class="iuInfoCenter__p">Reklama musí být jako reklama rozpoznatelná. Nesmí působit jako redakční doporučení, státní výstraha, ČHMÚ hlášení ani policejní informace. Koupí reklamy nelze ovlivnit pořadí oficiálních výstrah či veřejných dat mimo viditelně placenou pozici.</p>',

      '<h3 class="iuInfoCenter__h3">4. Materiály a licence</h3>',
      '<p class="iuInfoCenter__p">Klient prohlašuje, že má práva k podkladům a uděluje InfoUzlu nevýhradní oprávnění užít je v rozsahu nutném pro kampaň. InfoUzel může podklady před zveřejněním zkontrolovat a odmítnout.</p>',

      '<h3 class="iuInfoCenter__h3">5. Zakázaná a omezená reklama</h3>',
      '<p class="iuInfoCenter__p">Zakázána je reklama porušující zákon č. 40/1995 Sb. a další předpisy, zejména reklama klamavá, podvodná, malware/phishing, padělky, extremismus, nenávist, nelegální produkty. Politickou reklamu InfoUzel nepřijímá.</p>',
      '<div class="iuInfoCenter__box"><div class="iuInfoCenter__tableWrap"><table class="iuInfoCenter__table" data-iu-legal-ads-categories="1">',
      "<thead><tr><th>Kategorie</th><th>Stav</th><th>Právní důvod (orientačně)</th></tr></thead><tbody>",
      "<tr><td>Tabák, nikotin, e-cigarety</td><td>Zakázáno (default)</td><td>Zvláštní režim zákona o regulaci reklamy</td></tr>",
      "<tr><td>Alkohol</td><td>Zakázáno / jen výslovný schvalovací výjimkový režim</td><td>Zákon o regulaci reklamy</td></tr>",
      "<tr><td>Léčiva, zdravotnické prostředky, zdravotní služby</td><td>Zakázáno (default)</td><td>Zvláštní režim + riziko klamavosti</td></tr>",
      "<tr><td>Hazard, sázky, loterie</td><td>Zakázáno (default)</td><td>Zvláštní režim</td></tr>",
      "<tr><td>Investice, úvěry, finanční služby, krypto</td><td>Zakázáno (default)</td><td>Regulace + klamavost / spotřebitelské riziko</td></tr>",
      "<tr><td>Zbraně, střelivo, výbušniny</td><td>Zakázáno</td><td>Veřejný pořádek / zvláštní režim</td></tr>",
      "<tr><td>Drogy / psychotropní látky</td><td>Zakázáno</td><td>Nelegální obsah</td></tr>",
      "<tr><td>Doplňky stravy, kosmetika s léčebnými claimy</td><td>Omezeno / default zakázáno</td><td>Klamavé zdravotní účinky</td></tr>",
      "<tr><td>Politická / volební reklama</td><td>Zakázáno</td><td>Obchodní rozhodnutí provozovatele + zvláštní režimy</td></tr>",
      "<tr><td>Sexuální / pornografický obsah</td><td>Zakázáno</td><td>Ochrana uživatelů / obsahová politika</td></tr>",
      "<tr><td>Phishing, malware, padělky, extremismus, nenávist</td><td>Zakázáno</td><td>Protiprávní / bezpečnost</td></tr>",
      "</tbody></table></div></div>",
      '<p class="iuInfoCenter__p">Kategorie s přísným zvláštním režimem jsou přijatelné jen po individuálním právním posouzení a doložení oprávnění — defaultně <strong>zakázané</strong>, dokud provozovatel výslovně neschválí.</p>',

      '<h3 class="iuInfoCenter__h3">6. Cílová stránka a bezpečnost</h3>',
      '<p class="iuInfoCenter__p">Cílová URL musí být funkční, bezpečná a relevantní. InfoUzel může kampaň okamžitě pozastavit při podezření na podvod, malware, protiprávní obsah nebo bezpečnostní incident.</p>',

      '<h3 class="iuInfoCenter__h3">7. Cena, fakturace, storno</h3>',
      '<p class="iuInfoCenter__p">Cena a jednotka (např. období / umístění) vyplývají z objednávky. Fakturace a splatnost dle daňového dokladu. Storno před zveřejněním a po zahájení se řídí objednávkou; při zavinění klienta nemusí vznikat nárok na vrácení celé ceny.</p>',

      '<h3 class="iuInfoCenter__h3">8. Obchodní sdělení</h3>',
      '<p class="iuInfoCenter__p">Transakční e-maily (objednávka, faktura, stav kampaně, bezpečnost) nejsou marketingem. Marketingová obchodní sdělení dle zákona č. 480/2004 Sb. jen se souhlasem nebo jiným zákonným titulem; odhlášení musí být jednoduché.</p>',

      '<h3 class="iuInfoCenter__h3">9. DSA klasifikace</h3>',
      '<p class="iuInfoCenter__p">InfoUzel Ads primárně prodává vlastní reklamní plochu provozovatele. Nejde o tržiště uživatelského obsahu třetích osob typu velké online platformy. Povinnosti DSA pro „online platform“ se proto neaplikují automaticky; pokud by se model změnil, provozovatel provede novou klasifikaci.</p>',

      '<h3 class="iuInfoCenter__h3">10. Stížnosti na reklamu</h3>',
      '<p class="iuInfoCenter__p">Hlášení porušení práv, podvodu nebo nelegálního obsahu: <a class="iuInfoCenter__link" href="mailto:info@infouzel.cz">info@infouzel.cz</a> s předmětem „Reklama / stížnost“.</p>',

      '<div class="iuInfoCenter__box iuInfoCenter__box--warn" role="note">',
      "<p class=\"iuInfoCenter__p\"><strong>Právní upozornění:</strong> Tento dokument je připraven podle technického auditu produkce a platných předpisů. Nepředstavuje individuální právní poradenskou službu a nenahrazuje posouzení konkrétního sporu soudem nebo advokátem.</p>",
      "</div>",

      '<div class="iuInfoCenter__crossNav" aria-label="Související sekce">',
      '<button type="button" class="iuInfoCenter__crossNavItem" data-iu-info-goto="contact"><span class="iuInfoCenter__crossNavLabel">🏢 Provozovatel a kontakt →</span></button>',
      '<button type="button" class="iuInfoCenter__crossNavItem" data-iu-info-goto="cookies"><span class="iuInfoCenter__crossNavLabel">🍪 Cookies a technické ukládání →</span></button>',
      '<button type="button" class="iuInfoCenter__crossNavItem" data-iu-info-goto="privacy-settings"><span class="iuInfoCenter__crossNavLabel">🔐 Nastavení soukromí →</span></button>',
      '<button type="button" class="iuInfoCenter__crossNavItem" data-iu-info-goto="stats"><span class="iuInfoCenter__crossNavLabel">📊 Statistiky a transparentnost →</span></button>',
      '<button type="button" class="iuInfoCenter__crossNavItem" data-iu-info-goto="data-storage"><span class="iuInfoCenter__crossNavLabel">🛡️ Ukládání a ochrana dat →</span></button>',
      "</div>",

      '<footer class="iuInfoCenter__meta">Dokument <span data-iu-legal-version-id>2026-09-05-v1</span> · účinnost <span data-iu-legal-effective>5.&nbsp;9.&nbsp;2026</span></footer>',
      "</div>",
    ].join("");
  }

  function mountInto(el) {
    if (!el) return false;
    if (el.getAttribute("data-iu-legal-mounted") === "1") return true;
    el.innerHTML = bodyHtml();
    el.setAttribute("data-iu-legal-mounted", "1");
    return true;
  }

  function enhanceToc(root) {
    var scope = root || document;
    scope.querySelectorAll('[data-iu-legal-toc] a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = (a.getAttribute("href") || "").slice(1);
        var target = id ? document.getElementById(id) : null;
        if (!target) return;
        e.preventDefault();
        try {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (_) {
          target.scrollIntoView(true);
        }
      });
    });
  }

  global.iuGdprVopLegal = {
    META: META,
    bodyHtml: bodyHtml,
    mountInto: mountInto,
    enhanceToc: enhanceToc,
  };
})(typeof window !== "undefined" ? window : globalThis);
