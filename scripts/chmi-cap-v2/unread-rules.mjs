/**
 * Significant-update unread reset rules for CAP v2 items.
 * Saved/Hidden never auto-cleared. Read may reset to unread on significant change.
 */
export function shouldResetUnreadOnRevision(change) {
  if (!change) return false;
  if (change.significantUnreadReset === true) return true;
  const t = String(change.changeType || change.change_type || "");
  return t === "new" || t === "cancel" || t === "area_expand" || t === "severity_up";
}

/**
 * Apply unread resets into a mutable Set of read ids.
 * @returns {{ resetIds: string[] }}
 */
export function applyUnreadResets(readSet, items) {
  const resetIds = [];
  for (const it of items || []) {
    const cap = it && it.capV2;
    if (!cap || !cap.significantUnreadReset) continue;
    const id = String(it.id || "");
    if (!id) continue;
    if (readSet.has(id)) {
      readSet.delete(id);
      resetIds.push(id);
    }
  }
  return { resetIds };
}
