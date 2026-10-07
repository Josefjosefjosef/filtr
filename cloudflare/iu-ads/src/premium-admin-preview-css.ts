/**
 * Admin order detail preview — same slot geometry as live affiliate grid (scoped wrapper).
 */

export function buildAdminPremiumPreviewScopedCss(): string {
  const s = ".admin-premium-preview-scope";
  return (
    s +
    "{--iuChipH:110px;--iuChipPadX:12px;max-width:min(100%,calc((608px - 10px)/2));box-sizing:border-box}" +
    s +
    " a.iuPremiumSlot{box-sizing:border-box;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px var(--iuChipPadX,12px);height:var(--iuChipH,110px);min-height:0;max-height:var(--iuChipH,110px);width:100%;border-radius:12px;overflow:hidden;text-decoration:none;border:1px solid rgba(11,27,43,.14);background:#f8fafc;color:rgba(11,27,43,.88);pointer-events:none}" +
    s +
    " a.iuPremiumSlot--sold img.iuPremiumSlotImg{display:block;width:100%;height:100%;max-width:100%;max-height:100%}" +
    s +
    " a.iuPremiumSlot--sold.iuPremiumSlot--logo img.iuPremiumSlotImg{object-fit:contain;padding:10px;box-sizing:border-box}" +
    s +
    " a.iuPremiumSlot--banner{padding:0}" +
    s +
    " a.iuPremiumSlot--banner img.iuPremiumSlotImg{object-fit:cover;object-position:center center;padding:0;box-sizing:border-box}" +
    s +
    " a.iuPremiumSlot--blend img.iuPremiumSlotImg{display:block;padding:0;box-sizing:border-box;object-fit:contain}"
  );
}

export function wrapAdminPremiumPreviewHtml(slotHtml: string): string {
  return '<div class="admin-premium-preview-scope preview-box">' + slotHtml + "</div>";
}
