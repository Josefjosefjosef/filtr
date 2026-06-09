# Storage Notice Report

## Verdict: FIXED (implemented)

| Field | Value |
|-------|-------|
| **IMPLEMENTED** | YES |
| **MARKETING_CONSENT** | NO |
| **TRACKING** | NO |
| **DISMISS_STORAGE** | localStorage `iu:storage-notice:dismissed:v1` |

## Implementation

| File | Role |
|------|------|
| `assets/iu-storage-notice.js` | Show/dismiss + open Info Center Cookies |
| `assets/iu-storage-notice.css` | Fixed bar above bottom nav on mobile |
| `projects/index.html` | `#iuStorageNotice` markup + asset links |

## UX

- Text: „InfoUzel používá technické ukládání v prohlížeči pro fungování nástrojů, nastavení a offline režim.“
- **Rozumím** — dismiss + localStorage flag only.
- **Více informací** — dismiss + open Info Center → Cookies section.
- Mobile: `bottom` offset above `#iuMobileBottomNav` (z-index 10020 < nav 10025).
- Desktop: bottom floating panel, no nav overlap.

## Compliance Notes

- Not a marketing cookie banner.
- No analytics or third-party consent SDK.
- Aligns with Info Center Cookies section (V2.4).
