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

// Configure the Single/Joint segmented toggle in the Roadmaps page header.
// Show only for admin-live; hide for everyone else. Highlights the active mode
// and wires clicks to flip joint mode + re-render.
function wireRoadmapsModeToggle() {
  const toggle = document.getElementById("bnRmModeToggle");
  if (!toggle) return;
  const _isAdminLive = (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'admin') &&
                       !(typeof bnPreviewAsEmail !== 'undefined' && bnPreviewAsEmail);
  if (!_isAdminLive) { toggle.style.display = "none"; return; }
  toggle.style.display = "";
  const isJoint = (typeof bnIsJointMode === 'function') ? bnIsJointMode() : false;
  toggle.querySelectorAll('.bn-rm-mode-seg').forEach(seg => {
    const wantJoint = seg.dataset.mode === 'joint';
    const active = wantJoint === isJoint;
    seg.classList.toggle('active', active);
    seg.setAttribute('aria-selected', active ? 'true' : 'false');
    // Replace listeners on each render to avoid duplicate wiring across renders.
    const clone = seg.cloneNode(true);
    seg.parentNode.replaceChild(clone, seg);
    clone.addEventListener('click', () => {
      const wantJointMode = clone.dataset.mode === 'joint';
      if (typeof bnSetJointMode === 'function') bnSetJointMode(wantJointMode);
      renderRoadmapsTimelinePage();
    });
  });
}

function renderRoadmapsTimelinePage() {
  const sel = document.getElementById("rmSelector");
  const cont = document.getElementById("rmPageContent");
  const rms = getRoadmaps();
  // The Single/Joint toggle next to the page title — show it before we even know
  // if there are roadmaps, so admins can still see/use the control.
  wireRoadmapsModeToggle();
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
window.wireRoadmapsModeToggle = wireRoadmapsModeToggle;
