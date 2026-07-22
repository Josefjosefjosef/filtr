/**
 * Test ad campaigns must not pollute business reporting totals.
 * Convention: campaign_id starting with "test_" (or "test." / "test-") is verification-only.
 */
export function isTestAdCampaignId(campaignId: string | null | undefined): boolean {
  const id = String(campaignId || "").trim();
  if (!id) return false;
  return /^test([_.-]|$)/i.test(id);
}
