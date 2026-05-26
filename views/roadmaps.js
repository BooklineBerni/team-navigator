// =============================================================================
// views/roadmaps.js
// ---------------------------------------------------------------------------
// "Roadmaps" tab in the sidebar. The actual rendering for each roadmap lives
// in views/roadmap-calendar.js (renderRoadmapCalendar); this file just
// exposes the page-level wrapper (renderRoadmapsTimelinePage) that the
// central render() dispatcher calls.
//
// Loaded AFTER inline + views/roadmap-calendar.js.  Top-level `function`
// declaration in a classic script → goes on window automatically, so the
// inline render() dispatcher's `typeof renderRoadmapsTimelinePage === 'function'`
// guard resolves correctly.
// =============================================================================

function renderRoadmapsTimelinePage() {
  const sel = document.getElementById("rmSelector");
  const cont = document.getElementById("rmPageContent");
  const rms = getRoadmaps();
  if (rms.length === 0) {
    if (sel) sel.innerHTML = "";
    cont.innerHTML = '<div class="rm-empty">No roadmaps yet. Click "+ New roadmap" to create one.</div>';
    return;
  }
  // Hide the standalone selector strip — the picker lives inline in the summary card.
  if (sel) sel.innerHTML = "";
  // Joint mode (admin-only). Renders a multi-roadmap 6MFN aggregated view.
  // Only admins (NOT in preview-as) get to use this — for everyone else we
  // silently fall back to the single-roadmap view.
  const _isAdminLive = (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'admin') &&
                       !(typeof bnPreviewAsEmail !== 'undefined' && bnPreviewAsEmail);
  if (_isAdminLive && typeof bnIsJointMode === 'function' && bnIsJointMode() && typeof renderJointRoadmapsView === 'function') {
    renderJointRoadmapsView();
    return;
  }
  if (!selectedRoadmapTimelineId || !rms.some(r => r.id === selectedRoadmapTimelineId)) {
    selectedRoadmapTimelineId = rms[0].id;
    localStorage.setItem("bookline-selectedRoadmap", selectedRoadmapTimelineId);
  }
  renderRoadmapCalendar(selectedRoadmapTimelineId);
}
