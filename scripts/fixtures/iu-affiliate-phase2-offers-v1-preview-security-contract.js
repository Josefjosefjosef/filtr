/**
 * Minimal preview-security contract snapshot for offline selftests only.
 * Not referenced by production pages; full UI ships in a separate controlled release.
 */
(function () {
  function isLocalDevHost() {
    return false;
  }
  function previewAllowed() {
    if (!isLocalDevHost()) return false;
    try {
      return new URLSearchParams(window.location.search).get("iuCjPreview") === "1";
    } catch {
      return false;
    }
  }
  function applyPreviewData(data) {
    if (!data || data.previewGate === "public_stub_no_staging_data") return;
  }
  void previewAllowed;
  void applyPreviewData;
})();
