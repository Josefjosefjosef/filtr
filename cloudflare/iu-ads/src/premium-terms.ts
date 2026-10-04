/** Versioned Premium Selected Services B2B terms (public HTML). */
import { INFOUZEL_PROVIDER } from "./info-uzel-provider";

export const PREMIUM_TERMS_V1_VERSION = "premium-selected-services-b2b-v1-20261003";
export const PREMIUM_TERMS_V1_EFFECTIVE_AT = "2026-10-03";

export const PREMIUM_TERMS_VERSION = "premium-selected-services-b2b-v2-20261003";
export const PREMIUM_TERMS_EFFECTIVE_AT = "2026-10-03";

const TERMS_BASE_STYLE = `
body{margin:0;font:15px/1.55 system-ui,sans-serif;background:#f7f5f1;color:#1a221e;padding:1rem}
main{max-width:820px;margin:0 auto;background:#fff;border:1px solid #d6d0c4;border-radius:12px;padding:1.25rem 1.35rem}
h1{font-size:1.3rem;line-height:1.25} h2{font-size:1.05rem;margin:1.25rem 0 .45rem} .meta{color:#5c675f;font-size:.9rem}
p,li{line-height:1.5} ol{padding-left:1.25rem} a{color:#0f6b5c}
`;

function providerBlock(): string {
  const p = INFOUZEL_PROVIDER;
  return (
    "<p><strong>" +
    p.legalName +
    "</strong><br/>IČO: " +
    p.ico +
    "<br/>Sídlo: " +
    p.street +
    ", " +
    p.zip +
    " " +
    p.city +
    "<br/>E-mail: <a href=\"mailto:" +
    p.email +
    "\">" +
    p.email +
    "</a><br/>Web: <a href=\"" +
    p.web +
    "\" rel=\"noopener\">" +
    p.web +
    "</a></p>"
  );
}

export function buildPremiumOrderKeyTermsHtml(): string {
  return (
    '<div class="card keyterms" id="keyterms">' +
    "<h2 class=\"summary-h\">Nejdůležitější podmínky</h2>" +
    "<ul class=\"keyterms-ul\">" +
    "<li>Služba je určena <strong>výhradně podnikatelům</strong> (IČO povinné, včetně OSVČ).</li>" +
    "<li>Objednáváte konkrétní prémiovou pozici P1–P4 ve vybrané kategorii na InfoUzel.cz.</li>" +
    "<li>Cena a pozice jsou uvedeny v rekapitulaci; cena je <strong>bez DPH</strong> dle ceníku v okamžiku odeslání.</li>" +
    "<li>Reklamní období činí <strong>6 kalendářních měsíců</strong>; prodloužení <strong>není automatické</strong>.</li>" +
    "<li>Odesláním činíte <strong>návrh objednávky k posouzení</strong>. Smlouva a závazek k úhradě vznikají až po schválení a zveřejnění administrátorem.</li>" +
    "<li>Po schválení se vystaví faktura; splatnost obvykle <strong>3 kalendářní dny</strong>.</li>" +
    "<li>Neuhrazení samo o sobě <strong>neukončuje</strong> zveřejněnou reklamu; případné pozastavení rozhoduje administrátor.</li>" +
    "<li>InfoUzel <strong>nesleduje</strong> zobrazení, prokliky ani CTR; negarantuje obchodní výsledek.</li>" +
    "</ul>" +
    '<p class="legal">Plné znění: <a href="/premium/terms" target="_blank" rel="noopener">Obchodní podmínky Premium</a> · ' +
    '<a href="https://infouzel.cz/projects/gdpr-a-vop/" target="_blank" rel="noopener">Ochrana osobních údajů</a></p>' +
    "</div>"
  );
}

