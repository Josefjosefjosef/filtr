# RECOVERY.md – Návod na obnovu po pádu

## Rychlá obnova (uživatel)

### 1. Obnovit stránku
- Stiskni F5 nebo Ctrl+R
- Pokud to nepomůže, zkus Ctrl+Shift+R (hard refresh)

### 2. Vymazat cache a zkusit znovu
- DevTools (F12) → Application → Clear storage → Clear site data
- Obnovit stránku

### 3. Zkontrolovat offline režim
- Pokud vidíš badge "Offline – zobrazuji uložená data" → web funguje z cache
- Zkontroluj internetové připojení

## Obnova dat (admin/developer)

### 1. Obnovit z backupu (GitHub)

Pokud workflow nasadil rozbitá data:

```bash
# 1. Zkontroluj, co je v backupu
git log --oneline data/backup/

# 2. Obnov poslední validní verzi
git checkout HEAD~1 -- data/current/

# 3. Commit a push
git add data/current/
git commit -m "Recovery: restore from backup"
git push
```

### 2. Manuální obnova z lokálního backupu

Pokud máš lokální kopii:

```bash
# Zkopíruj z backupu do current
cp -r data/backup/1/* data/current/

# Commit
git add data/current/
git commit -m "Recovery: manual restore"
git push
```

### 3. Obnova z quarantine (rozbitá cache)

Pokud cache obsahuje rozbitá data:

```javascript
// V konzoli prohlížeče
localStorage.removeItem('iu:cache:articles:v1:a');
localStorage.removeItem('iu:cache:articles:v1:b');
localStorage.removeItem('iu:cache:articles:v1:c');
// Obnovit stránku
location.reload();
```

## Diagnostika problému

### Krok 1: Zjistit, co se stalo

1. Otevři `?debug=1` na webu
2. Zkontroluj "Poslední chyba" v debug panelu
3. Zkontroluj "Fetch log" → zda se data načítají

### Krok 2: Zkontrolovat data na serveru

```bash
# Zkontroluj, zda soubory existují
ls -la data/current/

# Zkontroluj, zda jsou validní JSON
python3 scripts/validate_json.py data/current

# Zkontroluj, zda nejsou HTML
head -n 5 data/current/articles.json
```

### Krok 3: Zkontrolovat GitHub Actions

1. Jdi na GitHub → Actions
2. Zkontroluj poslední běh workflow
3. Zkontroluj, zda prošel "Validate temp data" step
4. Pokud ne → zkontroluj logy, co selhalo

## Čtení status.json

Soubor `data/current/status.json` obsahuje:

```json
{
  "generated_at": "2026-01-25T12:00:00Z",
  "articles_count": 150,
  "videos_count": 10
}
```

**Interpretace:**
- `generated_at` - kdy byla data naposledy vygenerována
- Pokud je starší než 1 hodina → možný problém s workflow
- `articles_count` / `videos_count` - počet položek (0 = problém)

## Circuit breaker (zdroje)

Pokud jeden feed padá opakovaně:

1. Zkontroluj `data/feed_health.json`
2. Najdi zdroj s `"bozo": true`
3. Zkontroluj `reason` - proč selhává
4. Pokud je to dočasné → počkej, circuit breaker ho zapne zpět po 30-60 min
5. Pokud je to trvalé → oprav feed URL nebo odstraň ze `scripts/feeds.json`

## Testování ochran

### Test offline režimu

1. DevTools (F12) → Network tab
2. Zaškrtni "Offline"
3. Obnovit stránku
4. Web by se měl načíst z cache a zobrazit badge "Offline"

### Test rozbitých dat

1. Otevři `?break=articles404`
2. Web by měl použít cache a zobrazit badge "Síť kolísá"

### Test HTML místo JSON

1. Otevři `?break=articlesHTML`
2. Web by měl detekovat HTML a použít cache

## Kontakt a eskalace

Pokud nic nepomůže:

1. Zkontroluj `DEBUG.md` → root cause analýza
2. Zkontroluj GitHub Issues → zda už někdo nahlásil stejný problém
3. Vytvoř nový Issue s:
   - Screenshot debug panelu (`?debug=1`)
   - Console log
   - Network tab (export jako HAR)
   - Timestamp poslední chyby z localStorage

## Prevence

Aby se problém neopakoval:

1. ✅ Validace v workflow (už implementováno)
2. ✅ Zálohy 3 generací (už implementováno)
3. ✅ Atomic deploy (už implementováno)
4. ✅ Crash shield v runtime (už implementováno)
5. ✅ Service Worker pro offline (už implementováno)

**Doporučení:**
- Pravidelně kontroluj GitHub Actions → zda běží bez chyb
- Pravidelně kontroluj `data/feed_health.json` → zda feedy fungují
- Při změnách v `assets/app.js` → otestuj s `?break=*` parametry
