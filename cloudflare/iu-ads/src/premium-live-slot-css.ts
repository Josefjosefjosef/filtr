/**
 * Production premium slot CSS for order-page preview (must stay in sync with
 * assets/iu-premium-selected-services-v1.css + affiliate grid footprint rules).
 */
export const PREMIUM_LIVE_SLOT_CSS = `
:root{--iuChipH:110px;--iuChipPadX:12px}
.iuRadioGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media(max-width:520px){.iuRadioGrid{grid-template-columns:1fr}}
#iuAffiliateView .iuJRGrid{width:100%;max-width:none;margin:0}
#iuAffiliateView .iuPremiumGrid{margin:0 0 10px}
#iuAffiliateView a.iuPremiumSlot{box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px var(--iuChipPadX,12px);height:var(--iuChipH,110px);min-height:0;max-height:var(--iuChipH,110px);border-radius:12px;overflow:hidden;text-decoration:none;border:1px solid rgba(11,27,43,.14);background:#f8fafc;color:rgba(11,27,43,.88)}
@media(max-width:1024px){#iuAffiliateView a.iuPremiumSlot{padding:16px var(--iuChipPadX,12px);height:var(--iuChipH,110px);max-height:var(--iuChipH,110px)}}
#iuAffiliateView a.iuPremiumSlot--sold img.iuPremiumSlotImg{display:block;width:100%;height:100%}
#iuAffiliateView a.iuPremiumSlot--sold.iuPremiumSlot--logo img.iuPremiumSlotImg{object-fit:contain;padding:10px;box-sizing:border-box}
#iuAffiliateView a.iuPremiumSlot--sold.iuPremiumSlot--banner img.iuPremiumSlotImg{object-fit:cover}
.previewWrap{margin:.35rem 0 .75rem;max-width:100%}
.previewWrap .iuPremiumPreviewGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;width:100%;max-width:100%}
@media(max-width:520px){.previewWrap .iuPremiumPreviewGrid{grid-template-columns:1fr}}
.previewWrap .iuPremiumPreviewGrid--p1 #previewSlot{grid-column:1;grid-row:1}
.previewWrap .iuPremiumPreviewGrid--p2 #previewSlot{grid-column:2;grid-row:1}
.previewWrap .iuPremiumPreviewGrid--p3 #previewSlot{grid-column:1;grid-row:2}
.previewWrap .iuPremiumPreviewGrid--p4 #previewSlot{grid-column:2;grid-row:2}
@media(max-width:520px){
.previewWrap .iuPremiumPreviewGrid--p1 #previewSlot,
.previewWrap .iuPremiumPreviewGrid--p2 #previewSlot,
.previewWrap .iuPremiumPreviewGrid--p3 #previewSlot,
.previewWrap .iuPremiumPreviewGrid--p4 #previewSlot{grid-column:1}
.previewWrap .iuPremiumPreviewGrid--p2 #previewSlot{grid-row:2}
.previewWrap .iuPremiumPreviewGrid--p3 #previewSlot{grid-row:3}
.previewWrap .iuPremiumPreviewGrid--p4 #previewSlot{grid-row:4}
}
.previewWrap .iuPremiumSlot{cursor:default;pointer-events:none;width:100%;max-width:100%;box-sizing:border-box;justify-self:stretch}
.previewHint{font-size:.85rem;margin:0 0 .35rem}
`;
