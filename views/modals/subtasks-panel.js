// =============================================================================
// views/modals/subtasks-panel.js
// ---------------------------------------------------------------------------
// Subtasks panel inside the task modal (group mode).
//
// Loaded AFTER inline. Wirings inside this block move together with their
// functions so DOM addEventListener calls resolve their references locally.
// References to STORE / TEAM / helpers resolve via the shared classic-script
// scope at runtime (when modal events fire).
//
// Drag-reorder: each `.subtask-row` is draggable. The new order is persisted
// to `parent.subtaskOrder` (array of child IDs). Children not present in
// `subtaskOrder` are appended in alphabetical order so legacy groups still
// render sensibly. New subtasks added via the search picker are pushed to the
// end of `subtaskOrder` so they appear at the bottom of the list.
// =============================================================================

// Returns the children of a group task, sorted by the parent's persisted
// `subtaskOrder` first (in that exact order), then anything not yet ranked
// in alphabetical order. Used by both the rendering pass and by the calendar
// view if it wants to honour the same ordering.
function bnSortedSubtasks(parent) {
  const kids = (STORE.tasks || []).filter(x => x && x.groupId === parent.id && x.id !== parent.id);
  const order = Array.isArray(parent.subtaskOrder) ? parent.subtaskOrder : [];
  const byId = new Map(kids.map(k => [k.id, k]));
  const seen = new Set();
  const out = [];
  // First: anything explicitly listed in the saved order, in that order.
  for (const id of order) {
    const k = byId.get(id);
    if (k && !seen.has(id)) { out.push(k); seen.add(id); }
  }
  // Then: anything not yet ranked, alphabetically.
  const tail = kids.filter(k => !seen.has(k.id))
    .slice()
    .sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
  return out.concat(tail);
}
// Expose for cross-file use (calendar, profile, etc.).
window.bnSortedSubtasks = bnSortedSubtasks;

