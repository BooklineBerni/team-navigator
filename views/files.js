// =============================================================================
// views/files.js
// ---------------------------------------------------------------------------
// Files page view. Loaded AFTER the inline app script so its references to STORE,
// helpers, escapeHtml, etc., are all resolved via the shared classic-script
// scope. The function name stays the same so call-sites in inline (e.g. the
// central render() dispatcher) keep working unchanged.
// =============================================================================

function renderFilesPage() {
  const cont = document.getElementById('filesPageContent');
  const filterBar = document.getElementById('filesFilterBar');
  if (!cont || !filterBar) return;
  const all = STORE.driveFiles || [];
  const counts = { all: all.length, private: all.filter(f => f.sharedWith === 'private').length, team: all.filter(f => f.sharedWith === 'team').length };
  // Filter bar
  filterBar.innerHTML =
    '<button class="files-filter-pill ' + (filesFilter === 'all' ? 'active' : '') + '" data-fil="all">All <span class="count">' + counts.all + '</span></button>' +
    '<button class="files-filter-pill ' + (filesFilter === 'private' ? 'active' : '') + '" data-fil="private">Private <span class="count">' + counts.private + '</span></button>' +
    '<button class="files-filter-pill ' + (filesFilter === 'team' ? 'active' : '') + '" data-fil="team">Team <span class="count">' + counts.team + '</span></button>';
  filterBar.querySelectorAll('.files-filter-pill').forEach(btn => {
    btn.addEventListener('click', () => { filesFilter = btn.dataset.fil; renderFilesPage(); });
  });
  // List
  const visible = all.filter(fileMatchesFilter);
  if (visible.length === 0) {
    cont.innerHTML = '<div class="files-empty">' +
      (all.length === 0 ? 'No files yet. Click <strong>+ Add file</strong> to link a Google Drive document.' : 'No files match the current filter.') +
      '</div>';
    bnUpdateFilesBadge();
    return;
  }
  const containerClass = filesViewMode === 'list' ? 'files-list files-view-list' : 'files-grid files-view-grid';
  let html = '<div class="' + containerClass + '">';
  visible.forEach(f => {
    const t = f.type || detectFileType(f.url);
    const ic = fileIconForType(t);
    const dateStr = f.addedAt ? new Date(f.addedAt).toLocaleDateString('es-ES', { dateStyle: 'short' }) : '';
    const previewIframeUrl = drivePreviewUrl(f);
    // Preview block (used only by grid view) — uses the official Google /preview iframe
    // which works for any user signed into Google with permission to view the file.
    const previewHtml = '<div class="file-preview">' +
      (previewIframeUrl ? '<iframe class="file-iframe" src="' + escapeHtml(previewIframeUrl) + '" sandbox="allow-scripts allow-same-origin allow-popups" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>' : '') +
      '<div class="file-icon-fallback">' + (ic.svg || '') + '</div>' +
      '<div class="file-actions">' +
        '<button class="file-action-btn" data-act="edit" title="Edit">✎</button>' +
        '<button class="file-action-btn danger" data-act="delete" title="Remove">×</button>' +
      '</div>' +
    '</div>';
    // Body (used by both views)
    const typeMiniSvg = ic.svg
      ? ic.svg.replace(/<svg[^>]*>/, '<svg viewBox="0 0 36 44" preserveAspectRatio="xMidYMid meet">')
      : '';
    const bodyHtml = '<div class="file-body">' +
      (filesViewMode === 'list' ? '<div class="file-type-mini">' + typeMiniSvg + '</div>' : '') +
      '<div class="file-info">' +
        '<div class="file-name" title="' + escapeHtml(f.name) + '">' + escapeHtml(f.name) + '</div>' +
        '<div class="file-meta">' +
          '<span>' + escapeHtml(ic.name) + '</span>' +
          (dateStr ? '<span>·</span><span>' + escapeHtml(dateStr) + '</span>' : '') +
          '<span class="file-share ' + (f.sharedWith || 'private') + '">' + (f.sharedWith === 'team' ? 'Team' : 'Private') + '</span>' +
        '</div>' +
      '</div>' +
      (filesViewMode === 'list' ? '<div class="file-actions">' +
        '<button class="file-action-btn" data-act="edit" title="Edit">✎</button>' +
        '<button class="file-action-btn danger" data-act="delete" title="Remove">×</button>' +
      '</div>' : '') +
    '</div>';
    html += '<div class="file-card" data-id="' + escapeHtml(f.id) + '">' +
      previewHtml + bodyHtml +
    '</div>';
  });
  html += '</div>';
  cont.innerHTML = html;
  // Wire up
  cont.querySelectorAll('.file-card').forEach(card => {
    const id = card.dataset.id;
    const f = (STORE.driveFiles || []).find(x => x.id === id);
    if (!f) return;
    card.querySelector('[data-act="edit"]').addEventListener('click', e => { e.stopPropagation(); openFileModal(id); });
    card.querySelector('[data-act="delete"]').addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm("Remove '" + (f.name||'this file') + "' from the list?")) return;
      const wasTeam = f.sharedWith === 'team';
      STORE.driveFiles = (STORE.driveFiles || []).filter(x => x.id !== id);
      saveStore(STORE);
      renderFilesPage();
      if (wasTeam) { bnSyncTeamFilesAfterChange().catch(()=>{}); }
    });
    card.addEventListener('click', () => {
      if (f.url) window.open(f.url, '_blank', 'noopener');
    });
  });
  bnUpdateFilesBadge();
}

