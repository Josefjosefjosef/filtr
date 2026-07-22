# Backup & restore — InfoUzel Ads

## Scope denní zálohy (kap. 34)

Klienti, kampaně, dokumenty meta, statistiky (export z Analytics agregátů odděleně), audit, objednávky, smlouvy, faktury, reklamace, nastavení, metadata kreativ, klientská oprávnění (hashe, ne plaintext kódy).

## Požadavky

- Šifrování at-rest (záloha)
- Oddělení od produkce (`iu-ads-backups`)
- Verzování + retenční politika
- Pravidelný restore drill (Etapa 9)
- Žádná plaintext hesla ani klientské kódy

## Etapa 0/1 základ

- Tabulka `backup_manifests`
- Dokumentovaný runbook
- CI hook placeholder (neaktivní job do Etapy 9)
