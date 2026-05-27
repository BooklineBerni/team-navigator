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

// Configure the Roadmaps / Joint toggle that lives in place of the page title.
// "Roadmaps" itself is the single-mode segment (looks like a title); "Joint"
// is a small pill next to it. Non-admins only see "Roadmaps" (the joint
// segment is hidden) so for them it just looks like a regular page title.
function wireRoadmapsModeToggle() {
  const toggle = document.getElementById("bnRmModeToggle");
  if (!toggle) return;
  const singleSeg = document.getElementById("bnRmSingleSeg");
  const jointSeg  = document.getElementById("bnRmJointSeg");
  const subtitle  = document.getElementById("bnRmSubtitle");
  const _isAdminLive = (typeof bnUserPermission !== 'undefined' && bnUserPermission === 'admin') &&
                       !(typeof bnPreviewAsEmail !== 'undefined' && bnPreviewAsEmail);
  // Non-admins: hide the Joint pill entirely so the title reads as plain
  // "Roadmaps" without any toggle UI hint.
  if (jointSeg) jointSeg.style.display = _isAdminLive ? "" : "none";
  const isJoint = _isAdminLive && (typeof bnIsJointMode === 'function') && bnIsJointMode();
  if (singleSeg) {
    singleSeg.classList.toggle('active', !isJoint);
    singleSeg.setAttribute('aria-selected', !isJoint ? 'true' : 'false');
  }
  if (jointSeg) {
    jointSeg.classList.toggle('active', isJoint);
    jointSeg.setAttribute('aria-selected', isJoint ? 'true' : 'false');
  }
  if (subtitle) {
    subtitle.textContent = isJoint
      ? 'Pick the roadmaps to combine in a single 6-month timeline.'
      : 'Pick a roadmap to see its tasks on a timeline.';
  }
  // Replace listeners on each render to avoid duplicate wiring. We use cloning
  // because the elements live in the static HTML — they're not rebuilt per
  // render like dynamic content would be.
  toggle.querySelectorAll('.bn-rm-mode-seg').forEach(seg => {
    const clone = seg.cloneNode(true);
    seg.parentNode.replaceChild(clone, seg);
    // Non-admins can't interact with the toggle at all (the Joint seg is hidden
    // and clicking "Roadmaps" is a no-op anyway — already in single mode).
    if (!_isAdminLive && clone.dataset.mode === 'joint') return;
    clone.addEventListener('click', () => {
      if (!_isAdminLive) return;
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
