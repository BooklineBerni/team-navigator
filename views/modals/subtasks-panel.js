// =============================================================================
// views/modals/subtasks-panel.js
// ---------------------------------------------------------------------------
// Subtasks panel inside the task modal (group mode).
//
// Loaded AFTER inline. Wirings inside this block move together with their
// functions so DOM addEventListener calls resolve their references locally.
// References to STORE / TEAM / helpers resolve via the shared classic-script
// scope at runtime (when modal events fire).
// =============================================================================

// ---- Subtasks panel inside the task modal (shown when isGroup=true) ----
function renderSubtasksInModal(t) {
  const list = document.getElementById("f_subtasksList");
  const searchInp = document.getElementById("f_subtasksSearch");
  const sugg = document.getElementById("f_subtasksSuggestions");
  if (!list || !searchInp || !sugg) return;
  const children = (STORE.tasks || []).filter(x => x.groupId === t.id && x.id !== t.id);
  // Render the list of current subtasks
  if (children.length === 0) {
    list.innerHTML = '<span style="color:#9a9a9a; font-size:12px">No subtasks yet</span>';
  } else {
    list.innerHTML = '<div class="subtasks-list">' + children
      .slice()
      .sort((a, b) => (a.subject || '').localeCompare(b.subject || ''))
      .map(c => {
        const iconLeft = c.isGroup ? '📁' : '·';
        const sAttr = c.slackStatus ? ' data-status="' + escapeHtml(c.slackStatus) + '"' : '';
        const stat = c.slackStatus ? '<span class="subtask-status" data-status="' + escapeHtml(c.slackStatus) + '">' + escapeHtml(c.slackStatus) + '</span>' : '';
        return '<div class="subtask-row" data-tid="' + escapeHtml(c.id) + '"' + sAttr + '>' +
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
        saveAndSyncTaskDates();
        renderSubtasksInModal(t);
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
          saveAndSyncTaskDates();
          searchInp.value = '';
          sugg.style.display = 'none';
          renderSubtasksInModal(t);
        });
      });
    }
  }
  // Wire search input
  searchInp.value = '';
  searchInp.oninput = () => {
    renderSuggestions(searchInp.value);
    sugg.style.display = '';
  };
  searchInp.onfocus = () => {
    renderSuggestions(searchInp.value);
    sugg.style.display = '';
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
}