// ---- Subtasks panel inside the task modal (shown when isGroup=true) ----
function renderSubtasksInModal(t) {
  const list = document.getElementById("f_subtasksList");
  const searchInp = document.getElementById("f_subtasksSearch");
  const sugg = document.getElementById("f_subtasksSuggestions");
  if (!list || !searchInp || !sugg) return;
  const children = bnSortedSubtasks(t);
  // Render the list of current subtasks
  if (children.length === 0) {
    list.innerHTML = '<span style="color:#9a9a9a; font-size:12px">No subtasks yet</span>';
  } else {
    list.innerHTML = '<div class="subtasks-list">' + children
      .map(c => {
        const iconLeft = c.isGroup ? '📁' : '·';
        const sAttr = c.slackStatus ? ' data-status="' + escapeHtml(c.slackStatus) + '"' : '';
        const stat = c.slackStatus ? '<span class="subtask-status" data-status="' + escapeHtml(c.slackStatus) + '">' + escapeHtml(c.slackStatus) + '</span>' : '';
        return '<div class="subtask-row" draggable="true" data-tid="' + escapeHtml(c.id) + '"' + sAttr + '>' +
          '<span class="subtask-drag-handle" title="Drag to reorder" aria-hidden="true">⋮⋮</span>' +
          '<button type="button" class="subtask-link" data-tid="' + escapeHtml(c.id) + '" title="Open subtask">' +
            '<span class="subtask-icon">' + iconLeft + '</span>' +
            '<span class="subtask-name">' + escapeHtml(c.subject || '(unnamed)') + '</span>' +
          '</button>' +
          stat +
          '<button type="button" class="subtask-detach" data-tid="' + escapeHtml(c.id) + '" title="Detach from this parent">×</button>' +
        '</div>';
      }).join('') + '</div>';
    // Wire link → open the child in the modal
    list.querySelectorAll('.subtask-link').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cid = btn.dataset.tid;
        if (typeof closeModal === 'function') closeModal();
        setTimeout(() => openModal(cid), 0);
      });
    });
    // Wire detach → clear groupId on child
    list.querySelectorAll('.subtask-detach').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cid = btn.dataset.tid;
        const c = bnTaskById(cid);
        if (!c) return;
        c.groupId = '';
        c._pendingSync = true;
        // Drop the detached child from the parent's order array so it doesn't
        // leave a ghost slot if it ever gets re-attached.
        if (Array.isArray(t.subtaskOrder)) {
          t.subtaskOrder = t.subtaskOrder.filter(id => id !== cid);
        }
        saveAndSyncTaskDates();
        renderSubtasksInModal(t);
      });
    });
    // Wire drag-and-drop reorder.
    const rows = Array.from(list.querySelectorAll('.subtask-row'));
    let draggingId = '';
    function _clearOverState() {
      rows.forEach(r => r.classList.remove('subtask-drag-over-before', 'subtask-drag-over-after'));
    }
    rows.forEach(row => {
      row.addEventListener('dragstart', e => {
        draggingId = row.dataset.tid || '';
        row.classList.add('subtask-dragging');
        try {
          e.dataTransfer.effectAllowed = 'move';
          // Required for Firefox to start the drag at all.
          e.dataTransfer.setData('text/plain', draggingId);
        } catch (_) {}
      });
      row.addEventListener('dragend', () => {
        draggingId = '';
        row.classList.remove('subtask-dragging');
        _clearOverState();
      });
      row.addEventListener('dragover', e => {
        if (!draggingId || row.dataset.tid === draggingId) return;
        e.preventDefault();
        try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
        // Halfway split: top half = drop before, bottom half = drop after.
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < (rect.height / 2);
        _clearOverState();
        row.classList.add(before ? 'subtask-drag-over-before' : 'subtask-drag-over-after');
      });
      row.addEventListener('dragleave', e => {
        // Only clear if we're truly leaving the row (relatedTarget outside it).
        if (!row.contains(e.relatedTarget)) {
          row.classList.remove('subtask-drag-over-before', 'subtask-drag-over-after');
        }
      });
      row.addEventListener('drop', e => {
        e.preventDefault();
        const targetId = row.dataset.tid;
        const movedId = draggingId;
        _clearOverState();
        if (!movedId || !targetId || movedId === targetId) return;
        const rect = row.getBoundingClientRect();
        const before = (e.clientY - rect.top) < (rect.height / 2);
        // Rebuild the order from current DOM children, then reinsert movedId
        // at the chosen position relative to targetId.
        const currentIds = bnSortedSubtasks(t).map(k => k.id);
        const withoutMoved = currentIds.filter(id => id !== movedId);
        const idx = withoutMoved.indexOf(targetId);
        if (idx < 0) return;
        const insertAt = before ? idx : idx + 1;
        withoutMoved.splice(insertAt, 0, movedId);
        t.subtaskOrder = withoutMoved;
        t._pendingSync = true;
        if (typeof saveAndSyncTaskDates === 'function') saveAndSyncTaskDates();
        else if (typeof saveStore === 'function') saveStore(STORE);
        renderSubtasksInModal(t);
        // Re-render any open calendar / panel views so the new order propagates.
        if (typeof render === 'function') { try { render(); } catch (_) {} }
      });
    });
  }
  // Search picker: any task that's NOT already this task's child, NOT this task itself, and NOT one of this task's ancestors.
  const ancestors = new Set();
  let cur = t;
  while (cur && cur.groupId) {
    ancestors.add(cur.groupId);
    cur = bnTaskById(cur.groupId);
  }
  function getCandidates(query) {
    const q = (query || '').toLowerCase().trim();
    return (STORE.tasks || []).filter(x => {
      if (x.id === t.id) return false;
      if (x.groupId === t.id) return false;        // already a child
      if (ancestors.has(x.id)) return false;        // would create cycle
      if (!q) return true;
      return (x.subject || '').toLowerCase().indexOf(q) >= 0;
    }).slice().sort((a, b) => (a.subject || '').localeCompare(b.subject || ''));
  }
  function renderSuggestions(query) {
    const cands = getCandidates(query).slice(0, 30);
    if (cands.length === 0) {
      sugg.innerHTML = '<div class="subtask-suggestion-empty">No matches</div>';
    } else {
      sugg.innerHTML = cands.map(c => {
        const icon = c.isGroup ? '📁' : '·';
        const sAttr = c.slackStatus ? ' data-status="' + escapeHtml(c.slackStatus) + '"' : '';
        const stat = c.slackStatus ? '<span class="subtask-status"' + sAttr + '>' + escapeHtml(c.slackStatus) + '</span>' : '';
        return '<button type="button" class="subtask-suggestion" data-tid="' + escapeHtml(c.id) + '"' + sAttr + '>' +
          '<span class="subtask-icon">' + icon + '</span>' +
          '<span class="subtask-name">' + escapeHtml(c.subject || '(unnamed)') + '</span>' +
          stat +
        '</button>';
      }).join('');
      sugg.querySelectorAll('.subtask-suggestion').forEach(btn => {
        btn.addEventListener('mousedown', e => {   // mousedown so it fires before blur
          e.preventDefault();
          const cid = btn.dataset.tid;
          const c = bnTaskById(cid);
          if (!c) return;
          c.groupId = t.id;
          c._pendingSync = true;
          // Append the new child to the end of the parent's order so it shows
          // up at the bottom of the list (matches the user's mental model:
          // "I just added this, it should appear after the existing ones").
          if (!Array.isArray(t.subtaskOrder)) t.subtaskOrder = [];
          if (!t.subtaskOrder.includes(cid)) t.subtaskOrder.push(cid);
          saveAndSyncTaskDates();
          searchInp.value = '';
          sugg.style.display = 'none';
          renderSubtasksInModal(t);
        });
      });
    }
  }
  // Positions the suggestions popover with viewport coordinates so it overlays
  // the modal instead of pushing its content down. Called each time the popover
  // opens (oninput/onfocus) and on window scroll/resize while it's visible.
  function _positionSugg() {
    const r = searchInp.getBoundingClientRect();
    sugg.style.left = r.left + 'px';
    sugg.style.width = r.width + 'px';
    // Place below first so we can measure actual rendered height.
    sugg.style.top  = (r.bottom + 4) + 'px';
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const sH = sugg.offsetHeight || 240;
    const spaceBelow = vh - r.bottom - 8;
    const spaceAbove = r.top - 8;
    // Flip up only when it doesn't fit below AND there's more room above.
    if (sH > spaceBelow && spaceAbove > spaceBelow) {
      const top = Math.max(8, r.top - sH - 4);
      sugg.style.top = top + 'px';
    }
  }
  // Wire search input
  searchInp.value = '';
  searchInp.oninput = () => {
    renderSuggestions(searchInp.value);
    sugg.style.display = '';
    _positionSugg();
  };
  searchInp.onfocus = () => {
    renderSuggestions(searchInp.value);
    sugg.style.display = '';
    _positionSugg();
  };
  searchInp.onblur = () => {
    setTimeout(() => { sugg.style.display = 'none'; }, 120);
  };
  searchInp.onkeydown = e => {
    if (e.key === 'Escape') {
      searchInp.value = '';
      sugg.style.display = 'none';
      searchInp.blur();
    }
  };
  // Reposition the popover while open so it stays glued to the input on scroll
  // (modal can scroll vertically) or viewport resize.
  if (!searchInp._bnReposWired) {
    const repos = () => { if (sugg.style.display !== 'none') _positionSugg(); };
    window.addEventListener('scroll', repos, true);
    window.addEventListener('resize', repos);
    searchInp._bnReposWired = true;
  }
}