/** Archived v1 (audit / historical orders). */
export function buildPremiumTermsV1Html(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Obchodní podmínky Premium (archiv v1)</title>
<style nonce="${nonce}">${TERMS_BASE_STYLE}</style>
</head>
<body>
<main>
<h1>Obchodní podmínky — Premium (archiv)</h1>
<p class="meta">Verze ${PREMIUM_TERMS_V1_VERSION} · účinnost od ${PREMIUM_TERMS_V1_EFFECTIVE_AT}</p>
<p>Toto je archivní znění nahrazené verzí ${PREMIUM_TERMS_VERSION}. Nové objednávky se řídí aktuálními podmínkami.</p>
<p><a href="/premium/terms">Aktuální obchodní podmínky</a> · <a href="/premium/order">Objednávka</a></p>
</main>
</body>
</html>`;
}

export function buildPremiumTermsHtml(nonce: string): string {
  const p = INFOUZEL_PROVIDER;
  const vatNote = p.vatPayer
    ? "Poskytovatel je plátcem DPH; daň bude uvedena na faktuře dle platných předpisů."
    : "Poskytovatel není plátcem DPH; faktura se vystavuje bez DPH, pokud tomu nebrání jiná zákonná povinnost.";
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Obchodní podmínky — Premium Selected Services</title>
<style nonce="${nonce}">${TERMS_BASE_STYLE}</style>
</head>
<body>
<main>
<h1>Obchodní podmínky — Premium reklamní služby (Vybrané služby a odkazy)</h1>
<p class="meta">Verze ${PREMIUM_TERMS_VERSION} · účinnost od ${PREMIUM_TERMS_EFFECTIVE_AT}</p>

<h2>1. Úvodní ustanovení a poskytovatel</h2>
${providerBlock()}
<p>Tyto obchodní podmínky upravují poskytování služby Premium Selected Services (pronájem prémiové reklamní pozice na InfoUzel.cz) mezi poskytovatelem a podnikatelským klientem.</p>

<h2>2. Definice</h2>
<p><strong>Klient</strong> — podnikatel (právnická osoba, OSVČ nebo jiný podnikající subjekt) objednávající službu v souvislosti s podnikatelskou činností.</p>
<p><strong>Prémiová pozice</strong> — reklamní slot P1, P2, P3 nebo P4 ve vybrané kategorii Vybraných služeb a odkazů.</p>
<p><strong>Kreativa</strong> — logo nebo banner dodaný klientem ve formátech PNG, JPG/JPEG nebo WebP.</p>
<p><strong>Reklamní období</strong> — sjednaných 6 kalendářních měsíců od zveřejnění, pokud není dohodnuto jinak.</p>

<h2>3. Určení služby výhradně podnikatelům</h2>
<p>Služba je určena <strong>výhradně podnikatelům</strong>. Spotřebitel mimo podnikatelskou činnost službu objednat nemůže. Objednávka vyžaduje platné IČO a pravdivé fakturační údaje.</p>

<h2>4. Předmět reklamní služby</h2>
<p>Předmětem je zobrazení schválené kreativy klienta na sjednané prémiové pozici v konkrétní kategorii na InfoUzel.cz, s odkazem na schválenou cílovou URL.</p>

<h2>5. Reklamní pozice P1–P4</h2>
<p>Konkrétní pozice a kategorie jsou uvedeny v rekapitulaci objednávky. Ceníkové ceny jsou uvedeny bez DPH; aktuální ceník platí pro nové objednávky v okamžiku jejich odeslání.</p>
<p>P1–P4 jsou smluvně zakoupené Premium pozice (placement). Veřejné pořadí se počítá pouze mezi aktivními Premium reklamami; volné pozice nevytvářejí prázdné místo. Reklama na nižší zakoupené pozici se může dočasně zobrazovat výše, dokud nejsou obsazeny vyšší pozice; po jejich obsazení se posune nejvýše na svou zakoupenou P1/P2/P3/P4. Dočasně lepší zobrazení nezakládá nárok na jiný produkt, slevu, refund ani trvalé udržení vyšší pozice.</p>

<h2>6. Objednávka a vznik smlouvy</h2>
<p>Odesláním objednávkového formuláře klient činí <strong>návrh objednávky k posouzení</strong>. Poskytovatel objednávku posoudí včetně kreativy a cílové URL. Smlouva o poskytnutí služby a závazek k úhradě vznikají až po manuálním schválení administrátorem a zveřejnění reklamy (Schválit a zveřejnit).</p>

<h2>7. Schvalování reklamního podkladu</h2>
<p>Reklama se zveřejní až po schválení konkrétní verze kreativy a cílové URL. Poskytovatel může objednávku nebo kreativu odmítnout dle těchto podmínek.</p>

<h2>8. Cena služby a daňový režim</h2>
<p>Cena je sjednána v rekapitulaci objednávky jako cena bez DPH za 6měsíční období. ${vatNote} Cena je pro dané období evidována jako neměnný price snapshot.</p>

<h2>9. Fakturace a splatnost</h2>
<p>Po schválení a zveřejnění se vystaví faktura. Splatnost činí 3 kalendářní dny od vystavení, není-li uvedeno jinak. Úhrada se eviduje po manuálním potvrzení administrátora.</p>

<h2>10. Začátek a délka reklamního období</h2>
<p>Reklamní období začíná zveřejněním schválené reklamy a trvá 6 kalendářních měsíců.</p>

<h2>11. Prodloužení</h2>
<p>Prodloužení <strong>není automatické</strong>. Případné prodloužení se sjednává samostatně za cenu dle aktuálního ceníku v době prodloužení.</p>

<h2>12. Reklamní podklady a technické požadavky</h2>
<p>Podporované formáty: PNG, JPG/JPEG, WebP. Typy: logo (contain) nebo banner (celá plocha). Klient odpovídá za technickou kvalitu a čitelnost kreativy.</p>

<h2>13. Cílová URL</h2>
<p>Cílová adresa musí být HTTPS, musí vést na legální obsah a nesmí obsahovat malware, phishing ani jiné nebezpečí.</p>

<h2>14. Práva ke kreativě</h2>
<p>Klient prohlašuje, že má práva k dodané kreativě včetně ochranných známek, fotografií a dalších prvků, a že jejich užití neporušuje práva třetích osob.</p>

<h2>15. Zakázaný obsah</h2>
<p>Zakázán je zejména protiprávní, klamavý, podvodný obsah, malware, nelegální zboží/služby a obsah odporující pravidlům služby.</p>

<h2>16. Změna kreativy nebo URL</h2>
<p>Po schválení je publikovaná verze neměnná; změna vyžaduje nové posouzení a schválení.</p>

<h2>17. Odmítnutí reklamy</h2>
<p>Poskytovatel může reklamu odmítnout nebo odstranit, poruší-li klient podmínky, právní předpisy nebo technická pravidla.</p>

<h2>18. Pozastavení / ukončení zveřebnění</h2>
<p>Pozastavení nebo ukončení zveřejnění provádí administrátor; neuhrazení faktury samo o sobě reklamu automaticky nevypíná.</p>

<h2>19. Dostupnost služby</h2>
<p>Poskytovatel usiluje o dostupnost InfoUzel.cz, avšak negarantuje nepřetržitý provoz. Krátkodobé výpadky údržby, technické závady nebo okolnosti mimo přiměřenou kontrolu nejsou vadou služby samy o sobě.</p>

<h2>20. Reklamace</h2>
<p>Reklamaci zašlete na <a href="mailto:${p.email}">${p.email}</a> s identifikací objednávky/IČO, popisem vady a požadovaným řešením. Poskytovatel reklamaci posoudí a o výsledku informuje e-mailem.</p>

<h2>21. Odpovědnost</h2>
<p>Strany odpovídají za škodu dle obecně závazných právních předpisů. Klient odpovídá za obsah kreativy a cílové stránky.</p>

<h2>22. No-tracking / absence garance výkonu</h2>
<p>InfoUzel pro prémiové pozice <strong>nesleduje</strong> zobrazení, prokliky ani CTR. Služba je pronájem pozice; negarantuje návštěvnost, prokliky, leady ani obchodní výsledek. Klient může použít vlastní parametry v cílové URL (např. UTM); InfoUzel je automaticky nepřidává.</p>

<h2>23. Ochrana osobních údajů</h2>
<p>Zpracování osobních údajů pro objednávku probíhá za účelem jednání o smlouvě a plnění smlouvy. Podrobnosti: <a href="https://infouzel.cz/projects/gdpr-a-vop/" rel="noopener">InfoUzel.cz — GDPR a VOP</a>.</p>

<h2>24. Komunikace</h2>
<p>Kontaktní e-mail pro objednávky a reklamace: <a href="mailto:${p.email}">${p.email}</a>.</p>

<h2>25. Změny obchodních podmínek</h2>
<p>Nové znění se vztahuje na budoucí objednávky. U již odeslaných objednávek zůstává verze podmínek účinná v okamžiku odeslání.</p>

<h2>26. Rozhodné právo</h2>
<p>Vztahy se řídí právním řádem České republiky. Příslušnost soudů dle sídla poskytovatele, není-li mezi podnikateli dohodnuto jinak.</p>

<h2>27. Závěrečná ustanovení</h2>
<p>Archiv předchozí verze: <a href="/premium/terms/v1">${PREMIUM_TERMS_V1_VERSION}</a>.</p>
<p><a href="/premium/order">Zpět na objednávku</a></p>
</main>
</body>
</html>`;
}

export function buildPremiumPrivacyNoticeHtml(): string {
  return `<p class="muted legal">Osobní údaje zpracováváme za účelem vyřízení objednávky a plnění smlouvy (kontaktní a fakturační údaje). Podrobnosti: <a href="https://infouzel.cz/projects/gdpr-a-vop/" target="_blank" rel="noopener">Ochrana osobních údajů InfoUzel.cz</a>.</p>`;
}
