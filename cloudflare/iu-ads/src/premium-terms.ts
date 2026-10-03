/** Versioned Premium Selected Services B2B terms (public HTML). */

export const PREMIUM_TERMS_VERSION = "premium-selected-services-b2b-v1-20261003";
export const PREMIUM_TERMS_EFFECTIVE_AT = "2026-10-03";

export function buildPremiumTermsHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Obchodní podmínky — Premium Selected Services</title>
<style nonce="${nonce}">
body{margin:0;font:15px/1.5 system-ui,sans-serif;background:#f7f5f1;color:#1a221e;padding:1.25rem}
main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #d6d0c4;border-radius:12px;padding:1.25rem}
h1{font-size:1.25rem} .meta{color:#5c675f;font-size:.9rem}
</style>
</head>
<body>
<main>
<h1>Obchodní podmínky — Premium reklamní služby (Vybrané služby a odkazy)</h1>
<p class="meta">Verze ${PREMIUM_TERMS_VERSION} · účinnost od ${PREMIUM_TERMS_EFFECTIVE_AT}</p>
<p><strong>Poskytovatel:</strong> provozovatel webu InfoUzel.cz (kontakt dle <a href="https://infouzel.cz/projects/gdpr-a-vop/" rel="noopener">VOP a GDPR</a>).</p>
<p>Služba Premium Selected Services je určena <strong>výhradně podnikatelům</strong> (právnické osoby, OSVČ a jiné podnikající subjekty) v souvislosti s podnikatelskou činností. Spotřebitel mimo podnikání službu objednat nemůže. Objednávka vyžaduje platné IČO.</p>
<p>Předmětem je prémiová reklamní pozice P1–P4 ve vybrané kategorii na InfoUzel.cz po dobu <strong>6 měsíců</strong>. Konkrétní pozice a cena jsou uvedeny v rekapitulaci objednávky; cena je <strong>bez DPH</strong> dle ceníku v okamžiku objednávky. Daň na faktuře odpovídá režimu poskytovatele v době vystavení dokladu.</p>
<p>Odesláním formuláře klient činí <strong>návrh objednávky k posouzení</strong>. Smlouva a závazek k úhradě vznikají až po manuálním schválení a zveřejnění administrátorem. Publikace = začátek reklamního období. Prodloužení není automatické; případné prodloužení se sjednává samostatně za cenu dle aktuálního ceníku.</p>
<p>Fakturace probíhá po schválení; splatnost je 3 kalendářní dny, pokud není uvedeno jinak. Neuhrazení nebo nepotvrzení úhrady samo o sobě neukončuje zveřejněnou reklamu — případné pozastavení rozhoduje administrátor.</p>
<p>Klient odpovídá za práva k logu/banneru, pravdivost údajů, legálnost cílové URL a obsahu cílového webu. Poskytovatel může reklamu odmítnout při porušení pravidel nebo zákona. Změna creative/URL po schválení vyžaduje nové posouzení.</p>
<p>InfoUzel <strong>nesleduje</strong> zobrazení ani prokliky prémiových pozic. Reklamace a spory se řídí českým právem; příslušnost soudů dle sídla poskytovatele, není-li dohodnuto jinak v B2B vztahu.</p>
<p>Osobní údaje zpracováváme za účelem vyřízení objednávky a plnění smlouvy; podrobnosti v informaci o zpracování na objednávkové stránce.</p>
<p>Změna těchto podmínek se vztahuje pouze na budoucí objednávky; u provedené objednávky zůstává verze účinná v okamžiku odeslání.</p>
<p><a href="/premium/order">Zpět na objednávku</a></p>
</main>
</body>
</html>`;
}

export function buildPremiumPrivacyNoticeHtml(): string {
  return `<p class="muted legal">Osobní údaje zpracováváme za účelem vyřízení objednávky a plnění smlouvy (kontaktní a fakturační údaje). Podrobnosti: <a href="https://infouzel.cz/projects/gdpr-a-vop/" target="_blank" rel="noopener">Ochrana osobních údajů InfoUzel.cz</a>.</p>`;
}
