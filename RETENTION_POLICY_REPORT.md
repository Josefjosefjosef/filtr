# Retention Policy Report

## Verdict: FIXED (documented in Info Center)

Retention policy doplněna do sekce **Ochrana soukromí a data** v Info Center (`projects/index.html`).

## Policy Summary

| Data type | Retention | User control |
|-----------|-----------|--------------|
| localStorage (notes, tasks, calendar, prefs) | Until user/browser deletes | Browser data clear, in-app delete |
| sessionStorage | Session / until cleared | Tab close, browser clear |
| IndexedDB (`iu.calendar.idb`) | Until user/browser deletes | Browser clear |
| Service Worker cache | Version bump + TTL (articles 300s meta, etc.) | SW update, browser clear |
| PWA install | No server-side backup | Device reset loses local data |
| Server-side | Public static JSON only — no user profiles | N/A |

## Key Statements (honest, no false guarantees)

1. Data are **primarily local** — no central user database.
2. InfoUzel **does not guarantee** persistence across browser clear, device reset, or device swap.
3. User **may lose data** when clearing site data or resetting phone.
4. PWA icon alone **does not guarantee** data retention (already in PWA section).

## Info Center Linkage

- Privacy section: new **„Doba uchování dat (retention)“** subsection.
- Cookies section: technical storage enumeration (existing).
- PWA section: backup warning (existing).

## Gaps / NEEDS REVIEW

- Formal legal review of retention wording vs. GDPR Art. 13 — recommend counsel read Info Center V2.4+ text.
- No automated data export feature (user rights via local delete + email contact).
