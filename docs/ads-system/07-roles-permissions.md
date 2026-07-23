# Roles & permissions — InfoUzel Ads

## Interní role (kap. 4)

| Role code | Název | Shrnutí |
|-----------|-------|---------|
| `main_admin` | Hlavní administrátor | Vše včetně uživatelů, nastavení, audit, kódy |
| `ads_manager` | Správce reklam | Kampaně, kreativy, umístění, statistiky; ne uživatelé/systém |
| `sales` | Obchodník | Klienti, poptávky, objednávky, smlouvy; aktivace reklamy jen se schválením |
| `read_only` | Pouze čtení | Čtení přidělených částí; žádné mutace |

## Enforcement

- Server-side na každém Admin API requestu.
- UI skrytí tlačítek **nestačí**.
- Permissions matrix bude tabulková v Etapě 2 (`admin_permissions` / hardcoded map + DB roles).

## Klient ≠ interní uživatel

Inzerent nemá e-mail/heslo do admin. Přístup jen přes klientský kód → RO session.

## Session cookies (admin)

`Secure`, `HttpOnly`, `SameSite=Strict` (nebo `Lax` pokud cross-subdomain vyžaduje — zdokumentovat odchylku).

## Etapa 8 — alerts

| Permission | main_admin | ads_manager | sales | read_only |
|------------|------------|-------------|-------|-----------|
| `alerts.read` | yes | yes | yes | yes |
| `alerts.write` (ack/resolve/generate) | yes | yes | yes | no |
