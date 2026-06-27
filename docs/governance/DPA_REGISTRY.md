# DPA Registry — InfoUzel.cz (interní evidence)

**Provozovatel:** Media Uzel s.r.o.  
**Web:** https://infouzel.cz  
**Účel dokumentu:** Interní evidence zpracovatelských smluv (Art. 28 GDPR) — **ne** user-facing Info Centrum  
**Poslední revize:** 2026-06-15

---

## GitHub (GitHub Pages + GitHub Actions)

| Pole | Hodnota |
|------|---------|
| **Zpracovatel** | GitHub, Inc. (Microsoft) |
| **Služba** | GitHub Pages (statický hosting), GitHub Actions (CI/build) |
| **Účel zpracování** | Hosting veřejného webu, automatizované build/deploy pipeline |
| **Typ dat** | IP adresa při HTTP požadavku, technické logy, metadata repozitáře (build) |
| **DPA reference** | GitHub Data Protection Addendum (DPA) |
| **URL** | https://docs.github.com/en/site-policy/privacy-policies/github-data-protection-addendum |
| **Smluvní rámec** | GitHub Terms of Service + DPA (incorporated by reference pro organizační účty) |
| **Evidence uzavření** | DPA platí automaticky pro GitHub služby dle podmínek GitHub; organizace `Josefjosefjosef/filtr` |
| **Interní kontakt** | info@infouzel.cz |

```
GITHUB_DPA_REFERENCE=https://docs.github.com/en/site-policy/privacy-policies/github-data-protection-addendum
```

---

## Cloudflare (Workers / CDN — pokud nasazeno)

| Pole | Hodnota |
|------|---------|
| **Zpracovatel** | Cloudflare, Inc. |
| **Služba** | Cloudflare Workers (articles-watchdog), CDN/proxy |
| **Účel zpracování** | Technický provoz, cron watchdog |
| **Typ dat** | IP adresa, HTTP metadata |
| **DPA reference** | Cloudflare Customer Data Processing Addendum |
| **URL** | https://www.cloudflare.com/cloudflare-customer-dpa/ |
| **Smluvní rámec** | Cloudflare Terms of Service + Customer DPA |
| **Evidence nasazení v repu** | `cloudflare/articles-watchdog/` |
| **Interní kontakt** | info@infouzel.cz |

```
CLOUDFLARE_DPA_REFERENCE=https://www.cloudflare.com/cloudflare-customer-dpa/
```

---

## Poznámky

- Tento registr je **interní governance dokument**; user-facing popis zpracovatelů je v Info Centru (`projects/index.html` → Externí poskytovatelé).
- Finální právní posouzení LIA / Art. 28 zůstává na counsel review.
- Aktualizovat při změně infrastruktury (nový subprocessor, jiný hosting).
