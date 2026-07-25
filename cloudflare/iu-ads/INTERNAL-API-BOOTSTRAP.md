# Bezpečné první přihlášení hlavního administrátora (veřejné reklamy zůstanou OFF)

Tento runbook **nezapíná** veřejné doručování reklam (`SAFE_MODE=true`, `publicDeliveryEnabled=false`).

Heslo, pepper, session secret ani aktivační token **nikdy** neposílejte do Cursoru, chatu, CI logu ani do gitu.

---

## Co vznikne

1. Worker secrets pro autentizaci (z GitHub Actions secrets).
2. Právě jeden účet s rolí `main_admin`.
3. Jednorázový aktivační odkaz (soukromý artifact, 1 den) — heslo si nastavíte v prohlížeči.
4. Admin + Client API ON, veřejné reklamy OFF.

Opakovaný běh při existujícím `main_admin` / `BOOTSTRAP_COMPLETED=1` **selže** (záměrně).

---

## Krok za krokem (pro netechnického správce)

### A) Vytvořte 4 povinné GitHub secrets

1. Otevřete GitHub repozitář **filtr**.
2. Klikněte **Settings** → **Secrets and variables** → **Actions**.
3. Pro každou položku níže: **New repository secret** → Name → Value → **Add secret**.

| Name | Jak bezpečně vytvořit Value (lokálně, mimo chat) |
|------|--------------------------------------------------|
| `ADS_SESSION_SECRET` | PowerShell: `[Convert]::ToBase64String((1..48 \| ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])` |
| `ADS_PASSWORD_PEPPER` | Stejný příkaz znovu (jiná hodnota!). |
| `ADS_CLIENT_SESSION_SECRET` | Stejný příkaz znovu (jiná hodnota!). |
| `ADS_CODE_PEPPER` | Stejný příkaz znovu (jiná hodnota!). |
| `ADS_BACKUP_ENCRYPTION_KEY` | Volitelné; stejný příkaz (jiná hodnota) — pro šifrované produkční zálohy. |

Alternativa (Git Bash / WSL): `openssl rand -base64 48`

**Pravidla:** každá hodnota jiná; nikam nekopírujte kromě GitHub secret pole; neukládejte do Variables (jen Secrets).

Cloudflare tokeny `CLOUDFLARE_ADS_API_TOKEN` / `CLOUDFLARE_API_TOKEN` už musí existovat (deploy).

### B) Spusťte bootstrap workflow

1. **Actions** → vlevo **Bootstrap IU Ads Main Admin**.
2. **Run workflow**.
3. **run_mode** = `bootstrap` (nebo nejdřív `precheck_only` jen pro kontrolu D1 bez seedu).
4. Do pole **admin_email** zadejte e-mail hlavního administrátora (heslo sem **nepatří**; u `precheck_only` může zůstat prázdné).
5. Volitelně upravte zobrazované jméno / TTL (výchozí 3600 s).
6. Nechte **enable_apis_after** zapnuté.
7. Klikněte **Run workflow**.

Úspěch v logu: `D1_ID_RESOLVED=yes`, `BOOTSTRAP_PRECHECK=OK`, `BOOTSTRAP_STATUS=SUCCESS`, `HEALTH_GATE=PASS`, `PUBLIC_ADS=still_OFF`.  
Selhání `MISSING_SECRET=…` → vraťte se ke kroku A.  
Selhání `D1_QUERY_FAILED` / `TABLE_MISSING` → fail-closed (nekontinuje seed).

### C) Nastavte vlastní heslo (aktivační odkaz)

1. Otevřete právě doběhlý běh workflow.
2. Dole **Artifacts** → stáhněte `iu-ads-main-admin-activation`.
3. Rozbalte a otevřete `activation-url.txt` (soukromé okno prohlížeče).
4. Otevře se `/admin` s formulářem aktivace.
5. Zadejte **vlastní silné heslo** (min. 12 znaků) + potvrzení → **Nastavit heslo a aktivovat**.
6. Přihlaste se stejným e-mailem a novým heslem.
7. Smažte stažený soubor / ZIP. Artifact sám vyprší za 1 den.

Heslo **není** v GitHubu, Cloudflare ani v repozitáři. Po použití je token neplatný.

### D) První přihlášení

Otevřete: https://ads.infouzel.cz/admin

Úspěch = vidíte Admin menu (ne `auth_not_configured`).

V UI: **Účet** (změna hesla), **Odhlásit**, **Odhlásit všechny relace**.

### E) Co po úspěchu NEmazat / mazat

| Položka | Akce |
|---------|------|
| `ADS_*` GitHub secrets | **Ponechat** (trvalé Worker auth). |
| Stažený `activation-url.txt` | **Smazat** lokálně. |
| Veřejné reklamy | **Nezapínat** (Kap. 14 = samostatný lidský gate). |

Dočasný GitHub secret s heslem se **nevytváří** — heslo je jen ve vašem prohlížeči.

---

## Co workflow dělá (technicky)

1. Ověří přítomnost GitHub secrets (jména, ne hodnoty).
2. `wrangler secret put` trvalé auth secrets do Workeru `infouzel-ads` (stdout bez hodnot).
3. Resolve reálného D1 `database_id` (placeholder v `wrangler.toml` nestačí).
4. Odmítne, pokud už existuje `main_admin`, `BOOTSTRAP_COMPLETED=1`, nebo nekonzistentní D1.
5. **Nejdřív** `wrangler deploy` (Admin/Client API ON, public OFF).
6. Teprve potom ephemeral `ADS_BOOTSTRAP_TOKEN` přes `wrangler secret put` (secret put nasadí verzi *s* bindingem). **Nikdy** hned poté znovu `deploy` — to v produkci shodilo binding (`bootstrap_token_not_configured`).
7. Readiness: probe se špatným Bearerem musí vrátit `401 unauthorized` (ne `503 bootstrap_token_not_configured`).
8. Atomický seed přes `POST /v1/internal/bootstrap/main-admin` (D1 `batch()`, bez SQL `BEGIN TRANSACTION`); token jen v `Authorization` hlavičce.
9. D1 read-back → privátní artifact → `secret delete ADS_BOOTSTRAP_TOKEN` (i při selhání po put) → ověření, že endpoint je znovu nepoužitelný → health gate.

Skript (inspection-only SQL, bez BEGIN): `cloudflare/iu-ads/scripts/iu-ads-bootstrap-main-admin.mjs`  
Token/readiness helpers: `cloudflare/iu-ads/scripts/iu-ads-bootstrap-token-flow.mjs`  
Worker bootstrap: `cloudflare/iu-ads/src/admin-bootstrap.ts`  
Workflow: `.github/workflows/bootstrap-iu-ads-main-admin.yml`

---

## Legacy (jen nouze — nepoužívejte jako první volbu)

Lokální hash + ruční D1 insert: `scripts/iu-ads-hash-password.mjs`. Preferujte workflow výše.

---

## Jediný manuální blokátor před prvním loginem

**MANUAL_STEP:** vytvořit GitHub Actions secrets (krok A) → spustit **Bootstrap IU Ads Main Admin** (krok B) → aktivovat heslo z artifactu (krok C) → přihlásit na `/admin` (krok D).
